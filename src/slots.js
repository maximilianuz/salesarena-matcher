// Lógica pura de slots horarios de Sales-Arena Matcher.
//
// Un "slot" es una hora UTC de la semana: 0..167 (0 = Lunes 00:00 UTC).
// La disponibilidad se guarda en HORA LOCAL de cada miembro (dayIdx 0=Lunes,
// startHour/endHour) y acá se traduce a slots UTC. Este módulo no toca React
// ni Supabase para poder testearse con `node --test`.
//
// La Edge Function (supabase/functions/weekly-matcher) replica esta lógica:
// mantener ambas alineadas si se cambia.

export const WEEK_MIN = 7 * 24 * 60; // 10080 minutos por semana
export const N_SLOTS = 7 * 24; // 168 slots de 1 hora

// Offset real en minutos respecto de UTC para cualquier zona IANA.
// Usa Intl (nativo) y refleja automáticamente el horario de verano (DST)
// vigente en el momento del cálculo.
const tzOffsetCache = {};
export const getOffsetMinutes = (tz) => {
  if (!tz || tz === 'UTC') return 0;
  if (tzOffsetCache[tz] !== undefined) return tzOffsetCache[tz];
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    }).formatToParts(new Date());
    const name = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
    // name es "GMT-3", "GMT+5:30" o "GMT" (=UTC)
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    const offset = m
      ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0))
      : 0;
    tzOffsetCache[tz] = offset;
    return offset;
  } catch {
    return 0; // zona inválida → tratar como UTC
  }
};

// Agrega a `set` los slots UTC (0..167) que solapan con un bloque local
// {dayIdx, startHour, endHour} de una zona con `offsetMin` respecto de UTC.
//
//  * Solapamiento (no contención total): con offsets no múltiplos de 60
//    (ej. India UTC+5:30) un bloque local de 1h nunca cae completamente
//    dentro de un slot UTC de 1h; con "contención total" ese miembro quedaría
//    con 0 slots para siempre, sin ningún aviso.
//  * Envolvente semanal (wrap): un bloque local cercano al límite de la semana
//    cae, en UTC, en la OTRA punta de la semana (ej. Domingo 22:00 en
//    Argentina = Lunes 01:00 UTC). Se prueba el intervalo desplazado ±1 semana
//    para no perder esas horas.
export const addRuleSlots = (set, rule, offsetMin) => {
  const startUtcMin = rule.dayIdx * 1440 + rule.startHour * 60 - offsetMin;
  const endUtcMin = rule.dayIdx * 1440 + rule.endHour * 60 - offsetMin;
  if (endUtcMin <= startUtcMin) return;
  for (const shift of [-WEEK_MIN, 0, WEEK_MIN]) {
    const lo = startUtcMin + shift;
    const hi = endUtcMin + shift;
    if (hi <= 0 || lo >= WEEK_MIN) continue;
    const firstSlot = Math.max(0, Math.floor(lo / 60));
    const lastSlot = Math.min(N_SLOTS - 1, Math.ceil(hi / 60) - 1);
    for (let s = firstSlot; s <= lastSlot; s++) {
      if (s * 60 < hi && (s + 1) * 60 > lo) set.add(s);
    }
  }
};

// Slots UTC libres de UN miembro a partir de sus reglas locales.
export const memberSlotSet = (rules, tz) => {
  const offset = getOffsetMinutes(tz);
  const set = new Set();
  rules.forEach(rule => addRuleSlots(set, rule, offset));
  return set;
};

// Slots UTC (0..167) libres por miembro: Map(email → Set<int>).
// Las reglas de availabilities se vinculan al miembro por NOMBRE
// (case-insensitive), que es como la tabla las guarda hoy.
export const computeSlotSets = (members, avails) => {
  const map = new Map();
  members.forEach(member => {
    const rules = avails.filter(a => a.user.toLowerCase() === member.name.toLowerCase());
    map.set(member.email, memberSlotSet(rules, member.tz));
  });
  return map;
};

// Slot UTC → etiqueta en la hora local de una zona ("Lunes 14:00").
export const slotToLocalParts = (slot, tz) => {
  const localMin = slot * 60 + getOffsetMinutes(tz);
  const norm = ((localMin % WEEK_MIN) + WEEK_MIN) % WEEK_MIN;
  return {
    dayIdx: Math.floor(norm / 1440),
    hour: Math.floor((norm % 1440) / 60)
  };
};

// Mapa de calor 7×24 en la hora local de `viewTz`.
// Devuelve grid[day][hour] = { count, names }. Cada miembro cuenta a lo sumo
// UNA vez por slot aunque tenga reglas superpuestas (p.ej. plantilla + carga
// manual duplicada).
export const buildHeatmapGrid = (members, avails, viewTz) => {
  const slotSets = computeSlotSets(members, avails);
  const presence = Array.from({ length: N_SLOTS }, () => []);
  members.forEach(member => {
    const set = slotSets.get(member.email);
    set.forEach(s => presence[s].push(member.name));
  });

  const viewOffset = getOffsetMinutes(viewTz || 'UTC');
  const grid = [];
  for (let d = 0; d < 7; d++) {
    const hoursRow = [];
    for (let h = 0; h < 24; h++) {
      const localMin = d * 1440 + h * 60;
      const utcMin = localMin - viewOffset;
      const slotIdx = Math.floor((utcMin / 60) + N_SLOTS) % N_SLOTS;
      const names = presence[slotIdx] || [];
      hoursRow.push({ count: names.length, names: names.join(', ') });
    }
    grid.push(hoursRow);
  }
  return { grid, slotSets, presence };
};
