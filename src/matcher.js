// Motor de emparejamiento 1:1 semanal de Sales-Arena Matcher.
// Misma lógica que corre la Edge Function (supabase/functions/weekly-matcher):
// mantener ambas implementaciones alineadas si se cambia el algoritmo.

export const BASELINE_SCORE = 50; // score asumido para miembros sin historial

// Empareja 1:1 a los miembros priorizando por score de confiabilidad:
// mayor score elige primero y obtiene el mejor compañero disponible.
//
//   members:  [{ email, name }]
//   slotSets: Map(email -> Set<int>) slots UTC de la semana (0..167) en que está libre
//   scores:   Map(email -> pct | null)
//   excludedPairs: Set("emailA|emailB" ordenado) — parejas a no repetir
//     (ej. propuestas ya rechazadas esta semana)
//
// Devuelve { pairs: [{ a, b, slot }], unmatched: [email] } donde slot es el
// primer horario común de la semana para la dupla.
export const buildWeeklyPairs = (members, slotSets, scores, excludedPairs = new Set()) => {
  const scoreOf = (email) => {
    const s = scores.get(email);
    return s === null || s === undefined ? BASELINE_SCORE : s;
  };
  const pairKey = (e1, e2) => [e1.toLowerCase(), e2.toLowerCase()].sort().join('|');

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

      const candScore = scoreOf(cand.email);
      if (
        !best ||
        candScore > best.score ||
        (candScore === best.score && common.length > best.common.length)
      ) {
        best = { cand, score: candScore, common };
      }
    }

    if (best) {
      assigned.add(m.email);
      assigned.add(best.cand.email);
      pairs.push({ a: m, b: best.cand, slot: Math.min(...best.common) });
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
