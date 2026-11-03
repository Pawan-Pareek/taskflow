# Moving TaskFlow to real accounts and locked-down data

What changed: sign-in now uses Supabase Auth (passwords are hashed by Supabase, not in the browser), and
every table is restricted so a signed-in user can only read and change their own rows. Before this, the
tables were open to anyone holding the public key in `js/config.js`.

Do the steps **in this order**. Running the SQL before the new app is live signs everyone out of the old version.

## 1. Supabase dashboard settings
- **Authentication -> Providers -> Email:** keep **Confirm email** ON. The data move in step 4 trusts a confirmed email,
  so with it OFF someone could sign up with your email address and take your tasks.
- **Authentication -> URL Configuration:** set **Site URL** to your deployed site (the confirmation link opens it).

## 2. Deploy the new app
Push to GitHub and let Vercel deploy. Vercel now also sends security headers (see `vercel.json`).

## 3. Lock the database
SQL Editor -> paste all of `supabase/secure-rls.sql` -> Run.

## 4. Bring existing accounts across
For each person who had an account before:
1. Open the site, **Create account** with the **same email** as the old account (pick a new password), then open the link in the confirmation email.
2. **Sign in** with that email. Their old tasks, reminders, alerts, lists and categories move over automatically on this first sign-in.

The old account row (with its weak password hash) is deleted when it is moved. Once everyone has moved, you can drop the old table: `drop table public.users;`.

## 5. Redeploy the notification function
`npx supabase functions deploy send-notification-alerts --use-api`
(the "Send test" button now requires the alert's owner to be signed in).

## Notes
- Sign in is by **email** now, not username.
- Supabase's built-in email sender is rate limited (a few emails per hour). For many users, set up custom SMTP under Authentication -> SMTP Settings.
- The anon key in `js/config.js` is meant to be public. With the rules above it can no longer read anyone's data.
