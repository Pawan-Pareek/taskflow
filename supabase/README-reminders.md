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

# Notification alerts

Users create their own recurring notifications in **Settings -> Notification alerts** (up to 5): a name,
what to send (a reminder to add tasks, or a list of the tasks still open today), a time, the days, and an
optional title and message. "Morning nudge" and "Night summary" are one-tap starting points.
They arrive as the same push notifications as task reminders, on every device that tapped
**Enable notifications**. A cron job runs every minute and sends each alert once a day at its local time
(the time zone of the device that saved it). A late run still sends within 60 minutes of the set time,
then skips that day. If no device is registered yet, the alert waits instead of being lost.

## One-time setup

1. Run `supabase/setup-reminders.sql` again (sections 2d and 4 create the `notification_alerts` table and the cron job).
2. Deploy the function. It uses the VAPID secrets you already set for `send-reminders`:

```
supabase functions deploy send-notification-alerts --use-api
```

Use **Send test** in the alert editor to check it. Logs: Supabase dashboard -> Edge Functions ->
send-notification-alerts -> Logs.

## Weekly and monthly summary

The app shows a summary under **Review** in the menu, and a short review pop-up the first time it is
opened after a week or month ends. With notifications on, the phone also gets the summary at 8 pm
(in the user's own time zone) on Sundays and on the last day of each month.

1. SQL Editor: run all of `supabase/setup-summaries.sql` (adds `completed_at`, the summary setting, a send log, and a job every 10 minutes).
2. Deploy: `supabase functions deploy send-summaries --use-api`
3. The counting rules live in `js/summary.js`. After editing it, run `node scripts/sync-shared.js`
   (the server uses a copy) and `node scripts/test-summary.js`.

## Daily streak and habits

The streak is worked out from task history, so it needs nothing extra. Habits need one table and a function:

1. SQL Editor: run all of `supabase/setup-habits.sql` (the `habits` table with the own-rows rule, and a job every 5 minutes).
2. Deploy: `supabase functions deploy send-habits --use-api`

The function sends habit reminders at each habit's time, and at 7 pm a reminder when the daily streak would end tonight.
The rules live in `js/streak.js` (tests: `node scripts/test-streak.js`); run `node scripts/sync-shared.js` after editing it.

## Smart add (AI reads a task sentence)

"I want to call Jenis at 12 pm tomorrow" becomes the task "Call Jenis", tomorrow, with a 12:00 PM reminder.
The `parse-task` function sends the sentence to a free model on Groq; the app falls back to its own reader
(`js/quickparse.js`, tests: `node scripts/test-quickparse.js`) whenever the AI cannot be reached.

1. Groq key (free at console.groq.com): `supabase secrets set GROQ_API_KEY=... --project-ref <ref>`
2. Deploy: `supabase functions deploy parse-task --use-api`
3. Optional daily cap of 100 reads per user: run `supabase/setup-ai.sql`.

Groq retires models from time to time. The function tries the models in `MODELS` in order and moves on when
one is gone; list what a key can use with `GET https://api.groq.com/openai/v1/models`.
