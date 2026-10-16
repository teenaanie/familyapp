// Reminder date rules. Pure functions on "YYYY-MM-DD" strings; unit-tested.

export type ReminderKind = "birthday" | "anniversary" | "bill" | "custom";
export type Recurrence = "none" | "monthly" | "yearly" | "every_n_days";

export interface ReminderRule {
  kind: ReminderKind;
  /** First occurrence (for birthdays, the date of birth). */
  due_date: string;
  recurrence: Recurrence;
  every_n_days: number | null;
  /** Days before an occurrence to notify, e.g. [3, 0]. */
  lead_days: number[];
  /** Occurrence already marked done / paid. */
  done_for: string | null;
}

export interface ReminderStatus {
  /** Next occurrence on or after today that isn't done, or null if finished. */
  next: string | null;
  daysUntil: number | null;
  /** An unpaid bill whose date passed in the last week. */
  overdue: { date: string; daysLate: number } | null;
  notifyToday: boolean;
}

const DAY = 86_400_000;
const OVERDUE_WINDOW = 7;

export function toDays(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export function fromDays(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

function ymd(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/** Same month/day in another month, clamped (31 Jan → 28/29 Feb, 29 Feb → 28 Feb). */
function dateIn(y: number, m: number, d: number): string {
  // Normalise month overflow first (m may be 0 or 13).
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fromDays(Math.round(first.getTime() / DAY) + Math.min(d, last) - 1);
}

/** First occurrence on or after `today` (ignoring done_for). */
export function occurrenceOnOrAfter(r: ReminderRule, today: string): string | null {
  const t = toDays(today);
  const a = toDays(r.due_date);
  if (a >= t) return r.due_date;
  const { m, d } = ymd(r.due_date);
  const now = ymd(today);
  switch (r.recurrence) {
    case "none":
      return null;
    case "yearly": {
      const thisYear = dateIn(now.y, m, d);
      return toDays(thisYear) >= t ? thisYear : dateIn(now.y + 1, m, d);
    }
    case "monthly": {
      const thisMonth = dateIn(now.y, now.m, d);
      return toDays(thisMonth) >= t ? thisMonth : dateIn(now.y, now.m + 1, d);
    }
    case "every_n_days": {
      const n = Math.max(1, r.every_n_days ?? 1);
      return fromDays(a + Math.ceil((t - a) / n) * n);
    }
  }
}

/** Most recent occurrence strictly before `today`, not before the first one. */
export function previousOccurrence(r: ReminderRule, today: string): string | null {
  const t = toDays(today);
  const a = toDays(r.due_date);
  if (a >= t) return null;
  const { m, d } = ymd(r.due_date);
  const now = ymd(today);
  let prev: string;
  switch (r.recurrence) {
    case "none":
      return r.due_date;
    case "yearly": {
      const thisYear = dateIn(now.y, m, d);
      prev = toDays(thisYear) < t ? thisYear : dateIn(now.y - 1, m, d);
      break;
    }
    case "monthly": {
      const thisMonth = dateIn(now.y, now.m, d);
      prev = toDays(thisMonth) < t ? thisMonth : dateIn(now.y, now.m - 1, d);
      break;
    }
    case "every_n_days": {
      const n = Math.max(1, r.every_n_days ?? 1);
      prev = fromDays(a + Math.floor((t - 1 - a) / n) * n);
      break;
    }
  }
  return toDays(prev) >= a ? prev : null;
}

export function reminderStatus(r: ReminderRule, today: string): ReminderStatus {
  const t = toDays(today);
  let next = occurrenceOnOrAfter(r, today);
  if (next && next === r.done_for) {
    // Today's occurrence is already done: look past it.
    next = r.recurrence === "none" ? null : occurrenceOnOrAfter(r, fromDays(toDays(next) + 1));
  }
  const daysUntil = next ? toDays(next) - t : null;

  const prev = previousOccurrence(r, today);
  const overdue =
    r.kind === "bill" && prev && prev !== r.done_for && t - toDays(prev) <= OVERDUE_WINDOW
      ? { date: prev, daysLate: t - toDays(prev) }
      : null;

  const notifyToday = Boolean(overdue) || (daysUntil !== null && r.lead_days.includes(daysUntil));
  return { next, daysUntil, overdue, notifyToday };
}

/** Which occurrence "Done" / "Paid" should mark: an overdue one first, else the next. */
export function occurrenceToMark(r: ReminderRule, today: string): string | null {
  const s = reminderStatus(r, today);
  return s.overdue?.date ?? s.next;
}

/** "turns 70" / "40 years" for birthdays and anniversaries with a real year. */
export function yearsLabel(r: ReminderRule, occurrence: string): string | null {
  if (r.kind !== "birthday" && r.kind !== "anniversary") return null;
  const born = ymd(r.due_date).y;
  const years = ymd(occurrence).y - born;
  if (born < 1900 || years <= 0) return null;
  return r.kind === "birthday" ? `turns ${years}` : `${years} years`;
}

export function whenLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  if (days < 14) return "Next week";
  return `In ${Math.round(days / 7)} weeks`;
}

/** Today's date in India, as YYYY-MM-DD. */
export function todayIST(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}
