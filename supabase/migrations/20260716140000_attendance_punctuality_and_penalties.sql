-- Asistencia con puntualidad + penalizaciones por faltas.
--
-- Amplía meeting_attendees para soportar:
--   * puntualidad: si asistió, ¿llegó a tiempo? (tolerancia 10 min → 'a_tiempo'
--     o 'tarde')
--   * motivo de cancelación tardía (obligatorio si cancela con < 24hs)
--   * nuevo estado 'cancelado_tarde' (cuenta como falta)
--
-- Las FALTAS (no_show + cancelado_tarde) y el BLOQUEO mensual (3 faltas en el
-- mes calendario) NO requieren tablas nuevas: se derivan por consulta de
-- meeting_attendees + meetings. Lo mismo la ROTACIÓN "todos con todos", que se
-- calcula contando reuniones concretadas por dupla.
--
-- Estados de meeting_attendees tras esta migración:
--   'confirmado'          compromiso inicial, sin reportar
--   'asistio'             se conectó (ver columna punctuality)
--   'no_show'             no se presentó                         → FALTA
--   'cancelado_con_aviso' canceló con +24hs de antelación        → neutral
--   'cancelado_tarde'     canceló con menos de 24hs (con motivo)  → FALTA

-- 1. Puntualidad (solo aplica cuando status = 'asistio')
ALTER TABLE meeting_attendees
  ADD COLUMN IF NOT EXISTS punctuality TEXT
  CHECK (punctuality IS NULL OR punctuality IN ('a_tiempo', 'tarde'));

-- 2. Motivo de la cancelación tardía (obligatorio a nivel app, no a nivel DB
--    para no romper filas históricas)
ALTER TABLE meeting_attendees
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- 3. Permitir el nuevo estado 'cancelado_tarde'. Como la tabla pudo crearse
--    fuera de las migraciones, quitamos cualquier CHECK previo sobre 'status'
--    y lo recreamos con el vocabulario completo.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'meeting_attendees'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE meeting_attendees DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE meeting_attendees
  ADD CONSTRAINT meeting_attendees_status_check
  CHECK (status IN (
    'confirmado', 'asistio', 'no_show', 'cancelado_con_aviso', 'cancelado_tarde'
  ));

-- 4. Índice para acelerar el cálculo de faltas por miembro
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_member_status
  ON meeting_attendees(member_email, status);
