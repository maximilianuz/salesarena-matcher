-- Update cron job to send x-cron-secret header for authorization.
-- This prevents arbitrary public invocation of the weekly-matcher Edge Function.
--
-- The secret should be set as an environment variable CRON_SECRET in your
-- Supabase project. For safety, use a strong random value (not the default).

DO $$
BEGIN
  PERFORM cron.unschedule('weekly-matcher-10min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'weekly-matcher-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url:='https://gxqkfqxgmmnleqdmssva.supabase.co/functions/v1/weekly-matcher',
    body:='{}'::jsonb,
    headers:='{"Content-Type":"application/json","x-cron-secret":"'
             || current_setting('app.cron_secret', true) || '"}'::jsonb
  ) AS request_id;
  $$
);

-- VERIFICACIÓN:
-- 1. Activeços:   SELECT * FROM cron.job WHERE jobname = 'weekly-matcher-10min';
-- 2. Ejecuciones: SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 10;
--
-- IMPORTANTE: Antes de correr esto en producción, establece el secreto:
--   supabase secrets set CRON_SECRET="your-strong-random-value"
-- Luego, asegúrate de que el Edge Function use ese mismo valor en Deno.env.get('CRON_SECRET').
