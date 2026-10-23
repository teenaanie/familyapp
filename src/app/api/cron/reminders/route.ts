import { createClient } from "@supabase/supabase-js";
import { sendPush, type PushTarget } from "@/lib/push";
import { reminderStatus, todayIST, toDays, yearsLabel, type ReminderRule } from "@/lib/reminders";
import { daysInMonth } from "@/lib/pay";
import { formatRupees } from "@/lib/veg";

// Runs daily from Vercel Cron (see vercel.json). Sends each household member one
// notification listing today's reminders and monthly payments that are due.

const PAYMENT_LEADS = [2, 0];
const PAYMENT_NAG_DAYS = 3;

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const missing = ["SUPABASE_SECRET_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].filter((k) => !process.env[k]);
  if (missing.length) return Response.json({ error: `Missing settings: ${missing.join(", ")}` }, { status: 500 });

  // Service key: reads every household's rows. Never exposed to the browser.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

  const today = new URL(request.url).searchParams.get("date") ?? todayIST();
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [reminders, members, subs, payees, payments] = await Promise.all([
    db.from("reminders").select("id, household_id, title, kind, due_date, recurrence, every_n_days, lead_days, shared, owner_id, done_for"),
    db.from("members").select("household_id, user_id"),
    db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth"),
    db.from("payees").select("id, household_id, name, expected_amount, due_day").eq("active", true).eq("frequency", "monthly").not("due_day", "is", null),
    db.from("payments").select("payee_id, amount").eq("for_month", monthStart),
  ]);
  const err = reminders.error ?? members.error ?? subs.error ?? payees.error ?? payments.error;
  if (err) return Response.json({ error: err.message }, { status: 500 });

  // user id → lines to tell them today
  const lines = new Map<string, string[]>();
  const tell = (userId: string, line: string) => lines.set(userId, [...(lines.get(userId) ?? []), line]);
  const householdUsers = (hid: string) => (members.data ?? []).filter((x) => x.household_id === hid).map((x) => x.user_id);

  for (const r of reminders.data ?? []) {
    const s = reminderStatus(r as ReminderRule, today);
    if (!s.notifyToday) continue;
    let line: string;
    if (s.overdue) line = `${r.title} — overdue by ${s.overdue.daysLate} day${s.overdue.daysLate === 1 ? "" : "s"}`;
    else {
      const when = s.daysUntil === 0 ? "today" : s.daysUntil === 1 ? "tomorrow" : `in ${s.daysUntil} days`;
      const years = s.next ? yearsLabel(r as ReminderRule, s.next) : null;
      line = `${r.title}${years ? ` (${years})` : ""} — ${when}`;
    }
    const to = r.shared ? householdUsers(r.household_id) : [r.owner_id].filter(Boolean);
    to.forEach((u) => tell(u, line));
  }

  const paidBy = new Map<string, number>();
  for (const p of payments.data ?? []) paidBy.set(p.payee_id, (paidBy.get(p.payee_id) ?? 0) + Number(p.amount));
  for (const p of payees.data ?? []) {
    const dueDay = Math.min(p.due_day!, daysInMonth(y, m));
    const daysUntil = toDays(`${today.slice(0, 8)}${String(dueDay).padStart(2, "0")}`) - toDays(today);
    const expected = p.expected_amount === null ? null : Number(p.expected_amount);
    const paid = paidBy.get(p.id) ?? 0;
    const pending = expected === null ? paid === 0 : paid < expected;
    if (!pending) continue;
    if (!PAYMENT_LEADS.includes(daysUntil) && !(daysUntil < 0 && -daysUntil <= PAYMENT_NAG_DAYS)) continue;
    const amount = expected !== null ? ` ${formatRupees(expected - paid)}` : "";
    const when = daysUntil === 0 ? "due today" : daysUntil > 0 ? `due in ${daysUntil} days` : `${-daysUntil} day${daysUntil === -1 ? "" : "s"} late`;
    householdUsers(p.household_id).forEach((u) => tell(u, `Pay ${p.name}${amount} — ${when}`));
  }

  let sent = 0;
  const gone: string[] = [];
  for (const [userId, items] of lines) {
    const targets: PushTarget[] = (subs.data ?? []).filter((s) => s.user_id === userId);
    if (!targets.length) continue;
    const result = await sendPush(targets, {
      title: items.length === 1 ? items[0].split(" — ")[0] : `${items.length} reminders today`,
      body: items.length === 1 ? items[0].split(" — ").slice(1).join(" — ") : items.join("\n"),
      url: "/reminders",
      tag: `daily-${today}`,
    });
    sent += result.sent;
    gone.push(...result.gone);
  }
  if (gone.length) await db.from("push_subscriptions").delete().in("id", gone);

  return Response.json({ date: today, users: lines.size, sent, removed: gone.length });
}
