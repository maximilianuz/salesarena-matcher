// Cierre de sesión: lo que cada participante responde DESPUÉS del role-play.
//
// Hasta ahora lo único que se medía era un click en el link de Meet: entrar,
// clickear y irse a los dos minutos daba crédito completo. El cierre agrega la
// dimensión que faltaba —si la persona efectivamente sostuvo el ejercicio—.
//
// SOBRE SELLADO. Ninguno de los dos ve NUNCA lo que el otro respondió sobre las
// cuatro preguntas que puntúan. Lo único que cruza de una persona a la otra es
// el elogio opcional, y aparece POR RELOJ —48hs después de terminar la reunión—
// y no porque el compañero haya contestado. La diferencia importa: si apareciera
// al contestar el otro, el momento en que aparece ya sería información sobre su
// respuesta.
//
// Por el mismo motivo el puntaje también se mueve por reloj. Antes empezaba a
// contar en cuanto respondían los dos, y eso filtraba igual: quien miraba su
// compromiso antes de contestar podía deducir cómo lo habían calificado.
//
// MENTIR TIENE COSTO. Cuando una respuesta dice que la sesión no se hizo y la
// otra que sí, se mira el registro de ingreso al Meet. Si los dos abrieron el
// enlace, el "no se hizo" contradice ese registro y se trata como falso: quien
// lo dijo pierde credibilidad, su respuesta se descarta y la del compañero sí
// cuenta. Sin evidencia que la respalde, la disputa queda neutra para los dos.
//
// Módulo puro (sin React ni Supabase) para poder verificarse con `node --test`.
// La Edge Function (supabase/functions/weekly-matcher) replica getEngagement,
// getReciprocity, getVeracity e isBlockedForLying para priorizar y filtrar el
// emparejamiento: mantener ambas alineadas.

import { RELIABILITY_WINDOW_DAYS, monthStartOf } from './reliability.js';

// ¿Ocurrió la sesión? Es la única pregunta sobre un hecho COMPARTIDO, así que
// es la que se puede cruzar entre las dos respuestas.
export const HAPPENED = ['completa', 'cortada', 'no_se_hizo'];

// Las 5 categorías de la Encuesta 2 (feedback de habilidades), agrupando el
// framework de ventas en lo que un compañero puede evaluar después de UNA
// sola llamada. Cada una es un rating de 3 niveles + comentario libre.
// A diferencia del cierre, esta encuesta NO puntúa nada: es devolución pura,
// visible de inmediato para quien la recibe y para quien la escribió.
// Las 5 etapas de una sesión high-ticket, en el orden en que ocurren en la
// llamada: rapport primero, cierre al final, objeciones entre el pitch y el
// cierre (es ahí donde típicamente aparecen).
export const SKILL_CATEGORIES = ['rapport', 'discovery', 'pitch', 'objections', 'closing'];
export const SKILL_RATING = ['a_mejorar', 'bien', 'muy_bien'];

// ¿Cómo participó la otra persona? Es la pregunta que mueve el compromiso.
export const ENGAGEMENT_VALUE = {
  preparado: 1,
  a_medias: 0.5,
  no_participo: 0
};

// ¿Sirvió para aprender? No puntúa a nadie: mide si la sala está cumpliendo su
// objetivo, y se reporta agregado. Penalizar a alguien porque su compañero no
// aprendió sería castigar el resultado y no la conducta.
export const LEARNED = ['si', 'mas_o_menos', 'no'];

// Ventana para responder, desde que termina la reunión. Es también el plazo tras
// el cual el cierre empieza a puntuar y el elogio se muestra, haya contestado
// uno solo o los dos.
export const CLOSEOUT_WINDOW_MS = 48 * 3600e3;

// Piso del factor de reciprocidad: no contestar nunca cuesta como mucho un 15%
// de la credibilidad. Es un empujón para que el cierre no quede vacío, no una
// sanción — quien contesta todo simplemente no recibe ningún descuento.
export const RECIPROCITY_FLOOR = 0.85;

// Lo que cuesta cada mentira comprobada. Es deliberadamente mucho más caro que
// no contestar (piso 0.85): callarse es no colaborar, negar una sesión que el
// registro dice que ocurrió es intentar manipular el puntaje del otro.
export const LIE_PENALTY = 0.4;
export const VERACITY_FLOOR = 0.2;

