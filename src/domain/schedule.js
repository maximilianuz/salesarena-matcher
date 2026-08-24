// Fecha real de una reunion a partir del slot que eligio el emparejador.
//
// Vive aparte de src/matcher.js porque eso es el motor de emparejamiento y esto
// es solo la presentación de la fecha resultante, pero las dos tienen que
// coincidir: ver el comentario de getNextMatchDateUtc.

// Fecha/hora UTC real de la próxima ocurrencia del match.
// match.startSlot codifica día (0=Lunes) y hora UTC dentro de la semana.
// minLeadMs: piso de antelación. Debe coincidir con nextSlotOccurrenceMs
// (src/matcher.js / la Edge Function): el emparejador elige el turno y calcula
// respond_by respetando ese piso, así que mostrar/agendar la reunión con otra
// regla haría que el plazo y la fecha visibles no coincidan con lo planificado.
export const getNextMatchDateUtc = (match, minLeadMs = 0) => {
  const dayIdx = Math.floor(match.startSlot / 24); // 0 = Lunes ... 6 = Domingo
  const hourUtc = match.startSlot % 24;
  const now = new Date();
  const start = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0
  ));
  // getUTCDay(): 0=Domingo..6=Sábado → convertir a 0=Lunes..6=Domingo
  const todayIdx = (start.getUTCDay() + 6) % 7;
  const delta = (dayIdx - todayIdx + 7) % 7;
  start.setUTCDate(start.getUTCDate() + delta);
  // Rodar a la semana siguiente hasta respetar el piso de antelación (con
  // minLeadMs=0 equivale a "si ya pasó hoy, va a la semana próxima").
  const floor = now.getTime() + minLeadMs;
  while (start.getTime() < floor) start.setUTCDate(start.getUTCDate() + 7);
  return start;
};

export const formatMeetingDateUtc = (date, dayName) => {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  return `${dayName} ${dd}/${mm} · ${hh}:00 UTC`;
};

// Ventana en la que abrir el enlace del Meet deja registro de asistencia
// (joined_at): desde media hora antes de empezar hasta media hora después de
// terminar.
//
// El límite existe porque joined_at dejó de ser solo el insumo del barrido de
// asistencia: la resolución de disputas del cierre lo usa como EVIDENCIA de que
// la persona estuvo. Sin ventana, alguien podría abrir el enlace al día
// siguiente y fabricarse una prueba de presencia para desmentir a su compañero.
export const JOIN_RECORD_MARGIN_MS = 30 * 60000;

export const canRecordJoin = (startsAtIso, durationMin, now = Date.now()) => {
  const start = startsAtIso ? Date.parse(startsAtIso) : NaN;
  if (Number.isNaN(start)) return false;
  const end = start + (durationMin || 60) * 60000;
  return now >= start - JOIN_RECORD_MARGIN_MS && now <= end + JOIN_RECORD_MARGIN_MS;
};
