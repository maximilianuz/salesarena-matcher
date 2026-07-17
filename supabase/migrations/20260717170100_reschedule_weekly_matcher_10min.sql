-- Reprogramar weekly-matcher a cada 10 minutos (antes: cada hora).
--
-- Necesario para respetar las ventanas de confirmación escalonadas (4h→2h→1h→30m)
-- y la tolerancia de asistencia de 10 min: al correr cada 10 min, las propuestas
-- vencidas se reasignan casi en el acto y el barrido de asistencia resuelve
-- no-shows poco después del inicio. La función es idempotente, así que es seguro
-- ejecutarla con esta frecuencia.

-- 1. Quitar el job horario anterior (si existe). No falla si ya no está.
DO $$
BEGIN
  PERFORM cron.unschedule('weekly-matcher-hourly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. Programar el nuevo job cada 10 minutos.
SELECT cron.schedule(
  'weekly-matcher-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url:='https://gxqkfqxgmmnleqdmssva.supabase.co/functions/v1/weekly-matcher',
    body:='{}'::jsonb,
    headers:='{"Content-Type":"application/json"}'::jsonb
  ) AS request_id;
  $$
);

-- VERIFICACIÓN:
-- 1. Jobs activos:   SELECT * FROM cron.job WHERE jobname = 'weekly-matcher-10min';
-- 2. Que no quede el viejo: SELECT * FROM cron.job WHERE jobname = 'weekly-matcher-hourly';
-- 3. Ejecuciones:    SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 10;
