// Confiabilidad y sanciones de Sales-Arena Matcher.
//
// Esta es la lógica que decide si alguien entra o no al emparejamiento, y en el
// caso crónico si conserva el acceso a la sala. Vive en un módulo puro (sin
// React ni Supabase) para poder verificarse con `node --test`: antes estaba
// dentro del componente y era lo único crítico que no se podía testear.
//
// Todo se calcula a partir de lo que cada participante REPORTA después de cada
// sesión. La app no observa las videollamadas.
//
// La Edge Function (supabase/functions/weekly-matcher) replica el cálculo de
// score y de faltas: mantener ambas alineadas si se cambia el criterio.

// Faltas en el mes calendario que dejan a alguien fuera de la rotación.
export const MONTHLY_FALTAS_LIMIT = 3;

// Meses bloqueados (distintos) que se toman como patrón crónico. Un mes malo
// —una conexión mala, un imprevisto— ya cuesta el emparejamiento de ESE mes y
// se resetea solo al mes siguiente. Este umbral existe para el caso distinto:
// quien deja a su compañero sin sesión mes tras mes.
export const CHRONIC_BLOCK_THRESHOLD = 3;

// Ventana de historial del score de confiabilidad.
export const RELIABILITY_WINDOW_DAYS = 60;

// Valor de un reporte para el score:
//   asistió a tiempo = 1 · asistió tarde = 0.5 · no-show = 0 ·
//   cancelado tarde = 0 · cancelado con aviso / sin reportar = no computa.
export const scoreValue = (status, punctuality) => {
  if (status === 'asistio') return punctuality === 'tarde' ? 0.5 : 1;
  if (status === 'no_show' || status === 'cancelado_tarde') return 0;
  return null;
};

// Un reporte cuenta como falta si dejó al compañero sin sesión.
const isFalta = (status) => status === 'no_show' || status === 'cancelado_tarde';

const sameEmail = (a, b) => a.toLowerCase() === b.toLowerCase();

// Momento al que corresponde un reporte: el inicio de su reunión, y si no hay
// (reuniones viejas sin timestamp) el momento en que se reportó. NaN si no se
// puede determinar → la fila se ignora en vez de contarse en un mes arbitrario.
const whenOf = (attendance, meetings) => {
  const meeting = meetings.find(m => m.id === attendance.meetingId);
  if (meeting?.startsAt) return Date.parse(meeting.startsAt);
  return attendance.reportedAt ? Date.parse(attendance.reportedAt) : NaN;
};

const averagePct = (vals) => {
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100);
};

// Score 0..100 de una persona en los últimos RELIABILITY_WINDOW_DAYS.
// null = sin historial suficiente (se muestra como "Nuevo", no como 0%).
export const getReliability = (email, attendances, meetings, now = Date.now()) => {
  const cutoff = now - RELIABILITY_WINDOW_DAYS * 24 * 3600e3;
  const vals = attendances
    .filter(a => {
      if (!sameEmail(a.memberEmail, email)) return false;
      const when = whenOf(a, meetings);
      return !Number.isNaN(when) && when >= cutoff;
    })
    .map(a => scoreValue(a.status, a.punctuality))
    .filter(v => v !== null);
  return averagePct(vals);
};

// Mismo cálculo agregando a TODA la sala en vez de una sola persona.
export const getRoomReliability = (attendances, meetings, now = Date.now()) => {
  const cutoff = now - RELIABILITY_WINDOW_DAYS * 24 * 3600e3;
  const vals = attendances
    .filter(a => {
      const when = whenOf(a, meetings);
      return !Number.isNaN(when) && when >= cutoff;
    })
    .map(a => scoreValue(a.status, a.punctuality))
    .filter(v => v !== null);
  return averagePct(vals);
};

// Faltas dentro de un mes calendario UTC dado (monthStart = 1° del mes, UTC).
export const getFaltasInMonth = (email, monthStart, attendances, meetings) => {
  const d = new Date(monthStart);
  const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return attendances.filter(a => {
    if (!sameEmail(a.memberEmail, email)) return false;
    if (!isFalta(a.status)) return false;
    const when = whenOf(a, meetings);
    return !Number.isNaN(when) && when >= monthStart && when < monthEnd;
  }).length;
};

// Primer instante (UTC) del mes calendario al que pertenece `now`.
export const monthStartOf = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

// Faltas del mes en curso.
export const getMonthlyFaltas = (email, attendances, meetings, now = Date.now()) =>
  getFaltasInMonth(email, monthStartOf(now), attendances, meetings);

// ¿Queda fuera de la rotación este mes? Se recupera solo el 1° del mes siguiente.
export const isBlocked = (email, attendances, meetings, now = Date.now()) =>
  getMonthlyFaltas(email, attendances, meetings, now) >= MONTHLY_FALTAS_LIMIT;

// En cuántos meses calendario DISTINTOS la persona llegó al límite de faltas.
// Recorre solo los meses en los que efectivamente tuvo historial, no todo el
// calendario.
export const getChronicBlockedMonths = (email, attendances, meetings) => {
  const monthsWithHistory = new Set();
  attendances.forEach(a => {
    if (!sameEmail(a.memberEmail, email)) return;
    const when = whenOf(a, meetings);
    if (Number.isNaN(when)) return;
    monthsWithHistory.add(monthStartOf(when));
  });
  return [...monthsWithHistory].filter(
    monthStart => getFaltasInMonth(email, monthStart, attendances, meetings) >= MONTHLY_FALTAS_LIMIT
  ).length;
};

// Patrón repetido: se retira el acceso a la sala.
export const isChronicOffender = (email, attendances, meetings) =>
  getChronicBlockedMonths(email, attendances, meetings) >= CHRONIC_BLOCK_THRESHOLD;
