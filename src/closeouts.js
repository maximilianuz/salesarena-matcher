// Cierre de sesión: lo que cada participante responde DESPUÉS del role-play.
//
// Hasta ahora lo único que se medía era un click en el link de Meet: entrar,
// clickear y irse a los dos minutos daba crédito completo. El cierre agrega la
// dimensión que faltaba —si la persona efectivamente sostuvo el ejercicio— y lo
// hace en sobre cerrado: ninguno ve lo que respondió el otro, así que no hay
// forma de devolver una mala nota por represalia.
//
// Módulo puro (sin React ni Supabase) para poder verificarse con `node --test`.
// La Edge Function (supabase/functions/weekly-matcher) replica getEngagement y
// getReciprocity para priorizar el emparejamiento: mantener ambas alineadas.

import { RELIABILITY_WINDOW_DAYS } from './reliability.js';

// ¿Ocurrió la sesión? Es la única pregunta sobre un hecho COMPARTIDO, así que
// es la que se puede cruzar entre las dos respuestas.
export const HAPPENED = ['completa', 'cortada', 'no_se_hizo'];

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

// Ventana para responder, desde que termina la reunión. Pasado ese plazo el
// cierre se abre con lo que haya: la respuesta de quien sí contestó cuenta, y
// al que no contestó le baja la reciprocidad.
export const CLOSEOUT_WINDOW_MS = 48 * 3600e3;

// Piso del factor de reciprocidad: no contestar nunca cuesta como mucho un 15%
// de la credibilidad. Es un empujón para que el cierre no quede vacío, no una
// sanción — quien contesta todo simplemente no recibe ningún descuento.
export const RECIPROCITY_FLOOR = 0.85;

const sameEmail = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

const averagePct = (vals) => {
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100);
};

// Las dos respuestas se contradicen cuando una dice que la sesión no se hizo y
// la otra que sí. 'completa' vs 'cortada' NO es contradicción: son dos formas
// de decir que ocurrió, y discutir el grado no hace a nadie mentiroso.
export const isDisputed = (happenedA, happenedB) => {
  if (!happenedA || !happenedB) return false;
  return (happenedA === 'no_se_hizo') !== (happenedB === 'no_se_hizo');
};

// Reuniones cuyas dos respuestas se contradicen. Nadie se penaliza por un caso
// suelto: la reunión queda EN DISPUTA y no puntúa para ninguno de los dos, así
// mentir no sirve para hundir al otro. Lo que sí importa es la reincidencia, y
// para eso se devuelve quién quedó fuera del consenso en cada caso.
export const getDisputedMeetings = (closeouts) => {
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
    // El que dice que no se hizo es el que queda fuera del consenso. Si además
    // hay registro de que entró al Meet, la contradicción es más fuerte todavía,
    // pero eso lo resuelve quien administra: acá solo se deja señalado.
    const outlier = a.happened === 'no_se_hizo' ? a : b;
    disputed.push({ meetingId, outlierEmail: outlier.authorEmail });
  }
  return disputed;
};

const disputedIds = (closeouts) => new Set(getDisputedMeetings(closeouts).map(d => d.meetingId));

// Momento de la reunión de un cierre. NaN si no se puede determinar → la fila
// se ignora en vez de contarse en una ventana arbitraria (mismo criterio que
// whenOf en reliability.js).
const meetingTimeOf = (meetingId, meetings) => {
  const m = meetings.find(x => x.id === meetingId);
  return m?.startsAt ? Date.parse(m.startsAt) : NaN;
};

// Compromiso 0..100 de una persona: promedio de cómo la calificaron SUS
// compañeros en los últimos RELIABILITY_WINDOW_DAYS. null = todavía sin
// cierres recibidos, y se muestra como "Sin datos", nunca como 0.
export const getEngagement = (email, closeouts, meetings, now = Date.now()) => {
  const cutoff = now - RELIABILITY_WINDOW_DAYS * 24 * 3600e3;
  const enDisputa = disputedIds(closeouts);
  const porReunion = new Map();
  for (const c of closeouts) {
    if (!porReunion.has(c.meetingId)) porReunion.set(c.meetingId, []);
    porReunion.get(c.meetingId).push(c);
  }
  const vals = closeouts
    .filter(c => {
      if (!sameEmail(c.subjectEmail, email)) return false;
      if (enDisputa.has(c.meetingId)) return false;
      const when = meetingTimeOf(c.meetingId, meetings);
      if (Number.isNaN(when) || when < cutoff) return false;
      // Solo sobres ABIERTOS. Si el puntaje se moviera apenas responde el otro,
      // mirarlo antes de contestar delataría cómo lo calificaron a uno, que es
      // justamente lo que el sobre cerrado viene a impedir.
      const m = meetings.find(x => x.id === c.meetingId);
      const endMs = when + (m?.duration || 60) * 60000;
      return isRevealed(porReunion.get(c.meetingId), endMs, now);
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
// Promedia las señales que EXISTEN —asistencia y compromiso— y le aplica el
// factor de reciprocidad. Se promedia solo lo disponible a propósito: alguien
// que recién entra tiene compromiso null y no debe quedar último por eso, sino
// competir con la única señal que tiene.
export const getCredibility = (attendance, engagement, reciprocity) => {
  const dims = [attendance, engagement].filter(v => v !== null && v !== undefined);
  if (dims.length === 0) return null;
  const base = dims.reduce((s, x) => s + x, 0) / dims.length;
  const factor = reciprocity === null || reciprocity === undefined
    ? 1
    : RECIPROCITY_FLOOR + (1 - RECIPROCITY_FLOOR) * reciprocity;
  return Math.round(base * factor);
};

// ¿Se puede abrir el sobre? Cuando los dos respondieron, o cuando venció el
// plazo. Hasta ese momento nadie ve nada del otro, que es lo que evita que la
// segunda respuesta sea una reacción a la primera.
export const isRevealed = (closeoutsForMeeting, meetingEndMs, now = Date.now()) =>
  closeoutsForMeeting.length >= 2 || now >= meetingEndMs + CLOSEOUT_WINDOW_MS;

// Elogios recibidos ya destapados. Es lo único del cierre que la otra persona
// llega a ver, y solo en positivo: el resto de las respuestas no se comparte
// nunca, ni siquiera después de abierto el sobre.
export const getPraiseReceived = (email, closeouts, meetings, now = Date.now()) => {
  const byMeeting = new Map();
  for (const c of closeouts) {
    if (!byMeeting.has(c.meetingId)) byMeeting.set(c.meetingId, []);
    byMeeting.get(c.meetingId).push(c);
  }
  const out = [];
  for (const [meetingId, rows] of byMeeting) {
    const when = meetingTimeOf(meetingId, meetings);
    if (Number.isNaN(when)) continue;
    const m = meetings.find(x => x.id === meetingId);
    const endMs = when + (m?.duration || 60) * 60000;
    if (!isRevealed(rows, endMs, now)) continue;
    for (const c of rows) {
      if (!sameEmail(c.subjectEmail, email)) continue;
      const praise = (c.praise || '').trim();
      if (praise) out.push({ meetingId, praise, when });
    }
  }
  return out.sort((a, b) => b.when - a.when);
};
