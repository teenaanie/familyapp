"use client";

// Editable drafts for what the voice panel understood. Each draft can be shown as a
// one-line summary, checked for problems, edited in a small form, and saved.

import { supabase } from "@/lib/supabase";
import { sameName } from "@/lib/match";
import { prettyDate } from "@/lib/reminderData";
import { formatRupees, rateLabel, type VegLine } from "@/lib/veg";
import type { Recurrence, ReminderKind } from "@/lib/reminders";

export interface Named {
  id: string;
  name: string;
}
export interface PayeeRef extends Named {
  staff_id: string | null;
}

export type Draft =
  | { kind: "absence"; spoken: string; staff_id: string | null; date: string; status: "absent" | "half_day" | "extra" }
  | { kind: "payment"; spoken: string; payee_id: string | null; amount: number; date: string; mode: "cash" | "upi" | "bank" | null; is_advance: boolean }
  | { kind: "new_staff"; name: string; role: string; salary: number | null; work_days: number[]; leaves: number }
  | { kind: "new_payee"; name: string; category: string; frequency: "monthly" | "weekly"; amount: number | null; due_day: number | null; note: string }
  | { kind: "reminder"; title: string; rkind: ReminderKind; date: string; recurrence: Recurrence; every_n_days: number | null }
  | { kind: "veg"; lines: VegLine[] };

export interface Lookups {
  staff: Named[];
  payees: PayeeRef[];
}

const STATUS_TEXT = { absent: "absent", half_day: "half day", extra: "extra day worked" } as const;
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REMINDER_LEADS: Record<ReminderKind, number[]> = { birthday: [1, 0], anniversary: [3, 0], bill: [3, 0], custom: [0] };
const REMINDER_ICON: Record<ReminderKind, string> = { birthday: "🎂", anniversary: "💍", bill: "🧾", custom: "📌" };

function ordinal(n: number) {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}


const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export function icon(d: Draft): string {
  switch (d.kind) {
    case "absence":
    case "new_staff":
      return "🧹";
    case "payment":
      return "💸";
    case "new_payee":
      return "🗓️";
    case "reminder":
      return REMINDER_ICON[d.rkind];
    case "veg":
      return "🥕";
  }
}

export function summary(d: Draft, l: Lookups): string {
  switch (d.kind) {
    case "absence": {
      const who = l.staff.find((s) => s.id === d.staff_id)?.name ?? d.spoken;
      return `${who} — ${STATUS_TEXT[d.status]} on ${validDate(d.date) ? prettyDate(d.date) : "?"}`;
    }
    case "payment": {
      const who = l.payees.find((p) => p.id === d.payee_id)?.name ?? d.spoken;
      return `Paid ${who} ${formatRupees(d.amount || 0)}${d.mode ? ` by ${d.mode.toUpperCase()}` : ""}${d.is_advance ? " (advance)" : ""} on ${validDate(d.date) ? prettyDate(d.date) : "?"}`;
    }
    case "new_staff":
      return `Add staff: ${d.name}${d.role ? ` (${d.role})` : ""}, ${d.salary !== null ? `${formatRupees(d.salary)}/month` : "salary not set"} · ${d.work_days.map((x) => DAY_SHORT[x]).join(" ")} · ${d.leaves} paid leave${d.leaves === 1 ? "" : "s"}`;
    case "new_payee":
      return `Pay ${d.frequency}: ${d.name}${d.amount !== null ? ` · ${formatRupees(d.amount)}` : ""}${d.frequency === "monthly" && d.due_day ? ` · due on the ${ordinal(d.due_day)}` : ""}${d.note ? ` · ${d.note}` : ""}`;
    case "reminder":
      return `Reminder: ${d.title} — ${validDate(d.date) ? prettyDate(d.date) : "?"}${
        d.recurrence === "yearly" ? ", every year" : d.recurrence === "monthly" ? ", every month" : d.recurrence === "every_n_days" ? `, every ${d.every_n_days} days` : ""
      }`;
    case "veg":
      return `Add to vegetable bill: ${d.lines.map((x) => `${x.name}${Number.isFinite(x.rate) ? ` (${rateLabel(x.rate, x.rateQty, x.rateUnit)})` : ""}`).join(", ")}`;
  }
}

