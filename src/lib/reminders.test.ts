import { test } from "node:test";
import assert from "node:assert/strict";
import {
  occurrenceOnOrAfter,
  previousOccurrence,
  reminderStatus,
  occurrenceToMark,
  yearsLabel,
  todayIST,
  type ReminderRule,
} from "./reminders.ts";

const rule = (p: Partial<ReminderRule>): ReminderRule => ({
  kind: "custom",
  due_date: "2026-10-20",
  recurrence: "none",
  every_n_days: null,
  lead_days: [0],
  done_for: null,
  ...p,
});

test("one-off in the future and past", () => {
  assert.equal(occurrenceOnOrAfter(rule({}), "2026-10-16"), "2026-10-20");
  assert.equal(occurrenceOnOrAfter(rule({}), "2026-10-21"), null);
});

test("yearly birthday rolls to this or next year", () => {
  const bday = rule({ kind: "birthday", due_date: "1956-03-12", recurrence: "yearly" });
  assert.equal(occurrenceOnOrAfter(bday, "2026-10-16"), "2027-03-12");
  assert.equal(occurrenceOnOrAfter(bday, "2027-03-12"), "2027-03-12");
  assert.equal(yearsLabel(bday, "2027-03-12"), "turns 71");
});

test("29 Feb birthday falls on 28 Feb in non-leap years", () => {
  const r = rule({ due_date: "2000-02-29", recurrence: "yearly" });
  assert.equal(occurrenceOnOrAfter(r, "2026-01-01"), "2026-02-28");
  assert.equal(occurrenceOnOrAfter(r, "2028-01-01"), "2028-02-29");
});

test("monthly bill on the 31st clamps to short months", () => {
  const r = rule({ kind: "bill", due_date: "2026-01-31", recurrence: "monthly" });
  assert.equal(occurrenceOnOrAfter(r, "2026-02-10"), "2026-02-28");
  assert.equal(occurrenceOnOrAfter(r, "2026-03-01"), "2026-03-31");
  assert.equal(occurrenceOnOrAfter(r, "2026-12-31"), "2026-12-31");
  assert.equal(occurrenceOnOrAfter(r, "2027-01-01"), "2027-01-31");
});

test("every N days", () => {
  const r = rule({ due_date: "2026-10-01", recurrence: "every_n_days", every_n_days: 10 });
  assert.equal(occurrenceOnOrAfter(r, "2026-10-16"), "2026-10-21");
  assert.equal(previousOccurrence(r, "2026-10-16"), "2026-10-11");
  assert.equal(previousOccurrence(r, "2026-10-11"), "2026-10-01");
});

test("previous occurrence never precedes the first", () => {
  const r = rule({ due_date: "2026-10-05", recurrence: "monthly" });
  assert.equal(previousOccurrence(r, "2026-10-04"), null);
  assert.equal(previousOccurrence(r, "2026-10-06"), "2026-10-05");
  assert.equal(previousOccurrence(r, "2026-11-05"), "2026-10-05");
});

test("lead days decide when to notify", () => {
  const r = rule({ kind: "bill", due_date: "2026-10-05", recurrence: "monthly", lead_days: [3, 0] });
  assert.equal(reminderStatus(r, "2026-11-02").notifyToday, true); // 3 days before
  assert.equal(reminderStatus(r, "2026-11-03").notifyToday, false);
  assert.equal(reminderStatus(r, "2026-11-05").notifyToday, true); // on the day
});

test("unpaid bill nags for a week, then stops", () => {
  const r = rule({ kind: "bill", due_date: "2026-10-05", recurrence: "monthly", lead_days: [0] });
  const s = reminderStatus(r, "2026-10-08");
  assert.deepEqual(s.overdue, { date: "2026-10-05", daysLate: 3 });
  assert.equal(s.notifyToday, true);
  assert.equal(occurrenceToMark(r, "2026-10-08"), "2026-10-05");
  assert.equal(reminderStatus(r, "2026-10-13").overdue, null);
});

test("marking paid stops the nagging and moves to next month", () => {
  const r = rule({ kind: "bill", due_date: "2026-10-05", recurrence: "monthly", done_for: "2026-10-05" });
  const s = reminderStatus(r, "2026-10-08");
  assert.equal(s.overdue, null);
  assert.equal(s.notifyToday, false);
  assert.equal(s.next, "2026-11-05");
});

test("done today skips to the following occurrence", () => {
  const r = rule({ due_date: "2026-10-16", recurrence: "monthly", done_for: "2026-10-16" });
  assert.equal(reminderStatus(r, "2026-10-16").next, "2026-11-16");
  const once = rule({ due_date: "2026-10-16", done_for: "2026-10-16" });
  assert.equal(reminderStatus(once, "2026-10-16").next, null);
});

test("birthdays are never overdue", () => {
  const r = rule({ kind: "birthday", due_date: "1990-10-10", recurrence: "yearly" });
  assert.equal(reminderStatus(r, "2026-10-12").overdue, null);
});

test("today in India crosses midnight before UTC does", () => {
  assert.equal(todayIST(new Date("2026-10-16T19:00:00Z")), "2026-10-17");
});