// Reincidencia sin evidencia. El registro de ingreso solo existe si la persona
// entró al Meet DESDE la app; quien entra desde el mail de Calendar no deja
// rastro, y sin rastro no hay mentira comprobable. Eso abría un agujero justo
// para el caso peor: al mentiroso le alcanzaba con no pasar por la app para que
// nunca hubiera evidencia sobre sí mismo.
//
// Contra eso, el patrón ES la evidencia. Una disputa sin respaldo es un
// malentendido y sale gratis; a partir de la segunda en la ventana, cada una
// pesa la mitad de una mentira comprobada. Nunca bloquea: la reincidencia
// mueve el puntaje, pero sacar a alguien de la rotación pide evidencia dura.
export const PATTERN_PENALTY = 0.2;
export const PATTERN_GRACE = 1;

// Mentiras comprobadas en el mes calendario que dejan a alguien fuera de la
// rotación, igual que las faltas. Se recupera solo el 1° del mes siguiente: la
// sanción es fuerte pero nunca definitiva, y la ventana de 60 días termina de
// diluir el golpe al puntaje.
export const MONTHLY_LIES_LIMIT = 2;

const sameEmail = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

const averagePct = (vals) => {
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100);
};

// El sobre no se abre nunca ENTRE participantes. Lo único que cambia a las 48hs
// es que las respuestas empiezan a puntuar y que el elogio se muestra.
//
// El plazo es puro reloj a propósito. Cuando dependía de "ya contestaron los
// dos", el puntaje se movía en el instante en que el compañero respondía, y
// mirarlo antes de contestar delataba la nota recibida. Sobre el reloj no hay
// nada que deducir: el momento es el mismo haya contestado quien haya contestado.
export const isCountable = (meetingEndMs, now = Date.now()) =>
  now >= meetingEndMs + CLOSEOUT_WINDOW_MS;

// Las dos respuestas se contradicen cuando una dice que la sesión no se hizo y
// la otra que sí. 'completa' vs 'cortada' NO es contradicción: son dos formas
// de decir que ocurrió, y discutir el grado no hace a nadie mentiroso.
export const isDisputed = (happenedA, happenedB) => {
  if (!happenedA || !happenedB) return false;
  return (happenedA === 'no_se_hizo') !== (happenedB === 'no_se_hizo');
};

// Qué dice el registro de ingreso al Meet sobre una reunión. joined_at guarda
// cuándo cada persona abrió el enlace DESDE la app; quien entra desde el mail
// de Calendar no deja rastro, así que el dato puede faltar sin que eso signifique
// ausencia.
//
// `known` es false cuando ni siquiera hay filas de asistencia cargadas: ahí no
// se sabe nada y la reunión no cuenta ni a favor ni en contra de nadie.
const joinRecord = (meetingId, attendances) => {
  const rows = attendances.filter(a => a.meetingId === meetingId);
  return {
    known: rows.length >= 2,
    todos: rows.length >= 2 && rows.every(a => !!a.joinedAt),
    entro: new Set(
      rows.filter(a => a.joinedAt).map(a => (a.memberEmail || '').toLowerCase())
    )
  };
};

// Reuniones cuyas dos respuestas se contradicen, con quién quedó fuera del
// consenso y qué dice el registro sobre él:
//
//   'desmiente' → los DOS abrieron el enlace. Que los dos estuvieran ahí no
//                 prueba que hayan hablado, pero contra eso "no se hizo" deja
//                 de ser un malentendido posible. Es mentira comprobada.
//   'respalda'  → él entró y el otro no. Se presentó y lo dejaron plantado:
//                 "no se hizo" es exactamente lo que hay que contestar, y no
//                 puede costarle nada.
//   'silencio'  → no hay registro suyo. Ni lo desmiente ni lo respalda; solo
//                 cuenta si se repite.
//   'sin_datos' → ni siquiera hay filas de asistencia. No se juzga.
export const getDisputedMeetings = (closeouts, attendances = []) => {
  const byMeeting = new Map();
  for (const c of closeouts) {
    if (!byMeeting.has(c.meetingId)) byMeeting.set(c.meetingId, []);
    byMeeting.get(c.meetingId).push(c);
  }
  const disputed = [];
  for (const [meetingId, rows] of byMeeting) {
    if (rows.length < 2) continue;
    const [a, b] = rows;
    if (!isDisputed(a.happened, b.happened)) continue;
    const outlier = a.happened === 'no_se_hizo' ? a : b;
    const reg = joinRecord(meetingId, attendances);
    const outlierEntro = reg.entro.has((outlier.authorEmail || '').toLowerCase());
    const evidence = !reg.known ? 'sin_datos'
      : reg.todos ? 'desmiente'
      : outlierEntro ? 'respalda'
      : 'silencio';
    disputed.push({
      meetingId,
      outlierEmail: outlier.authorEmail,
      corroborated: evidence === 'desmiente',
      evidence
    });
  }
  return disputed;
};

