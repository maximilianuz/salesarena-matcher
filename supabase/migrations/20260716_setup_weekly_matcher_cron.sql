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
    url:='https://' || current_setting('app.settings.supabase_project_id', 'true') || '.supabase.co/functions/v1/weekly-matcher',
    body:='{}'::jsonb,
    headers:='{"Content-Type":"application/json"}'::jsonb
  ) AS request_id;
  $$
);

-- NOTE: This migration enables pg_cron to periodically trigger the weekly-matcher Edge Function.
-- The function is idempotent, so it's safe to run every hour.
--
-- VERIFICATION STEPS:
-- 1. After deployment, check cron jobs with: SELECT * FROM cron.job;
-- 2. Verify job execution: SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 10;
-- 3. Check Edge Function logs in Supabase Dashboard > Logs > Edge Functions
--
-- If the cron job fails with "current_setting('app.settings.supabase_project_id')" error:
-- Replace the above URL line with:
--   url:='https://YOUR_ACTUAL_PROJECT_ID.supabase.co/functions/v1/weekly-matcher',
-- where YOUR_ACTUAL_PROJECT_ID is from Supabase Dashboard > Settings > General > Project ID
