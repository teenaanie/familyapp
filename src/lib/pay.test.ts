import { test } from "node:test";
import assert from "node:assert/strict";
import { monthPay, workingDaysInMonth, daysInMonth } from "./pay.ts";

const MON_SAT = [1, 2, 3, 4, 5, 6];
const terms = { monthlySalary: 9000, workDays: MON_SAT, paidLeavesPerMonth: 2 };

test("month lengths incl. leap February", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 10), 31);
});

test("working days Mon–Sat", () => {
  // October 2026: 1st is a Thursday, 31 days, 4 Sundays.
  assert.equal(workingDaysInMonth(2026, 10, MON_SAT), 27);
  assert.equal(workingDaysInMonth(2026, 10, [0, 1, 2, 3, 4, 5, 6]), 31);
});

test("no absences = full salary", () => {
  assert.equal(monthPay(terms, 2026, 10, []).payable, 9000);
});

test("absences within paid leave are free", () => {
  const s = monthPay(terms, 2026, 10, ["absent", "absent"]);
  assert.equal(s.unpaidLeaveDays, 0);
  assert.equal(s.payable, 9000);
});

test("extra leave is deducted per working day", () => {
  // 4 absences, 2 paid → 2 unpaid × 9000/27 = 666.67 → 667
  const s = monthPay(terms, 2026, 10, ["absent", "absent", "absent", "absent"]);
  assert.equal(s.unpaidLeaveDays, 2);
  assert.equal(s.deduction, 667);
  assert.equal(s.payable, 8333);
});

test("half days count as half", () => {
  const s = monthPay(terms, 2026, 10, ["absent", "absent", "half_day", "half_day", "half_day"]);
  assert.equal(s.leaveDays, 3.5);
  assert.equal(s.unpaidLeaveDays, 1.5);
  assert.equal(s.deduction, 500);
});

test("extra days add pay", () => {
  const s = monthPay({ ...terms, paidLeavesPerMonth: 0 }, 2026, 10, ["extra"]);
  assert.equal(s.extraPay, 333);
  assert.equal(s.payable, 9333);
});
