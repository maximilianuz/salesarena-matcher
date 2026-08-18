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

// Cuánto pesa NO haberse juntado antes, medido en puntos de credibilidad. La
// rotación es el criterio principal, pero no absoluta: con prioridad estricta,
// quien nunca se conecta ganaba siempre por ser cara nueva y del otro lado
// quedaba esperando alguien que sí se prepara.
// Debe coincidir con ROTATION_WEIGHT en src/matcher.js.
const ROTATION_WEIGHT = 40;
const partnerDesirability = (timesPaired: number, score: number): number =>
  score - timesPaired * ROTATION_WEIGHT;

// Tope de role-plays por persona y por semana.
//
// Marcar "libre lunes de 9 a 17" significa "cualquiera de esas horas me sirve",
// NO "agendame ocho sesiones el lunes". Sin este tope el motor llenaba cada hora
// declarada: una sala de 20 personas con 40 horas marcadas cada una generaba 400
// propuestas, 40 por persona, y la misma dupla se repetía 22 veces — con lo que
// la rotación dejaba de significar nada.
//
// El tope cuenta las propuestas VIVAS de la semana, no solo las de esta corrida:
// el cron pasa cada 10 minutos y sin eso sumaría el tope entero en cada pasada.
// Debe coincidir con MAX_SESSIONS_PER_WEEK en src/matcher.js.
const MAX_SESSIONS_PER_WEEK = 3;

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

// Epoch (ms) de la PRÓXIMA ocurrencia de un slot UTC (0..167) posterior a
// now + minLeadMs. Si la de esta semana cae en el piso o antes, rueda a la
// siguiente. El piso es ESTRICTO para que respondByMs nunca devuelva null sobre
// un slot ya dado por bueno (ventana de confirmación de cero).
// Debe coincidir con nextSlotOccurrenceMs en src/matcher.js.
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
  while (d.getTime() <= floor) d.setUTCDate(d.getUTCDate() + 7);
  return d.getTime();
};

// Slot que ocurre ANTES a partir de `now` (respetando minLeadMs). Evita elegir
// siempre el lunes cuando hoy es jueves y la dupla coincide, p.ej., el viernes.
const soonestSlot = (slots: number[], now: Date, minLeadMs = 0): number =>
  slots.reduce((best, s) =>
    nextSlotOccurrenceMs(s, now, minLeadMs) < nextSlotOccurrenceMs(best, now, minLeadMs) ? s : best
  );

const EMPTY_SLOTS: Set<number> = new Set();

