// Tests del cierre de sesión (src/closeouts.js): compromiso, reciprocidad,
// credibilidad, disputas, mentiras comprobadas y sobre sellado. `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDisputed,
  getDisputedMeetings,
  getEngagement,
  getOwedCloseouts,
  getReciprocity,
  getCredibility,
  getProvenLies,
  getVeracity,
  getUnbackedDisputes,
  getPatternStrikes,
  getMonthlyLies,
  isBlockedForLying,
  isCountable,
  getPraiseReceived,
  getOwedSkillFeedback,
  isPendingSkillFeedback,
  CLOSEOUT_WINDOW_MS,
  RECIPROCITY_FLOOR,
  VERACITY_FLOOR,
  LIE_PENALTY,
  PATTERN_PENALTY,
  MONTHLY_LIES_LIMIT
} from '../src/closeouts.js';

const AHORA = Date.parse('2026-08-15T12:00:00Z');
const hace = (horas) => new Date(AHORA - horas * 3600e3).toISOString();

const reunion = (id, horasAtras) => ({ id, startsAt: hace(horasAtras), duration: 60 });
// Una reunión cuyo plazo de 48hs ya venció: es cuando el cierre empieza a
// puntuar. Termina a la hora de empezar, así que hacen falta 49hs para atrás.
const cerrada = (id) => reunion(id, 72);
const reciente = (id) => reunion(id, 5);

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
// Registro de ingreso al Meet de los dos: es la evidencia que desmiente un
// "no se hizo".
const entraronLosDos = (meetingId, a, b) => [
  { meetingId, memberEmail: a, status: 'asistio', joinedAt: hace(72) },
  { meetingId, memberEmail: b, status: 'asistio', joinedAt: hace(72) }
];

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
  // Sin filas de asistencia el registro no dice nada de nadie.
  assert.deepEqual(getDisputedMeetings(closeouts), [
    { meetingId: 'm1', outlierEmail: 'b@x.com', corroborated: false, evidence: 'sin_datos' }
  ]);
});

test('disputa: sin registro de ingreso no se corrobora nada', () => {
  // Si nadie abrió el enlace desde la app —o solo uno lo hizo— el registro no
  // desmiente a nadie y la disputa queda neutra.
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ];
  const soloUnoEntro = [
    { meetingId: 'm1', memberEmail: 'a@x.com', status: 'asistio', joinedAt: hace(72) },
    { meetingId: 'm1', memberEmail: 'b@x.com', status: 'no_show', joinedAt: null }
  ];
  const d = getDisputedMeetings(closeouts, soloUnoEntro)[0];
  assert.equal(d.corroborated, false);
  // Entró el acusador, no el outlier: el registro calla sobre quien niega.
  assert.equal(d.evidence, 'silencio');
});

test('disputa: si los dos entraron al Meet, el "no se hizo" queda desmentido', () => {
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ];
  const att = entraronLosDos('m1', 'a@x.com', 'b@x.com');
  assert.deepEqual(getDisputedMeetings(closeouts, att), [
    { meetingId: 'm1', outlierEmail: 'b@x.com', corroborated: true, evidence: 'desmiente' }
  ]);
});

// --- MENTIRA COMPROBADA ---

test('mentira: negar una sesión que el registro respalda cuenta como mentira', () => {
  const meetings = [cerrada('m1')];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ];
  const att = entraronLosDos('m1', 'a@x.com', 'b@x.com');
  assert.equal(getProvenLies('b@x.com', closeouts, meetings, att, AHORA).length, 1);
  // Al que dijo la verdad no le queda ninguna marca.
  assert.equal(getProvenLies('a@x.com', closeouts, meetings, att, AHORA).length, 0);
});

test('mentira: sin evidencia no hay mentira, solo una disputa neutra', () => {
  const meetings = [cerrada('m1')];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ];
  assert.equal(getProvenLies('b@x.com', closeouts, meetings, [], AHORA).length, 0);
  assert.equal(getVeracity('b@x.com', closeouts, meetings, [], AHORA), 1);
});

