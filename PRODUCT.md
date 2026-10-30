# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
A person managing their own day: quick capture of tasks, weekly and monthly goals, and timed reminders. Used mostly on an iPhone (installed to the Home Screen as a web app) and sometimes on a laptop browser. Each user signs in with their own account; data syncs between devices.

## Product Purpose
TaskFlow is a personal to-do app. It lets someone add tasks with priority, category, due date and optional reminder time, plan weekly and monthly goals that roll over when unfinished, filter by date, and get a push notification on their phone at the reminder time. Success is capturing a task in a few seconds and trusting that it will be shown, and reminded, at the right time.

## Operating Context
Stack: static HTML, CSS and vanilla JavaScript PWA (service worker, manifest), hosted on Vercel. Data and accounts in Supabase; reminders sent by a Supabase Edge Function with Web Push. Works offline with local storage. Installed to the iPhone Home Screen for push to work.

## Capabilities and Constraints
- Task types: daily task, weekly goal, monthly goal; unfinished goals roll into the current week or month.
- Views: Today, Upcoming, All, Starred, Completed, Weekly Goals, Monthly Goals, category filters, date filter, search, sort.
- Reminders: one-time, per task; iOS requires installing to the Home Screen.
- Must keep working offline and with the existing Supabase schema; no build step (plain static files).
- Must respect iPhone safe areas.

## Brand Commitments
The user asked for a simple, professional, user-friendly look that does not read as AI-generated: no glowing buttons or effects, and no unnecessary emojis. Follows the device light/dark setting. One calm blue accent.

## Product Principles
- Capturing and finishing tasks must take as few taps as possible, especially one-handed on a phone.
- The screen shows what matters now; history stays reachable but out of the way.
- Plain, specific labels over decoration.
- Reminders must be trustworthy: set clearly, delivered once, visible afterwards.

## Accessibility & Inclusion
Meet WCAG AA contrast, visible keyboard focus, labelled controls, 44px touch targets, and respect reduced-motion and system light/dark settings.