const buildWeeklyPairs = (
  members: Member[],
  slotSets: Map<string, Set<number>>,
  scores: Map<string, number | null>,
  excludedPairs: Set<string>,
  pairCounts: Map<string, number>,
  now: Date,
  softExcludedPairs: Set<string> = new Set(),
  minLeadMs = 0,
  busySlots: Map<string, Set<number>> = new Map()
): { pairs: Pair[] } => {
  const scoreOf = (email: string) => scores.get(email) ?? BASELINE_SCORE;
  const pairKey = (e1: string, e2: string) => [e1.toLowerCase(), e2.toLowerCase()].sort().join('|');
  const timesPaired = (e1: string, e2: string) => pairCounts.get(pairKey(e1, e2)) ?? 0;
  const busyOf = (email: string) => busySlots.get(email.toLowerCase()) ?? EMPTY_SLOTS;
  const ranked = [...members].sort((a, b) => (scoreOf(b.email) ?? BASELINE_SCORE) - (scoreOf(a.email) ?? BASELINE_SCORE));
  const assigned = new Set<string>();
  const pairs: Pair[] = [];

  const freeSlotsOf = (email: string): number[] => {
    const all = slotSets.get(email);
    if (!all) return [];
    const busy = busyOf(email);
    return [...all].filter(s => !busy.has(s));
  };

  // De los horarios comunes de la dupla, cuál ocupar. Tomar siempre el más
  // próximo dejaba gente afuera: dos personas con varias horas libres se
  // quedaban con la ÚNICA hora de una tercera y esa tercera perdía su sesión de
  // la semana. Primero se mira a quién deja sin nada cada opción; entre las que
  // empatan, la más próxima. Debe coincidir con src/matcher.js.
  const leastContendedSlot = (common: number[], m: Member, cand: Member): number => {
    let best: { slot: number; dejaSinNada: number; cuando: number } | null = null;
    for (const s of common) {
      let dejaSinNada = 0;
      for (const otro of ranked) {
        if (otro.email === m.email || otro.email === cand.email) continue;
        if (assigned.has(otro.email)) continue;
        const libres = freeSlotsOf(otro.email);
        if (libres.length === 1 && libres[0] === s) dejaSinNada++;
      }
      const cuando = nextSlotOccurrenceMs(s, now, minLeadMs);
      if (
        !best ||
        dejaSinNada < best.dejaSinNada ||
        (dejaSinNada === best.dejaSinNada && cuando < best.cuando)
      ) {
        best = { slot: s, dejaSinNada, cuando };
      }
    }
    return best!.slot;
  };

  for (const m of ranked) {
    if (assigned.has(m.email)) continue;
    const mySlots = slotSets.get(m.email);
    if (!mySlots || mySlots.size === 0) continue;
    const myBusy = busyOf(m.email);
    const myFree = [...mySlots].filter(s => !myBusy.has(s));
    if (myFree.length === 0) continue;

    let best: { cand: Member; count: number; score: number; desirability: number; common: number[]; isSoft: boolean } | null = null;
    for (const cand of ranked) {
      if (cand.email === m.email || assigned.has(cand.email)) continue;
      if (excludedPairs.has(pairKey(m.email, cand.email))) continue;
      const candSlots = slotSets.get(cand.email);
      if (!candSlots || candSlots.size === 0) continue;
      // Solapamiento REALMENTE disponible: descarta lo que cualquiera de los dos
      // ya tiene comprometido, para que nadie termine con dos role-plays a la
      // misma hora. Debe coincidir con src/matcher.js.
      const candBusy = busyOf(cand.email);
      const common = myFree.filter(s => candSlots.has(s) && !candBusy.has(s));
      if (common.length === 0) continue;
      const isSoft = softExcludedPairs.has(pairKey(m.email, cand.email));
      const count = timesPaired(m.email, cand.email);
      const candScore = scoreOf(cand.email) ?? BASELINE_SCORE;
      const desirability = partnerDesirability(count, candScore);
      // Prioridad de selección del compañero (anti-amiguismo):
      //   0º evitar duplas soft-excluidas si hay alternativa: las que ya se
      //      juntaron esta semana y las que dejaron vencer una propuesta.
      //   1º mayor deseabilidad: rotación con el peso de ROTATION_WEIGHT y la
      //      credibilidad como contrapeso.
      //   2º mayor solapamiento horario
      if (
        !best ||
        (best.isSoft && !isSoft) ||
        (best.isSoft === isSoft && (
          desirability > best.desirability ||
          (desirability === best.desirability && common.length > best.common.length)
        ))
      ) {
        best = { cand, count, score: candScore, desirability, common, isSoft };
      }
    }
    if (best) {
      assigned.add(m.email);
      assigned.add(best.cand.email);
      pairs.push({ a: m, b: best.cand, slot: leastContendedSlot(best.common, m, best.cand) });
    }
  }
  return { pairs };
};

// --- Corrida principal ---

