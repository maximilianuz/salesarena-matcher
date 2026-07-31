// Tests de confiabilidad y sanciones (src/reliability.js).
//
// Es la lógica que deja a alguien fuera del emparejamiento y, en el caso
// crónico, sin acceso a la sala. Los casos de abajo cubren tanto que la sanción
// se aplique cuando corresponde como —igual de importante— que NO se aplique de
// más: un mes malo no debe arrastrarse al siguiente, y quien todavía no tiene
// historial no debe aparecer como 0%.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreValue,
  getReliability,
  getRoomReliability,
  getMonthlyFaltas,
  isBlocked,
  getChronicBlockedMonths,
  isChronicOffender,
  getFaltasInMonth,
  MONTHLY_FALTAS_LIMIT,
  CHRONIC_BLOCK_THRESHOLD
} from '../src/reliability.js';

// "Ahora" determinista: 20 de julio de 2026, 12:00 UTC.
const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
const JULIO = Date.UTC(2026, 6, 1);
const JUNIO = Date.UTC(2026, 5, 1);
const MAYO = Date.UTC(2026, 4, 1);

let seq = 0;
// Crea una reunión + su reporte de asistencia en una fecha dada.
const reporte = (email, status, whenMs, punctuality = null) => {
  const id = ++seq;
  return {
    meeting: { id, startsAt: new Date(whenMs).toISOString() },
    attendance: { meetingId: id, memberEmail: email, status, punctuality }
  };
};

// Arma los arrays que consumen las funciones a partir de una lista de reportes.
const build = (rows) => ({
  attendances: rows.map(r => r.attendance),
  meetings: rows.map(r => r.meeting)
});

const dia = (mes, d) => mes + (d - 1) * 24 * 3600e3;

test('scoreValue: puntual vale el doble que tarde, y las faltas valen cero', () => {
  assert.equal(scoreValue('asistio', 'a_tiempo'), 1);
  assert.equal(scoreValue('asistio', null), 1);
  assert.equal(scoreValue('asistio', 'tarde'), 0.5);
  assert.equal(scoreValue('no_show', null), 0);
  assert.equal(scoreValue('cancelado_tarde', null), 0);
  // Cancelar con aviso no premia ni castiga: no entra al promedio.
  assert.equal(scoreValue('cancelado_con_aviso', null), null);
  assert.equal(scoreValue('confirmado', null), null);
});

test('sin historial la confiabilidad es null (se muestra "Nuevo", no 0%)', () => {
  const { attendances, meetings } = build([]);
  assert.equal(getReliability('ana@x.com', attendances, meetings, NOW), null);
});

test('cancelar CON aviso no baja la confiabilidad', () => {
  const { attendances, meetings } = build([
    reporte('ana@x.com', 'asistio', dia(JULIO, 5), 'a_tiempo'),
    reporte('ana@x.com', 'cancelado_con_aviso', dia(JULIO, 8))
  ]);
  // Solo computa la sesión a la que asistió: 100%, no 50%.
  assert.equal(getReliability('ana@x.com', attendances, meetings, NOW), 100);
});

test('llegar tarde puntúa la mitad que llegar a tiempo', () => {
  const { attendances, meetings } = build([
    reporte('ana@x.com', 'asistio', dia(JULIO, 5), 'a_tiempo'),
    reporte('ana@x.com', 'asistio', dia(JULIO, 8), 'tarde')
  ]);
  assert.equal(getReliability('ana@x.com', attendances, meetings, NOW), 75); // (1 + 0.5) / 2
});

test('la confiabilidad ignora lo anterior a la ventana de 60 días', () => {
  const viejo = NOW - 90 * 24 * 3600e3;
  const { attendances, meetings } = build([
    reporte('ana@x.com', 'no_show', viejo),                       // fuera de ventana
    reporte('ana@x.com', 'asistio', dia(JULIO, 10), 'a_tiempo')   // dentro
  ]);
  assert.equal(getReliability('ana@x.com', attendances, meetings, NOW), 100);
});

test('el email se compara sin distinguir mayúsculas', () => {
  const { attendances, meetings } = build([
    reporte('Ana@X.com', 'asistio', dia(JULIO, 5), 'a_tiempo')
  ]);
  assert.equal(getReliability('ana@x.com', attendances, meetings, NOW), 100);
});

test('bloqueo mensual: se activa al llegar al límite, no antes', () => {
  const dos = build([
    reporte('ana@x.com', 'no_show', dia(JULIO, 3)),
    reporte('ana@x.com', 'cancelado_tarde', dia(JULIO, 7))
  ]);
  assert.equal(getMonthlyFaltas('ana@x.com', dos.attendances, dos.meetings, NOW), 2);
  assert.equal(isBlocked('ana@x.com', dos.attendances, dos.meetings, NOW), false);

  const tres = build([
    reporte('ana@x.com', 'no_show', dia(JULIO, 3)),
    reporte('ana@x.com', 'cancelado_tarde', dia(JULIO, 7)),
    reporte('ana@x.com', 'no_show', dia(JULIO, 11))
  ]);
  assert.equal(getMonthlyFaltas('ana@x.com', tres.attendances, tres.meetings, NOW), MONTHLY_FALTAS_LIMIT);
  assert.equal(isBlocked('ana@x.com', tres.attendances, tres.meetings, NOW), true);
});

