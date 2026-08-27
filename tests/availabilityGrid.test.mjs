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
  goalState
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

test('cabecera de día: marca la columna entera cuando está vacía', () => {
  const grid = toggleDay([], 3, visibleHours(false));
  assert.equal(grid.length, 18, 'quedan marcadas las 18 horas visibles');
  assert.ok(grid.every(s => s.dayIdx === 3), 'todas son del jueves');
  assert.ok(tiene(grid, 3, 6) && tiene(grid, 3, 23), 'cubre de punta a punta');
});

test('cabecera de día: la borra cuando ya estaba completa', () => {
  const llena = toggleDay([], 3, visibleHours(false));
  assert.deepEqual(toggleDay(llena, 3, visibleHours(false)), [], 'segundo clic limpia');
});

test('cabecera de día: completa la columna si estaba a medias, no la borra', () => {
  const parcial = [cell(3, 9), cell(3, 10)];
  const grid = toggleDay(parcial, 3, visibleHours(false));
  assert.equal(grid.length, 18, 'la completa en vez de borrar lo que había');
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

// wizardWeeklyTarget se edita a mano en un input numérico: si queda vacío o en
// cero, dividir por el margen daría Infinity o NaN y la barra se rompería.
test('medidor: un objetivo vacío o cero no rompe el cálculo', () => {
  for (const target of [0, null, undefined, NaN]) {
    const g = goalState(5, target);
    assert.ok(Number.isFinite(g.pct), `pct finito con objetivo ${target}`);
    assert.ok(g.pct >= 0 && g.pct <= 100, `pct en rango con objetivo ${target}`);
  }
});
