// Tests de src/domain/availabilityGrid.js: los atajos de cabecera del asistente
// de disponibilidad y el medidor de cobertura.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visibleHours,
  toggleDay,
  toggleHourRow,
  describeDrag,
  runAt,
  goalState,
  MAX_HOURS_PER_DAY,
  hoursOnDay,
  dayHasRoom,
  daysOverCap,
  addCell,
  allMarkedDaysFull
} from '../src/domain/availabilityGrid.js';

const cell = (dayIdx, hour) => ({ dayIdx, hour });
const tiene = (grid, dayIdx, hour) => grid.some(s => s.dayIdx === dayIdx && s.hour === hour);
const ordenar = (grid) => [...grid].sort((a, b) => a.dayIdx - b.dayIdx || a.hour - b.hour);

// --- HORAS VISIBLES ---
//
// La grilla arranca colapsada en 06:00 y la madrugada se despliega aparte. Los
// atajos tienen que respetar ese recorte: marcar horas que la persona no tiene
// en pantalla es declarar disponibilidad que nunca vio.

test('horas visibles: colapsada arranca a las 06:00, desplegada muestra las 24', () => {
  assert.deepEqual(visibleHours(false)[0], 6, 'colapsada empieza a las 06');
  assert.equal(visibleHours(false).length, 18, 'de 06 a 23 son 18 horas');
  assert.equal(visibleHours(true).length, 24, 'desplegada muestra el día entero');
  assert.equal(visibleHours(true)[0], 0, 'desplegada empieza a las 00');
});

// --- CABECERA DE DÍA ---

test('cabecera de día: llena hasta el tope, no la columna entera', () => {
  const grid = toggleDay([], 3, visibleHours(false));
  assert.equal(grid.length, MAX_HOURS_PER_DAY, 'marca 4 horas, no las 18 visibles');
  assert.ok(grid.every(s => s.dayIdx === 3), 'todas son del jueves');
});

// El atajo tiene que elegir horas que sirvan para algo: marcar cuatro horas
// donde no hay nadie más libre es disponibilidad que nunca va a cruzarse.
test('cabecera de día: elige las horas más elegidas por la sala', () => {
  const popularidad = { 20: 9, 21: 8, 9: 7, 10: 6 };
  const rank = (_d, h) => popularidad[h] ?? 0;
  const grid = toggleDay([], 3, visibleHours(false), { rank });
  assert.deepEqual(
    grid.map(s => s.hour).sort((a, b) => a - b),
    [9, 10, 20, 21],
    'toma las cuatro más votadas'
  );
});

test('cabecera de día: a igual popularidad gana la más temprana', () => {
  const grid = toggleDay([], 3, visibleHours(false));
  assert.deepEqual(grid.map(s => s.hour).sort((a, b) => a - b), [6, 7, 8, 9]);
});

test('cabecera de día: la borra cuando ya estaba completa', () => {
  const llena = toggleDay([], 3, visibleHours(false));
  assert.deepEqual(toggleDay(llena, 3, visibleHours(false)), [], 'segundo clic limpia');
});

test('cabecera de día: completa hasta el tope si estaba a medias, no la borra', () => {
  const parcial = [cell(3, 9), cell(3, 10)];
  const grid = toggleDay(parcial, 3, visibleHours(false));
  assert.equal(grid.length, MAX_HOURS_PER_DAY, 'suma las dos que faltaban para llegar al tope');
  assert.ok(tiene(grid, 3, 9) && tiene(grid, 3, 10), 'conserva lo que ya estaba');
  assert.equal(
    grid.filter(s => s.dayIdx === 3 && s.hour === 9).length,
    1,
    'no duplica las celdas que ya estaban'
  );
});

test('cabecera de día: no toca las otras columnas', () => {
  const otras = [cell(0, 9), cell(6, 14)];
  const grid = toggleDay(otras, 3, visibleHours(false));
  assert.ok(tiene(grid, 0, 9) && tiene(grid, 6, 14), 'lunes y domingo siguen intactos');
});

// Este es el caso que justifica que el atajo reciba las horas visibles en vez
// de calcularlas: con la madrugada colapsada, marcar y desmarcar un día no
// puede llevarse puestas las horas que la persona había cargado a las 03:00.
test('cabecera de día: conserva las horas ocultas de esa misma columna', () => {
  const conMadrugada = [cell(3, 3)];
  const marcada = toggleDay(conMadrugada, 3, visibleHours(false));
  assert.ok(tiene(marcada, 3, 3), 'las 03:00 sobreviven al marcar');

  const borrada = toggleDay(marcada, 3, visibleHours(false));
  assert.deepEqual(borrada, [cell(3, 3)], 'y también al borrar');
});

