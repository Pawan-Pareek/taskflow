// Supabase Edge Function: turns a sentence into tasks with a free AI model (Groq, Llama).
// "I want to call Jenis at 12 pm tomorrow" -> [{ title: "Call Jenis", date: <tomorrow>, time: "12:00", ... }]
// Only signed-in users can call it. The Groq key is the GROQ_API_KEY secret (never sent to the browser).
// The app falls back to its own reader (js/quickparse.js) whenever this fails or is unavailable.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Free Groq models, tried in order (a busy or retired one falls through to the next).
// Check what a key can use: GET https://api.groq.com/openai/v1/models
// gpt-oss-120b read all test sentences right (dates, weekly repeats, Hinglish); Qwen is faster but put
// "every Monday" on the wrong first day, so it is the backup.
const MODELS: { id: string; extra: Record<string, unknown> }[] = [
  { id: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" } },
  { id: "qwen/qwen3.8-27b", extra: { reasoning_effort: "none" } },
  { id: "openai/gpt-oss-20b", extra: { reasoning_effort: "low" } },
];
const DAILY_LIMIT = 100;   // per user, so a fault can never use up the free quota
const MAX_TEXT = 300;
const MAX_TASKS = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Named = { id: string; name: string };
type Task = {
  title: string;
  date: string | null;
  time: string | null;
  repeat: string;
  priority: string | null;
  category: string | null;
  list: string | null;
  type: string;
};

function localNow(tz: string) {
  const parts: Record<string, string> = {};
  try {
    const f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hourCycle: "h23", weekday: "long",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    for (const p of f.formatToParts(new Date())) parts[p.type] = p.value;
  } catch {
    return null;
  }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday: parts.weekday };
}

function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

// The next 15 days with their weekday names, so the model looks dates up instead of working them out
// (in testing, models often got "Monday" wrong without this)
function calendar(today: string) {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const rows: string[] = [];
  for (let i = 0; i < 15; i++) {
    const day = addDays(today, i);
    const [y, m, d] = day.split("-").map(Number);
    const wd = names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    rows.push(`${wd} ${day}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`);
  }
  return rows.join("; ");
}

function prompt(now: { date: string; time: string; weekday: string }, categories: Named[], lists: Named[]) {
  return [
    "You turn a to-do sentence into tasks. Reply with JSON only, in this shape:",
    '{"tasks":[{"title":string,"date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"repeat":"none"|"daily"|"weekdays"|"weekly"|"monthly","priority":"urgent"|"high"|"medium"|"low"|null,"category":string|null,"list":string|null,"type":"daily"|"weekly"|"monthly"}]}',
    `Now it is ${now.weekday} ${now.date}, ${now.time} (24-hour clock, the user's local time).`,
    `Calendar (use it for weekday names; a weekday name means the first matching day from today on, "next <weekday>" the same unless that is today): ${calendar(now.date)}.`,
    "Rules:",
    "- title: short and clear, starting with a verb when there is one, first letter capital. Keep names and details. Leave out the date, time, repeat and filler such as 'I want to', 'remind me to', 'please'.",
    "- Translate Hindi or Hinglish into a plain English title (for example 'kal 12 baje Jenis ko call karna' -> 'Call Jenis', tomorrow 12:00).",
    "- date: the day the task is for, as YYYY-MM-DD, worked out from 'today', 'tomorrow', weekday names, 'next week', calendar dates and so on. null when no day is mentioned.",
    "- time: 24-hour HH:MM when a time is mentioned ('12 pm' -> 12:00, 'evening' -> 18:00, 'morning' -> 09:00, 'night' -> 21:00, 'noon' -> 12:00). A bare hour from 1 to 6 means the afternoon. null when no time is mentioned.",
    "- repeat: only when the sentence says so ('every day', 'every Monday', 'weekly'), otherwise 'none'.",
    "- priority: only when the sentence says it is urgent or important, otherwise null.",
    `- category: the id of the best matching category, only if the sentence clearly fits one, otherwise null. Categories: ${JSON.stringify(categories)}.`,
    `- list: the id of a list only if the sentence names it, otherwise null. Lists: ${JSON.stringify(lists)}.`,
    "- type: 'weekly' or 'monthly' only for a goal for the whole week or month ('this week I want to finish the course'), otherwise 'daily'.",
    `- Several separate things in one sentence become separate tasks (at most ${MAX_TASKS}). One thing stays one task.`,
  ].join("\n");
}