// Disputas SIN respaldo del registro: no hay forma de saber quién dice la
// verdad, así que la reunión no puntúa para ninguno de los dos. Es lo que
// impide que acusar en falso hunda al otro cuando no hay evidencia.
const neutralMeetings = (closeouts, attendances) =>
  new Set(getDisputedMeetings(closeouts, attendances)
    .filter(d => !d.corroborated)
    .map(d => d.meetingId));

// Respuestas contradichas por el registro. Se descarta SOLO la del mentiroso, no
// la de su compañero, y eso es lo que quita a la mentira su uso más rentable:
// negar la sesión para borrar la mala nota que uno ya sabe que va a recibir.
const discardedKeys = (closeouts, attendances) =>
  new Set(getDisputedMeetings(closeouts, attendances)
    .filter(d => d.corroborated)
    .map(d => `${d.meetingId}|${(d.outlierEmail || '').toLowerCase()}`));

const keyOf = (closeout) =>
  `${closeout.meetingId}|${(closeout.authorEmail || '').toLowerCase()}`;

// Momento de la reunión de un cierre. NaN si no se puede determinar → la fila
// se ignora en vez de contarse en una ventana arbitraria (mismo criterio que
// whenOf en reliability.js).
const meetingTimeOf = (meetingId, meetings) => {
  const m = meetings.find(x => x.id === meetingId);
  return m?.startsAt ? Date.parse(m.startsAt) : NaN;
};

const meetingEndOf = (meetingId, meetings, whenMs) => {
  const m = meetings.find(x => x.id === meetingId);
  return whenMs + (m?.duration || 60) * 60000;
};

// Mentiras comprobadas de una persona dentro de la ventana del score: disputas
// en las que dijo que la sesión no se hizo mientras el registro mostraba que los
// dos habían entrado.
export const getProvenLies = (email, closeouts, meetings, attendances = [], now = Date.now()) => {
  const cutoff = now - RELIABILITY_WINDOW_DAYS * 24 * 3600e3;
  return getDisputedMeetings(closeouts, attendances)
    .filter(d => d.corroborated && sameEmail(d.outlierEmail, email))
    .map(d => ({ meetingId: d.meetingId, when: meetingTimeOf(d.meetingId, meetings) }))
    .filter(l => !Number.isNaN(l.when) && l.when >= cutoff)
    .sort((a, b) => b.when - a.when);
};

// Disputas en las que la persona quedó fuera del consenso y el registro no dijo
// nada —ni a favor ni en contra—, dentro de la ventana del score.
export const getUnbackedDisputes = (email, closeouts, meetings, attendances = [], now = Date.now()) => {
  const cutoff = now - RELIABILITY_WINDOW_DAYS * 24 * 3600e3;
  return getDisputedMeetings(closeouts, attendances)
    .filter(d => d.evidence === 'silencio' && sameEmail(d.outlierEmail, email))
    .map(d => ({ meetingId: d.meetingId, when: meetingTimeOf(d.meetingId, meetings) }))
    .filter(l => !Number.isNaN(l.when) && l.when >= cutoff)
    .sort((a, b) => b.when - a.when);
};

// Cuántas de esas disputas pesan. La primera es gratis: negar una sesión que el
// otro dio por hecha puede ser un malentendido honesto, y sin registro no hay
// forma de saberlo. Lo que no se sostiene como malentendido es la repetición.
export const getPatternStrikes = (email, closeouts, meetings, attendances = [], now = Date.now()) =>
  Math.max(0, getUnbackedDisputes(email, closeouts, meetings, attendances, now).length - PATTERN_GRACE);