test('el bloqueo NO se arrastra: las faltas del mes pasado no cuentan en el actual', () => {
  const { attendances, meetings } = build([
    reporte('ana@x.com', 'no_show', dia(JUNIO, 3)),
    reporte('ana@x.com', 'no_show', dia(JUNIO, 10)),
    reporte('ana@x.com', 'no_show', dia(JUNIO, 20))
  ]);
  // En junio estaba bloqueada; consultando en julio, vuelve a estar limpia.
  assert.equal(getFaltasInMonth('ana@x.com', JUNIO, attendances, meetings), 3);
  assert.equal(getMonthlyFaltas('ana@x.com', attendances, meetings, NOW), 0);
  assert.equal(isBlocked('ana@x.com', attendances, meetings, NOW), false);
});

test('las faltas de OTRA persona no bloquean a la propia', () => {
  const { attendances, meetings } = build([
    reporte('beto@x.com', 'no_show', dia(JULIO, 3)),
    reporte('beto@x.com', 'no_show', dia(JULIO, 5)),
    reporte('beto@x.com', 'no_show', dia(JULIO, 9))
  ]);
  assert.equal(isBlocked('ana@x.com', attendances, meetings, NOW), false);
  assert.equal(isBlocked('beto@x.com', attendances, meetings, NOW), true);
});

test('crónico: un solo mes malo NO retira el acceso a la sala', () => {
  const { attendances, meetings } = build([
    reporte('ana@x.com', 'no_show', dia(JULIO, 3)),
    reporte('ana@x.com', 'no_show', dia(JULIO, 8)),
    reporte('ana@x.com', 'no_show', dia(JULIO, 14))
  ]);
  assert.equal(getChronicBlockedMonths('ana@x.com', attendances, meetings), 1);
  assert.equal(isChronicOffender('ana@x.com', attendances, meetings), false);
});

test('crónico: se retira el acceso recién con el patrón repetido en 3 meses', () => {
  const mesMalo = (mes) => [
    reporte('ana@x.com', 'no_show', dia(mes, 3)),
    reporte('ana@x.com', 'no_show', dia(mes, 8)),
    reporte('ana@x.com', 'cancelado_tarde', dia(mes, 14))
  ];
  const dosMeses = build([...mesMalo(JULIO), ...mesMalo(JUNIO)]);
  assert.equal(getChronicBlockedMonths('ana@x.com', dosMeses.attendances, dosMeses.meetings), 2);
  assert.equal(isChronicOffender('ana@x.com', dosMeses.attendances, dosMeses.meetings), false);

  const tresMeses = build([...mesMalo(JULIO), ...mesMalo(JUNIO), ...mesMalo(MAYO)]);
  assert.equal(
    getChronicBlockedMonths('ana@x.com', tresMeses.attendances, tresMeses.meetings),
    CHRONIC_BLOCK_THRESHOLD
  );
  assert.equal(isChronicOffender('ana@x.com', tresMeses.attendances, tresMeses.meetings), true);
});

test('crónico: muchas faltas repartidas sin llegar al límite mensual no son patrón', () => {
  // 2 faltas por mes durante 3 meses = 6 faltas, pero ningún mes bloqueado.
  const { attendances, meetings } = build([
    reporte('ana@x.com', 'no_show', dia(JULIO, 3)), reporte('ana@x.com', 'no_show', dia(JULIO, 9)),
    reporte('ana@x.com', 'no_show', dia(JUNIO, 3)), reporte('ana@x.com', 'no_show', dia(JUNIO, 9)),
    reporte('ana@x.com', 'no_show', dia(MAYO, 3)), reporte('ana@x.com', 'no_show', dia(MAYO, 9))
  ]);
  assert.equal(getChronicBlockedMonths('ana@x.com', attendances, meetings), 0);
  assert.equal(isChronicOffender('ana@x.com', attendances, meetings), false);
});

test('confiabilidad de la sala: promedia a todos, no a una persona', () => {
  const { attendances, meetings } = build([
    reporte('ana@x.com', 'asistio', dia(JULIO, 5), 'a_tiempo'),  // 1
    reporte('beto@x.com', 'no_show', dia(JULIO, 6)),             // 0
    reporte('caro@x.com', 'asistio', dia(JULIO, 7), 'tarde')     // 0.5
  ]);
  assert.equal(getRoomReliability(attendances, meetings, NOW), 50); // (1 + 0 + 0.5) / 3
  assert.equal(getRoomReliability([], [], NOW), null);
});

test('un reporte sin fecha determinable se ignora en vez de contarse mal', () => {
  const attendances = [
    { meetingId: 999, memberEmail: 'ana@x.com', status: 'no_show', punctuality: null, reportedAt: null }
  ];
  const meetings = []; // sin la reunión, y sin reportedAt: no hay fecha
  assert.equal(getMonthlyFaltas('ana@x.com', attendances, meetings, NOW), 0);
  assert.equal(getReliability('ana@x.com', attendances, meetings, NOW), null);
});

test('sin startsAt se usa la fecha del reporte como referencia', () => {
  const attendances = [
    {
      meetingId: 999,
      memberEmail: 'ana@x.com',
      status: 'no_show',
      punctuality: null,
      reportedAt: new Date(dia(JULIO, 6)).toISOString()
    }
  ];
  assert.equal(getMonthlyFaltas('ana@x.com', attendances, [], NOW), 1);
});
