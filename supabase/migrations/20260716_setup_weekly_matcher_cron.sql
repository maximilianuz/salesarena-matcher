-- Enable pg_cron extension (required for periodic job scheduling)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Grant execute permission on cron functions to postgres
GRANT EXECUTE ON FUNCTION cron.schedule(text, text, text) TO postgres;
GRANT EXECUTE ON FUNCTION cron.schedule(text, text, text, text) TO postgres;
GRANT EXECUTE ON FUNCTION net.http_post(text, jsonb, text, text) TO postgres;

-- Schedule weekly-matcher Edge Function to run every hour
-- Uses pg_net (net.http_post) to trigger the Edge Function without JWT verification
-- The Edge Function has --no-verify-jwt flag, so no Authorization header needed
SELECT cron.schedule(
  'weekly-matcher-hourly',
  '0 * * * *',  -- Every hour at minute 0 UTC
  $$
  SELECT net.http_post(
    url:='https://gxqkfqxgmmn1eqdmssva.supabase.co/functions/v1/weekly-matcher',
    body:='{}'::jsonb,
    headers:='{"Content-Type":"application/json"}'::jsonb
  ) AS request_id;
  $$
);

-- NOTE: This migration enables pg_cron to periodically trigger the weekly-matcher Edge Function.
-- The function is idempotent, so it's safe to run every hour.
-- Project ID: gxqkfqxgmmn1eqdmssva
--
-- VERIFICATION STEPS (after deployment):
-- 1. Check cron jobs: SELECT * FROM cron.job WHERE jobname = 'weekly-matcher-hourly';
-- 2. Verify execution: SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 10;
-- 3. Check Edge Function logs: Supabase Dashboard > Logs > Edge Functions
-- 4. Manually trigger: curl -X POST https://gxqkfqxgmmn1eqdmssva.supabase.co/functions/v1/weekly-matcher
