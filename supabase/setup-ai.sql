-- TaskFlow smart add: a daily cap on AI requests per user (so a fault can never use up the free quota).
-- Run once in Supabase -> SQL Editor. Optional: without it the feature still works, just without the cap.
create table if not exists public.ai_usage (
  user_id text not null,
  day text not null,          -- the user's local day, YYYY-MM-DD
  count int not null default 0,
  primary key (user_id, day)
);
-- Row Level Security with no policies: only the parse-task server function can read or write it.
alter table public.ai_usage enable row level security;
