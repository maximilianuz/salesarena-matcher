-- Cancelación de asistencia en duplas 1:1 (UX 2026-07-18).
--
-- Cuando cualquiera de los dos cancela su asistencia, la app ahora cierra la
-- propuesta vinculada con status = 'cancelado'. Eso saca a AMBOS del set
-- "busy" del weekly-matcher, así el que no canceló vuelve al pool y puede ser
-- reasignado con otro compañero disponible en la próxima corrida (cada 10
-- min). La dupla cancelada queda excluida (no se re-ofrece la misma pareja
-- esa semana).
--
-- El CHECK original (20240715) solo admitía propuesto/confirmado/rechazado/
-- expirado, por lo que el update del cliente fallaría sin esta migración.

ALTER TABLE match_proposals DROP CONSTRAINT IF EXISTS match_proposals_status_check;
ALTER TABLE match_proposals ADD CONSTRAINT match_proposals_status_check
  CHECK (status IN ('propuesto', 'confirmado', 'rechazado', 'expirado', 'cancelado'));

-- VERIFICACIÓN:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'match_proposals_status_check';
