// Staff salary maths from attendance. Pure functions, unit-tested.

export type AttendanceStatus = "absent" | "half_day" | "extra";

export interface StaffTerms {
  monthlySalary: number;
  /** 0 = Sunday … 6 = Saturday */
  workDays: number[];
  paidLeavesPerMonth: number;
}

export interface PaySummary {
  workingDays: number;
  /** Absent days, half-days count as 0.5. */
  leaveDays: number;
  unpaidLeaveDays: number;
  extraDays: number;
  perDay: number;
  deduction: number;
  extraPay: number;
  payable: number;
}

/** month is 1–12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function workingDaysInMonth(year: number, month: number, workDays: number[]): number {
  let n = 0;
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    if (workDays.includes(weekday(year, month, d))) n++;
  }
  return n;
}

export function monthPay(
  terms: StaffTerms,
  year: number,
  month: number,
  statuses: AttendanceStatus[],
): PaySummary {
  const workingDays = workingDaysInMonth(year, month, terms.workDays);
  let leaveDays = 0;
  let extraDays = 0;
  for (const s of statuses) {
    if (s === "absent") leaveDays += 1;
    else if (s === "half_day") leaveDays += 0.5;
    else if (s === "extra") extraDays += 1;
  }
  const unpaidLeaveDays = Math.max(0, leaveDays - terms.paidLeavesPerMonth);
  const perDay = workingDays ? terms.monthlySalary / workingDays : 0;
  const deduction = Math.round(unpaidLeaveDays * perDay);
  const extraPay = Math.round(extraDays * perDay);
  return {
    workingDays,
    leaveDays,
    unpaidLeaveDays,
    extraDays,
    perDay: Math.round(perDay * 100) / 100,
    deduction,
    extraPay,
    payable: Math.max(0, terms.monthlySalary - deduction + extraPay),
  };
}

/** "2026-10-01" for the first day of a month (month 1–12). */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