test('mentira: una comprobada descuenta el 40% de la credibilidad', () => {
  const meetings = [cerrada('m1')];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ];
  const att = entraronLosDos('m1', 'a@x.com', 'b@x.com');
  assert.equal(getVeracity('b@x.com', closeouts, meetings, att, AHORA), 0.6);
  assert.equal(getVeracity('a@x.com', closeouts, meetings, att, AHORA), 1);
});

test('mentira: mentir cuesta bastante más que no contestar nunca', () => {
  const mintioUnaVez = getCredibility(100, 100, 1, 0.6);
  const nuncaContesto = getCredibility(100, 100, 0, 1);
  assert.ok(mintioUnaVez < nuncaContesto,
    'negar una sesión tiene que pesar más que callarse');
  assert.equal(mintioUnaVez, 60);
  assert.equal(nuncaContesto, Math.round(100 * RECIPROCITY_FLOOR));
});

test('mentira: reincidir no baja del piso', () => {
  const meetings = [cerrada('m1'), cerrada('m2'), cerrada('m3')];
  const closeouts = ['m1', 'm2', 'm3'].flatMap(id => [
    cierre(id, 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre(id, 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ]);
  const att = ['m1', 'm2', 'm3'].flatMap(id => entraronLosDos(id, 'a@x.com', 'b@x.com'));
  assert.equal(getProvenLies('b@x.com', closeouts, meetings, att, AHORA).length, 3);
  assert.equal(getVeracity('b@x.com', closeouts, meetings, att, AHORA), VERACITY_FLOOR);
});

test('mentira: a la segunda del mes queda fuera de la rotación', () => {
  const meetings = [cerrada('m1'), cerrada('m2')];
  const unaSola = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ];
  const attUna = entraronLosDos('m1', 'a@x.com', 'b@x.com');
  assert.equal(getMonthlyLies('b@x.com', unaSola, meetings, attUna, AHORA), 1);
  assert.equal(isBlockedForLying('b@x.com', unaSola, meetings, attUna, AHORA), false);

  const dos = [...unaSola,
    cierre('m2', 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre('m2', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ];
  const attDos = [...attUna, ...entraronLosDos('m2', 'a@x.com', 'b@x.com')];
  assert.equal(getMonthlyLies('b@x.com', dos, meetings, attDos, AHORA), MONTHLY_LIES_LIMIT);
  assert.equal(isBlockedForLying('b@x.com', dos, meetings, attDos, AHORA), true);
});

test('mentira: el bloqueo se suelta al cambiar de mes, el descuento no', () => {
  // Dos mentiras, pero del mes pasado: sigue pesando en el puntaje (ventana de
  // 60 días) y ya no lo deja afuera de la rotación.
  const mesPasado = (id) => ({ id, startsAt: hace(24 * 25), duration: 60 });
  const meetings = [mesPasado('m1'), mesPasado('m2')];
  const closeouts = ['m1', 'm2'].flatMap(id => [
    cierre(id, 'a@x.com', 'b@x.com', { happened: 'completa' }),
    cierre(id, 'b@x.com', 'a@x.com', { happened: 'no_se_hizo' })
  ]);
  const att = ['m1', 'm2'].flatMap(id => entraronLosDos(id, 'a@x.com', 'b@x.com'));
  assert.equal(getMonthlyLies('b@x.com', closeouts, meetings, att, AHORA), 0);
  assert.equal(isBlockedForLying('b@x.com', closeouts, meetings, att, AHORA), false);
  assert.equal(getProvenLies('b@x.com', closeouts, meetings, att, AHORA).length, 2);
  assert.equal(getVeracity('b@x.com', closeouts, meetings, att, AHORA), VERACITY_FLOOR);
});

// --- COMPROMISO ---

test('compromiso: promedia lo que dijeron los compañeros sobre esa persona', () => {
  const meetings = [cerrada('m1'), cerrada('m2')];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { engagement: 'preparado' }),   // 1
    cierre('m2', 'c@x.com', 'b@x.com', { engagement: 'a_medias' })     // 0.5
  ];
  assert.equal(getEngagement('b@x.com', closeouts, meetings, [], AHORA), 75);
});

test('compromiso: no puntúa hasta que vence el plazo, respondan o no los dos', () => {
  // El plazo es puro reloj: si el puntaje se moviera al contestar el compañero,
  // mirarlo antes de responder delataría la nota recibida.
  const meetings = [reciente('m1')];
  const losDos = [
    cierre('m1', 'a@x.com', 'b@x.com', { engagement: 'preparado' }),
    cierre('m1', 'b@x.com', 'a@x.com', { engagement: 'a_medias' })
  ];
  assert.equal(getEngagement('b@x.com', losDos, meetings, [], AHORA), null);
  assert.equal(getEngagement('a@x.com', losDos, meetings, [], AHORA), null);
});

test('compromiso: al vencer el plazo cuenta aunque el otro nunca haya contestado', () => {
  const meetings = [cerrada('m1')];
  const soloUno = [cierre('m1', 'a@x.com', 'b@x.com', { engagement: 'preparado' })];
  assert.equal(getEngagement('b@x.com', soloUno, meetings, [], AHORA), 100);
});

test('compromiso: sin cierres recibidos es null, nunca 0', () => {
  // Alguien que recién entra no puede arrancar con la peor nota posible.
  assert.equal(getEngagement('nuevo@x.com', [], [cerrada('m1')], [], AHORA), null);
});

test('compromiso: no cuenta lo que dijo la persona sobre OTROS', () => {
  const meetings = [cerrada('m1')];
  const closeouts = [cierre('m1', 'b@x.com', 'a@x.com', { engagement: 'no_participo' })];
  assert.equal(getEngagement('b@x.com', closeouts, meetings, [], AHORA), null);
  assert.equal(getEngagement('a@x.com', closeouts, meetings, [], AHORA), 0);
});

test('compromiso: una disputa SIN evidencia no puntúa para ninguno de los dos', () => {
  // Sin registro que respalde a nadie, acusar en falso no hunde al otro: solo
  // anula la reunión.
  const meetings = [cerrada('m1')];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa', engagement: 'preparado' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo', engagement: 'no_participo' })
  ];
  assert.equal(getEngagement('a@x.com', closeouts, meetings, [], AHORA), null);
  assert.equal(getEngagement('b@x.com', closeouts, meetings, [], AHORA), null);
});

