-- Registro del click al Meet para la asistencia automática (tolerancia 10 min).
--
-- joined_at guarda cuándo cada participante abrió el enlace de Google Meet desde
-- la app. El barrido de asistencia del weekly-matcher lo usa para resolver, a los
-- 10 min del inicio, quién asistió y quién quedó no-show, sin depender del reporte
-- manual del compañero:
--   joined_at presente → 'asistio' (a_tiempo si entró dentro de los 10 min, si no 'tarde')
--   joined_at ausente  → 'no_show'
--
-- Nota: el click abre el enlace, no prueba el ingreso a la videollamada real de
-- Google Meet (no es observable). Es un proxy razonable de "se presentó".

ALTER TABLE meeting_attendees
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP WITH TIME ZONE;
