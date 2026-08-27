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

import { DIAS } from './zones.js';

export const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];

const has = (grid, dayIdx, hour) => grid.some(s => s.dayIdx === dayIdx && s.hour === hour);

// Tope de horas por día.
//
// Disponibilidad no es lo mismo que compromiso, y cada cosa tiene su límite:
// cuántos role-plays querés por semana ya lo decide weekly_target. Esto otro
// limita cuánta disponibilidad se DECLARA en un mismo día, que es un problema
// distinto: marcar el día entero de un clic es gratis, se olvida a los dos
// días, y después la propuesta cae en un horario que la persona ya no quería.
// Eso termina en inasistencia, que es justo lo que el sistema de confiabilidad
// castiga. El tope corta la disponibilidad fantasma en el origen.
export const MAX_HOURS_PER_DAY = 4;

// Horas marcadas en un día. Cuenta las 24 horas reales, no solo las visibles:
// el tope es del día, así que la madrugada colapsada también ocupa lugar.
export const hoursOnDay = (grid, dayIdx) =>
  grid.filter(s => s.dayIdx === dayIdx).length;

export const dayHasRoom = (grid, dayIdx, cap = MAX_HOURS_PER_DAY) =>
  hoursOnDay(grid, dayIdx) < cap;

// Días que ya venían por encima del tope de antes de que existiera. No se
// tocan solos: borrarle a alguien disponibilidad que guardó, sin avisar, sería
// peor que el problema que el tope viene a resolver. La pantalla los marca y
// la persona decide.
export const daysOverCap = (grid, cap = MAX_HOURS_PER_DAY) =>
  [...new Set(grid.map(s => s.dayIdx))].filter(d => hoursOnDay(grid, d) > cap);

// Agrega una celda respetando el tope. Si el día ya llegó al límite devuelve
// la MISMA grilla, para que quien llama pueda detectar el rechazo por
// identidad y avisar en pantalla en vez de fallar en silencio.
export const addCell = (grid, dayIdx, hour, cap = MAX_HOURS_PER_DAY) => {
  if (has(grid, dayIdx, hour)) return grid;
  if (!dayHasRoom(grid, dayIdx, cap)) return grid;
  return [...grid, { dayIdx, hour }];
};

// ¿Todos los días que la persona marcó llegaron al tope? Si es así, pedirle
// "más horas" es pedirle algo que el tope no la deja hacer: lo que le falta es
// otro día. El medidor lo usa para no contradecirse a sí mismo.
export const allMarkedDaysFull = (grid, cap = MAX_HOURS_PER_DAY) => {
  const dias = [...new Set(grid.map(s => s.dayIdx))];
  return dias.length > 0 && dias.every(d => hoursOnDay(grid, d) >= cap);
};

// Las horas que la grilla está mostrando. Los atajos operan SOLO sobre lo
// visible: marcar de un clic la madrugada colapsada sería declarar
// disponibilidad que la persona nunca vio en pantalla.
export const visibleHours = (showAllHours) =>
  Array.from({ length: 24 }, (_, h) => h).filter(h => showAllHours || h >= 6);

// Cabecera de día: llena el día HASTA EL TOPE, o lo limpia si ya no queda cupo.
//
// Antes marcaba la columna entera: 18 horas de un clic, que es exactamente la
// disponibilidad fantasma que el tope viene a evitar. Ahora el mismo gesto
// sigue siendo el atajo rápido, pero enseña el límite en vez de saltárselo.
//
// `rank` decide QUÉ horas se eligen: se toman las más elegidas por el resto de
// la sala, que son las que tienen chance real de cruzarse con alguien. A igual
// popularidad gana la más temprana, para que el resultado sea estable y no
// dependa del orden en que vino la grilla.
//
// Las horas ocultas de esa columna se conservan en ambos sentidos, y también
// ocupan cupo: el tope es del día real, no del pedazo que está en pantalla.
export const toggleDay = (grid, dayIdx, hours, opts = {}) => {
  const { cap = MAX_HOURS_PER_DAY, rank } = opts;
  const rest = grid.filter(s => s.dayIdx !== dayIdx || !hours.includes(s.hour));

  const ocupadasOcultas = grid.filter(s => s.dayIdx === dayIdx && !hours.includes(s.hour)).length;
  const yaVisibles = grid.filter(s => s.dayIdx === dayIdx && hours.includes(s.hour)).length;
  const cupo = Math.max(0, cap - ocupadasOcultas);

  // Sin cupo libre, el clic limpia lo visible: es el "segundo clic" de siempre.
  if (yaVisibles >= cupo) return rest;

  const puntaje = typeof rank === 'function' ? rank : () => 0;
  const elegidas = hours
    .filter(h => !has(grid, dayIdx, h))
    .sort((a, b) => puntaje(dayIdx, b) - puntaje(dayIdx, a) || a - b)
    .slice(0, cupo - yaVisibles);

  return [...grid, ...elegidas.map(h => ({ dayIdx, hour: h }))];
};