test('compromiso: mentir ya no borra la nota que el compañero puso', () => {
  // El uso rentable de la mentira era este: negar la sesión para anular la mala
  // calificación que uno sabía que venía. Con el registro en contra, la nota del
  // compañero cuenta y la del mentiroso se descarta.
  const meetings = [cerrada('m1')];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa', engagement: 'no_participo' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo', engagement: 'no_participo' })
  ];
  const att = entraronLosDos('m1', 'a@x.com', 'b@x.com');
  // A dijo la verdad: su calificación de B cuenta.
  assert.equal(getEngagement('b@x.com', closeouts, meetings, att, AHORA), 0);
  // B mintió: lo que puso sobre A se descarta, A no arrastra esa nota.
  assert.equal(getEngagement('a@x.com', closeouts, meetings, att, AHORA), null);
});

test('compromiso: ignora cierres fuera de la ventana de 60 días', () => {
  const meetings = [reunion('viejo', 24 * 90), cerrada('nuevo')];
  const closeouts = [
    cierre('viejo', 'a@x.com', 'b@x.com', { engagement: 'no_participo' }),
    cierre('nuevo', 'a@x.com', 'b@x.com', { engagement: 'preparado' })
  ];
  assert.equal(getEngagement('b@x.com', closeouts, meetings, [], AHORA), 100);
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

test('credibilidad: sin veracidad declarada no cambia nada', () => {
  // El parámetro es opcional para no romper a quien todavía no lo pasa.
  assert.equal(getCredibility(100, 100, 1), getCredibility(100, 100, 1, 1));
  assert.equal(getCredibility(100, 100, 1, null), 100);
});

// --- SOBRE SELLADO ---

test('sobre: no se abre por más que contesten los dos, solo por reloj', () => {
  const finReciente = AHORA - 3600e3;
  assert.equal(isCountable(finReciente, AHORA), false);
  const finViejo = AHORA - CLOSEOUT_WINDOW_MS - 1000;
  assert.equal(isCountable(finViejo, AHORA), true);
});

test('elogio: no se ve mientras el plazo sigue corriendo', () => {
  const meetings = [reciente('m1')];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { praise: 'Muy buenas preguntas' }),
    cierre('m1', 'b@x.com', 'a@x.com', { praise: 'Gran escucha' })
  ];
  // Ni siquiera con las dos respuestas cargadas: si apareciera ahí, el momento
  // en que aparece ya diría que el otro contestó.
  assert.deepEqual(getPraiseReceived('b@x.com', closeouts, meetings, [], AHORA), []);
});

