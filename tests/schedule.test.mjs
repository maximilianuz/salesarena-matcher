// Tests de src/domain/schedule.js: la fecha real de una reunión a partir del
// slot, y la ventana en la que abrir el enlace deja registro de asistencia.

import test from 'node:test';
import assert from 'node:assert/strict';
import { canRecordJoin, JOIN_RECORD_MARGIN_MS } from '../src/domain/schedule.js';

// --- VENTANA DE REGISTRO DE INGRESO ---
//
// joined_at dejó de ser solo el insumo del barrido de asistencia: la resolución
// de disputas del cierre lo usa como EVIDENCIA de que la persona estuvo. Por eso
// abrir el enlace tiene que dejar rastro solo alrededor de la reunión — si no,
// alguien podría clickear al día siguiente y fabricarse una prueba de presencia
// para desmentir a su compañero.

const INICIO = Date.parse('2026-08-20T15:00:00Z');
const ISO = new Date(INICIO).toISOString();
const min = (n) => INICIO + n * 60000;

test('ingreso: se registra desde 30 min antes hasta 30 min después del final', () => {
  assert.equal(canRecordJoin(ISO, 60, min(-31)), false, '31 min antes es demasiado temprano');
  assert.equal(canRecordJoin(ISO, 60, min(-30)), true, 'media hora antes ya vale');
  assert.equal(canRecordJoin(ISO, 60, min(0)), true, 'a la hora de empezar');
  assert.equal(canRecordJoin(ISO, 60, min(45)), true, 'en el medio de la sesión');
  assert.equal(canRecordJoin(ISO, 60, min(90)), true, 'media hora después de terminar');
  assert.equal(canRecordJoin(ISO, 60, min(91)), false, 'más tarde ya no cuenta');
});

test('ingreso: quien llega tarde igual deja registro', () => {
  // Es el caso que importa para las disputas: entró 20 min tarde, la sesión se
  // hizo, y su presencia queda probada aunque el barrido ya lo haya resuelto.
  assert.equal(canRecordJoin(ISO, 60, min(20)), true);
});

test('ingreso: la ventana sigue a la duración real de la reunión', () => {
  assert.equal(canRecordJoin(ISO, 30, min(61)), false);
  assert.equal(canRecordJoin(ISO, 60, min(61)), true);
  // Sin duración se asume una hora, igual que meeting_end_at() en la base.
  assert.equal(canRecordJoin(ISO, null, min(61)), true);
});

test('ingreso: una reunión sin fecha válida nunca registra', () => {
  assert.equal(canRecordJoin(null, 60, INICIO), false);
  assert.equal(canRecordJoin('', 60, INICIO), false);
  assert.equal(canRecordJoin('no es una fecha', 60, INICIO), false);
});

test('ingreso: el margen es el mismo antes y después', () => {
  assert.equal(JOIN_RECORD_MARGIN_MS, 30 * 60000);
});
