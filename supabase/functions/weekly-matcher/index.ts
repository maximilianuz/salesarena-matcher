// Supabase Edge Function: weekly-matcher
//
// Emparejador 1:1 de Sales-Arena Matcher. Idempotente: puede correr por cron
// cada hora. En cada corrida, por sala:
//   1. Expira propuestas 'propuesto' cuyo respond_by ya pasó.
//   2. Toma los miembros activos SIN propuesta viva esta semana (incluye a los
//      que quedaron libres por rechazo/expiración) y los empareja 1:1
//      priorizando por score de confiabilidad (60 días). No repite parejas ya
//      rechazadas/expiradas en la semana.
//   3. Inserta las nuevas propuestas con respond_by = ahora + RESPOND_HOURS.
//
// La lógica de emparejamiento replica src/matcher.js del cliente:
// mantener ambas alineadas si se cambia el algoritmo.
//
// Deploy:   supabase functions deploy weekly-matcher --no-verify-jwt
// Secrets:  usa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (inyectados por defecto)
// Config:   RESPOND_HOURS (opcional, default 24)

import { createClient } from 'npm:@supabase/supabase-js@2';

const RESPOND_HOURS = Number(Deno.env.get('RESPOND_HOURS') || '24');
const BASELINE_SCORE = 50;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// --- Helpers compartidos con el cliente (src/matcher.js / App.jsx) ---

const tzOffsetCache: Record<string, number> = {};
const getOffsetMinutes = (tz: string): number => {
  if (!tz || tz === 'UTC') return 0;
  if (tzOffsetCache[tz] !== undefined) return tzOffsetCache[tz];
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date());
    const name = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    const offset = m
      ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0))
      : 0;
    tzOffsetCache[tz] = offset;
    return offset;
  } catch {
    return 0;
  }
};

const currentWeekStartISO = (now = new Date()): string => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayIdx = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayIdx);
  return d.toISOString().slice(0, 10);
};

type Member = { email: string; name: string; tz: string };
type Pair = { a: Member; b: Member; slot: number };

const buildWeeklyPairs = (
  members: Member[],
  slotSets: Map<string, Set<number>>,
  scores: Map<string, number | null>,
  excludedPairs: Set<string>
): { pairs: Pair[] } => {
  const scoreOf = (email: string) => scores.get(email) ?? BASELINE_SCORE;
  const pairKey = (e1: string, e2: string) => [e1.toLowerCase(), e2.toLowerCase()].sort().join('|');
  const ranked = [...members].sort((a, b) => (scoreOf(b.email) ?? BASELINE_SCORE) - (scoreOf(a.email) ?? BASELINE_SCORE));
  const assigned = new Set<string>();
  const pairs: Pair[] = [];

  for (const m of ranked) {
    if (assigned.has(m.email)) continue;
    const mySlots = slotSets.get(m.email);
    if (!mySlots || mySlots.size === 0) continue;

    let best: { cand: Member; score: number; common: number[] } | null = null;
    for (const cand of ranked) {
      if (cand.email === m.email || assigned.has(cand.email)) continue;
      if (excludedPairs.has(pairKey(m.email, cand.email))) continue;
      const candSlots = slotSets.get(cand.email);
      if (!candSlots || candSlots.size === 0) continue;
      const common = [...mySlots].filter(s => candSlots.has(s));
      if (common.length === 0) continue;
      const candScore = scoreOf(cand.email) ?? BASELINE_SCORE;
      if (!best || candScore > best.score || (candScore === best.score && common.length > best.common.length)) {
        best = { cand, score: candScore, common };
      }
    }
    if (best) {
      assigned.add(m.email);
      assigned.add(best.cand.email);
      pairs.push({ a: m, b: best.cand, slot: Math.min(...best.common) });
    }
  }
  return { pairs };
};

// --- Corrida principal ---