test('elogio: se ve al vencer el plazo, y solo al destinatario', () => {
  const meetings = [cerrada('m1')];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { praise: 'Muy buenas preguntas' }),
    cierre('m1', 'b@x.com', 'a@x.com', { praise: '' })
  ];
  const paraB = getPraiseReceived('b@x.com', closeouts, meetings, [], AHORA);
  assert.equal(paraB.length, 1);
  assert.equal(paraB[0].praise, 'Muy buenas preguntas');
  assert.deepEqual(getPraiseReceived('a@x.com', closeouts, meetings, [], AHORA), []);
});

test('elogio: el de quien mintió no se entrega', () => {
  const meetings = [cerrada('m1')];
  const closeouts = [
    cierre('m1', 'a@x.com', 'b@x.com', { happened: 'completa', praise: 'Muy claro' }),
    cierre('m1', 'b@x.com', 'a@x.com', { happened: 'no_se_hizo', praise: 'Buenísimo' })
  ];
  const att = entraronLosDos('m1', 'a@x.com', 'b@x.com');
  // Su cierre entero queda descartado, elogio incluido.
  assert.deepEqual(getPraiseReceived('a@x.com', closeouts, meetings, att, AHORA), []);
  // El del compañero honesto sí llega.
  assert.equal(getPraiseReceived('b@x.com', closeouts, meetings, att, AHORA).length, 1);
});

// --- REINCIDENCIA SIN EVIDENCIA ---
//
// El registro de ingreso solo existe si la persona entró al Meet desde la app.
// Quien entra desde el mail de Calendar no deja rastro, y eso dejaba un agujero
// justo para el caso peor: al mentiroso le alcanzaba con no pasar por la app
// para que nunca hubiera evidencia sobre sí mismo. Contra eso, el patrón es la
// evidencia.

// Disputa donde el outlier NO tiene registro de ingreso (entró por Calendar, o
// directamente no entró). El registro no lo desmiente ni lo respalda.
const disputaSinRespaldo = (id, outlier, otro) => ({
  meeting: cerrada(id),
  closeouts: [
    cierre(id, otro, outlier, { happened: 'completa', engagement: 'preparado' }),
    cierre(id, outlier, otro, { happened: 'no_se_hizo', engagement: 'no_participo' })
  ],
  attendances: [
    { meetingId: id, memberEmail: outlier, status: 'asistio', joinedAt: null },
    { meetingId: id, memberEmail: otro, status: 'asistio', joinedAt: null }
  ]
});

const armar = (...casos) => ({
  meetings: casos.map(c => c.meeting),
  closeouts: casos.flatMap(c => c.closeouts),
  attendances: casos.flatMap(c => c.attendances)
});

test('reincidencia: la primera disputa sin respaldo sale gratis', () => {
  const { meetings, closeouts, attendances } = armar(
    disputaSinRespaldo('m1', 'beto@x.com', 'ana@x.com')
  );
  assert.equal(getUnbackedDisputes('beto@x.com', closeouts, meetings, attendances, AHORA).length, 1);
  assert.equal(getPatternStrikes('beto@x.com', closeouts, meetings, attendances, AHORA), 0);
  assert.equal(getVeracity('beto@x.com', closeouts, meetings, attendances, AHORA), 1);
});

test('reincidencia: de la segunda en más empieza a costar', () => {
  const { meetings, closeouts, attendances } = armar(
    disputaSinRespaldo('m1', 'beto@x.com', 'ana@x.com'),
    disputaSinRespaldo('m2', 'beto@x.com', 'caro@x.com')
  );
  assert.equal(getPatternStrikes('beto@x.com', closeouts, meetings, attendances, AHORA), 1);
  assert.equal(getVeracity('beto@x.com', closeouts, meetings, attendances, AHORA), 0.8);

  const tres = armar(
    disputaSinRespaldo('m1', 'beto@x.com', 'ana@x.com'),
    disputaSinRespaldo('m2', 'beto@x.com', 'caro@x.com'),
    disputaSinRespaldo('m3', 'beto@x.com', 'dani@x.com')
  );
  assert.equal(getPatternStrikes('beto@x.com', tres.closeouts, tres.meetings, tres.attendances, AHORA), 2);
  assert.equal(getVeracity('beto@x.com', tres.closeouts, tres.meetings, tres.attendances, AHORA), 0.6);
});

