// Supabase Edge Function: sends due task reminders as Web Push notifications.
// Called every minute by pg_cron (see supabase/setup-reminders.sql).
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

Deno.serve(async () => {
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabase
    .from("todos")
    .select("id, user_id, title, notes")
    .lte("remind_at", nowIso)
    .gte("remind_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()) // skip anything over a day late
    .eq("reminded", false)
    .eq("completed", false)
    .limit(200);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!due || due.length === 0) return new Response(JSON.stringify({ sent: 0 }));

  let sent = 0;
  for (const todo of due) {
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", todo.user_id);

    // No phone registered yet: keep the reminder pending instead of losing it.
    if (!subs || subs.length === 0) continue;

    // Claim the reminder so overlapping runs never send it twice.
    const { data: claimed } = await supabase
      .from("todos")
      .update({ reminded: true })
      .eq("id", todo.id)
      .eq("reminded", false)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const payload = JSON.stringify({
      title: "⏰ Reminder",
      body: todo.title,
      taskId: todo.id,
      url: "/?task=" + encodeURIComponent(todo.id),
    });

    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        // Subscription expired or revoked: remove it.
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        } else {
          console.error("push failed", code, (err as Error).message);
        }
      }
    }
  }

  return new Response(JSON.stringify({ due: due.length, sent }));
});
