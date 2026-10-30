# Task reminders: one-time setup

Reminders are sent as Web Push notifications. A Supabase job runs every minute,
finds tasks whose reminder time has passed and pushes them to the user's phone.
Everything used here is on the free tiers of Supabase and Vercel.

## 1. Database (about 1 minute)

Supabase dashboard -> **SQL Editor** -> paste all of `supabase/setup-reminders.sql` -> **Run**.

It adds the `goal_type`, `remind_at` and `reminded` columns, a `push_subscriptions` table,
and a job that calls the `send-reminders` function every minute.

## 2. Deploy the sending function

You need the Supabase CLI. On Windows install it with `scoop install supabase`
(a global `npm i -g supabase` is not supported), or run every command below as `npx supabase ...`.

```
supabase login
supabase link --project-ref dqdejfvtsnzamqrumdzm
supabase secrets set VAPID_PUBLIC_KEY=BBGsL_KS1NRLde5VAHhJBRlbsCITilB7_RwwNpKHjnG-WLGhzZr0X7UrUqGN6Cbw3CRveA7D07bYwfd5zCtpJZY
supabase secrets set VAPID_PRIVATE_KEY=<contents of supabase/.vapid-private.key>
supabase secrets set VAPID_SUBJECT=https://github.com/Pawan-Pareek/taskflow
supabase functions deploy send-reminders --use-api
```

`VAPID_SUBJECT` is just a contact URL for the push services (use your site URL or a mailto: address). `supabase/.vapid-private.key`
is git-ignored: never commit or share it. If you lose it, run
`node scripts/generate-vapid-keys.js`, update `vapidPublicKey` in `js/config.js`,
and set both secrets again (devices then need to re-enable notifications).

## 3. Use it

1. Deploy the app (push to GitHub, Vercel builds it).
2. On the phone: open the site -> **Settings -> Enable notifications** -> Allow.
   - **iPhone** (iOS 16.4+): first tap Share -> **Add to Home Screen**, then open TaskFlow
     from the home screen icon. Notifications do not work from a normal Safari tab.
   - **Android**: works in Chrome directly.
3. Add or edit a task, set **Remind me at**, and wait. The phone is notified within about a minute
   of that time, even with the app closed.

## Testing the function by hand

```
curl -X POST -H "Authorization: Bearer <anon key from js/config.js>" https://dqdejfvtsnzamqrumdzm.supabase.co/functions/v1/send-reminders
```

It returns `{"due":N,"sent":M}`. Logs: Supabase dashboard -> Edge Functions -> send-reminders -> Logs.

## Limits

- One-time reminders only. Delivery is within about a minute, not to the second.
- Needs Supabase cloud sync. In local-only mode, reminders show only while the app is open.
- A reminder fires once. Changing the time on a task re-arms it. Completed tasks are skipped.
