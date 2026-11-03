-- TaskFlow: lock the database down so each signed-in user can only reach their own rows.
-- Run this ONCE in Supabase -> SQL Editor, AFTER the new app version is live (it needs Supabase Auth sign-in).
--
-- Before you run it (Supabase dashboard):
--   Authentication -> Providers -> Email: keep "Confirm email" ON. The data move below trusts a confirmed email.
--   Authentication -> URL Configuration: set "Site URL" to your deployed site (the confirmation link opens it).

-- 1) Drop every old policy (the old ones were "using (true)": open to anyone holding the public key)
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('todos', 'push_subscriptions', 'user_settings', 'notification_alerts', 'users')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2) Row Level Security on, and one policy per table: you only see and change rows where user_id is you.
alter table public.todos enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.user_settings enable row level security;
alter table public.notification_alerts enable row level security;

create policy "own rows" on public.todos for all to authenticated
  using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);
create policy "own rows" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);
create policy "own rows" on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);
create policy "own rows" on public.notification_alerts for all to authenticated
  using (user_id = (select auth.uid())::text) with check (user_id = (select auth.uid())::text);

-- The old home-made accounts table (it held weak password hashes): no policies = not reachable from the app at all.
alter table public.users enable row level security;

-- 3) First sign-in after the switch: move an old account's data to the new login with the same (confirmed) email.
create or replace function public.claim_legacy_data() returns int
language plpgsql security definer set search_path = public, auth as $$
declare
  uid text := auth.uid()::text;
  mail text;
  confirmed timestamptz;
  old record;
  moved int := 0;
begin
  if auth.uid() is null then return 0; end if;
  select email, email_confirmed_at into mail, confirmed from auth.users where id = auth.uid();
  if mail is null or confirmed is null then return 0; end if;

  for old in select id from public.users where lower(email) = lower(mail) loop
    update public.todos set user_id = uid where user_id = old.id;
    update public.push_subscriptions set user_id = uid where user_id = old.id;
    update public.notification_alerts set user_id = uid where user_id = old.id;
    delete from public.user_settings where user_id = uid;
    update public.user_settings set user_id = uid where user_id = old.id;
    delete from public.users where id = old.id;   -- one-time: the old account (and its weak hash) is gone
    moved := moved + 1;
  end loop;
  return moved;
end $$;

revoke all on function public.claim_legacy_data() from public, anon;
grant execute on function public.claim_legacy_data() to authenticated;
