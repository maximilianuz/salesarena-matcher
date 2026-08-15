// Tests del cierre de sesión (src/closeouts.js): compromiso, reciprocidad,
// credibilidad, disputas y sobre cerrado. Corre con `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDisputed,
  getDisputedMeetings,
  getEngagement,
  getOwedCloseouts,
  getReciprocity,
  getCredibility,
  isRevealed,
  getPraiseReceived,
  CLOSEOUT_WINDOW_MS,
  RECIPROCITY_FLOOR
} from '../src/closeouts.js';

const AHORA = Date.parse('2026-08-15T12:00:00Z');
const hace = (horas) => new Date(AHORA - horas * 3600e3).toISOString();

const reunion = (id, horasAtras) => ({ id, startsAt: hace(horasAtras), duration: 60 });
const cierre = (meetingId, autor, sujeto, extra = {}) => ({
  meetingId,
  authorEmail: autor,
  subjectEmail: sujeto,
  happened: 'completa',
  engagement: 'preparado',
  learned: 'si',
  cordial: true,
  praise: '',
  ...extra
});
const asistio = (meetingId, email) => ({ meetingId, memberEmail: email, status: 'asistio' });

// --- DISPUTAS ---

test('disputa: decir "no se hizo" contra "completa" es contradicción', () => {
  assert.equal(isDisputed('no_se_hizo', 'completa'), true);
  assert.equal(isDisputed('completa', 'no_se_hizo'), true);
});

test('disputa: "completa" vs "cortada" NO es contradicción', () => {
  // Son dos formas de decir que la sesión ocurrió; discutir el grado no
  // convierte a nadie en mentiroso.
  assert.equal(isDisputed('completa', 'cortada'), false);
  assert.equal(isDisputed('cortada', 'cortada'), false);
});

test('disputa: una sola respuesta todavía no es disputa', () => {
  assert.equal(isDisputed('no_se_hizo', null), false);
  assert.deepEqual(getDisputedMeetings([cierre('m1', 'a@x.com', 'b@x.com')]), []);
});

test('disputa: señala a quien quedó fuera del consenso', () => {
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ];
  assert.deepEqual(getDisputedMeetings(closeouts), [
    { meetingId: 'm1', outlierEmail: 'b@x.com' }
  ]);
});

// --- COMPROMISO ---

test('compromiso: promedia lo que dijeron los compañeros sobre esa persona', () => {
  const meetings = [reunion('m1', 5), reunion('m2', 5)];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { engagement: 'preparado' }),   // 1
    cierre('m1', 'b@x.com', 'a@x.com'),                                // abre el sobre
    cierre('m2', 'c@x.com', 'b@x.com', { engagement: 'a_medias' }),    // 0.5
    cierre('m2', 'b@x.com', 'c@x.com')                                 // abre el sobre
  ];
  assert.equal(getEngagement('b@x.com', closeouts, meetings, AHORA), 75);
});

test('compromiso: no se ve mientras el sobre sigue cerrado', () => {
  // Si el puntaje se moviera apenas responde el compañero, mirarlo antes de
  // contestar delataría la nota recibida y el sobre no serviría de nada.
  const meetings = [reunion('m1', 1)]; // terminó hace poco, plazo abierto
  const soloUno = [cierre('m1', 'a@x.com', 'b@x.com', { engagement: 'preparado' })];
  assert.equal(getEngagement('b@x.com', soloUno, meetings, AHORA), null);

  const losDos = [...soloUno, cierre('m1', 'b@x.com', 'a@x.com', { engagement: 'a_medias' })];
  assert.equal(getEngagement('b@x.com', losDos, meetings, AHORA), 100);
});

test('compromiso: al vencer el plazo cuenta aunque el otro nunca haya contestado', () => {
  const meetings = [reunion('m1', 72)]; // terminó hace 72h, plazo de 48h vencido
  const soloUno = [cierre('m1', 'a@x.com', 'b@x.com', { engagement: 'preparado' })];
  assert.equal(getEngagement('b@x.com', soloUno, meetings, AHORA), 100);
});

test('compromiso: sin cierres recibidos es null, nunca 0', () => {
  // Alguien que recién entra no puede arrancar con la peor nota posible.
  assert.equal(getEngagement('nuevo@x.com', [], [reunion('m1', 5)], AHORA), null);
});

test('compromiso: no cuenta lo que dijo la persona sobre OTROS', () => {
  const meetings = [reunion('m1', 72)]; // plazo vencido → sobre abierto
  const closeouts = [cierre('m1', 'b@x.com', 'a@x.com', { engagement: 'no_participo' })];
  assert.equal(getEngagement('b@x.com', closeouts, meetings, AHORA), null);
  assert.equal(getEngagement('a@x.com', closeouts, meetings, AHORA), 0);
});

test('compromiso: una reunión en disputa no puntúa para NINGUNO de los dos', () => {
  // Es lo que hace que mentir no sirva: acusar en falso no hunde al otro,
  // solo anula la reunión.
  const meetings = [reunion('m1', 5)];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa', engagement: 'preparado' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo', engagement: 'no_participo' })
  ];
  assert.equal(getEngagement('a@x.com', closeouts, meetings, AHORA), null);
  assert.equal(getEngagement('b@x.com', closeouts, meetings, AHORA), null);
});

