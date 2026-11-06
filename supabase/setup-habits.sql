-- TaskFlow habits and streak reminders. Run once in Supabase -> SQL Editor
-- (after secure-rls.sql and setup-summaries.sql). Safe to run again.

-- 1) Habits: one row per habit. checkins is the list of days checked in ("YYYY-MM-DD").
create table if not exists public.habits (
  id text primary key,
  user_id text not null,
  name text not null,
  schedule text not null default 'daily',      -- 'daily' or 'weekdays'
  remind_time text,                             -- 'HH:MM' in the user's time zone, or null
  tz text,
  start_date text not null,
  target_days int not null default 21,          -- 21, then 66 if the user keeps going
  checkins jsonb not null default '[]'::jsonb,
  status text not null default 'active',        -- 'active' or 'done'
  last_reminded_on text,                        -- set by the server so a reminder goes out once a day
  created_at timestamptz default timezone('utc'::text, now()),
  updated_at timestamptz default timezone('utc'::text, now())
);
create index if not exists habits_user_idx on public.habits (user_id);

-- 2) Each signed-in user can only see and change their own habits
alter table public.habits enable row level security;
drop policy if exists "own rows" on public.habits;
create policy "own rows" on public.habits for all to authenticated
  using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);

-- 3) Run the send-habits function every 5 minutes (deploy it first).
--    It sends habit reminders at their set time, and the 7 pm streak reminder when a streak would end tonight.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'taskflow-send-habits';
select cron.schedule(
  'taskflow-send-habits',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://dqdejfvtsnzamqrumdzm.supabase.co/functions/v1/send-habits',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZGVqZnZ0c256YW1xcnVtZHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTEzMDcsImV4cCI6MjEwODcyNzMwN30.65aa9GJLsQ_xOT1lHG1qlmpwB5um_FAyCIZXoEnM4Nc'),
    body := '{}'::jsonb
  );
  $$
);
