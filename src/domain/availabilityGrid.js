// Operaciones sobre la grilla del asistente de disponibilidad: los atajos de
// cabecera (marcar un día entero, marcar una franja horaria en los siete días)
// y el estado del medidor de cobertura.
//
// Viven acá y no adentro de App.jsx porque son lógica pura sobre un array de
// celdas: separarlas las hace testeables sin montar el componente, igual que
// schedule.js y rows.js.
//
// La grilla es un array de { dayIdx, hour } sin orden garantizado; nunca se
// muta, cada operación devuelve una grilla nueva.

export const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];

const has = (grid, dayIdx, hour) => grid.some(s => s.dayIdx === dayIdx && s.hour === hour);

// Las horas que la grilla está mostrando. Los atajos operan SOLO sobre lo
// visible: marcar de un clic la madrugada colapsada sería declarar
// disponibilidad que la persona nunca vio en pantalla.
export const visibleHours = (showAllHours) =>
  Array.from({ length: 24 }, (_, h) => h).filter(h => showAllHours || h >= 6);

// Cabecera de día: marca la columna entera, o la borra si ya estaba completa.
// Las horas ocultas de esa columna se conservan intactas en ambos sentidos.
export const toggleDay = (grid, dayIdx, hours) => {
  const full = hours.every(h => has(grid, dayIdx, h));
  const rest = grid.filter(s => s.dayIdx !== dayIdx || !hours.includes(s.hour));
  return full ? rest : [...rest, ...hours.map(h => ({ dayIdx, hour: h }))];
};

// Cabecera de hora: marca esa franja en los siete días, o la borra si ya
// estaba completa.
export const toggleHourRow = (grid, hour) => {
  const full = DAY_INDEXES.every(d => has(grid, d, hour));
  const rest = grid.filter(s => s.hour !== hour);
  return full ? rest : [...rest, ...DAY_INDEXES.map(d => ({ dayIdx: d, hour }))];
};

// Estado del medidor de cobertura, que reemplazó al aviso naranja que solo
// aparecía cuando faltaban horas.
//   - piso duro: una hora por sesión pedida, si no no hay dónde ubicarlas.
//   - margen cómodo: 3× las sesiones, para que el emparejador tenga
//     alternativas al cruzar con la agenda del resto.
export const goalState = (hoursMarked, weeklyTarget) => {
  const target = Math.max(1, weeklyTarget || 1);
  const comfy = target * 3;
  const pct = Math.min(100, Math.round((hoursMarked / comfy) * 100));
  if (hoursMarked < target) return { pct, tone: 'short', label: 'Faltan horas' };
  if (hoursMarked < comfy) return { pct, tone: 'ok', label: 'Alcanza, con poco margen' };
  return { pct, tone: 'good', label: 'Margen holgado' };
};
