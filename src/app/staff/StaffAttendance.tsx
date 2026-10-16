"use client";

import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import MonthNav, { thisMonth, type YearMonth } from "@/components/MonthNav";
import { supabase } from "@/lib/supabase";
import { loadStaffMonth, type Staff, type StaffMonth } from "@/lib/staffData";
import { daysInMonth, dayKey, weekday, type AttendanceStatus } from "@/lib/pay";
import { formatRupees } from "@/lib/veg";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Tapping a working day cycles present → absent → half day → present; a day off toggles "extra day worked". */
function nextStatus(current: AttendanceStatus | undefined, workingDay: boolean): AttendanceStatus | null {
  if (!workingDay) return current === "extra" ? null : "extra";
  if (!current) return "absent";
  if (current === "absent") return "half_day";
  return null;
}

export default function StaffAttendance() {
  const { householdId } = useHousehold();
  const [ym, setYm] = useState<YearMonth>(thisMonth);
  const [rows, setRows] = useState<StaffMonth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Staff | "new" | null>(null);

  const reload = useCallback(() => {
    loadStaffMonth(householdId, ym.year, ym.month)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [householdId, ym]);

  useEffect(reload, [reload]);

  async function tapDay(s: StaffMonth, day: number) {
    const working = s.staff.work_days.includes(weekday(ym.year, ym.month, day));
    const next = nextStatus(s.days[day], working);
    const key = dayKey(ym.year, ym.month, day);
    // Optimistic update, then persist.
    setRows((rs) =>
      rs!.map((r) => {
        if (r.staff.id !== s.staff.id) return r;
        const days = { ...r.days };
        if (next) days[day] = next;
        else delete days[day];
        return { ...r, days };
      }),
    );
    const { error } = next
      ? await supabase.from("attendance").upsert({ staff_id: s.staff.id, household_id: householdId, day: key, status: next })
      : await supabase.from("attendance").delete().eq("staff_id", s.staff.id).eq("day", key);
    if (error) setError(error.message);
    reload();
  }

  const today = new Date();
  const isThisMonth = today.getFullYear() === ym.year && today.getMonth() + 1 === ym.month;

  return (
    <div className="flex flex-col gap-4 pb-16">
      <MonthNav value={ym} onChange={setYm} />
      <p className="px-1 text-sm text-ink-soft">
        Everyone is present by default. Tap a day to mark <b className="text-bad">absent</b>, tap again for{" "}
        <b className="text-amber-600">half day</b>, once more to clear. Tap a day off to mark an{" "}
        <b className="text-good">extra day</b> worked.
      </p>
      {error && <p className="text-sm text-bad">{error}</p>}
      {rows === null && <p className="text-center text-ink-soft">Loading…</p>}
      {rows?.length === 0 && editing === null && (
        <p className="text-center text-ink-soft">No staff yet. Add your maid, cleaner, cook…</p>
      )}

      {rows?.map((r) => {
        const first = weekday(ym.year, ym.month, 1);
        const n = daysInMonth(ym.year, ym.month);
        return (
          <section key={r.staff.id} className="rounded-2xl bg-surface p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{r.staff.name}</h2>
                <p className="text-sm text-ink-soft">
                  {[r.staff.role, `${formatRupees(r.staff.monthly_salary)}/month`, `${r.staff.paid_leaves_per_month} paid leave${r.staff.paid_leaves_per_month === 1 ? "" : "s"}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button onClick={() => setEditing(r.staff)} className="text-sm text-ink-soft underline">
                Edit
              </button>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((d, i) => (
                <div key={i} className="pb-1 text-xs text-ink-soft">{d}</div>
              ))}
              {Array.from({ length: first }, (_, i) => <div key={`pad${i}`} />)}
              {Array.from({ length: n }, (_, i) => {
                const day = i + 1;
                const status = r.days[day];
                const working = r.staff.work_days.includes(weekday(ym.year, ym.month, day));
                const isToday = isThisMonth && day === today.getDate();
                const cls =
                  status === "absent"
                    ? "bg-bad text-white"
                    : status === "half_day"
                      ? "bg-amber-400 text-white"
                      : status === "extra"
                        ? "bg-good text-white"
                        : working
                          ? "bg-muted"
                          : "text-ink-soft/50";
                return (
                  <button
                    key={day}
                    onClick={() => tapDay(r, day)}
                    className={`aspect-square rounded-lg text-sm tabular-nums ${cls} ${isToday ? "ring-2 ring-highlight" : ""}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-muted py-2">
                <dt className="text-xs text-ink-soft">Leave</dt>
                <dd className="font-semibold">{r.pay.leaveDays} day{r.pay.leaveDays === 1 ? "" : "s"}</dd>
              </div>
              <div className="rounded-xl bg-muted py-2">
                <dt className="text-xs text-ink-soft">Deduction</dt>
                <dd className="font-semibold">
                  {r.pay.deduction ? `−${formatRupees(r.pay.deduction)}` : "—"}
                  {r.pay.extraPay ? ` +${formatRupees(r.pay.extraPay)}` : ""}
                </dd>
              </div>
              <div className="rounded-xl bg-highlight-soft py-2">
                <dt className="text-xs text-ink-soft">Payable</dt>
                <dd className="font-bold">{formatRupees(r.pay.payable)}</dd>
              </div>
            </dl>
            {r.pay.unpaidLeaveDays > 0 && (
              <p className="mt-2 text-xs text-ink-soft">
                {r.pay.unpaidLeaveDays} day{r.pay.unpaidLeaveDays === 1 ? "" : "s"} beyond paid leave × {formatRupees(r.pay.perDay)}/day ({r.pay.workingDays} working days)
              </p>
            )}
          </section>
        );
      })}

      {editing ? (
        <StaffForm
          staff={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : (
        <button onClick={() => setEditing("new")} className="rounded-2xl border border-dashed border-line py-4 font-medium text-ink-soft">
          + Add staff
        </button>
      )}
    </div>
  );
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function StaffForm({ staff, onDone }: { staff: Staff | null; onDone: () => void }) {
  const { householdId } = useHousehold();
  const [name, setName] = useState(staff?.name ?? "");
  const [role, setRole] = useState(staff?.role ?? "");
  const [salary, setSalary] = useState(staff ? String(staff.monthly_salary) : "");
  const [leaves, setLeaves] = useState(staff ? String(staff.paid_leaves_per_month) : "2");
  const [days, setDays] = useState<number[]>(staff?.work_days ?? [1, 2, 3, 4, 5, 6]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const row = {
      name: name.trim(),
      role: role.trim() || null,
      monthly_salary: Number(salary) || 0,
      paid_leaves_per_month: Number(leaves) || 0,
      work_days: [...days].sort(),
    };
    if (staff) {
      const { error } = await supabase.from("staff").update(row).eq("id", staff.id);
      if (error) return fail(error.message);
      await supabase.from("payees").update({ name: row.name }).eq("staff_id", staff.id);
    } else {
      const { data, error } = await supabase.from("staff").insert({ ...row, household_id: householdId }).select("id").single();
      if (error) return fail(error.message);
      // Every staff member also appears in Monthly payments, with salary taken from attendance.
      await supabase.from("payees").insert({ household_id: householdId, name: row.name, category: row.role ?? "Staff", staff_id: data.id });
    }
    onDone();
  }

  function fail(msg: string) {
    setBusy(false);
    setError(msg);
  }

  async function remove() {
    if (!staff || !confirm(`Remove ${staff.name}? Their past attendance and payments are kept.`)) return;
    await supabase.from("staff").update({ active: false }).eq("id", staff.id);
    await supabase.from("payees").update({ active: false }).eq("staff_id", staff.id);
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
      <h2 className="text-lg font-semibold">{staff ? `Edit ${staff.name}` : "Add staff"}</h2>
      <Field label="Name">
        <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
      </Field>
      <Field label="Work">
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Maid, cleaner, cook…" className="input" list="roles" />
        <datalist id="roles">
          {["Maid", "Cleaner", "Cook", "Gardener", "Driver", "Nanny"].map((r) => <option key={r} value={r} />)}
        </datalist>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Monthly salary (₹)">
          <input required inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} className="input" />
        </Field>
        <Field label="Paid leaves / month">
          <input inputMode="decimal" value={leaves} onChange={(e) => setLeaves(e.target.value)} className="input" />
        </Field>
      </div>
      <Field label="Working days">
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES.map((d, i) => (
            <button
              type="button"
              key={d}
              onClick={() => setDays((ds) => (ds.includes(i) ? ds.filter((x) => x !== i) : [...ds, i]))}
              className={`rounded-lg px-3 py-1.5 text-sm ${days.includes(i) ? "bg-accent text-white" : "bg-muted text-ink-soft"}`}
            >
              {d}
            </button>
          ))}
        </div>
      </Field>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-ink-soft underline">Cancel</button>
        {staff && (
          <button type="button" onClick={remove} className="ml-auto text-sm text-bad underline">Remove</button>
        )}
      </div>
    </form>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-soft">
      {label}
      {children}
    </label>
  );
}
