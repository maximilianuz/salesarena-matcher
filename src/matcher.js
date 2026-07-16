// Motor de emparejamiento 1:1 semanal de Sales-Arena Matcher.
// Misma lógica que corre la Edge Function (supabase/functions/weekly-matcher):
// mantener ambas implementaciones alineadas si se cambia el algoritmo.

export const BASELINE_SCORE = 50; // score asumido para miembros sin historial

// De una lista de slots UTC de la semana (0..167), devuelve el que ocurre
// ANTES a partir de `now`. Un slot codifica día (0=lunes) y hora UTC; su
// "próxima ocurrencia" se calcula igual que getNextMatchDateUtc en App.jsx.
// Esto evita que se elija siempre el lunes (índice 0) cuando hoy es jueves y
// la dupla también coincide, por ejemplo, mañana viernes (mucho más pronto).
const soonestSlot = (slots, now = new Date()) => {
  const nextOccurrenceMs = (slot) => {
    const dayIdx = Math.floor(slot / 24);
    const hourUtc = slot % 24;
    const d = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0
    ));
    const todayIdx = (d.getUTCDay() + 6) % 7; // 0 = lunes
    let delta = (dayIdx - todayIdx + 7) % 7;
    if (delta === 0 && d <= now) delta = 7; // ya pasó hoy → semana próxima
    d.setUTCDate(d.getUTCDate() + delta);
    return d.getTime();
  };
  return slots.reduce((best, s) =>
    nextOccurrenceMs(s) < nextOccurrenceMs(best) ? s : best
  );
};

// Empareja 1:1 a los miembros priorizando por score de confiabilidad:
// mayor score elige primero y obtiene el mejor compañero disponible.
//
//   members:  [{ email, name }]
//   slotSets: Map(email -> Set<int>) slots UTC de la semana (0..167) en que está libre
//   scores:   Map(email -> pct | null)
//   excludedPairs: Set("emailA|emailB" ordenado) — parejas a no repetir
//     (ej. propuestas ya rechazadas esta semana)
//   pairCounts: Map("emailA|emailB" ordenado -> nº de reuniones concretadas)
//     para la rotación anti-amiguismo (menos veces juntos = mayor prioridad)
//
// Devuelve { pairs: [{ a, b, slot }], unmatched: [email] } donde slot es el
// horario común de la dupla que ocurre ANTES a partir de `now` (no el de
// menor índice de la semana).
export const buildWeeklyPairs = (members, slotSets, scores, excludedPairs = new Set(), pairCounts = new Map(), now = new Date()) => {
  const scoreOf = (email) => {
    const s = scores.get(email);
    return s === null || s === undefined ? BASELINE_SCORE : s;
  };
  const pairKey = (e1, e2) => [e1.toLowerCase(), e2.toLowerCase()].sort().join('|');
  const timesPaired = (e1, e2) => pairCounts.get(pairKey(e1, e2)) ?? 0;

  const ranked = [...members].sort((a, b) => scoreOf(b.email) - scoreOf(a.email));
  const assigned = new Set();
  const pairs = [];

  for (const m of ranked) {
    if (assigned.has(m.email)) continue;
    const mySlots = slotSets.get(m.email);
    if (!mySlots || mySlots.size === 0) continue;

    let best = null;
    for (const cand of ranked) {
      if (cand.email === m.email || assigned.has(cand.email)) continue;
      if (excludedPairs.has(pairKey(m.email, cand.email))) continue;
      const candSlots = slotSets.get(cand.email);
      if (!candSlots || candSlots.size === 0) continue;

      const common = [...mySlots].filter(s => candSlots.has(s));
      if (common.length === 0) continue;

      const count = timesPaired(m.email, cand.email);
      const candScore = scoreOf(cand.email);
      // Anti-amiguismo: 1º menos veces juntos, 2º mayor confiabilidad,
      // 3º mayor solapamiento. Debe coincidir con la Edge Function.
      if (
        !best ||
        count < best.count ||
        (count === best.count && candScore > best.score) ||
        (count === best.count && candScore === best.score && common.length > best.common.length)
      ) {
        best = { cand, count, score: candScore, common };
      }
    }

    if (best) {
      assigned.add(m.email);
      assigned.add(best.cand.email);
      pairs.push({ a: m, b: best.cand, slot: soonestSlot(best.common, now) });
    }
  }

  const unmatched = ranked
    .filter(m => !assigned.has(m.email) && (slotSets.get(m.email)?.size || 0) > 0)
    .map(m => m.email);

  return { pairs, unmatched };
};

// Lunes (UTC) de la semana actual en formato YYYY-MM-DD
export const currentWeekStartISO = (now = new Date()) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayIdx = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dayIdx);
  return d.toISOString().slice(0, 10);
};
