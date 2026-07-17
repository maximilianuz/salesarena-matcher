// Supabase Edge Function: weekly-matcher
//
// Emparejador 1:1 de Sales-Arena Matcher. Idempotente: puede correr por cron
// cada hora. En cada corrida, por sala:
//   1. Expira propuestas 'propuesto' cuyo respond_by ya pasó (nadie confirmó
//      con 4hs de antelación) → esos miembros vuelven al pool para REASIGNAR.
//   2. Excluye del pool a los miembros BLOQUEADOS: 3+ faltas (no-show +
//      cancelación tardía) dentro del mes calendario, hasta el 1ero del mes
//      siguiente.
//   3. Toma los miembros activos SIN propuesta viva esta semana y los empareja
//      1:1 con criterio ANTI-AMIGUISMO: prioriza duplas que menos veces se
//      juntaron (rotación "todos con todos"), luego mayor confiabilidad y luego
//      mayor solapamiento. El historial de rotación cuenta solo reuniones
//      CONCRETADAS (llegaron a su horario sin cancelarse; el no-show cuenta).
//      Las duplas RECHAZADAS esta semana se excluyen; las EXPIRADAS se evitan
//      si hay otro compañero disponible (reasignación por mapa de calor) y solo
//      se re-ofrecen si son la única coincidencia.
//   4. Asigna el horario común más PRÓXIMO que esté a >= 30min e inserta/reactiva
//      la propuesta con una VENTANA DE CONFIRMACIÓN ESCALONADA: respond_by = el
//      mayor escalón (4hs → 2hs → 1h → 30min) cuyo vencimiento siga en el futuro.
//      Como el cron corre cada 10 min, al vencer una propuesta sin confirmar se
//      reasigna casi en el acto y la nueva ventana es más corta automáticamente,
//      hasta 30min antes de la reunión ("oportunidades" hasta que se cumpla la hora).
//   5. BARRIDO DE ASISTENCIA (tolerancia 10 min): para reuniones cuya hora ya pasó
//      +10min, a cada participante que sigue 'confirmado' (nadie reportó) se lo
//      resuelve por el click al Meet: con joined_at → 'asistio' (a_tiempo/tarde
//      según los 10 min), sin joined_at → 'no_show'.
//
// Score de confiabilidad (60 días) ponderado por puntualidad: asistió a tiempo
// = 1, asistió tarde (>10 min) = 0.5, no-show / cancelación tardía = 0.
//
// La lógica de emparejamiento replica src/matcher.js del cliente:
// mantener ambas alineadas si se cambia el algoritmo.
//
// Deploy:   supabase functions deploy weekly-matcher --no-verify-jwt
// Secrets:  usa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (inyectados por defecto)

import { createClient } from 'npm:@supabase/supabase-js@2';

// Ventana de confirmación escalonada: 4h → 2h → 1h → 30m. En cada (re)asignación
// se toma el mayor escalón cuyo vencimiento siga en el futuro; el piso para
// proponer un slot es el escalón más chico (30 min). Debe coincidir con
// CONFIRM_STEPS_MS / respondByMs en src/matcher.js.
const CONFIRM_STEPS_MS = [4, 2, 1, 0.5].map((h) => h * 3600e3);
const MIN_LEAD_MS = CONFIRM_STEPS_MS[CONFIRM_STEPS_MS.length - 1];
const respondByMs = (meetingMs: number, now: Date): number | null => {
  const t = now.getTime();
  for (const step of CONFIRM_STEPS_MS) if (meetingMs - step > t) return meetingMs - step;
  return null;
};
// Tolerancia de asistencia: si a los 10 min del inicio nadie abrió el Meet, se
// marca no-show automático.
const ATTENDANCE_TOLERANCE_MS = 10 * 60 * 1000;
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

// Epoch (ms) de la PRÓXIMA ocurrencia de un slot UTC (0..167) que sea
// >= now + minLeadMs. Si la de esta semana cae antes del piso, rueda a la
// siguiente. Debe coincidir con nextSlotOccurrenceMs en src/matcher.js.
const nextSlotOccurrenceMs = (slot: number, now: Date, minLeadMs = 0): number => {
  const dayIdx = Math.floor(slot / 24);
  const hourUtc = slot % 24;
  const d = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0
  ));
  const todayIdx = (d.getUTCDay() + 6) % 7; // 0 = lunes
  const delta = (dayIdx - todayIdx + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  const floor = now.getTime() + minLeadMs;
  while (d.getTime() < floor) d.setUTCDate(d.getUTCDate() + 7);
  return d.getTime();
};