// --- CABECERA DE HORA ---

test('cabecera de hora: marca esa franja en los siete días', () => {
  const grid = toggleHourRow([], 9);
  assert.equal(grid.length, 7, 'una celda por día');
  assert.deepEqual(
    ordenar(grid).map(s => s.dayIdx),
    [0, 1, 2, 3, 4, 5, 6],
    'de lunes a domingo'
  );
  assert.ok(grid.every(s => s.hour === 9), 'todas a las 09:00');
});

test('cabecera de hora: la borra cuando ya estaba completa', () => {
  const llena = toggleHourRow([], 9);
  assert.deepEqual(toggleHourRow(llena, 9), [], 'segundo clic limpia');
});

test('cabecera de hora: completa la franja si estaba a medias', () => {
  const grid = toggleHourRow([cell(0, 9), cell(1, 9)], 9);
  assert.equal(grid.length, 7, 'la completa en vez de borrar');
});

test('cabecera de hora: no toca las otras franjas', () => {
  const grid = toggleHourRow([cell(0, 14)], 9);
  assert.ok(tiene(grid, 0, 14), 'las 14:00 del lunes siguen ahí');
  assert.equal(grid.length, 8, '7 nuevas + la que ya estaba');
});

// --- TOPE DIARIO ---
//
// Cuatro horas por día. Es un límite sobre lo que se DECLARA disponible, no
// sobre cuántos role-plays se aceptan: eso ya lo decide weekly_target. El tope
// existe porque marcar el día entero es gratis, se olvida, y termina en una
// propuesta a un horario que la persona ya no quería.

test('tope: una celda de más en un día lleno se rechaza', () => {
  const lleno = [cell(1, 9), cell(1, 10), cell(1, 11), cell(1, 12)];
  assert.equal(hoursOnDay(lleno, 1), 4);
  assert.equal(dayHasRoom(lleno, 1), false, 'el martes no tiene lugar');
  assert.equal(addCell(lleno, 1, 15), lleno, 'devuelve la MISMA grilla, para poder avisar');
});

test('tope: el rechazo es por día, no global', () => {
  const lleno = [cell(1, 9), cell(1, 10), cell(1, 11), cell(1, 12)];
  const conMiercoles = addCell(lleno, 2, 15);
  assert.equal(conMiercoles.length, 5, 'el miércoles sigue teniendo lugar');
  assert.ok(tiene(conMiercoles, 2, 15));
});

test('tope: volver a marcar una celda que ya estaba no consume cupo', () => {
  const tres = [cell(1, 9), cell(1, 10), cell(1, 11)];
  assert.equal(addCell(tres, 1, 9), tres, 'no duplica ni gasta lugar');
  assert.equal(addCell(tres, 1, 14).length, 4, 'y todavía entra una nueva');
});

// La madrugada se colapsa en pantalla, pero sigue siendo el mismo día: si no
// contara para el tope, marcar cuatro horas visibles más cuatro ocultas daría
// ocho, que es justo lo que el tope viene a evitar.
test('tope: las horas ocultas de la madrugada también ocupan cupo', () => {
  const conMadrugada = [cell(1, 2), cell(1, 3), cell(1, 4)];
  assert.equal(hoursOnDay(conMadrugada, 1), 3);
  const grid = toggleDay(conMadrugada, 1, visibleHours(false));
  assert.equal(grid.length, 4, 'solo entra una hora visible más');
});

test('tope: sin cupo libre, la cabecera de día limpia lo visible', () => {
  const lleno = toggleDay([], 3, visibleHours(false));
  const vacio = toggleDay(lleno, 3, visibleHours(false));
  assert.deepEqual(vacio, [], 'el segundo clic sigue borrando');
});

test('tope: la cabecera de hora saltea los días que ya llegaron al límite', () => {
  const lunesLleno = [cell(0, 6), cell(0, 7), cell(0, 8), cell(0, 9)];
  const grid = toggleHourRow(lunesLleno, 15);
  assert.equal(tiene(grid, 0, 15), false, 'el lunes no recibe la hora nueva');
  assert.equal(grid.filter(s => s.hour === 15).length, 6, 'los otros seis días sí');
  assert.equal(hoursOnDay(grid, 0), 4, 'y el lunes queda intacto en su tope');
});

