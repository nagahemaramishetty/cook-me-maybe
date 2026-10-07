-- Cook Me Maybe: daily reminder schedule.
-- Run this AFTER the send-reminders function is deployed (see SETUP.md, step 5).
-- Replace the two placeholders below before running:
--   YOUR-PROJECT-ID   → from your Supabase URL (https://YOUR-PROJECT-ID.supabase.co)
--   YOUR-CRON-SECRET  → the same CRON_SECRET you saved in Edge Function secrets

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove an older copy of the job if you're re-running this file
select cron.unschedule('cook-me-maybe-daily')
where exists (select 1 from cron.job where jobname = 'cook-me-maybe-daily');

-- Every day at 13:00 UTC = 9:00 AM in Charlotte during daylight time (8:00 AM in winter).
-- Change '0 13 * * *' if you want a different time (format: minute hour * * *, in UTC).
select cron.schedule(
  'cook-me-maybe-daily',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-ID.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR-CRON-SECRET'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Check it's scheduled:
-- select jobname, schedule from cron.job;
-- See recent runs:
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