// CORS: el cliente llama a esta función directo desde el navegador
// (triggerWeeklyMatcher en App.jsx, con ?room= y Authorization: Bearer). Al
// llevar un header custom, el navegador manda antes un preflight OPTIONS; sin
// responderlo con estos headers, el fetch fallaba SIEMPRE de forma silenciosa
// (quedaba tapado por el try/catch de triggerWeeklyMatcher) y solo el cron
// cada 10 min terminaba emparejando. Solo se admite el origen de producción:
// reflejar cualquier Origin sería tan abierto como no tener CORS.
const ALLOWED_ORIGINS = new Set([
  'https://sales-arena-matcher.com',
  'https://www.sales-arena-matcher.com'
]);
const corsHeaders = (origin: string | null): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : '',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
});

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  try {
    // --- AUTORIZACIÓN ---
    // Hay dos llamadores legítimos y se tratan distinto:
    //
    //   1. El cron cada 10 min. Corre la pasada GLOBAL: expira propuestas
    //      vencidas, resuelve asistencias y empareja todas las salas. Es
    //      idempotente y no acepta parámetros, así que dispararla de más no
    //      cambia ningún resultado. Se admite sin credencial para no repetir
    //      el incidente de 20260718170000, donde exigir un secreto que el cron
    //      no podía construir dejó el emparejador caído al 100%.
    //
    //   2. El cliente, al cambiar la disponibilidad, con ?room=<id>. Esa forma
    //      SÍ es dirigida (elige sobre qué sala actuar) y por eso exige sesión
    //      válida Y pertenencia a esa sala: no alcanza con estar logueado, o
    //      cualquier usuario podría forzar corridas sobre una sala ajena.
    //
    // Si CRON_SECRET está configurado, vale como credencial para ambas formas y
    // ADEMÁS pasa a exigirse en la pasada global. Mientras no se configure, la
    // global queda abierta (comportamiento actual). Si se configura, hay que
    // agregar el header x-cron-secret al cron o dejará de correr.
    const cronSecret = Deno.env.get('CRON_SECRET');
    const hasCronSecret = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;

    const url = new URL(req.url);
    const onlyRoom = url.searchParams.get('room');

    const unauthorized = (reason: string) => {
      console.warn(`Rejected weekly-matcher run: ${reason}`);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    };

    // El token del usuario viaja en Authorization: Bearer <jwt>. getUser lo
    // valida contra Supabase; un token ausente, vencido o falso no pasa.
    const authHeader = req.headers.get('Authorization') || '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const { data: userData } = bearer
      ? await supabase.auth.getUser(bearer)
      : { data: { user: null } };
    const callerEmail = userData?.user?.email?.toLowerCase() || null;

    if (onlyRoom) {
      if (!hasCronSecret) {
        if (!callerEmail) return unauthorized('targeted run without a valid session');

        // Estar logueado no basta: hay que ser miembro de ESA sala.
        // El email se compara sin distinguir mayúsculas porque el alta manual
        // lo guarda tal cual se escribió, y se escapan los comodines de LIKE:
        // el guion bajo es válido en un email y en ILIKE significa "cualquier
        // carácter", así que sin escapar podría dar por buena a otra persona.
        const { data: membership } = await supabase
          .from('members')
          .select('email')
          .eq('room_id', onlyRoom)
          .ilike('email', callerEmail.replace(/[\\%_]/g, '\\$&'))
          .maybeSingle();

        if (!membership) {
          return unauthorized(`caller is not a member of room ${onlyRoom}`);
        }
      }
    } else if (cronSecret && !hasCronSecret && !callerEmail) {
      // Pasada global con secreto configurado: se exige el secreto (cron) o una
      // sesión válida (cliente).
      return unauthorized('global run without cron secret or session');
    }

    // --- LOCK: una sola corrida a la vez ---
    // El cron dispara cada 10 minutos y una corrida con muchas salas puede
    // tardar más que eso. Dos corridas solapadas leen el mismo estado de
    // propuestas y de horarios ocupados antes de que ninguna escriba, y pueden
    // terminar agendando a la misma persona dos veces en el mismo horario.
    //
    // El lock es la misma llave para la pasada global y para la dirigida:
    // las dos escriben las mismas tablas. Quien no lo consigue NO es un error
    // —el trabajo es idempotente y la próxima corrida del cron lo hace igual—,
    // así que se responde 200 y el cliente no muestra ninguna alarma.
    const { data: gotLock } = await supabase.rpc('try_acquire_job_lock', {
      p_name: 'weekly-matcher',
      p_ttl_seconds: 900
    });
    // Se compara contra `false` a propósito, y no `if (!gotLock)`: si la RPC
    // falla —por ejemplo porque la migración del lock todavía no se aplicó—
    // `data` viene null y el emparejador tiene que SEGUIR funcionando. Solapar
    // dos corridas es un riesgo acotado; dejar la sala sin emparejamientos por
    // una pieza de infraestructura ausente ya rompió el sistema una vez
    // (ver 20260718170000, el incidente del CRON_SECRET).
    if (gotLock === false) {
      return new Response(
        JSON.stringify({ ok: true, skipped: 'already_running' }),
        { headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }

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
          .in('meeting_id', dueIds);
        // Reuniones caídas por cancelación de algún participante: al que quedó
        // 'confirmado' esperando NO se lo puede penalizar como no-show por no
        // unirse a una sesión que ya no iba a ocurrir. Se lo resuelve como
        // 'cancelado_con_aviso' (no computa en confiabilidad ni en faltas).
        const cancelledMeetings = new Set(
          (pend || [])
            .filter((a) => a.status === 'cancelado_con_aviso' || a.status === 'cancelado_tarde')
            .map((a) => a.meeting_id)
        );
        for (const a of pend || []) {
          if (a.status !== 'confirmado') continue;
          const startMs = startById.get(a.meeting_id);
          if (startMs === undefined) continue;
          if (cancelledMeetings.has(a.meeting_id)) {
            await supabase.from('meeting_attendees')
              .update({ status: 'cancelado_con_aviso', reported_by: 'system', reported_at: nowIso })
              .eq('id', a.id);
          } else if (a.joined_at) {
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
    } catch (sweepError) {
      // Si la columna joined_at aún no existe (migración sin aplicar), el barrido
      // se omite sin frenar el emparejamiento. Se deja registro para poder
      // distinguir ese caso esperado de una falla real al revisar los logs.
      console.warn('Barrido de asistencia omitido:', String(sweepError));
    }

    // 2. Salas a procesar (?room=<id> limita a una sola; ya validado arriba)
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
        .from('meetings').select('id, starts_at, duration').eq('room_id', roomId);
      const meetingIds = (meetingsRows || []).map(mt => mt.id);
      const { data: attRows } = meetingIds.length
        ? await supabase.from('meeting_attendees')
            .select('meeting_id, member_email, status, punctuality')
            .in('meeting_id', meetingIds)
        : { data: [] as Array<{ meeting_id: string; member_email: string; status: string; punctuality: string | null }> };

      const nowMs = Date.now();
      const meetingStartMs = new Map<string, number>();
      // Fin real de cada reunión: lo usa el cierre de sesión para saber si ya
      // venció el plazo. duration es nullable, así que se cae a 60 igual que
      // meeting_end_at() en la base y que el cliente.
      const meetingEndMs = new Map<string, number>();
      for (const mt of meetingsRows || []) {
        const t = mt.starts_at ? Date.parse(mt.starts_at) : NaN;
        if (!Number.isNaN(t)) {
          meetingStartMs.set(mt.id, t);
          meetingEndMs.set(mt.id, t + (mt.duration || 60) * 60000);
        }
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

      // Parejas que NO se pueden repetir esta semana:
      // - RECHAZADO: exclusión DURA (se respeta el "no")
      // - CANCELADO: no se re-ofrece esta semana
      // - PROPUESTO/CONFIRMADO: ya tienen propuesta viva con esta persona
      const excluded = new Set<string>(
        (weekProposals || [])
          .filter(p => p.status === 'rechazado' || p.status === 'cancelado' ||
                        p.status === 'propuesto' || p.status === 'confirmado')
          .map(p => pairKeyOf(p.member_a_email, p.member_b_email))
      );
      // Parejas EXPIRADAS (nadie confirmó con 4hs de antelación): exclusión
      // BLANDA. Se prefiere REASIGNAR a otro compañero disponible del mapa de
      // calor; solo si no hay alternativa se re-ofrece la misma dupla,
      // REACTIVANDO la fila vencida (evita violar el UNIQUE por sala/semana/dupla).
      // Una MISMA dupla puede tener varias propuestas vencidas en la semana
      // (ahora que pueden juntarse más de una vez), así que se guardan en cola:
      // cada sesión nueva reutiliza una fila vencida distinta y, cuando se
      // acaban, se insertan filas nuevas. Con un solo id por dupla, la segunda
      // sesión pisaba la reactivación de la primera y se perdía una propuesta.
      const softExcluded = new Set<string>();
      const expiredByPair = new Map<string, number[]>();
      for (const p of weekProposals || []) {
        if (p.status === 'expirado') {
          const k = pairKeyOf(p.member_a_email, p.member_b_email);
          softExcluded.add(k);
          if (!expiredByPair.has(k)) expiredByPair.set(k, []);
          expiredByPair.get(k)!.push(p.id);
        }
      }

      // Pool inicial: miembros no bloqueados (sin importar si tienen propuestas)
      // Múltiples propuestas están permitidas siempre que sean con personas diferentes
      const pool: Member[] = members
        .filter(m => !blocked.has(m.email.toLowerCase()))
        .map(m => ({ email: m.email, name: m.name, tz: m.timezone }));
      if (pool.length < 2) continue;

      // Slots UTC libres por miembro
      const slotSets = new Map<string, Set<number>>();
      for (const m of pool) {
        const offset = getOffsetMinutes(m.tz);
        const set = new Set<number>();
        (avails || [])
          // El vínculo real con el miembro es member_email, que es estable. El
          // nombre solo sirve de respaldo para las filas anteriores a esa
          // columna: empatar por nombre era lo que hacía que dos homónimos de
          // la misma sala compartieran horarios. Debe coincidir con
          // ruleBelongsTo en src/slots.js.
          .filter(a => a.member_email
            ? a.member_email.toLowerCase() === m.email.toLowerCase()
            : (a.user || '').toLowerCase() === (m.name || '').toLowerCase())
          .forEach(rule => {
            const startUtcMin = rule.day_idx * 1440 + rule.start_hour * 60 - offset;
            const endUtcMin = rule.day_idx * 1440 + rule.end_hour * 60 - offset;
            // Regla degenerada o invertida (start_hour >= end_hour, dato legado
            // o corrupto): no describe ninguna franja real. Sin este corte, con
            // un offset fraccionario (India +5:30) el solapamiento de abajo
            // igual marcaría un slot que el cliente nunca mostró.
            // Debe coincidir con addRuleSlots en src/slots.js.
            if (endUtcMin <= startUtcMin) return;
            // Solapamiento (no contención total): con offsets no múltiplos de 60
            // (ej. India UTC+5:30) un bloque local de 1h nunca cae completamente
            // dentro de un slot UTC de 1h, y con "contención total" ese miembro
            // quedaría con 0 slots para siempre, sin ningún aviso.
            // Envolvente semanal (±10080 min): un bloque local pegado al límite
            // de la semana cae, en UTC, en la otra punta (ej. Domingo 22:00 en
            // Argentina = Lunes 01:00 UTC); sin el wrap esas horas se perdían.
            // Debe coincidir con src/slots.js (addRuleSlots).
            for (const shift of [-10080, 0, 10080]) {
              const lo = startUtcMin + shift;
              const hi = endUtcMin + shift;
              if (hi <= 0 || lo >= 10080) continue;
              for (let s = 0; s < 168; s++) {
                if (s * 60 < hi && (s + 1) * 60 > lo) set.add(s);
              }
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
      const attendanceScores = new Map<string, number | null>();
      for (const m of pool) {
        const rows = (attByMember.get(m.email.toLowerCase()) || []).filter(r => r.startMs >= cutoff60);
        const vals = rows.map(r => scoreVal(r.status, r.punctuality)).filter((v): v is number => v !== null);
        attendanceScores.set(
          m.email,
          vals.length === 0 ? null : Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100)
        );
      }

      // COMPROMISO Y RECIPROCIDAD (cierre de sesión).
      //
      // La asistencia sola medía un click en el link de Meet: entrar y irse a
      // los dos minutos daba 100. El compromiso es lo que responde el compañero
      // sobre si la persona sostuvo el ejercicio, y es lo que ordena la fila del
      // emparejamiento junto con la asistencia.
      //
      // Debe coincidir con getEngagement / getReciprocity / getCredibility en
      // src/closeouts.js.
      const { data: closeoutRows } = await supabase
        .from('session_closeouts')
        .select('meeting_id, author_email, subject_email, happened, engagement')
        .eq('room_id', roomId);

      const closeoutsByMeeting = new Map<string, typeof closeoutRows>();
      for (const c of closeoutRows || []) {
        if (!closeoutsByMeeting.has(c.meeting_id)) closeoutsByMeeting.set(c.meeting_id, []);
        closeoutsByMeeting.get(c.meeting_id)!.push(c);
      }

      const CLOSEOUT_WINDOW_MS = 48 * 3600e3;
      // Un sobre abierto es el que ya respondieron los dos, o cuyo plazo venció.
      // Mientras siga cerrado no puntúa: si contara antes, mirar el propio score
      // delataría cómo lo calificó a uno el compañero.
      const sobreAbierto = (meetingId: string) => {
        const rows = closeoutsByMeeting.get(meetingId) || [];
        if (rows.length >= 2) return true;
        const endMs = meetingEndMs.get(meetingId);
        if (endMs === undefined) return false;
        return nowMs > endMs + CLOSEOUT_WINDOW_MS;
      };
      // Reunión en disputa: una respuesta dice que no se hizo y la otra que sí.
      // No puntúa para ninguno de los dos, así acusar en falso no hunde al otro.
      const enDisputa = new Set<string>();
      for (const [meetingId, rows] of closeoutsByMeeting) {
        if (rows.length < 2) continue;
        const noSeHizo = rows.filter(r => r.happened === 'no_se_hizo').length;
        if (noSeHizo > 0 && noSeHizo < rows.length) enDisputa.add(meetingId);
      }

      const ENGAGEMENT_VALUE: Record<string, number> = {
        preparado: 1, a_medias: 0.5, no_participo: 0
      };
      // Reuniones caídas por cancelación de algún asistente: nadie tiene nada
      // que cerrar ahí, así que no pueden sumar al denominador de reciprocidad.
      // Debe coincidir con la CTE me_tocaba en 20260815120000_session_closeouts.sql
      // y con getOwedCloseouts en src/closeouts.js.
      const cancelledMeetingIds = new Set(
        [...byMeeting.entries()]
          .filter(([, rows]) => rows.some(r =>
            r.status === 'cancelado_con_aviso' || r.status === 'cancelado_tarde'))
          .map(([meetingId]) => meetingId)
      );
      const engagementScores = new Map<string, number | null>();
      const reciprocity = new Map<string, number | null>();
      for (const m of pool) {
        const email = m.email.toLowerCase();
        const vals = (closeoutRows || [])
          .filter(c =>
            c.subject_email.toLowerCase() === email &&
            !enDisputa.has(c.meeting_id) &&
            sobreAbierto(c.meeting_id) &&
            (meetingStartMs.get(c.meeting_id) ?? 0) >= cutoff60)
          .map(c => ENGAGEMENT_VALUE[c.engagement])
          .filter(v => v !== undefined);
        engagementScores.set(m.email,
          vals.length === 0 ? null : Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100));

        // Cierres que le tocaba responder: reuniones suyas ya terminadas, sin
        // contar las que se cayeron por cancelación.
        const meTocaba = (attRows || [])
          .filter(r => r.member_email.toLowerCase() === email)
          .map(r => r.meeting_id)
          .filter(id => !cancelledMeetingIds.has(id))
          .filter(id => {
            const end = meetingEndMs.get(id);
            return end !== undefined && nowMs > end;
          });
        const respondi = new Set(
          (closeoutRows || [])
            .filter(c => c.author_email.toLowerCase() === email)
            .map(c => c.meeting_id)
        );
        reciprocity.set(m.email, meTocaba.length === 0
          ? null
          : meTocaba.filter(id => respondi.has(id)).length / meTocaba.length);
      }

      // Credibilidad: promedio de las señales que EXISTEN, por el factor de
      // reciprocidad (piso 0.85). Quien recién entra no tiene compromiso y
      // compite con su asistencia, en vez de quedar último por no tenerlo.
      const RECIPROCITY_FLOOR = 0.85;
      const scores = new Map<string, number | null>();
      for (const m of pool) {
        const dims = [attendanceScores.get(m.email), engagementScores.get(m.email)]
          .filter((v): v is number => v !== null && v !== undefined);
        if (dims.length === 0) { scores.set(m.email, null); continue; }
        const base = dims.reduce((s, x) => s + x, 0) / dims.length;
        const r = reciprocity.get(m.email);
        const factor = r === null || r === undefined
          ? 1 : RECIPROCITY_FLOOR + (1 - RECIPROCITY_FLOOR) * r;
        scores.set(m.email, Math.round(base * factor));
      }

      // HORARIOS YA COMPROMETIDOS. Las propuestas vivas de esta semana ocupan la
      // agenda de sus dos integrantes: si no se tuvieran en cuenta, cada corrida
      // del cron (cada 10 min) podría volver a ofrecerles ese mismo horario con
      // otra persona y dejarlos con dos role-plays superpuestos.
      const busySlots = new Map<string, Set<number>>();
      const markBusy = (email: string, slot: number) => {
        const k = email.toLowerCase();
        if (!busySlots.has(k)) busySlots.set(k, new Set<number>());
        busySlots.get(k)!.add(slot);
      };
      // Sesiones que cada persona YA tiene esta semana. El cron corre cada 10
      // minutos: si el tope contara solo lo de esta corrida, cada pasada le
      // sumaría el tope entero a la misma persona.
      const sessionCount = new Map<string, number>();
      const addSession = (email: string) => {
        const k = email.toLowerCase();
        sessionCount.set(k, (sessionCount.get(k) ?? 0) + 1);
      };
      const sessionsOf = (email: string) => sessionCount.get(email.toLowerCase()) ?? 0;
      for (const p of weekProposals || []) {
        if (p.status !== 'propuesto' && p.status !== 'confirmado') continue;
        addSession(p.member_a_email);
        addSession(p.member_b_email);
        if (p.slot_start === null || p.slot_start === undefined) continue;
        markBusy(p.member_a_email, p.slot_start);
        markBusy(p.member_b_email, p.slot_start);
      }

      // Emparejar en rondas: se permiten varias propuestas por miembro. No hay
      // tope fijo — el límite lo pone la disponibilidad, porque cada horario
      // asignado queda tomado para esas dos personas y las rondas se cortan
      // solas cuando no quedan horas libres en común.
      //
      // Las duplas ya armadas en esta corrida se EVITAN, no se prohíben: si a
      // los dos les quedan horas libres y no hay nadie nuevo con quien
      // emparejarlos, una segunda sesión juntos es mejor que desperdiciar la
      // disponibilidad de ambos. Cara nueva siempre gana primero.
      // Debe coincidir con buildWeeklyPairsMultiRound en src/matcher.js.
      const allPairs: Pair[] = [];
      const roundSoftExcluded = new Set(softExcluded);
      // Cada ronda consume al menos una hora libre de dos personas, así que no
      // puede haber más rondas que horas en la semana.
      const maxRounds = 168;

      for (let round = 0; round < maxRounds; round++) {
        // Quien ya llegó a su tope semanal no entra a esta ronda.
        const disponibles = pool.filter(m => sessionsOf(m.email) < MAX_SESSIONS_PER_WEEK);
        if (disponibles.length < 2) break;

        const { pairs } = buildWeeklyPairs(
          disponibles, slotSets, scores, excluded, pairCounts, now, roundSoftExcluded, MIN_LEAD_MS, busySlots
        );
        if (pairs.length === 0) break; // No hay más parejas posibles

        allPairs.push(...pairs);
        for (const p of pairs) {
          roundSoftExcluded.add(pairKeyOf(p.a.email, p.b.email));
          markBusy(p.a.email, p.slot);
          markBusy(p.b.email, p.slot);
          addSession(p.a.email);
          addSession(p.b.email);
        }
      }

      const pairs = allPairs;
      if (pairs.length === 0) continue;

      const toInsert: Record<string, unknown>[] = [];
      let revived = 0;
      for (const p of pairs) {
        const meetingMs = nextSlotOccurrenceMs(p.slot, now, MIN_LEAD_MS);
        // Plazo escalonado: 4h→2h→1h→30m. Si la reunión está a <30min no hay
        // ventana posible → no se propone (se reintentará en la próxima corrida).
        const rbMs = respondByMs(meetingMs, now);
        if (rbMs === null) continue;
        const respondBy = new Date(rbMs).toISOString();
        // shift() y no get(): la fila vencida se consume. Si esta dupla tiene
        // una segunda sesión esta semana, va a buscar la siguiente de la cola o
        // a insertar una nueva, en vez de sobrescribir la que se acaba de usar.
        const revivedId = expiredByPair.get(pairKeyOf(p.a.email, p.b.email))?.shift();
        if (revivedId !== undefined) {
          revived++;
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
      let inserted = 0;
      if (toInsert.length) {
        const { error } = await supabase.from('match_proposals').insert(toInsert);
        if (error) continue;
        inserted = toInsert.length;
      }
      // Lo que se informa es lo que REALMENTE quedó propuesto: los pares que se
      // descartan por no entrar en la ventana de confirmación no cuentan, y el
      // cliente usa este número para avisar "se generaron nuevas propuestas".
      summary[roomId] = inserted + revived;
    }

    return new Response(JSON.stringify({ ok: true, week, created: summary }), {
      headers: { 'Content-Type': 'application/json', ...cors }
    });

    } finally {
      // Se suelta pase lo que pase. Si esta corrida se cayera antes de llegar
      // acá, el lock igual vence solo por TTL y el emparejador no queda trabado.
      await supabase.rpc('release_job_lock', { p_name: 'weekly-matcher' });
    }
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...cors }
    });
  }
});
