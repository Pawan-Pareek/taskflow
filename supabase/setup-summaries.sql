-- TaskFlow weekly / monthly summary. Run once in Supabase -> SQL Editor (after secure-rls.sql).
-- Safe to run again.

-- 1) When each task was finished (summaries count tasks on the day they were done).
--    Tasks finished before this existed have no time, so they count on their due date.
alter table public.todos add column if not exists completed_at timestamptz;

-- 2) Each user's summary setting and time zone: { "enabled": true, "tz": "Asia/Kolkata" }.
--    Lives on the user's own user_settings row, which the "own rows" rule already protects.
alter table public.user_settings add column if not exists summary_prefs jsonb;

-- 3) Which summaries were already sent, so nobody gets the same one twice.
--    Row Level Security with no policies: only the server function can read or write it.
create table if not exists public.summary_log (
  user_id text not null,
  kind text not null,          -- 'week' or 'month'
  period_key text not null,    -- week: its Monday (YYYY-MM-DD); month: YYYY-MM
  sent_at timestamptz default timezone('utc'::text, now()),
  primary key (user_id, kind, period_key)
);
alter table public.summary_log enable row level security;

-- 4) Run the send-summaries function every 10 minutes (deploy the function first).
--    It only sends from 8 pm on Sundays and on the last day of the month, in each user's time zone.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'taskflow-send-summaries';
select cron.schedule(
  'taskflow-send-summaries',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://dqdejfvtsnzamqrumdzm.supabase.co/functions/v1/send-summaries',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZGVqZnZ0c256YW1xcnVtZHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTEzMDcsImV4cCI6MjEwODcyNzMwN30.65aa9GJLsQ_xOT1lHG1qlmpwB5um_FAyCIZXoEnM4Nc'),
    body := '{}'::jsonb
  );
  $$
);
