-- TaskFlow reminders: run this once in Supabase -> SQL Editor.

-- 1) Task columns
alter table todos add column if not exists goal_type text default 'daily';
alter table todos add column if not exists remind_at timestamptz;
alter table todos add column if not exists reminded boolean default false;
alter table todos add column if not exists repeat_rule text;
alter table todos add column if not exists repeat_day int;
create index if not exists todos_due_reminders_idx on todos (remind_at) where reminded = false;

-- 2) Phones / browsers that accepted notifications
create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default timezone('utc'::text, now())
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
create policy "Allow all operations on push_subscriptions" on push_subscriptions for all using (true) with check (true);

-- 2b) Per-user settings (custom list name). One row per user; the latest rename wins.
create table if not exists user_settings (
  user_id text primary key,
  custom_list_name text,
  updated_at timestamptz default timezone('utc'::text, now())
);
alter table user_settings enable row level security;
create policy "Allow all operations on user_settings" on user_settings for all using (true) with check (true);
alter publication supabase_realtime add table user_settings;

-- 2c) Per-user categories (names + colors). Safe to run even if 2b was already run.
alter table user_settings add column if not exists categories jsonb;

-- 2d) Notification alerts the user creates and edits in Settings (morning nudge, night summary, ...)
create table if not exists notification_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  kind text not null default 'nudge',        -- 'nudge' = reminder to add tasks, 'remaining' = list of open tasks, 'reminder' = just the user's own text
  send_time text not null default '08:00',   -- local time, HH:MM
  days text not null default '0,1,2,3,4,5,6', -- weekdays, 0 = Sunday
  tz text not null default 'UTC',            -- IANA time zone of the device that saved it
  subject text,
  message text,
  enabled boolean not null default true,
  last_sent_on text,                         -- local date of the last send, so it fires once a day
  last_test_at timestamptz,
  created_at timestamptz default timezone('utc'::text, now())
);
create index if not exists notification_alerts_user_idx on notification_alerts (user_id);
alter table notification_alerts enable row level security;
create policy "Allow all operations on notification_alerts" on notification_alerts for all using (true) with check (true);

-- 3) Run the send-reminders Edge Function every minute
-- (deploy the function first; see supabase/README-reminders.md. The request carries the
--  project public anon key, so the function keeps JWT verification on.)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'taskflow-send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://dqdejfvtsnzamqrumdzm.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZGVqZnZ0c256YW1xcnVtZHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTEzMDcsImV4cCI6MjEwODcyNzMwN30.65aa9GJLsQ_xOT1lHG1qlmpwB5um_FAyCIZXoEnM4Nc'),
    body := '{}'::jsonb
  );
  $$
);

-- 4) Run the send-notification-alerts Edge Function every minute (deploy it first; see README-reminders.md)
select cron.schedule(
  'taskflow-send-notification-alerts',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://dqdejfvtsnzamqrumdzm.supabase.co/functions/v1/send-notification-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZGVqZnZ0c256YW1xcnVtZHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNTEzMDcsImV4cCI6MjEwODcyNzMwN30.65aa9GJLsQ_xOT1lHG1qlmpwB5um_FAyCIZXoEnM4Nc'),
    body := '{}'::jsonb
  );
  $$
);
