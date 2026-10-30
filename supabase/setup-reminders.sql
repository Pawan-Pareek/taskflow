-- TaskFlow reminders: run this once in Supabase -> SQL Editor.

-- 1) Task columns
alter table todos add column if not exists goal_type text default 'daily';
alter table todos add column if not exists remind_at timestamptz;
alter table todos add column if not exists reminded boolean default false;
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