// Keep only well-formed values; the model is helpful, not trusted
function clean(raw: unknown, now: { date: string; time: string }, categories: Named[], lists: Named[]): Task[] {
  const list = (raw && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown }).tasks))
    ? (raw as { tasks: unknown[] }).tasks : [];
  const byIdOrName = (pool: Named[], v: unknown) => {
    if (typeof v !== "string" || !v) return null;
    const s = v.trim().toLowerCase();
    const hit = pool.find((p) => p.id.toLowerCase() === s || p.name.toLowerCase() === s);
    return hit ? hit.id : null;
  };
  const out: Task[] = [];
  for (const r of list.slice(0, MAX_TASKS)) {
    if (!r || typeof r !== "object") continue;
    const t = r as Record<string, unknown>;
    let title = typeof t.title === "string" ? t.title.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    if (!title) continue;
    title = title.charAt(0).toUpperCase() + title.slice(1);
    let date = typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null;
    const time = typeof t.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : null;
    if (date && date < now.date) date = null; // never a day in the past
    if (time && !date) date = time > now.time ? now.date : addDays(now.date, 1); // a time with no day
    if (date === now.date && time && time <= now.time) date = addDays(now.date, 1);
    out.push({
      title,
      date,
      time,
      repeat: ["daily", "weekdays", "weekly", "monthly"].includes(t.repeat as string) ? t.repeat as string : "none",
      priority: ["urgent", "high", "medium", "low"].includes(t.priority as string) ? t.priority as string : null,
      category: byIdOrName(categories, t.category),
      list: byIdOrName(lists, t.list),
      type: ["weekly", "monthly"].includes(t.type as string) ? t.type as string : "daily",
    });
  }
  return out;
}

// Per-user daily cap. If the ai_usage table has not been set up yet, the cap is skipped.
async function underLimit(userId: string, day: string) {
  const { data, error } = await supabase.from("ai_usage").select("count").eq("user_id", userId).eq("day", day).maybeSingle();
  if (error) return true;
  const count = data?.count ?? 0;
  if (count >= DAILY_LIMIT) return false;
  await supabase.from("ai_usage").upsert({ user_id: userId, day, count: count + 1 }, { onConflict: "user_id,day" });
  return true;
}

async function askGroq(system: string, text: string) {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY is not set");
  let lastError = "";
  for (const m of MODELS) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: m.id,
        temperature: 0,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: text }],
        ...m.extra,
      }),
    });
    if (res.ok) {
      const body = await res.json();
      const content = body?.choices?.[0]?.message?.content ?? "{}";
      try {
        return { model: m.id, parsed: JSON.parse(content) };
      } catch {
        lastError = `${m.id}: not JSON`;
        continue;
      }
    }
    lastError = `${m.id}: ${res.status}`;
    // busy (429), retired (404) or a server problem: try the next model; anything else would fail there too
    if (res.status !== 429 && res.status !== 404 && res.status < 500) break;
  }
  throw new Error("AI unavailable (" + lastError + ")");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await supabase.auth.getUser(token);
  if (!who?.user) return json({ error: "Sign in to use this" }, 401);

  let body: { text?: string; tz?: string; categories?: Named[]; lists?: Named[] } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const text = String(body.text ?? "").trim().slice(0, MAX_TEXT);
  if (!text) return json({ error: "Nothing to read" }, 400);
  const now = localNow(body.tz || "UTC") ?? localNow("UTC")!;
  const pick = (v: unknown) => (Array.isArray(v) ? v : [])
    .filter((x) => x && typeof x.id === "string" && typeof x.name === "string")
    .slice(0, 20)
    .map((x) => ({ id: String(x.id).slice(0, 40), name: String(x.name).slice(0, 40) }));
  const categories = pick(body.categories);
  const lists = pick(body.lists);

  if (!(await underLimit(who.user.id, now.date))) return json({ error: "Daily limit reached" }, 429);

  try {
    const { model, parsed } = await askGroq(prompt(now, categories, lists), text);
    const tasks = clean(parsed, now, categories, lists);
    if (!tasks.length) return json({ error: "Could not read a task" }, 422);
    return json({ tasks, source: "ai", model });
  } catch (e) {
    console.error("parse-task", (e as Error).message);
    return json({ error: "AI unavailable" }, 503);
  }
});
