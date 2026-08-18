// Motor de emparejamiento 1:1 semanal de Sales-Arena Matcher.
// Misma lógica que corre la Edge Function (supabase/functions/weekly-matcher):
// mantener ambas implementaciones alineadas si se cambia el algoritmo.

export const BASELINE_SCORE = 50; // score asumido para miembros sin historial

// Set vacío compartido para "esta persona no tiene ningún horario tomado":
// se lee muchas veces por ronda y no se muta nunca.
const EMPTY_SLOTS = new Set();

// Cuánto pesa NO haberse juntado antes, medido en puntos de credibilidad.
//
// La rotación es el criterio principal —de eso se trata el anti-amiguismo—,
// pero no puede ser absoluta: con prioridad estricta, alguien que nunca se
// conecta gana siempre por el solo hecho de ser cara nueva, y del otro lado hay
// una persona real que se prepara y se queda esperando.
//
// Con 40, una repetición cuesta lo mismo que 40 puntos de credibilidad: la cara
// nueva gana en casi todos los casos, salvo cuando la diferencia de conducta es
// grande (p. ej. alguien de 100 con quien ya te juntaste una vez le gana a
// alguien de 50 con quien no). Debe coincidir con la Edge Function.
export const ROTATION_WEIGHT = 40;

// Cuánto más deseable es un compañero: rotación primero, conducta después.
export const partnerDesirability = (timesPaired, score) =>
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
// Debe coincidir con la Edge Function.
export const MAX_SESSIONS_PER_WEEK = 3;

// Ventana de confirmación ESCALONADA. En cada (re)asignación, el plazo para
// confirmar se elige como el mayor escalón que aún deje el vencimiento en el
// futuro: 4hs → 2hs → 1h → 30min. Así, si una propuesta vence sin confirmar y el
// emparejador reasigna más cerca de la reunión, la nueva ventana es más corta en
// forma automática, hasta un piso de 30min antes de la reunión.
// Debe coincidir con la Edge Function (supabase/functions/weekly-matcher).
export const CONFIRM_STEPS_MS = [4, 2, 1, 0.5].map((h) => h * 3600e3);

// Antelación mínima para proponer un slot: el escalón más chico (30min). Un slot
// que ocurra dentro de los próximos 30min ya no se propone (no habría ventana de
// confirmación).
export const MIN_LEAD_MS = CONFIRM_STEPS_MS[CONFIRM_STEPS_MS.length - 1];

// respond_by (epoch ms) para una reunión dada: el mayor escalón cuyo vencimiento
// siga siendo futuro respecto de `now`. Devuelve null si ni el escalón más chico
// entra (reunión a < 30min) → esa dupla/slot no se debe proponer.
export const respondByMs = (meetingMs, now = new Date()) => {
  const t = now.getTime();
  for (const step of CONFIRM_STEPS_MS) {
    if (meetingMs - step > t) return meetingMs - step;
  }
  return null;
};