test('compromiso: ignora cierres fuera de la ventana de 60 días', () => {
  const meetings = [reunion('viejo', 24 * 90), reunion('nuevo', 5)];
  const closeouts = [
    cierre('viejo', 'a@x.com', 'b@x.com', { engagement: 'no_participo' }),
    cierre('viejo', 'b@x.com', 'a@x.com'),
    cierre('nuevo', 'a@x.com', 'b@x.com', { engagement: 'preparado' }),
    cierre('nuevo', 'b@x.com', 'a@x.com')
  ];
  assert.equal(getEngagement('b@x.com', closeouts, meetings, AHORA), 100);
});

// --- RECIPROCIDAD ---

test('reciprocidad: cuenta solo reuniones ya terminadas', () => {
  const meetings = [reunion('pasada', 5), { id: 'futura', startsAt: new Date(AHORA + 3600e3).toISOString(), duration: 60 }];
  const attendances = [asistio('pasada', 'a@x.com'), asistio('futura', 'a@x.com')];
  assert.deepEqual(getOwedCloseouts('a@x.com', meetings, attendances, AHORA), ['pasada']);
});

test('reciprocidad: una reunión cancelada no genera obligación', () => {
  const meetings = [reunion('m1', 5)];
  const attendances = [
    asistio('m1', 'a@x.com'),
    { meetingId: 'm1', memberEmail: 'b@x.com', status: 'cancelado_con_aviso' }
  ];
  assert.deepEqual(getOwedCloseouts('a@x.com', meetings, attendances, AHORA), []);
});

test('reciprocidad: proporción de cierres respondidos', () => {
  const meetings = [reunion('m1', 5), reunion('m2', 5)];
  const attendances = [asistio('m1', 'a@x.com'), asistio('m2', 'a@x.com')];
  const closeouts = [cierre('m1', 'a@x.com', 'b@x.com')];
  assert.equal(getReciprocity('a@x.com', closeouts, meetings, attendances, AHORA), 0.5);
});

test('reciprocidad: sin obligaciones todavía es null, no 0', () => {
  assert.equal(getReciprocity('nuevo@x.com', [], [], [], AHORA), null);
});

// --- CREDIBILIDAD ---

test('credibilidad: promedia las señales disponibles', () => {
  assert.equal(getCredibility(100, 50, 1), 75);
});

test('credibilidad: con una sola señal usa esa, no penaliza por la que falta', () => {
  // Quien recién entra tiene compromiso null y no debe quedar último por eso.
  assert.equal(getCredibility(80, null, null), 80);
  assert.equal(getCredibility(null, 60, null), 60);
});

test('credibilidad: sin ninguna señal es null', () => {
  assert.equal(getCredibility(null, null, null), null);
});

test('credibilidad: no contestar nunca descuenta, pero solo hasta el piso', () => {
  const contestaTodo = getCredibility(100, 100, 1);
  const noContestaNada = getCredibility(100, 100, 0);
  assert.equal(contestaTodo, 100);
  assert.equal(noContestaNada, Math.round(100 * RECIPROCITY_FLOOR));
  assert.ok(noContestaNada < contestaTodo, 'ignorar el cierre tiene que costar algo');
  assert.ok(noContestaNada >= 80, 'pero no puede hundir a alguien que sí asiste');
});

// --- SOBRE CERRADO ---

test('sobre: se abre cuando los dos respondieron', () => {
  const finMs = AHORA - 3600e3;
  const dos = [cierre('m1', 'a@x.com', 'b@x.com'), cierre('m1', 'b@x.com', 'a@x.com')];
  assert.equal(isRevealed(dos, finMs, AHORA), true);
});

test('sobre: con una sola respuesta sigue cerrado hasta que vence el plazo', () => {
  const uno = [cierre('m1', 'a@x.com', 'b@x.com')];
  const finReciente = AHORA - 3600e3;
  assert.equal(isRevealed(uno, finReciente, AHORA), false);
  const finViejo = AHORA - CLOSEOUT_WINDOW_MS - 1000;
  assert.equal(isRevealed(uno, finViejo, AHORA), true);
});

test('elogio: no se ve mientras el sobre sigue cerrado', () => {
  const meetings = [reunion('m1', 1)]; // terminó hace nada
  const closeouts = [cierre('m1', 'a@x.com', 'b@x.com', { praise: 'Muy buenas preguntas' })];
  assert.deepEqual(getPraiseReceived('b@x.com', closeouts, meetings, AHORA), []);
});

test('elogio: se ve una vez abierto el sobre, y solo al destinatario', () => {
  const meetings = [reunion('m1', 5)];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { praise: 'Muy buenas preguntas' }),
    cierre('m1', 'b@x.com', 'a@x.com', { praise: '' })
  ];
  const paraB = getPraiseReceived('b@x.com', closeouts, meetings, AHORA);
  assert.equal(paraB.length, 1);
  assert.equal(paraB[0].praise, 'Muy buenas preguntas');
  assert.deepEqual(getPraiseReceived('a@x.com', closeouts, meetings, AHORA), []);
});