test('reincidencia: pesa la mitad que una mentira comprobada', () => {
  const patron = armar(
    disputaSinRespaldo('m1', 'beto@x.com', 'ana@x.com'),
    disputaSinRespaldo('m2', 'beto@x.com', 'caro@x.com')
  );
  const conPatron = getVeracity('beto@x.com', patron.closeouts, patron.meetings, patron.attendances, AHORA);

  const meetings = [cerrada('m1')];
  const comprobada = [
    cierre('m1', 'ana@x.com', 'beto@x.com', { happened: 'completa' }),
    cierre('m1', 'beto@x.com', 'ana@x.com', { happened: 'no_se_hizo' })
  ];
  const conMentira = getVeracity('beto@x.com', comprobada, meetings,
    entraronLosDos('m1', 'ana@x.com', 'beto@x.com'), AHORA);

  const descuento = (v) => Math.round((1 - v) * 100);
  assert.equal(descuento(conPatron), descuento(conMentira) / 2,
    'la evidencia circunstancial tiene que pesar la mitad que la dura');
  assert.equal(PATTERN_PENALTY, LIE_PENALTY / 2);
});

test('reincidencia: NUNCA saca a nadie de la rotación', () => {
  // Sacar a alguien del pool con evidencia circunstancial sería demasiado: el
  // patrón mueve el puntaje, el bloqueo pide el registro en contra.
  const { meetings, closeouts, attendances } = armar(
    disputaSinRespaldo('m1', 'beto@x.com', 'ana@x.com'),
    disputaSinRespaldo('m2', 'beto@x.com', 'caro@x.com'),
    disputaSinRespaldo('m3', 'beto@x.com', 'dani@x.com'),
    disputaSinRespaldo('m4', 'beto@x.com', 'eli@x.com')
  );
  assert.equal(getPatternStrikes('beto@x.com', closeouts, meetings, attendances, AHORA), 3);
  assert.equal(getMonthlyLies('beto@x.com', closeouts, meetings, attendances, AHORA), 0);
  assert.equal(isBlockedForLying('beto@x.com', closeouts, meetings, attendances, AHORA), false);
});

test('reincidencia: al que se presentó y lo dejaron plantado no le cuesta nada', () => {
  // Él entró al Meet, el otro no. "No se hizo" es exactamente lo que hay que
  // contestar, y repetirlo no puede convertirlo en sospechoso: la víctima de
  // varios plantones sería la más castigada.
  const caso = (id, presente, ausente) => ({
    meeting: cerrada(id),
    closeouts: [
      cierre(id, ausente, presente, { happened: 'completa', engagement: 'preparado' }),
      cierre(id, presente, ausente, { happened: 'no_se_hizo', engagement: 'no_participo' })
    ],
    attendances: [
      { meetingId: id, memberEmail: presente, status: 'asistio', joinedAt: hace(72) },
      { meetingId: id, memberEmail: ausente, status: 'no_show', joinedAt: null }
    ]
  });
  const { meetings, closeouts, attendances } = armar(
    caso('m1', 'beto@x.com', 'ana@x.com'),
    caso('m2', 'beto@x.com', 'caro@x.com'),
    caso('m3', 'beto@x.com', 'dani@x.com')
  );
  assert.equal(getUnbackedDisputes('beto@x.com', closeouts, meetings, attendances, AHORA).length, 0);
  assert.equal(getPatternStrikes('beto@x.com', closeouts, meetings, attendances, AHORA), 0);
  assert.equal(getVeracity('beto@x.com', closeouts, meetings, attendances, AHORA), 1);
});

