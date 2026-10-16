import { supabase } from "./supabase";
import { reminderStatus, todayIST, type ReminderRule, type ReminderStatus } from "./reminders";

export interface Reminder extends ReminderRule {
  id: string;
  title: string;
  shared: boolean;
}

export interface ReminderView extends Reminder {
  status: ReminderStatus;
}

export const KIND_EMOJI: Record<Reminder["kind"], string> = {
  birthday: "🎂",
  anniversary: "💍",
  bill: "🧾",
  custom: "📌",
};

/** Active reminders (finished one-offs dropped), soonest first, overdue at the top. */
export async function loadReminders(householdId: string): Promise<ReminderView[]> {
  const { data, error } = await supabase
    .from("reminders")
    .select("id, title, kind, due_date, recurrence, every_n_days, lead_days, done_for, shared")
    .eq("household_id", householdId);
  if (error) throw error;
  const today = todayIST();
  return (data ?? [])
    .map((r) => ({ ...(r as Reminder), status: reminderStatus(r as Reminder, today) }))
    .filter((r) => r.status.next !== null || r.status.overdue)
    .sort((a, b) => sortKey(a) - sortKey(b));
}

function sortKey(r: ReminderView) {
  return r.status.overdue ? -1000 + r.status.overdue.daysLate * -1 : (r.status.daysUntil ?? 1e6);
}

export function prettyDate(iso: string) {
  return new Date(iso + "T00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function repeatLabel(r: Pick<Reminder, "recurrence" | "every_n_days">) {
  switch (r.recurrence) {
    case "yearly":
      return "Every year";
    case "monthly":
      return "Every month";
    case "every_n_days":
      return `Every ${r.every_n_days} days`;
    default:
      return "Once";
  }
}
