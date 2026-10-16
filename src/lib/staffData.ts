import { supabase } from "./supabase";
import { daysInMonth, dayKey, monthKey, monthPay, type AttendanceStatus, type PaySummary } from "./pay";

export interface Staff {
  id: string;
  name: string;
  role: string | null;
  monthly_salary: number;
  work_days: number[];
  paid_leaves_per_month: number;
}

export interface StaffMonth {
  staff: Staff;
  /** day-of-month → status */
  days: Record<number, AttendanceStatus>;
  pay: PaySummary;
}

export async function loadStaffMonth(householdId: string, year: number, month: number): Promise<StaffMonth[]> {
  const [{ data: staff, error }, { data: att }] = await Promise.all([
    supabase
      .from("staff")
      .select("id, name, role, monthly_salary, work_days, paid_leaves_per_month")
      .eq("household_id", householdId)
      .eq("active", true)
      .order("created_at"),
    supabase
      .from("attendance")
      .select("staff_id, day, status")
      .eq("household_id", householdId)
      .gte("day", monthKey(year, month))
      .lte("day", dayKey(year, month, daysInMonth(year, month))),
  ]);
  if (error) throw error;
  return (staff ?? []).map((s) => {
    const staffRow: Staff = {
      ...s,
      monthly_salary: Number(s.monthly_salary),
      paid_leaves_per_month: Number(s.paid_leaves_per_month),
    };
    const days: Record<number, AttendanceStatus> = {};
    for (const a of att ?? []) {
      if (a.staff_id === s.id) days[Number(a.day.slice(8, 10))] = a.status as AttendanceStatus;
    }
    const pay = monthPay(
      {
        monthlySalary: staffRow.monthly_salary,
        workDays: staffRow.work_days,
        paidLeavesPerMonth: staffRow.paid_leaves_per_month,
      },
      year,
      month,
      Object.values(days),
    );
    return { staff: staffRow, days, pay };
  });
}