test('reincidencia: sin filas de asistencia no se juzga a nadie', () => {
  // Un llamador que no pasa las asistencias no puede fabricar sanciones.
  const meetings = [cerrada('m1'), cerrada('m2'), cerrada('m3')];
  const closeouts = ['m1', 'm2', 'm3'].flatMap(id => [
    cierre(id, 'ana@x.com', 'beto@x.com', { happened: 'completa' }),
    cierre(id, 'beto@x.com', 'ana@x.com', { happened: 'no_se_hizo' })
  ]);
  assert.equal(getPatternStrikes('beto@x.com', closeouts, meetings, [], AHORA), 0);
  assert.equal(getVeracity('beto@x.com', closeouts, meetings, [], AHORA), 1);
});

test('reincidencia: se suma a las mentiras comprobadas, con el mismo piso', () => {
  const conMentira = {
    meeting: cerrada('m0'),
    closeouts: [
      cierre('m0', 'ana@x.com', 'beto@x.com', { happened: 'completa' }),
      cierre('m0', 'beto@x.com', 'ana@x.com', { happened: 'no_se_hizo' })
    ],
    attendances: entraronLosDos('m0', 'ana@x.com', 'beto@x.com')
  };
  const { meetings, closeouts, attendances } = armar(
    conMentira,
    disputaSinRespaldo('m1', 'beto@x.com', 'caro@x.com'),
    disputaSinRespaldo('m2', 'beto@x.com', 'dani@x.com')
  );
  // 1 comprobada (-0.4) + 1 de patrón (-0.2) = 0.4
  assert.equal(getProvenLies('beto@x.com', closeouts, meetings, attendances, AHORA).length, 1);
  assert.equal(getPatternStrikes('beto@x.com', closeouts, meetings, attendances, AHORA), 1);
  assert.equal(getVeracity('beto@x.com', closeouts, meetings, attendances, AHORA), 0.4);
});

// --- ENCUESTA 2: FEEDBACK DE HABILIDADES ---

const feedback = (meetingId, autor, sujeto) => ({ meetingId, authorEmail: autor, subjectEmail: sujeto });

test('feedback: se debe cuando el cierre dice que hubo sesión real y todavía no se dio', () => {
  const closeouts = [cierre('m1', 'ana@x.com', 'beto@x.com', { happened: 'completa' })];
  const owed = getOwedSkillFeedback('ana@x.com', closeouts, [], [cerrada('m1')], AHORA);
  assert.deepEqual(owed.map(o => o.meetingId), ['m1']);
  assert.equal(isPendingSkillFeedback('ana@x.com', closeouts, [], [cerrada('m1')], AHORA), true);
});

test('feedback: no se debe nada si "no se hizo" la sesión', () => {
  const closeouts = [cierre('m1', 'ana@x.com', 'beto@x.com', { happened: 'no_se_hizo' })];
  assert.deepEqual(getOwedSkillFeedback('ana@x.com', closeouts, [], [cerrada('m1')], AHORA), []);
  assert.equal(isPendingSkillFeedback('ana@x.com', closeouts, [], [cerrada('m1')], AHORA), false);
});

test('feedback: se salda apenas se completa, no hace falta esperar nada', () => {
  const closeouts = [cierre('m1', 'ana@x.com', 'beto@x.com', { happened: 'completa' })];
  const yaDada = [feedback('m1', 'ana@x.com', 'beto@x.com')];
  assert.deepEqual(getOwedSkillFeedback('ana@x.com', closeouts, yaDada, [cerrada('m1')], AHORA), []);
  assert.equal(isPendingSkillFeedback('ana@x.com', closeouts, yaDada, [cerrada('m1')], AHORA), false);
});

test('feedback: solo bloquea a quien debe, nunca a su compañero', () => {
  const closeouts = [
    cierre('m1', 'ana@x.com', 'beto@x.com', { happened: 'completa' }),
    cierre('m1', 'beto@x.com', 'ana@x.com', { happened: 'completa' })
  ];
  // Solo beto dio su devolución; ana todavía no.
  const yaDada = [feedback('m1', 'beto@x.com', 'ana@x.com')];
  assert.equal(isPendingSkillFeedback('ana@x.com', closeouts, yaDada, [cerrada('m1')], AHORA), true);
  assert.equal(isPendingSkillFeedback('beto@x.com', closeouts, yaDada, [cerrada('m1')], AHORA), false);
});