Deno.serve(async (req) => {
  try {
    const week = currentWeekStartISO();
    const nowIso = new Date().toISOString();
    const respondBy = new Date(Date.now() + RESPOND_HOURS * 3600e3).toISOString();

    // 1. Expirar propuestas vencidas (todas las salas)
    await supabase
      .from('match_proposals')
      .update({ status: 'expirado' })
      .eq('status', 'propuesto')
      .lt('respond_by', nowIso);

    // 2. Salas a procesar (opcional: ?room=<id> para una sola)
    const url = new URL(req.url);
    const onlyRoom = url.searchParams.get('room');
    const { data: rooms } = onlyRoom
      ? { data: [{ id: onlyRoom }] }
      : await supabase.from('rooms').select('id');

    const summary: Record<string, number> = {};

    for (const room of rooms || []) {
      const roomId = room.id;

      const [{ data: members }, { data: avails }, { data: weekProposals }] = await Promise.all([
        supabase.from('members').select('*').eq('room_id', roomId).eq('active', true),
        supabase.from('availabilities').select('*').eq('room_id', roomId),
        supabase.from('match_proposals').select('*').eq('room_id', roomId).eq('week_start', week)
      ]);
      if (!members || members.length < 2) continue;

      // Miembros con propuesta viva (propuesto/confirmado) quedan fuera del pool
      const busy = new Set(
        (weekProposals || [])
          .filter(p => p.status === 'propuesto' || p.status === 'confirmado')
          .flatMap(p => [p.member_a_email.toLowerCase(), p.member_b_email.toLowerCase()])
      );
      // Parejas ya rechazadas/expiradas esta semana: no repetir
      const excluded = new Set<string>(
        (weekProposals || [])
          .filter(p => p.status === 'rechazado' || p.status === 'expirado')
          .map(p => [p.member_a_email.toLowerCase(), p.member_b_email.toLowerCase()].sort().join('|'))
      );

      const pool: Member[] = members
        .filter(m => !busy.has(m.email.toLowerCase()))
        .map(m => ({ email: m.email, name: m.name, tz: m.timezone }));
      if (pool.length < 2) continue;

      // Slots UTC libres por miembro
      const slotSets = new Map<string, Set<number>>();
      for (const m of pool) {
        const offset = getOffsetMinutes(m.tz);
        const set = new Set<number>();
        (avails || [])
          .filter(a => a.user.toLowerCase() === m.name.toLowerCase())
          .forEach(rule => {
            const startUtcMin = rule.day_idx * 1440 + rule.start_hour * 60 - offset;
            const endUtcMin = rule.day_idx * 1440 + rule.end_hour * 60 - offset;
            // Solapamiento (no contención total): con offsets no múltiplos de 60
            // (ej. India UTC+5:30) un bloque local de 1h nunca cae completamente
            // dentro de un slot UTC de 1h, y con "contención total" ese miembro
            // quedaría con 0 slots para siempre, sin ningún aviso. Debe coincidir
            // con src/App.jsx (computeSlotSets / calculateEngine).
            for (let s = 0; s < 168; s++) {
              if (s * 60 < endUtcMin && (s + 1) * 60 > startUtcMin) set.add(s);
            }
          });
        slotSets.set(m.email, set);
      }

      // Scores de confiabilidad (ventana 60 días): asistio / (asistio + no_show)
      const cutoff = new Date(Date.now() - 60 * 24 * 3600e3).toISOString();
      const { data: attRows } = await supabase
        .from('meeting_attendees')
        .select('member_email, status, created_at')
        .eq('room_id', roomId)
        .in('status', ['asistio', 'no_show'])
        .gte('created_at', cutoff);

      const scores = new Map<string, number | null>();
      for (const m of pool) {
        const rows = (attRows || []).filter(r => r.member_email.toLowerCase() === m.email.toLowerCase());
        scores.set(
          m.email,
          rows.length === 0
            ? null
            : Math.round((rows.filter(r => r.status === 'asistio').length / rows.length) * 100)
        );
      }

      // Emparejar e insertar propuestas
      const { pairs } = buildWeeklyPairs(pool, slotSets, scores, excluded);
      if (pairs.length === 0) continue;

      const { error } = await supabase.from('match_proposals').insert(pairs.map(p => ({
        room_id: roomId,
        week_start: week,
        member_a_email: p.a.email,
        member_a_name: p.a.name,
        member_b_email: p.b.email,
        member_b_name: p.b.name,
        slot_start: p.slot,
        respond_by: respondBy
      })));
      if (!error) summary[roomId] = pairs.length;
    }

    return new Response(JSON.stringify({ ok: true, week, created: summary }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
