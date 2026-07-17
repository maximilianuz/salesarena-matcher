-- Garantizar que meeting_attendees tenga las columnas que el cliente usa.
--
-- AUDITORÍA: src/App.jsx inserta/lee/mapea meeting_attendees con `room_id` y
-- `member_name`, pero la migración que creó la tabla (20260716150000) NO define
-- esas columnas. En este repo varias tablas se crearon/ajustaron fuera de las
-- migraciones, así que producción PUEDE tenerlas ya. Esta migración es
-- idempotente (ADD COLUMN IF NOT EXISTS): si ya existen, no hace nada; si
-- faltan, alinea el esquema con el código y evita que el registro del
-- compromiso de asistencia falle (lo que rompería el score de confiabilidad).
--
--   room_id     → permite filtrar la asistencia por sala en la carga inicial.
--   member_name → nombre mostrado en la UI de asistencia (evita otro lookup).

ALTER TABLE meeting_attendees
  ADD COLUMN IF NOT EXISTS room_id TEXT;

ALTER TABLE meeting_attendees
  ADD COLUMN IF NOT EXISTS member_name TEXT;

-- Índice para la carga por sala (no falla si ya está).
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_room
  ON meeting_attendees(room_id);

-- Backfill de room_id para filas históricas, derivándolo de la reunión asociada.
-- Así las asistencias previas siguen apareciendo al filtrar por sala.
UPDATE meeting_attendees ma
SET room_id = m.room_id
FROM meetings m
WHERE ma.meeting_id = m.id
  AND ma.room_id IS NULL;
