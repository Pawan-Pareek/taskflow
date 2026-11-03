// Supabase Edge Function: sends the notification alerts users set up in Settings
// (e.g. a morning nudge to add tasks, a night list of what is still open) as Web Push.
// Called every minute by pg_cron (see supabase/setup-reminders.sql). Uses the same
// push subscriptions and VAPID keys as send-reminders.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const CATCH_UP_MINUTES = 60; // after an outage, still send if at most this late; otherwise skip today
const MAX_LISTED = 4;        // task titles shown in the night summary before "+N more"

type Alert = {
  id: string;
  user_id: string;
  name: string;
  kind: string;
  send_time: string;
  days: string;
  tz: string;
  subject: string | null;
  message: string | null;
  last_sent_on: string | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localNow(tz: string) {
  const parts: Record<string, string> = {};
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  } catch {
    return null; // unknown time zone
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

function toMinutes(hhmm: string) {
  const [h, m] = (hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : -1;
}

async function buildNotification(a: Alert, today: string) {
  const intro = (a.message ?? "").trim();

  // "Just a reminder": only the title and message the user wrote
  if (a.kind === "reminder") {
    return { title: a.subject || a.name, body: intro || a.name };
  }

  if (a.kind !== "remaining") {
    return {
      title: a.subject || "Plan your day",
      body: intro || "Take a minute to add what you want to get done today.",
    };
  }

  // Open tasks that are due today, overdue, or on the no-date list
  const { data } = await supabase
    .from("todos")
    .select("title, due_date, goal_type")
    .eq("user_id", a.user_id)
    .eq("completed", false)
    .limit(500);
  const open = (data ?? []).filter((t) =>
    (t.goal_type ?? "").startsWith("custom") || (t.due_date && t.due_date <= today)
  ).sort((x, y) => (x.due_date || "9999").localeCompare(y.due_date || "9999"));

  if (open.length === 0) {
    return { title: a.subject || "All done for today", body: "Nothing left on your list. Nice work." };
  }
  const shown = open.slice(0, MAX_LISTED).map((t) => "• " + t.title).join("\n");
  const more = open.length > MAX_LISTED ? `\n+${open.length - MAX_LISTED} more` : "";
  return {
    title: a.subject || `${open.length} task${open.length === 1 ? "" : "s"} still open`,
    body: (intro ? intro + "\n" : "") + shown + more,
  };
}

// Returns how many devices got it
async function push(userId: string, tag: string, n: { title: string; body: string }) {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  let sent = 0;
  const payload = JSON.stringify({ title: n.title, body: n.body, taskId: tag, url: "/" }) // taskId is the notification tag, so alerts never replace task reminders;
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

// The app calls this from the browser (Send test), so it must answer the CORS preflight
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: { test?: string } = {};
  try { body = await req.json(); } catch { /* cron sends {} */ }

  // "Send test" button in Settings: send one alert now, at most once every 15 seconds
  if (body.test) {
    const { data: a } = await supabase.from("notification_alerts").select("*").eq("id", body.test).maybeSingle();
    if (!a) return json({ error: "Alert not found" }, 404);
    if (a.last_test_at && Date.now() - new Date(a.last_test_at).getTime() < 15000) {
      return json({ error: "Please wait a few seconds before testing again" }, 429);
    }
    await supabase.from("notification_alerts").update({ last_test_at: new Date().toISOString() }).eq("id", a.id);
    const now = localNow(a.tz) ?? localNow("UTC")!;
    const sent = await push(a.user_id, "alert-" + a.id, await buildNotification(a, now.date));
    if (sent === 0) return json({ error: "No device is registered. Tap Enable notifications in Settings on your phone first." }, 409);
    return json({ sent });
  }

  const { data: alerts, error } = await supabase.from("notification_alerts").select("*").eq("enabled", true).limit(1000);
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const a of (alerts ?? []) as Alert[]) {
    const now = localNow(a.tz);
    if (!now) continue;
    if (!a.days.split(",").map(Number).includes(now.weekday)) continue;
    if (a.last_sent_on === now.date) continue;
    const late = now.minutes - toMinutes(a.send_time);
    if (late < 0 || late > CATCH_UP_MINUTES) continue;

    // Claim today's send so overlapping runs never notify twice
    const { data: claimed } = await supabase
      .from("notification_alerts")
      .update({ last_sent_on: now.date })
      .eq("id", a.id)
      .or(`last_sent_on.is.null,last_sent_on.neq.${now.date}`)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const delivered = await push(a.user_id, "alert-" + a.id, await buildNotification(a, now.date));
    if (delivered > 0) {
      sent++;
    } else {
      // No registered device (yet): release the claim so it still goes out once one is registered
      await supabase.from("notification_alerts").update({ last_sent_on: a.last_sent_on }).eq("id", a.id);
    }
  }
  return json({ alerts: alerts?.length ?? 0, sent });
});
