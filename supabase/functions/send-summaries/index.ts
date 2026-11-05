// Supabase Edge Function: weekly and monthly summary notifications.
// Called every 10 minutes by pg_cron (see supabase/setup-summaries.sql). From 8 pm in each user's own
// time zone it sends the week's summary on Sundays and the month's summary on the last day of the month,
// once per period (later runs the same evening catch up after an outage). Counting and wording come from
// the same code the app uses (../_shared/summary.js, generated from js/summary.js).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import "../_shared/summary.js";

// deno-lint-ignore no-explicit-any
const S = (globalThis as any).TaskSummary;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const SEND_HOUR = 20; // 8 pm local time

type Prefs = { enabled?: boolean; tz?: string };
type TodoRow = {
  id: string;
  title: string;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  goal_type: string | null;
};

function localNow(tz: string) {
  const parts: Record<string, string> = {};
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hourCycle: "h23", weekday: "short",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    });
    for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  } catch {
    return null; // unknown time zone
  }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday };
}

// database row -> the task shape js/summary.js expects
function toTask(r: TodoRow) {
  const g = r.goal_type ?? "";
  return {
    id: r.id,
    title: r.title,
    dueDate: r.due_date ?? "",
    completed: !!r.completed,
    completedAt: r.completed_at ?? "",
    type: g.startsWith("custom") ? "custom" : (g || "daily"),
  };
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

Deno.serve(async () => {
  const { data: rows, error } = await supabase
    .from("user_settings")
    .select("user_id, summary_prefs")
    .not("summary_prefs", "is", null)
    .limit(5000);
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const row of rows ?? []) {
    const prefs = (row.summary_prefs ?? {}) as Prefs;
    if (prefs.enabled === false || !prefs.tz) continue;
    const now = localNow(prefs.tz);
    if (!now || now.hour < SEND_HOUR) continue;

    const due: { kind: "week" | "month"; key: string }[] = [];
    if (now.weekday === "Sun") due.push({ kind: "week", key: S.dates.weekStart(now.date) });
    if (now.date === S.dates.monthEnd(now.date)) due.push({ kind: "month", key: now.date.slice(0, 7) });
    if (due.length === 0) continue;

    let tasks: ReturnType<typeof toTask>[] | null = null;
    for (const d of due) {
      // Claim this user's summary for this period, so overlapping runs never send it twice
      const { error: claimErr } = await supabase
        .from("summary_log")
        .insert({ user_id: row.user_id, kind: d.kind, period_key: d.key });
      if (claimErr) continue; // already sent for this period

      if (!tasks) {
        const { data: todos } = await supabase
          .from("todos")
          .select("id, title, due_date, completed, completed_at, goal_type")
          .eq("user_id", row.user_id)
          .limit(5000);
        tasks = ((todos ?? []) as TodoRow[]).map(toTask);
      }
      // Treat the period as finished (it ends tonight), so the wording is the final one
      const summary = S.buildSummary(tasks, d.kind, now.date, { tz: prefs.tz, today: S.dates.addDays(now.date, 1) });
      if (summary.planned === 0) continue; // nothing was planned: stay quiet

      const delivered = await push(row.user_id, `summary-${d.kind}-${d.key}`, S.pushText(summary), `/?view=summary-${d.kind}`);
      if (delivered > 0) {
        sent++;
      } else {
        // No registered device: release the claim so a later run this evening can try again
        await supabase.from("summary_log").delete()
          .eq("user_id", row.user_id).eq("kind", d.kind).eq("period_key", d.key);
      }
    }
  }
  return json({ users: rows?.length ?? 0, sent });
});
