-- Update weekly-matcher cron job from every hour to every 10 minutes
-- Required to respect cascading reassignment windows: 4h→2h→1h→30m

-- Delete old hourly job
SELECT cron.unschedule('weekly-matcher-hourly');

-- Schedule new job: every 10 minutes
-- Uses pg_net (net.http_post) to trigger the Edge Function without JWT verification
SELECT cron.schedule(
  'weekly-matcher-every-10min',
  '*/10 * * * *',  -- Every 10 minutes UTC
  $$
  SELECT net.http_post(
    url:='https://gxqkfqxgmmnleqdmssva.supabase.co/functions/v1/weekly-matcher',
    body:='{}'::jsonb,
    headers:='{"Content-Type":"application/json"}'::jsonb
  ) AS request_id;
  $$
);

-- NOTE: The Edge Function is idempotent, so running every 10 minutes is safe.
-- This allows respecting the cascading windows for reasignments:
--   4h → expires → (within 2h) reasign
--   2h → expires → (within 1h) reasign
--   1h → expires → (within 30m) reasign
--   30m → expires → no more proposals (critical hour)
--
-- VERIFICATION STEPS:
-- 1. Check updated cron job: SELECT * FROM cron.job WHERE jobname LIKE 'weekly-matcher%';
-- 2. Verify new schedule: SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 10;
-- 3. Monitor Edge Function logs for increased frequency
