-- Auditoría 2026-07-18: el cron 'weekly-matcher-10min' fallaba en el 100% de
-- sus corridas, así que el emparejador nunca corrió en producción.
--
-- Causa: la migración 20260717180100 construía el header x-cron-secret
-- concatenando current_setting('app.cron_secret', true). Ese ajuste nunca se
-- configuró en la base, así que la concatenación producía JSON inválido
-- ("invalid input syntax for type json") y net.http_post ni siquiera llegaba
-- a disparar la petición. En paralelo, la Edge Function tenía CRON_SECRET
-- seteado, con lo que el disparo instantáneo desde el cliente (sin secreto)
-- también recibía 401.
--
-- Resolución: se quita el esquema del secreto (la función es idempotente y
-- solo genera emparejamientos; el diseño original la contempla como endpoint
-- disparable sin secreto). Este archivo reprograma el cron SIN el header roto.
--
-- IMPORTANTE (paso manual complementario, no expresable en SQL de migración):
-- borrar el secreto CRON_SECRET de la Edge Function
--   * Dashboard → Edge Functions → Secrets → eliminar CRON_SECRET, o
--   * supabase secrets unset CRON_SECRET
-- Sin ese borrado, la función seguiría exigiendo el header y devolvería 401.

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
    headers:='{"Content-Type":"application/json"}'::jsonb
  ) AS request_id;
  $$
);

-- VERIFICACIÓN:
--   SELECT jobid, status, return_message, start_time
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'weekly-matcher-10min')
--   ORDER BY start_time DESC LIMIT 10;
-- Las corridas nuevas deben salir 'succeeded'.
