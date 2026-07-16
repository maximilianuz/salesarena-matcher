-- Fix: el cron job 'weekly-matcher-hourly' fue creado apuntando a un dominio
-- con un error de tipeo en el Project ID ("...n1e..." con número uno en lugar
-- de "...nle..." con letra ele). Ese dominio no existe en DNS, por lo que el
-- cron nunca pudo invocar la Edge Function. Este script lo reemplaza con la
-- URL correcta. Es idempotente: si el job no existe, simplemente lo crea.

DO $$
BEGIN
  PERFORM cron.unschedule('weekly-matcher-hourly');
EXCEPTION WHEN OTHERS THEN
  NULL; -- el job no existía; continuar
END $$;

SELECT cron.schedule(
  'weekly-matcher-hourly',
  '0 * * * *',  -- Cada hora en el minuto 0 UTC
  $$
  SELECT net.http_post(
    url:='https://gxqkfqxgmmnleqdmssva.supabase.co/functions/v1/weekly-matcher',
    body:='{}'::jsonb,
    headers:='{"Content-Type":"application/json"}'::jsonb
  ) AS request_id;
  $$
);