// Milisegundos (epoch) de la PRÓXIMA ocurrencia de un slot UTC (0..167) que sea
// posterior a ahora + minLeadMs. Un slot codifica día (0=lunes) y hora UTC. Si la
// ocurrencia de esta semana cae en el piso o antes, rueda a la semana siguiente.
//
// El piso es ESTRICTO (`<=`, no `<`) para que respondByMs nunca devuelva null
// sobre un slot que este motor ya dio por bueno: una reunión exactamente a
// minLeadMs de distancia deja una ventana de confirmación de cero, que no le
// sirve a nadie. Debe coincidir con la Edge Function.
const nextSlotOccurrenceMs = (slot, now, minLeadMs = 0) => {
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

// De una lista de slots UTC de la semana, devuelve el que ocurre ANTES a partir
// de `now` (respetando minLeadMs). Evita elegir siempre el lunes cuando hoy es
// jueves y la dupla coincide, por ejemplo, el viernes (mucho más pronto).
export const soonestSlot = (slots, now = new Date(), minLeadMs = 0) =>
  slots.reduce((best, s) =>
    nextSlotOccurrenceMs(s, now, minLeadMs) < nextSlotOccurrenceMs(best, now, minLeadMs) ? s : best
  );

// Epoch (ms) de la reunión para un slot ya elegido. Se usa para calcular
// respond_by = reunión - 24hs de forma estable (timestamp fijo, no recalculado).
export const slotDateMs = (slot, now = new Date(), minLeadMs = 0) =>
  nextSlotOccurrenceMs(slot, now, minLeadMs);

// Motor base: empareja 1:1 a los miembros priorizando por score de confiabilidad.
// Mayor score elige primero y obtiene el mejor compañero disponible.
//
//   members:  [{ email, name }]
//   slotSets: Map(email -> Set<int>) slots UTC de la semana (0..167) en que está libre
//   scores:   Map(email -> pct | null)
//   excludedPairs: Set("emailA|emailB" ordenado) — parejas a NO repetir
//     (ej. propuestas ya RECHAZADAS esta semana: se respeta el "no" explícito)
//   pairCounts: Map("emailA|emailB" ordenado -> nº de reuniones concretadas)
//     para la rotación anti-amiguismo (menos veces juntos = mayor prioridad)
//   softExcludedPairs: Set(...) — parejas a EVITAR si hay alternativa (ej. una
//     propuesta que expiró sin respuesta esta semana → se prefiere otro
//     compañero disponible; si no hay otro, se re-ofrece la misma dupla)
//   minLeadMs: antelación mínima de la reunión respecto de `now`
//   busySlots: Map(email -> Set<int>) horarios que esa persona YA tiene
//     comprometidos (propuestas vivas de esta semana, o pares elegidos en una
//     ronda anterior). Nadie puede quedar con dos reuniones a la misma hora,
//     así que esos slots no se vuelven a ofrecer.
//
// Devuelve { pairs: [{ a, b, slot }], unmatched: [email] }.
// NOTA: Este motor empareja cada miembro UNA SOLA VEZ. Para múltiples
// emparejamientos por semana, usar buildWeeklyPairsMultiRound().
export const buildWeeklyPairs = (
  members,
  slotSets,
  scores,
  excludedPairs = new Set(),
  pairCounts = new Map(),
  now = new Date(),
  softExcludedPairs = new Set(),
  minLeadMs = 0,
  busySlots = new Map()
) => {
  const scoreOf = (email) => {
    const s = scores.get(email);
    return s === null || s === undefined ? BASELINE_SCORE : s;
  };
  const pairKey = (e1, e2) => [e1.toLowerCase(), e2.toLowerCase()].sort().join('|');
  const timesPaired = (e1, e2) => pairCounts.get(pairKey(e1, e2)) ?? 0;

  const busyOf = (email) => busySlots.get(email.toLowerCase()) ?? EMPTY_SLOTS;

  const ranked = [...members].sort((a, b) => scoreOf(b.email) - scoreOf(a.email));
  const assigned = new Set();
  const pairs = [];

  // Horas que le quedan REALMENTE libres a alguien todavía sin emparejar.
  const freeSlotsOf = (email) => {
    const all = slotSets.get(email);
    if (!all) return [];
    const busy = busyOf(email);
    return [...all].filter(s => !busy.has(s));
  };

  // De los horarios que la dupla tiene en común, cuál ocupar.
  //
  // Tomar siempre el más próximo dejaba gente afuera: si dos personas con
  // varias horas libres se quedaban con la ÚNICA hora de una tercera, esa
  // tercera perdía su sesión de la semana pudiendo haberla tenido. Y el
  // perjudicado era sistemáticamente el que menos disponibilidad tiene, que es
  // justo al revés de lo que conviene.
  //
  // Así que primero se mira a quién deja sin nada cada opción, y solo entre las
  // que empatan se elige la más próxima.
  const leastContendedSlot = (common, m, cand) => {
    let best = null;
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
    return best.slot;
  };

  for (const m of ranked) {
    if (assigned.has(m.email)) continue;
    const mySlots = slotSets.get(m.email);
    if (!mySlots || mySlots.size === 0) continue;
    const myBusy = busyOf(m.email);
    // Los horarios que esta persona ya tiene tomados no son candidatos, así que
    // si no le queda ninguno libre no hay nada que ofrecerle en esta ronda.
    const myFree = [...mySlots].filter(s => !myBusy.has(s));
    if (myFree.length === 0) continue;

    let best = null;
    for (const cand of ranked) {
      if (cand.email === m.email || assigned.has(cand.email)) continue;
      if (excludedPairs.has(pairKey(m.email, cand.email))) continue;
      const candSlots = slotSets.get(cand.email);
      if (!candSlots || candSlots.size === 0) continue;

      // Solapamiento REALMENTE disponible: descarta las horas que cualquiera de
      // los dos ya tiene comprometidas. Sin esto, una persona con varias
      // propuestas en la misma semana terminaba con dos reuniones a la misma
      // hora, porque cada ronda volvía a elegir su horario común más próximo.
      const candBusy = busyOf(cand.email);
      const common = myFree.filter(s => candSlots.has(s) && !candBusy.has(s));
      if (common.length === 0) continue;

      const isSoft = softExcludedPairs.has(pairKey(m.email, cand.email));
      const count = timesPaired(m.email, cand.email);
      const candScore = scoreOf(cand.email);
      const desirability = partnerDesirability(count, candScore);
      // Prioridad de selección del compañero (anti-amiguismo):
      //   0º evitar duplas soft-excluidas si hay alternativa: son las que ya se
      //      juntaron esta semana y las que dejaron vencer una propuesta. Es el
      //      "primero fijate si no hay otra persona" — recién si no hay nadie
      //      más se repite compañero.
      //   1º mayor deseabilidad: rotación con el peso de ROTATION_WEIGHT, y la
      //      credibilidad como contrapeso, para no mandar a alguien con quien
      //      nunca se conecta solo porque es cara nueva.
      //   2º mayor solapamiento horario
      // Debe coincidir con la Edge Function.
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
      pairs.push({
        a: m,
        b: best.cand,
        slot: leastContendedSlot(best.common, m, best.cand)
      });
    }
  }

  const unmatched = ranked
    .filter(m => !assigned.has(m.email) && (slotSets.get(m.email)?.size || 0) > 0)
    .map(m => m.email);

  return { pairs, unmatched };
};

// Empareja en múltiples rondas para permitir que cada miembro tenga varias
// propuestas en la misma semana (con personas diferentes).
//
// No hay tope de propuestas por persona: el límite real lo pone la
// disponibilidad. Cada horario que se asigna queda TOMADO para esas dos
// personas, así que las rondas se cortan solas cuando a nadie le quedan horas
// libres en común. Eso es lo que impide que alguien termine con dos role-plays
// a la misma hora, que es lo que pasaba cuando las rondas solo excluían la
// dupla y no el horario.
//
//   initialBusySlots: Map(email en minúsculas -> Set<slot>) con lo que ya está
//     comprometido ANTES de esta corrida (las propuestas vivas de la semana).
//     Sin esto, el cron —que corre cada 10 minutos— volvería a pisar horarios
//     ya ocupados en corridas anteriores.
//
// Devuelve un array de todos los pares encontrados en todas las rondas.
export const buildWeeklyPairsMultiRound = (
  members,
  slotSets,
  scores,
  excludedPairs = new Set(),
  pairCounts = new Map(),
  now = new Date(),
  softExcludedPairs = new Set(),
  minLeadMs = 0,
  initialBusySlots = new Map(),
  initialSessionCounts = new Map(),
  maxSessionsPerWeek = MAX_SESSIONS_PER_WEEK
) => {
  const pairKey = (e1, e2) => [e1.toLowerCase(), e2.toLowerCase()].sort().join('|');
  const allPairs = [];
  // Sesiones que cada persona ya tiene esta semana, contando las propuestas
  // vivas de corridas anteriores. Quien llegó al tope sale del pool.
  const sessionCount = new Map();
  for (const [email, n] of initialSessionCounts) {
    sessionCount.set(email.toLowerCase(), n);
  }
  const sessionsOf = (email) => sessionCount.get(email.toLowerCase()) ?? 0;
  const addSession = (email) => {
    const k = email.toLowerCase();
    sessionCount.set(k, (sessionCount.get(k) ?? 0) + 1);
  };
  // Las duplas que ya se juntaron en una ronda anterior de ESTA corrida pasan a
  // evitarse, no a prohibirse: si a los dos les quedan horas libres y ya no hay
  // nadie nuevo con quien emparejarlos, es mejor una segunda sesión juntos que
  // desperdiciar la disponibilidad de los dos. Cara nueva siempre gana primero.
  const roundSoftExcluded = new Set(softExcludedPairs);
  // Copia propia: se muta ronda a ronda y no debe tocar el Map del llamador.
  const busySlots = new Map();
  for (const [email, slots] of initialBusySlots) {
    busySlots.set(email.toLowerCase(), new Set(slots));
  }
  const markBusy = (email, slot) => {
    const key = email.toLowerCase();
    if (!busySlots.has(key)) busySlots.set(key, new Set());
    busySlots.get(key).add(slot);
  };
  // Techo de seguridad: cada ronda consume al menos una hora libre de dos
  // personas, así que la cantidad de rondas no puede superar las horas de la
  // semana. El corte real lo da la disponibilidad, no este número.
  const maxRounds = 168;

  for (let round = 0; round < maxRounds; round++) {
    // Quien ya llegó a su tope semanal no entra a esta ronda.
    const disponibles = members.filter(m => sessionsOf(m.email) < maxSessionsPerWeek);
    if (disponibles.length < 2) break;

    const { pairs } = buildWeeklyPairs(
      disponibles, slotSets, scores, excludedPairs, pairCounts, now,
      roundSoftExcluded, minLeadMs, busySlots
    );
    if (pairs.length === 0) break; // No hay más parejas posibles

    allPairs.push(...pairs);
    for (const p of pairs) {
      roundSoftExcluded.add(pairKey(p.a.email, p.b.email));
      markBusy(p.a.email, p.slot);
      markBusy(p.b.email, p.slot);
      addSession(p.a.email);
      addSession(p.b.email);
    }
  }

  return allPairs;
};

// Lunes (UTC) de la semana actual en formato YYYY-MM-DD
export const currentWeekStartISO = (now = new Date()) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayIdx = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dayIdx);
  return d.toISOString().slice(0, 10);
};
