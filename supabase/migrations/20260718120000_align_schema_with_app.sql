-- Alinear el esquema de producción con lo que el cliente y el weekly-matcher
-- realmente escriben/leen. Las tablas base se crearon (20240713) con columnas
-- inventadas que no coinciden con App.jsx:
--
--   * rooms.founder_email era NOT NULL, pero la app crea salas sin founder
--     (INSERT {id, name}) → 400 al auto-crear salas.
--   * availabilities usaba email/day_of_week/start_time/end_time; la app y el
--     weekly-matcher usan "user"/day_idx/start_hour/end_hour.
--   * meetings usaba scheduled_start; la app inserta title/date_utc/duration/
--     participants/meet_link/starts_at.
--   * meeting_attendees no tenía reported_by/reported_at, que el reporte de
--     asistencia actualiza.
--
-- Las columnas legadas se eliminan porque ningún código las referencia y las
-- tablas están vacías (los inserts de la app siempre fallaron contra ellas).

-- rooms
ALTER TABLE rooms ALTER COLUMN founder_email DROP NOT NULL;

-- availabilities
ALTER TABLE availabilities DROP COLUMN IF EXISTS email;
ALTER TABLE availabilities DROP COLUMN IF EXISTS day_of_week;
ALTER TABLE availabilities DROP COLUMN IF EXISTS start_time;
ALTER TABLE availabilities DROP COLUMN IF EXISTS end_time;
ALTER TABLE availabilities ADD COLUMN IF NOT EXISTS "user" TEXT;
ALTER TABLE availabilities ADD COLUMN IF NOT EXISTS day_idx INTEGER;
ALTER TABLE availabilities ADD COLUMN IF NOT EXISTS start_hour NUMERIC;
ALTER TABLE availabilities ADD COLUMN IF NOT EXISTS end_hour NUMERIC;

-- meetings
ALTER TABLE meetings DROP COLUMN IF EXISTS scheduled_start;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS date_utc TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS duration INTEGER;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS participants TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

-- meeting_attendees
ALTER TABLE meeting_attendees ADD COLUMN IF NOT EXISTS reported_by TEXT;
ALTER TABLE meeting_attendees ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;