// Slot que ocurre ANTES a partir de `now` (respetando minLeadMs). Evita elegir
// siempre el lunes cuando hoy es jueves y la dupla coincide, p.ej., el viernes.
const soonestSlot = (slots: number[], now: Date, minLeadMs = 0): number =>
  slots.reduce((best, s) =>
    nextSlotOccurrenceMs(s, now, minLeadMs) < nextSlotOccurrenceMs(best, now, minLeadMs) ? s : best
  );

const buildWeeklyPairs = (
  members: Member[],
  slotSets: Map<string, Set<number>>,
  scores: Map<string, number | null>,
  excludedPairs: Set<string>,
  pairCounts: Map<string, number>,
  now: Date,
  softExcludedPairs: Set<string> = new Set(),
  minLeadMs = 0
): { pairs: Pair[] } => {
  const scoreOf = (email: string) => scores.get(email) ?? BASELINE_SCORE;
  const pairKey = (e1: string, e2: string) => [e1.toLowerCase(), e2.toLowerCase()].sort().join('|');
  const timesPaired = (e1: string, e2: string) => pairCounts.get(pairKey(e1, e2)) ?? 0;
  const ranked = [...members].sort((a, b) => (scoreOf(b.email) ?? BASELINE_SCORE) - (scoreOf(a.email) ?? BASELINE_SCORE));
  const assigned = new Set<string>();
  const pairs: Pair[] = [];

  for (const m of ranked) {
    if (assigned.has(m.email)) continue;
    const mySlots = slotSets.get(m.email);
    if (!mySlots || mySlots.size === 0) continue;

    let best: { cand: Member; count: number; score: number; common: number[]; isSoft: boolean } | null = null;
    for (const cand of ranked) {
      if (cand.email === m.email || assigned.has(cand.email)) continue;
      if (excludedPairs.has(pairKey(m.email, cand.email))) continue;
      const candSlots = slotSets.get(cand.email);
      if (!candSlots || candSlots.size === 0) continue;
      const common = [...mySlots].filter(s => candSlots.has(s));
      if (common.length === 0) continue;
      const isSoft = softExcludedPairs.has(pairKey(m.email, cand.email));
      const count = timesPaired(m.email, cand.email);
      const candScore = scoreOf(cand.email) ?? BASELINE_SCORE;
      // Prioridad de selección del compañero (anti-amiguismo):
      //   0º evitar duplas soft-excluidas (expiradas) si hay alternativa
      //   1º menos veces emparejados históricamente → fuerza "todos con todos"
      //   2º mayor confiabilidad (premia compromiso)
      //   3º mayor solapamiento horario
      if (
        !best ||
        (best.isSoft && !isSoft) ||
        (best.isSoft === isSoft && (
          count < best.count ||
          (count === best.count && candScore > best.score) ||
          (count === best.count && candScore === best.score && common.length > best.common.length)
        ))
      ) {
        best = { cand, count, score: candScore, common, isSoft };
      }
    }
    if (best) {
      assigned.add(m.email);
      assigned.add(best.cand.email);
      pairs.push({ a: m, b: best.cand, slot: soonestSlot(best.common, now, minLeadMs) });
    }
  }
  return { pairs };
};

// --- Corrida principal ---