// Cabecera de hora: marca esa franja en los siete días, o la borra si ya
// estaba completa. Suma UNA hora por día, así que solo se salta los días que
// ya llegaron al tope; el resto se marca normalmente.
export const toggleHourRow = (grid, hour, cap = MAX_HOURS_PER_DAY) => {
  const full = DAY_INDEXES.every(d => has(grid, d, hour));
  const rest = grid.filter(s => s.hour !== hour);
  if (full) return rest;
  const conLugar = DAY_INDEXES.filter(d => dayHasRoom(rest, d, cap));
  return [...rest, ...conLugar.map(d => ({ dayIdx: d, hour }))];
};

// Estado del medidor de cobertura, que reemplazó al aviso naranja que solo
// aparecía cuando faltaban horas.
//   - piso duro: una hora por sesión pedida, si no no hay dónde ubicarlas.
//   - margen cómodo: 3× las sesiones, para que el emparejador tenga
//     alternativas al cruzar con la agenda del resto.
// Dónde empieza y dónde termina el tramo contiguo al que pertenece una celda,
// para que tres horas seguidas se lean como UN bloque con su duración escrita y
// no como tres casillas sueltas.
//
// Se resuelve por celda en vez de dibujar bloques posicionados sobre la grilla:
// así la tabla sigue siendo una tabla, y el arrastre, el foco por teclado y los
// aria-label sobreviven intactos. Lo único que cambia es cómo se pinta.
//
// `primeraHoraVisible` importa porque la madrugada se colapsa: con la grilla
// arrancando a las 06:00, una celda a esa hora es principio de bloque aunque
// las 05:00 estén marcadas, porque en pantalla no hay nada encima.
export const runAt = (marcadas, dayIdx, hour, primeraHoraVisible = 0) => {
  const en = (h) => marcadas.has(`${dayIdx}-${h}`);
  if (!en(hour)) return null;

  const esInicio = hour <= primeraHoraVisible || !en(hour - 1);
  const esFin = hour >= 23 || !en(hour + 1);

  // El largo solo se cuenta en la celda que abre el tramo: es la única que
  // muestra la etiqueta de duración.
  let largo = 0;
  if (esInicio) {
    let h = hour;
    while (h <= 23 && en(h)) { largo++; h++; }
  }
  return { esInicio, esFin, largo };
};

// Lectura en vivo de lo que se está pintando con el arrastre. Antes el gesto
// no decía nada: soltabas y recién ahí contabas celdas para saber qué habías
// marcado. El arrastre pinta libre (puede cruzar días), así que la etiqueta se
// adapta a la forma real del trazo en vez de fingir un rectángulo:
//   - un solo día y horas seguidas → el rango, que es el caso normal
//   - un solo día con huecos → el día y el total
//   - varios días → cuántos días y el total
export const describeDrag = (touched) => {
  const n = touched.length;
  if (!n) return '';
  const horas = `${n} ${n === 1 ? 'hora' : 'horas'}`;
  const dias = [...new Set(touched.map(t => t.dayIdx))];
  if (dias.length > 1) return `${dias.length} días · ${horas}`;

  const hs = touched.map(t => t.hour).sort((a, b) => a - b);
  const desde = hs[0];
  const hasta = hs[hs.length - 1] + 1;
  const seguidas = hs.length === hasta - desde;
  const dia = DIAS[dias[0]];
  if (!seguidas) return `${dia} · ${horas}`;
  const pad = (h) => String(h).padStart(2, '0');
  return `${dia} ${pad(desde)}:00 – ${pad(hasta)}:00 · ${horas}`;
};

// `atCap` evita que el medidor se contradiga con el tope diario. Sin esto,
// quien solo tiene libres los fines de semana llegaba a 8 horas —el máximo que
// el tope le permite en dos días— y el medidor le seguía pidiendo horas que no
// tenía forma de cargar. Cuando ya está en el techo de cada día que marcó, lo
// que le falta no son horas: es otro día.
export const goalState = (hoursMarked, weeklyTarget, atCap = false) => {
  const target = Math.max(1, weeklyTarget || 1);
  const comfy = target * 3;
  const pct = Math.min(100, Math.round((hoursMarked / comfy) * 100));
  if (hoursMarked < target) {
    return { pct, tone: 'short', label: atCap ? 'Sumá otro día' : 'Faltan horas' };
  }
  if (hoursMarked < comfy) {
    return { pct, tone: 'ok', label: atCap ? 'Alcanza; sumá otro día para más margen' : 'Alcanza, con poco margen' };
  }
  return { pct, tone: 'good', label: 'Margen holgado' };
};