// Factor de veracidad 0..1 que multiplica la credibilidad.
//
//   mentira comprobada (el registro lo desmiente) = -0.4 cada una
//   reincidencia sin respaldo, de la segunda en más = -0.2 cada una
//   piso 0.2
//
// La reincidencia pesa la mitad porque la evidencia es circunstancial: es un
// patrón, no un hecho. Por eso tampoco bloquea — para sacar a alguien de la
// rotación hace falta el registro en contra.
export const getVeracity = (email, closeouts, meetings, attendances = [], now = Date.now()) => {
  const lies = getProvenLies(email, closeouts, meetings, attendances, now).length;
  const pattern = getPatternStrikes(email, closeouts, meetings, attendances, now);
  if (lies === 0 && pattern === 0) return 1;
  const factor = Math.max(VERACITY_FLOOR, 1 - LIE_PENALTY * lies - PATTERN_PENALTY * pattern);
  // Redondeado a dos decimales: restar 0.4 y 0.2 en binario deja colas como
  // 0.3999999999999999, que después se arrastran al puntaje y no coinciden con
  // el porcentaje entero que devuelve la base.
  return Math.round(factor * 100) / 100;
};

// Mentiras comprobadas dentro del mes calendario UTC en curso.
export const getMonthlyLies = (email, closeouts, meetings, attendances = [], now = Date.now()) => {
  const monthStart = monthStartOf(now);
  const d = new Date(monthStart);
  const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return getProvenLies(email, closeouts, meetings, attendances, now)
    .filter(l => l.when >= monthStart && l.when < monthEnd).length;
};

// ¿Queda fuera de la rotación este mes por mentir? Se recupera solo el 1° del
// mes siguiente, igual que el bloqueo por faltas.
export const isBlockedForLying = (email, closeouts, meetings, attendances = [], now = Date.now()) =>
  getMonthlyLies(email, closeouts, meetings, attendances, now) >= MONTHLY_LIES_LIMIT;

// Compromiso 0..100 de una persona: promedio de cómo la calificaron SUS
// compañeros en los últimos RELIABILITY_WINDOW_DAYS. null = todavía sin
// cierres recibidos, y se muestra como "Sin datos", nunca como 0.
export const getEngagement = (email, closeouts, meetings, attendances = [], now = Date.now()) => {
  const cutoff = now - RELIABILITY_WINDOW_DAYS * 24 * 3600e3;
  const neutrales = neutralMeetings(closeouts, attendances);
  const descartadas = discardedKeys(closeouts, attendances);
  const vals = closeouts
    .filter(c => {
      if (!sameEmail(c.subjectEmail, email)) return false;
      if (neutrales.has(c.meetingId)) return false;
      // La respuesta de quien mintió no califica a nadie.
      if (descartadas.has(keyOf(c))) return false;
      const when = meetingTimeOf(c.meetingId, meetings);
      if (Number.isNaN(when) || when < cutoff) return false;
      return isCountable(meetingEndOf(c.meetingId, meetings, when), now);
    })
    .map(c => ENGAGEMENT_VALUE[c.engagement])
    .filter(v => v !== undefined);
  return averagePct(vals);
};

// Cierres que a esta persona le TOCABA responder: reuniones ya terminadas en
// las que participó y que no se cancelaron. Es la base de la reciprocidad.
export const getOwedCloseouts = (email, meetings, attendances, now = Date.now()) =>
  meetings.filter(m => {
    if (!m.startsAt) return false;
    if (now <= Date.parse(m.startsAt) + (m.duration || 60) * 60000) return false;
    const rows = attendances.filter(a => a.meetingId === m.id);
    const mine = rows.find(a => sameEmail(a.memberEmail, email));
    if (!mine) return false;
    // Si la reunión se cayó por una cancelación no hay nada que cerrar.
    return !rows.some(a => a.status === 'cancelado_con_aviso' || a.status === 'cancelado_tarde');
  }).map(m => m.id);

// Proporción 0..1 de cierres respondidos sobre los que le tocaba responder.
// null = todavía no le tocó ninguno (no arrastra penalización por ser nueva).
export const getReciprocity = (email, closeouts, meetings, attendances, now = Date.now()) => {
  const owed = getOwedCloseouts(email, meetings, attendances, now);
  if (owed.length === 0) return null;
  const answered = new Set(
    closeouts.filter(c => sameEmail(c.authorEmail, email)).map(c => c.meetingId)
  );
  return owed.filter(id => answered.has(id)).length / owed.length;
};