Deno.serve(async (req) => {
  try {
    const now = new Date();
    const week = currentWeekStartISO();
    const nowIso = now.toISOString();

    // 1. Expirar propuestas vencidas (todas las salas). respond_by = escalón de
    //    confirmación (4h/2h/1h/30m), así que "vencida" = no confirmada dentro de
    //    esa ventana. Al correr cada 10 min, la reasignación es casi inmediata.
    await supabase
      .from('match_proposals')
      .update({ status: 'expirado' })
      .eq('status', 'propuesto')
      .lt('respond_by', nowIso);

    // 1b. BARRIDO DE ASISTENCIA (tolerancia 10 min). Para reuniones cuya hora de
    //     inicio + 10min ya pasó (y no más viejas que 24h, para no reprocesar
    //     historia), a cada participante que sigue 'confirmado' (nadie lo reportó
    //     a mano) se lo resuelve por el click al Meet registrado en joined_at:
    //       joined_at presente → 'asistio' (a_tiempo si entró dentro de los 10 min)
    //       joined_at ausente  → 'no_show'
    //     Es idempotente: una vez resuelto, la fila deja de estar 'confirmado'.
    try {
      const sweepFloor = new Date(now.getTime() - 24 * 3600e3).toISOString();
      const sweepCeil = new Date(now.getTime() - ATTENDANCE_TOLERANCE_MS).toISOString();
      const { data: dueMeetings } = await supabase
        .from('meetings')
        .select('id, starts_at')
        .not('starts_at', 'is', null)
        .lt('starts_at', sweepCeil)
        .gt('starts_at', sweepFloor);
      const dueIds = (dueMeetings || []).map((m) => m.id);
      if (dueIds.length) {
        const startById = new Map<string, number>(
          (dueMeetings || []).map((m) => [m.id, Date.parse(m.starts_at)])
        );
        const { data: pend } = await supabase
          .from('meeting_attendees')
          .select('id, meeting_id, joined_at, status')
          .in('meeting_id', dueIds)
          .eq('status', 'confirmado');
        for (const a of pend || []) {
          const startMs = startById.get(a.meeting_id);
          if (startMs === undefined) continue;
          if (a.joined_at) {
            const punctuality = Date.parse(a.joined_at) <= startMs + ATTENDANCE_TOLERANCE_MS
              ? 'a_tiempo' : 'tarde';
            await supabase.from('meeting_attendees')
              .update({ status: 'asistio', punctuality, reported_by: 'system', reported_at: nowIso })
              .eq('id', a.id);
          } else {
            await supabase.from('meeting_attendees')
              .update({ status: 'no_show', reported_by: 'system', reported_at: nowIso })
              .eq('id', a.id);
          }
        }
      }
    } catch (_e) {
      // Si la columna joined_at aún no existe (migración sin aplicar), el barrido
      // se omite sin frenar el emparejamiento.
    }

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

      // Reuniones de la sala (base para rotación, faltas y score). La tabla
      // meeting_attendees NO tiene columna room_id: sus filas se filtran por los
      // IDs de las reuniones de esta sala.
      const { data: meetingsRows } = await supabase
        .from('meetings').select('id, starts_at').eq('room_id', roomId);
      const meetingIds = (meetingsRows || []).map(mt => mt.id);
      const { data: attRows } = meetingIds.length
        ? await supabase.from('meeting_attendees')
            .select('meeting_id, member_email, status, punctuality')
            .in('meeting_id', meetingIds)
        : { data: [] as Array<{ meeting_id: string; member_email: string; status: string; punctuality: string | null }> };

      const nowMs = Date.now();
      const meetingStartMs = new Map<string, number>();
      for (const mt of meetingsRows || []) {
        const t = mt.starts_at ? Date.parse(mt.starts_at) : NaN;
        if (!Number.isNaN(t)) meetingStartMs.set(mt.id, t);
      }

      const pairKeyOf = (a: string, b: string) =>
        [a.toLowerCase(), b.toLowerCase()].sort().join('|');

      // ROTACIÓN: reuniones CONCRETADAS por dupla (llegaron a su horario sin
      // cancelarse; el no-show sí cuenta como concretada). Ventana 120 días.
      const byMeeting = new Map<string, { email: string; status: string }[]>();
      for (const r of attRows || []) {
        if (!byMeeting.has(r.meeting_id)) byMeeting.set(r.meeting_id, []);
        byMeeting.get(r.meeting_id)!.push({ email: r.member_email, status: r.status });
      }
      const cutoff120 = nowMs - 120 * 24 * 3600e3;
      const pairCounts = new Map<string, number>();
      for (const [meetingId, rows] of byMeeting) {
        const startMs = meetingStartMs.get(meetingId);
        if (startMs === undefined || startMs > nowMs || startMs < cutoff120) continue;
        if (rows.length < 2) continue;
        const cancelled = rows.some(r =>
          r.status === 'cancelado_con_aviso' || r.status === 'cancelado_tarde');
        if (cancelled) continue; // cancelada → la dupla queda libre, no cuenta
        const key = pairKeyOf(rows[0].email, rows[1].email);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }

      // FALTAS del mes calendario (no_show + cancelado_tarde). 3+ → BLOQUEO
      // hasta el 1ero del mes siguiente. Se ancla en el mes de la reunión.
      const monthStartMs = Date.UTC(
        new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
      const faltasMes = new Map<string, number>();
      for (const r of attRows || []) {
        if (r.status !== 'no_show' && r.status !== 'cancelado_tarde') continue;
        const startMs = meetingStartMs.get(r.meeting_id);
        if (startMs === undefined || startMs < monthStartMs) continue;
        const k = r.member_email.toLowerCase();
        faltasMes.set(k, (faltasMes.get(k) ?? 0) + 1);
      }
      const blocked = new Set<string>();
      for (const [email, count] of faltasMes) if (count >= 3) blocked.add(email);

      // Miembros con propuesta viva (propuesto/confirmado) quedan fuera del pool
      const busy = new Set(
        (weekProposals || [])
          .filter(p => p.status === 'propuesto' || p.status === 'confirmado')
          .flatMap(p => [p.member_a_email.toLowerCase(), p.member_b_email.toLowerCase()])
      );
      // Parejas RECHAZADAS esta semana: exclusión DURA (se respeta el "no").
      const excluded = new Set<string>(
        (weekProposals || [])
          .filter(p => p.status === 'rechazado')
          .map(p => pairKeyOf(p.member_a_email, p.member_b_email))
      );
      // Parejas EXPIRADAS (nadie confirmó con 4hs de antelación): exclusión
      // BLANDA. Se prefiere REASIGNAR a otro compañero disponible del mapa de
      // calor; solo si no hay alternativa se re-ofrece la misma dupla,
      // REACTIVANDO la fila vencida (evita violar el UNIQUE por sala/semana/dupla).
      const softExcluded = new Set<string>();
      const expiredByPair = new Map<string, number>();
      for (const p of weekProposals || []) {
        if (p.status === 'expirado') {
          const k = pairKeyOf(p.member_a_email, p.member_b_email);
          softExcluded.add(k);
          expiredByPair.set(k, p.id);
        }
      }

      const pool: Member[] = members
        .filter(m => !busy.has(m.email.toLowerCase()) && !blocked.has(m.email.toLowerCase()))
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

      // Score de confiabilidad (ventana 60 días), ponderado por puntualidad:
      //   asistió a tiempo = 1 · asistió tarde = 0.5 · no-show = 0 ·
      //   cancelado tarde = 0 · cancelado con aviso / sin reportar = neutral.
      const cutoff60 = nowMs - 60 * 24 * 3600e3;
      const scoreVal = (status: string, punctuality: string | null): number | null => {
        if (status === 'asistio') return punctuality === 'tarde' ? 0.5 : 1;
        if (status === 'no_show' || status === 'cancelado_tarde') return 0;
        return null; // 'confirmado' / 'cancelado_con_aviso' → no computa
      };
      const attByMember = new Map<string, { status: string; punctuality: string | null; startMs: number }[]>();
      for (const r of attRows || []) {
        const startMs = meetingStartMs.get(r.meeting_id);
        if (startMs === undefined) continue;
        const k = r.member_email.toLowerCase();
        if (!attByMember.has(k)) attByMember.set(k, []);
        attByMember.get(k)!.push({ status: r.status, punctuality: r.punctuality, startMs });
      }
      const scores = new Map<string, number | null>();
      for (const m of pool) {
        const rows = (attByMember.get(m.email.toLowerCase()) || []).filter(r => r.startMs >= cutoff60);
        const vals = rows.map(r => scoreVal(r.status, r.punctuality)).filter((v): v is number => v !== null);
        scores.set(
          m.email,
          vals.length === 0 ? null : Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100)
        );
      }

      // Emparejar. El slot elegido siempre está a >= 4hs (MIN_LEAD_MS), y el
      // plazo de confirmación es 4hs antes de la reunión. Por cada dupla: si ya
      // existe una propuesta VENCIDA se REACTIVA (sin violar el UNIQUE); si no,
      // se INSERTA.
      const { pairs } = buildWeeklyPairs(
        pool, slotSets, scores, excluded, pairCounts, now, softExcluded, MIN_LEAD_MS
      );
      if (pairs.length === 0) continue;

      const toInsert: Record<string, unknown>[] = [];
      for (const p of pairs) {
        const meetingMs = nextSlotOccurrenceMs(p.slot, now, MIN_LEAD_MS);
        // Plazo escalonado: 4h→2h→1h→30m. Si la reunión está a <30min no hay
        // ventana posible → no se propone (se reintentará en la próxima corrida).
        const rbMs = respondByMs(meetingMs, now);
        if (rbMs === null) continue;
        const respondBy = new Date(rbMs).toISOString();
        const revivedId = expiredByPair.get(pairKeyOf(p.a.email, p.b.email));
        if (revivedId !== undefined) {
          await supabase.from('match_proposals').update({
            status: 'propuesto',
            status_a: null,
            status_b: null,
            slot_start: p.slot,
            respond_by: respondBy,
            meeting_id: null
          }).eq('id', revivedId);
        } else {
          toInsert.push({
            room_id: roomId,
            week_start: week,
            member_a_email: p.a.email,
            member_a_name: p.a.name,
            member_b_email: p.b.email,
            member_b_name: p.b.name,
            slot_start: p.slot,
            respond_by: respondBy
          });
        }
      }
      if (toInsert.length) {
        const { error } = await supabase.from('match_proposals').insert(toInsert);
        if (error) continue;
      }
      summary[roomId] = pairs.length;
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