// Los días que ya estaban por encima del tope antes de que existiera no se
// tocan solos: se marcan y la persona decide.
test('tope: los días que ya excedían el límite se señalan, no se recortan', () => {
  const viejo = [cell(4, 9), cell(4, 10), cell(4, 11), cell(4, 12), cell(4, 13), cell(0, 9)];
  assert.deepEqual(daysOverCap(viejo), [4], 'solo el viernes está excedido');
  assert.equal(hoursOnDay(viejo, 4), 5, 'y conserva sus cinco horas');
});

test('tope: sin días excedidos la lista viene vacía', () => {
  assert.deepEqual(daysOverCap([cell(0, 9), cell(1, 9)]), []);
});

// --- TRAMOS CONTIGUOS ---
//
// Tres horas seguidas tienen que leerse como un bloque: la primera redondea
// arriba, la última abajo, y las del medio no llevan costura. La etiqueta de
// duración va solo en la que abre.

const setDe = (...celdas) => new Set(celdas.map(c => `${c.dayIdx}-${c.hour}`));

test('tramo: una hora sola abre y cierra el bloque', () => {
  const m = setDe(cell(2, 9));
  assert.deepEqual(runAt(m, 2, 9), { esInicio: true, esFin: true, largo: 1 });
});

test('tramo: tres horas seguidas son un bloque con principio, medio y fin', () => {
  const m = setDe(cell(2, 9), cell(2, 10), cell(2, 11));
  assert.deepEqual(runAt(m, 2, 9), { esInicio: true, esFin: false, largo: 3 }, 'la primera abre y sabe el largo');
  assert.deepEqual(runAt(m, 2, 10), { esInicio: false, esFin: false, largo: 0 }, 'la del medio no lleva costura ni etiqueta');
  assert.deepEqual(runAt(m, 2, 11), { esInicio: false, esFin: true, largo: 0 }, 'la última cierra');
});

test('tramo: un hueco corta el bloque en dos', () => {
  const m = setDe(cell(2, 9), cell(2, 10), cell(2, 13), cell(2, 14));
  assert.equal(runAt(m, 2, 10).esFin, true, 'las 10 cierran el primer bloque');
  assert.equal(runAt(m, 2, 13).esInicio, true, 'las 13 abren el segundo');
  assert.equal(runAt(m, 2, 13).largo, 2, 'y cuentan solo su propio tramo');
});

test('tramo: los días no se contagian entre sí', () => {
  const m = setDe(cell(2, 9), cell(3, 9), cell(3, 10));
  assert.deepEqual(runAt(m, 2, 9), { esInicio: true, esFin: true, largo: 1 }, 'el miércoles no ve al jueves');
  assert.equal(runAt(m, 3, 9).largo, 2);
});

// Este es el caso que justifica el parámetro: con la madrugada colapsada la
// grilla arranca a las 06:00, así que esa celda abre el bloque en pantalla
// aunque las 05:00 estén marcadas. Sin esto, el bloque nacería sin borde
// superior y se vería cortado contra la cabecera.
test('tramo: con la madrugada colapsada, la primera hora visible abre el bloque', () => {
  const m = setDe(cell(2, 5), cell(2, 6), cell(2, 7));
  assert.equal(runAt(m, 2, 6, 6).esInicio, true, 'colapsada: las 06 abren');
  assert.equal(runAt(m, 2, 6, 6).largo, 2, 'y cuentan solo lo visible hacia abajo');
  assert.equal(runAt(m, 2, 6, 0).esInicio, false, 'desplegada: las 06 vienen de las 05');
});

test('tramo: la última hora del día cierra el bloque', () => {
  const m = setDe(cell(2, 22), cell(2, 23));
  assert.equal(runAt(m, 2, 23).esFin, true, 'no hay hora 24 que continúe');
});

test('tramo: una celda sin marcar no tiene tramo', () => {
  assert.equal(runAt(setDe(cell(2, 9)), 2, 14), null);
});

// --- LECTURA EN VIVO DEL ARRASTRE ---
//
// El arrastre pinta libre y puede cruzar días, así que la etiqueta describe la
// forma real del trazo en vez de fingir que siempre es un rango.

test('arrastre: un día con horas seguidas muestra el rango', () => {
  const trazo = [cell(4, 9), cell(4, 10)];
  assert.equal(describeDrag(trazo), 'Viernes 09:00 – 11:00 · 2 horas');
});

test('arrastre: el rango termina al final de la última hora, no al empezarla', () => {
  assert.equal(describeDrag([cell(0, 9)]), 'Lunes 09:00 – 10:00 · 1 hora');
});