// Credibilidad: el número que ordena el emparejamiento.
//
// Promedia las señales que EXISTEN —asistencia y compromiso— y le aplica los
// factores de reciprocidad y veracidad. Se promedia solo lo disponible a
// propósito: alguien que recién entra tiene compromiso null y no debe quedar
// último por eso, sino competir con la única señal que tiene.
export const getCredibility = (attendance, engagement, reciprocity, veracity = 1) => {
  const dims = [attendance, engagement].filter(v => v !== null && v !== undefined);
  if (dims.length === 0) return null;
  const base = dims.reduce((s, x) => s + x, 0) / dims.length;
  const recFactor = reciprocity === null || reciprocity === undefined
    ? 1
    : RECIPROCITY_FLOOR + (1 - RECIPROCITY_FLOOR) * reciprocity;
  const verFactor = veracity === null || veracity === undefined ? 1 : veracity;
  return Math.round(base * recFactor * verFactor);
};

// Resumen de UNA devolución de la Encuesta 2, para encabezar su tarjeta en el
// historial sin obligar a leer las 5 etapas.
//
// `aplica` en false es el caso de roles sin invertir: el compañero nunca hizo
// de closer, así que no hay etapas calificadas y la tarjeta lo dice en vez de
// mostrar cinco casilleros vacíos —que se leerían como "no contestó"—.
export const summarizeSkillFeedback = (feedback) => {
  if (!feedback || feedback.partnerWasCloser === false) {
    return { aplica: false, a_mejorar: 0, bien: 0, muy_bien: 0, total: 0 };
  }
  const conteo = { a_mejorar: 0, bien: 0, muy_bien: 0 };
  let total = 0;
  for (const cat of SKILL_CATEGORIES) {
    const rating = feedback[`${cat}Rating`];
    if (conteo[rating] === undefined) continue;
    conteo[rating]++;
    total++;
  }
  // Sin ninguna etapa calificada tampoco hay nada que resumir, aunque la fila
  // diga que el compañero sí fue closer (datos viejos o a medio guardar).
  return { aplica: total > 0, ...conteo, total };
};

// Encuesta 2 que le TOCA responder: cerró la sesión (Encuesta 1) diciendo que
// hubo sesión real (no 'no_se_hizo'), y todavía no completó la devolución de
// habilidades sobre esa reunión. Sin ventana de vencimiento a propósito: la
// deuda no prescribe, porque lo que hace que se salde es completarla, no que
// pase el tiempo.
//
// Se salda con solo EXISTIR la fila, sin importar si trae ratings: cuando el
// compañero no llegó a hacer de closer en la sesión (roles sin invertir), la
// encuesta se completa igual pero sin las 5 etapas — no hay nada que
// calificar, pero la deuda es la misma.
export const getOwedSkillFeedback = (email, closeouts, skillFeedbacks, meetings, now = Date.now()) => {
  const yaDio = new Set(
    skillFeedbacks
      .filter(f => sameEmail(f.authorEmail, email))
      .map(f => f.meetingId)
  );
  return closeouts
    .filter(c => sameEmail(c.authorEmail, email) && c.happened !== 'no_se_hizo')
    .filter(c => !yaDio.has(c.meetingId))
    .map(c => ({ meetingId: c.meetingId, when: meetingTimeOf(c.meetingId, meetings) }))
    .filter(o => !Number.isNaN(o.when) && o.when <= now)
    .sort((a, b) => a.when - b.when);
};

// ¿Queda fuera del próximo armado de duplas por no haber devuelto feedback de
// alguna sesión ya cerrada? Es el único bloqueo del sistema que se levanta
// apenas la persona actúa, sin esperar reloj ni mes calendario: el objetivo no
// es sancionar, es que el intercambio sea win-win — quien recibe una sesión
// nueva es porque también devolvió la que le tocaba.
export const isPendingSkillFeedback = (email, closeouts, skillFeedbacks, meetings, now = Date.now()) =>
  getOwedSkillFeedback(email, closeouts, skillFeedbacks, meetings, now).length > 0;
