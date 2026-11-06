// Supabase Edge Function: habit reminders and the evening streak reminder.
// Called every 5 minutes by pg_cron (see supabase/setup-habits.sql).
//  - Habit reminder: at the time set on the habit (in the user's time zone), on scheduled days,
//    when the user has not checked in yet. At most once a day per habit.
//  - Streak reminder: from 7 pm, once a day, only when the daily streak would end tonight
//    (this week's rest day is already used and today does not count yet).
// The rules come from the same code the app uses (../_shared/streak.js, generated from js/streak.js).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import "../_shared/streak.js";

// deno-lint-ignore no-explicit-any
const K = (globalThis as any).TaskStreak;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const CATCH_UP_MINUTES = 60; // after an outage, a habit reminder up to an hour late still goes out
const STREAK_HOUR = 19;      // 7 pm local time
const MIN_STREAK = 2;        // do not nag about a 1-day streak

type Habit = {
  id: string;
  user_id: string;
  name: string;
  schedule: string;
  remind_time: string | null;
  tz: string | null;
  start_date: string;
  target_days: number;
  checkins: string[];
  last_reminded_on: string | null;
};

function localNow(tz: string) {
  const parts: Record<string, string> = {};
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  } catch {
    return null;
  }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function toMinutes(hhmm: string) {
  const [h, m] = (hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : -1;
}

// Returns how many devices got it
async function push(userId: string, tag: string, n: { title: string; body: string }, url: string) {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  let sent = 0;
  const payload = JSON.stringify({ title: n.title, body: n.body, taskId: tag, url });
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      } else {
        console.error("push failed", code, (err as Error).message);
      }
    }
  }
  return sent;
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

async function habitReminders() {
  const { data, error } = await supabase
    .from("habits")
    .select("*")
    .eq("status", "active")
    .not("remind_time", "is", null)
    .limit(5000);
  if (error) throw new Error(error.message);

  let sent = 0;
  for (const h of (data ?? []) as Habit[]) {
    const now = localNow(h.tz || "UTC");
    if (!now) continue;
    if (!K.isScheduled(h, now.date)) continue;
    if ((h.checkins ?? []).includes(now.date)) continue;
    if (h.last_reminded_on === now.date) continue;
    const late = now.minutes - toMinutes(h.remind_time!);
    if (late < 0 || late > CATCH_UP_MINUTES) continue;

    // Claim today's reminder so overlapping runs never send it twice
    const { data: claimed } = await supabase
      .from("habits")
      .update({ last_reminded_on: now.date })
      .eq("id", h.id)
      .or(`last_reminded_on.is.null,last_reminded_on.neq.${now.date}`)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const p = K.habitProgress(h, now.date);
    const body = p.onLastChance
      ? `You missed yesterday. Check in today to keep your ${p.run}-day progress.`
      : `Day ${p.run + 1} of ${p.target}. Tap to check in.`;
    const delivered = await push(h.user_id, "habit-" + h.id, { title: h.name, body }, "/?view=habits");
    if (delivered > 0) sent++;
    else await supabase.from("habits").update({ last_reminded_on: h.last_reminded_on }).eq("id", h.id); // retry when a device is registered
  }
  return sent;
}

async function streakReminders() {
  const { data: rows, error } = await supabase
    .from("user_settings")
    .select("user_id, summary_prefs")
    .not("summary_prefs", "is", null)
    .limit(5000);
  if (error) throw new Error(error.message);

  let sent = 0;
  for (const row of rows ?? []) {
    const prefs = (row.summary_prefs ?? {}) as { tz?: string; streakNudge?: boolean };
    if (prefs.streakNudge === false || !prefs.tz) continue;
    const now = localNow(prefs.tz);
    if (!now || now.hour < STREAK_HOUR) continue;

    // One check per user per evening
    const { error: claimErr } = await supabase
      .from("summary_log")
      .insert({ user_id: row.user_id, kind: "streak", period_key: now.date });
    if (claimErr) continue;

    const { data: todos } = await supabase
      .from("todos")
      .select("due_date, completed, completed_at, goal_type")
      .eq("user_id", row.user_id)
      .limit(5000);
    const tasks = (todos ?? []).map((r) => {
      const g = (r.goal_type as string | null) ?? "";
      return {
        dueDate: r.due_date ?? "",
        completed: !!r.completed,
        completedAt: r.completed_at ?? "",
        type: g.startsWith("custom") ? "custom" : (g || "daily"),
      };
    });
    const st = K.computeStreak(tasks, { today: now.date, tz: prefs.tz });
    if (!st.atRisk || st.current < MIN_STREAK) continue; // safe tonight: nothing to say

    const n = st.need;
    const delivered = await push(row.user_id, "streak-" + now.date, {
      title: `Keep your ${st.current}-day streak`,
      body: `Finish ${n} more task${n === 1 ? "" : "s"} today to keep it going.`,
    }, "/");
    if (delivered > 0) sent++;
    else await supabase.from("summary_log").delete().eq("user_id", row.user_id).eq("kind", "streak").eq("period_key", now.date);
  }
  return sent;
}

Deno.serve(async () => {
  const result: Record<string, unknown> = {};
  try { result.habits = await habitReminders(); } catch (e) { result.habitsError = (e as Error).message; }
  try { result.streaks = await streakReminders(); } catch (e) { result.streaksError = (e as Error).message; }
  return json(result);
});