test('arrastre: da igual el orden en que se pintaron las celdas', () => {
  const alReves = [cell(2, 11), cell(2, 9), cell(2, 10)];
  assert.equal(describeDrag(alReves), 'Miércoles 09:00 – 12:00 · 3 horas');
});

test('arrastre: un día con huecos no inventa un rango', () => {
  const conHueco = [cell(2, 9), cell(2, 14)];
  assert.equal(describeDrag(conHueco), 'Miércoles · 2 horas');
});

test('arrastre: cruzando días informa cuántos días y el total', () => {
  const cruzado = [cell(0, 9), cell(1, 9), cell(2, 9)];
  assert.equal(describeDrag(cruzado), '3 días · 3 horas');
});

test('arrastre: sin celdas no dice nada', () => {
  assert.equal(describeDrag([]), '');
});

// --- MEDIDOR DE COBERTURA ---
//
// El piso duro es una hora por sesión pedida; el margen cómodo, 3× las
// sesiones. En el medio el medidor dice "alcanza" sin fingir que está todo
// resuelto: hay dónde ubicarlas, pero el emparejador tiene poco con qué cruzar.

test('medidor: por debajo de las sesiones pedidas falta disponibilidad', () => {
  assert.equal(goalState(0, 3).tone, 'short', 'sin nada marcado');
  assert.equal(goalState(2, 3).tone, 'short', 'dos horas para tres sesiones');
});

test('medidor: desde una hora por sesión ya alcanza', () => {
  assert.equal(goalState(3, 3).tone, 'ok', 'justo en el piso');
  assert.equal(goalState(8, 3).tone, 'ok', 'todavía sin margen holgado');
});

test('medidor: con el triple de horas el margen es holgado', () => {
  assert.equal(goalState(9, 3).tone, 'good', 'justo en el margen cómodo');
  assert.equal(goalState(40, 3).tone, 'good', 'y por encima también');
});

test('medidor: el porcentaje avanza y se corta en 100', () => {
  assert.equal(goalState(0, 3).pct, 0, 'vacío arranca en cero');
  assert.equal(goalState(9, 3).pct, 100, 'el margen cómodo llena la barra');
  assert.equal(goalState(40, 3).pct, 100, 'marcar de más no la desborda');
});

// El medidor no puede pedir horas que el tope prohíbe cargar. Quien solo tiene
// libres sábado y domingo llega a 8 horas y ahí se termina: si el mensaje
// siguiera siendo "faltan horas", le estaría pidiendo algo imposible para
// siempre. Lo que le falta es otro día, y eso es lo que tiene que decir.
test('medidor: en el techo de cada día marcado, pide otro día y no más horas', () => {
  assert.equal(goalState(8, 3, true).label, 'Alcanza; sumá otro día para más margen');
  assert.equal(goalState(8, 3, false).label, 'Alcanza, con poco margen');
  assert.equal(goalState(2, 3, true).label, 'Sumá otro día', 'también cuando está por debajo del piso');
});

test('medidor: el tono no cambia por estar en el techo, solo el mensaje', () => {
  assert.equal(goalState(8, 3, true).tone, goalState(8, 3, false).tone);
  assert.equal(goalState(8, 3, true).pct, goalState(8, 3, false).pct);
});

test('medidor: con margen holgado el tope ya no es lo que limita', () => {
  assert.equal(goalState(12, 3, true).label, 'Margen holgado', 'nadie tiene que sumar nada');
});

test('techo: dos días llenos están en el techo; uno a medias no', () => {
  const dosLlenos = [
    cell(5, 9), cell(5, 10), cell(5, 11), cell(5, 12),
    cell(6, 9), cell(6, 10), cell(6, 11), cell(6, 12)
  ];
  assert.equal(allMarkedDaysFull(dosLlenos), true);
  assert.equal(allMarkedDaysFull([...dosLlenos, cell(0, 9)]), false, 'el lunes todavía tiene lugar');
});

test('techo: una grilla vacía no está en el techo', () => {
  assert.equal(allMarkedDaysFull([]), false, 'sin nada marcado lo que falta son horas, no días');
});

// wizardWeeklyTarget se edita a mano en un input numérico: si queda vacío o en
// cero, dividir por el margen daría Infinity o NaN y la barra se rompería.
test('medidor: un objetivo vacío o cero no rompe el cálculo', () => {
  for (const target of [0, null, undefined, NaN]) {
    const g = goalState(5, target);
    assert.ok(Number.isFinite(g.pct), `pct finito con objetivo ${target}`);
    assert.ok(g.pct >= 0 && g.pct <= 100, `pct en rango con objetivo ${target}`);
  }
});