/** Why this can't be saved as it stands, or null. */
export function problem(d: Draft, l: Lookups): string | null {
  switch (d.kind) {
    case "absence":
      if (!d.staff_id) return `Who is "${d.spoken}"? Pick them under Edit.`;
      return validDate(d.date) ? null : "Pick a date";
    case "payment":
      if (!d.payee_id) return `Who is "${d.spoken}"? Pick them under Edit, or add them under Monthly payments first.`;
      if (!(d.amount > 0)) return "Enter the amount";
      return validDate(d.date) ? null : "Pick a date";
    case "new_staff": {
      if (!d.name.trim()) return "Enter a name";
      const dup = l.staff.find((s) => sameName(s.name, d.name));
      return dup ? `${dup.name} is already on your staff list` : null;
    }
    case "new_payee": {
      if (!d.name.trim()) return "Enter a name";
      const dup = l.payees.find((p) => sameName(p.name, d.name));
      return dup ? `"${dup.name}" is already in Monthly payments — rename this one under Edit` : null;
    }
    case "reminder":
      if (!d.title.trim()) return "Enter what to remind you about";
      return validDate(d.date) ? null : "Pick a date";
    case "veg":
      return null;
  }
}

export async function save(d: Draft, householdId: string): Promise<void> {
  const check = <T,>(r: { error: { message: string } | null; data?: T | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  };
  switch (d.kind) {
    case "absence":
      check(await supabase.from("attendance").upsert({ staff_id: d.staff_id, household_id: householdId, day: d.date, status: d.status }));
      return;
    case "payment":
      check(
        await supabase.from("payments").insert({
          household_id: householdId,
          payee_id: d.payee_id,
          for_month: `${d.date.slice(0, 7)}-01`,
          amount: d.amount,
          paid_on: d.date,
          mode: d.mode,
          is_advance: d.is_advance,
        }),
      );
      return;
    case "new_staff": {
      const row = check<{ id: string }>(
        await supabase
          .from("staff")
          .insert({
            household_id: householdId,
            name: d.name.trim(),
            role: d.role.trim() || null,
            monthly_salary: d.salary ?? 0,
            work_days: [...d.work_days].sort(),
            paid_leaves_per_month: d.leaves,
          })
          .select("id")
          .single(),
      );
      // Same as adding staff by hand: they also appear in Monthly payments, salary from attendance.
      check(await supabase.from("payees").insert({ household_id: householdId, name: d.name.trim(), category: d.role.trim() || "Staff", staff_id: row.id }));
      return;
    }
    case "new_payee":
      check(
        await supabase.from("payees").insert({
          household_id: householdId,
          name: d.name.trim(),
          category: d.category.trim() || null,
          expected_amount: d.amount,
          due_day: d.frequency === "monthly" ? d.due_day : null,
          frequency: d.frequency,
          note: d.note.trim() || null,
        }),
      );
      return;
    case "reminder":
      check(
        await supabase.from("reminders").insert({
          household_id: householdId,
          title: d.title.trim(),
          kind: d.rkind,
          due_date: d.date,
          recurrence: d.recurrence,
          every_n_days: d.recurrence === "every_n_days" ? Math.max(1, d.every_n_days ?? 30) : null,
          lead_days: REMINDER_LEADS[d.rkind],
        }),
      );
      return;
    case "veg": {
      // The open bill lives on this device; the bill page picks these up when opened.
      const existing = JSON.parse(localStorage.getItem("veg.bill") ?? "[]");
      localStorage.setItem("veg.bill", JSON.stringify([...existing, ...d.lines]));
      return;
    }
  }
}

// ───────────── Edit forms ─────────────

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

function F({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-ink-soft ${wide ? "col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}

function Chips<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className={`rounded-lg px-3 py-1.5 text-sm ${value === o.v ? "bg-accent text-white" : "bg-muted text-ink-soft"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DraftEditor({ draft, lookups, onChange }: { draft: Draft; lookups: Lookups; onChange: (d: Draft) => void }) {
  const d = draft;
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch } as Draft);

  switch (d.kind) {
    case "absence":
      return (
        <div className="grid grid-cols-2 gap-3">
          <F label="Who">
            <select value={d.staff_id ?? ""} onChange={(e) => set({ staff_id: e.target.value || null })} className="input">
              <option value="">Choose…</option>
              {lookups.staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </F>
          <F label="Date">
            <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} className="input" />
          </F>
          <F label="What happened" wide>
            <Chips
              value={d.status}
              onChange={(v) => set({ status: v })}
              options={[
                { v: "absent", label: "Absent" },
                { v: "half_day", label: "Half day" },
                { v: "extra", label: "Extra day worked" },
              ]}
            />
          </F>
        </div>
      );
    case "payment":
      return (
        <div className="grid grid-cols-2 gap-3">
          <F label="Paid to" wide>
            <select value={d.payee_id ?? ""} onChange={(e) => set({ payee_id: e.target.value || null })} className="input">
              <option value="">Choose…</option>
              {lookups.payees.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </F>
          <F label="Amount (₹)">
            <input inputMode="decimal" value={Number.isFinite(d.amount) ? String(d.amount) : ""} onChange={(e) => set({ amount: Number(e.target.value) })} className="input" />
          </F>
          <F label="Paid on">
            <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} className="input" />
          </F>
          <F label="How" wide>
            <Chips
              value={d.mode ?? "none"}
              onChange={(v) => set({ mode: v === "none" ? null : v })}
              options={[
                { v: "upi", label: "UPI" },
                { v: "cash", label: "Cash" },
                { v: "bank", label: "Bank" },
                { v: "none", label: "Not said" },
              ]}
            />
          </F>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.is_advance} onChange={(e) => set({ is_advance: e.target.checked })} />
            This was an advance
          </label>
        </div>
      );
    case "new_staff":
      return (
        <div className="grid grid-cols-2 gap-3">
          <F label="Name">
            <input value={d.name} onChange={(e) => set({ name: e.target.value })} className="input" />
          </F>
          <F label="Work">
            <input value={d.role} onChange={(e) => set({ role: e.target.value })} placeholder="Maid, cook…" className="input" />
          </F>
          <F label="Monthly salary (₹)">
            <input inputMode="decimal" value={d.salary ?? ""} onChange={(e) => set({ salary: numOrNull(e.target.value) })} className="input" />
          </F>
          <F label="Paid leaves / month">
            <input inputMode="decimal" value={d.leaves} onChange={(e) => set({ leaves: Number(e.target.value) || 0 })} className="input" />
          </F>
          <F label="Working days" wide>
            <div className="flex flex-wrap gap-1.5">
              {DAY_SHORT.map((name, i) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => set({ work_days: d.work_days.includes(i) ? d.work_days.filter((x) => x !== i) : [...d.work_days, i] })}
                  className={`rounded-lg px-3 py-1.5 text-sm ${d.work_days.includes(i) ? "bg-accent text-white" : "bg-muted text-ink-soft"}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </F>
        </div>
      );
    case "new_payee":
      return (
        <div className="grid grid-cols-2 gap-3">
          <F label="Name">
            <input value={d.name} onChange={(e) => set({ name: e.target.value })} className="input" />
          </F>
          <F label="Type">
            <input value={d.category} onChange={(e) => set({ category: e.target.value })} placeholder="Donation, classes…" className="input" />
          </F>
          <F label="How often" wide>
            <Chips
              value={d.frequency}
              onChange={(v) => set({ frequency: v })}
              options={[
                { v: "monthly", label: "Every month" },
                { v: "weekly", label: "Every week" },
              ]}
            />
          </F>
          <F label={`Usual amount per ${d.frequency === "weekly" ? "week" : "month"} (₹)`}>
            <input inputMode="decimal" value={d.amount ?? ""} onChange={(e) => set({ amount: numOrNull(e.target.value) })} placeholder="Blank if it varies" className="input" />
          </F>
          {d.frequency === "monthly" ? (
            <F label="Due on day">
              <input inputMode="numeric" value={d.due_day ?? ""} onChange={(e) => set({ due_day: numOrNull(e.target.value) })} placeholder="1–31" className="input" />
            </F>
          ) : (
            <span />
          )}
          <F label="Note" wide>
            <input value={d.note} onChange={(e) => set({ note: e.target.value })} className="input" />
          </F>
        </div>
      );
    case "reminder":
      return (
        <div className="grid grid-cols-2 gap-3">
          <F label="What" wide>
            <input value={d.title} onChange={(e) => set({ title: e.target.value })} className="input" />
          </F>
          <F label="Type" wide>
            <Chips
              value={d.rkind}
              onChange={(v) => set({ rkind: v })}
              options={[
                { v: "birthday", label: "🎂 Birthday" },
                { v: "anniversary", label: "💍 Anniversary" },
                { v: "bill", label: "🧾 Bill" },
                { v: "custom", label: "📌 Other" },
              ]}
            />
          </F>
          <F label={d.rkind === "birthday" ? "Date of birth" : "Date"}>
            <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} className="input" />
          </F>
          <F label="Repeats">
            <select value={d.recurrence} onChange={(e) => set({ recurrence: e.target.value as Recurrence })} className="input">
              <option value="none">Once</option>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
              <option value="every_n_days">Every N days</option>
            </select>
          </F>
          {d.recurrence === "every_n_days" && (
            <F label="Every how many days">
              <input inputMode="numeric" value={d.every_n_days ?? ""} onChange={(e) => set({ every_n_days: numOrNull(e.target.value) })} className="input" />
            </F>
          )}
        </div>
      );
    case "veg":
      return <p className="text-sm text-ink-soft">Save to add these to your bill — you can change rates and quantities there.</p>;
  }
}
