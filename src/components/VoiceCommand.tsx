"use client";

import Link from "next/link";
import { useState } from "react";
import MicButton from "./MicButton";
import { useHousehold } from "./HouseholdProvider";
import { supabase } from "@/lib/supabase";
import { matchName, sameName } from "@/lib/match";
import { findProduce } from "@/lib/produce";
import { prettyDate } from "@/lib/reminderData";
import { formatRupees, rateLabel, type VegLine } from "@/lib/veg";
import type { VoiceResult } from "@/lib/voice";

interface Named {
  id: string;
  name: string;
}

type ActionKind = "absence" | "payment" | "new_payee" | "new_staff" | "reminder" | "veg";

/** What each page's mic is allowed to save. */
const ALLOWED: Record<Scope, ActionKind[]> = {
  any: ["absence", "payment", "new_payee", "new_staff", "reminder", "veg"],
  staff: ["absence", "new_staff"],
  payments: ["payment", "new_payee", "new_staff"],
  reminders: ["reminder"],
};

type Scope = "any" | "staff" | "payments" | "reminders";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinal(n: number) {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

interface Action {
  key: string;
  kind: ActionKind;
  icon: string;
  text: string;
  /** Why it can't be saved (e.g. unknown name); shown instead of a checkbox. */
  problem?: string;
  run: () => Promise<void>;
}

const STATUS_TEXT = { absent: "absent", half_day: "half day", extra: "extra day worked" } as const;
const REMINDER_LEADS = { birthday: [1, 0], anniversary: [3, 0], bill: [3, 0], custom: [0] } as const;

const COPY = {
  any: {
    label: "Tap and tell me",
    hint: 'e.g. "Lakshmi didn\'t come today", "Paid Ravi 1500 by GPay", "Amma\'s birthday is 12 March"',
  },
  staff: {
    label: "Tap and say who was on leave",
    hint: 'e.g. "Lakshmi didn\'t come today", "Sunita half day yesterday", "Lakshmi came on Sunday"',
  },
  payments: {
    label: "Tap and say what you paid, or who you pay",
    hint: 'e.g. "Paid Ravi 1500 by GPay", "Kickboxing sir 2500 every month on the 5th"',
  },
  reminders: {
    label: "Tap and say what to remind you about",
    hint: 'e.g. "Amma\'s birthday is 12 March", "KSEB bill on the 5th every month"',
  },
} as const;

/**
 * Voice panel: one sentence can mark leave, record payments, add reminders and veg items.
 * On the staff and payments pages it focuses on that page's kind of entry.
 */
export default function VoiceCommand({ scope = "any", onSaved }: { scope?: Scope; onSaved?: () => void }) {
  const { householdId } = useHousehold();
  const [heard, setHeard] = useState<{ text: string; actions: Action[]; unclear: string | null } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function onResult(text: string, r: VoiceResult) {
    // Fresh names each time, so someone added a moment ago is recognised.
    const [{ data: staffRows }, { data: payeeRows }] = await Promise.all([
      supabase.from("staff").select("id, name").eq("household_id", householdId).eq("active", true),
      supabase.from("payees").select("id, name, staff_id").eq("household_id", householdId).eq("active", true),
    ]);
    const staff: Named[] = staffRows ?? [];
    const payees: (Named & { staff_id: string | null })[] = payeeRows ?? [];
    const actions: Action[] = [];

    r.absences.forEach((a, i) => {
      const who = matchName(a.staff_name, staff, (s) => s.name);
      actions.push({
        key: `abs${i}`,
        kind: "absence",
        icon: "🧹",
        text: `${who?.name ?? a.staff_name} — ${STATUS_TEXT[a.status]} on ${prettyDate(a.date)}`,
        problem: who ? undefined : `No staff called "${a.staff_name}"`,
        run: async () => {
          const { error } = await supabase.from("attendance").upsert({ staff_id: who!.id, household_id: householdId, day: a.date, status: a.status });
          if (error) throw error;
        },
      });
    });

    r.payments.forEach((p, i) => {
      // A staff member's name should find their salary payee too.
      const payee =
        matchName(p.payee_name, payees, (x) => x.name) ??
        (() => {
          const s = matchName(p.payee_name, staff, (x) => x.name);
          return s ? (payees.find((x) => x.staff_id === s.id) ?? null) : null;
        })();
      actions.push({
        key: `pay${i}`,
        kind: "payment",
        icon: "💸",
        text: `Paid ${payee?.name ?? p.payee_name} ${formatRupees(p.amount)}${p.mode ? ` by ${p.mode.toUpperCase()}` : ""}${p.is_advance ? " (advance)" : ""} on ${prettyDate(p.date)}`,
        problem: payee ? undefined : `No payee called "${p.payee_name}" — add them under Monthly payments`,
        run: async () => {
          const { error } = await supabase.from("payments").insert({
            household_id: householdId,
            payee_id: payee!.id,
            for_month: `${p.date.slice(0, 7)}-01`,
            amount: p.amount,
            paid_on: p.date,
            mode: p.mode,
            is_advance: p.is_advance,
          });
          if (error) throw error;
        },
      });
    });

    r.new_staff.forEach((n, i) => {
      const exists = staff.find((x) => sameName(x.name, n.name));
      const days = n.work_days?.length ? [...n.work_days].sort() : [1, 2, 3, 4, 5, 6];
      const leaves = n.paid_leaves ?? 2;
      actions.push({
        key: `staff${i}`,
        kind: "new_staff",
        icon: "🧹",
        text: `Add staff: ${n.name}${n.role ? ` (${n.role})` : ""}, ${n.monthly_salary !== null ? `${formatRupees(n.monthly_salary)}/month` : "salary not said"} · ${days.map((d) => DAY_SHORT[d]).join(" ")} · ${leaves} paid leave${leaves === 1 ? "" : "s"}`,
        problem: exists ? `${exists.name} is already on your staff list` : undefined,
        run: async () => {
          const { data, error } = await supabase
            .from("staff")
            .insert({ household_id: householdId, name: n.name, role: n.role, monthly_salary: n.monthly_salary ?? 0, work_days: days, paid_leaves_per_month: leaves })
            .select("id")
            .single();
          if (error) throw error;
          // Same as adding staff by hand: they also appear in Monthly payments, salary from attendance.
          await supabase.from("payees").insert({ household_id: householdId, name: n.name, category: n.role ?? "Staff", staff_id: data.id });
        },
      });
    });

    r.new_payees.forEach((n, i) => {
      const exists = payees.find((x) => sameName(x.name, n.name));
      const day = n.frequency === "monthly" && n.due_day && n.due_day >= 1 && n.due_day <= 31 ? Math.round(n.due_day) : null;
      actions.push({
        key: `payee${i}`,
        kind: "new_payee",
        icon: "🗓️",
        text: `Pay ${n.frequency}: ${n.name}${n.amount !== null ? ` · ${formatRupees(n.amount)}` : ""}${day ? ` · due on the ${ordinal(day)}` : ""}${n.note ? ` · ${n.note}` : ""}`,
        problem: exists ? `"${exists.name}" is already in Monthly payments` : undefined,
        run: async () => {
          const { error } = await supabase
            .from("payees")
            .insert({ household_id: householdId, name: n.name, category: n.category, expected_amount: n.amount, due_day: day, frequency: n.frequency, note: n.note });
          if (error) throw error;
        },
      });
    });

    r.reminders.forEach((m, i) => {
      actions.push({
        key: `rem${i}`,
        kind: "reminder",
        icon: { birthday: "🎂", anniversary: "💍", bill: "🧾", custom: "📌" }[m.kind],
        text: `Reminder: ${m.title} — ${prettyDate(m.date)}${m.recurrence === "yearly" ? ", every year" : m.recurrence === "monthly" ? ", every month" : m.recurrence === "every_n_days" ? `, every ${m.every_n_days} days` : ""}`,
        run: async () => {
          const { error } = await supabase.from("reminders").insert({
            household_id: householdId,
            title: m.title,
            kind: m.kind,
            due_date: m.date,
            recurrence: m.recurrence,
            every_n_days: m.recurrence === "every_n_days" ? (m.every_n_days ?? 30) : null,
            lead_days: [...REMINDER_LEADS[m.kind]],
          });
          if (error) throw error;
        },
      });
    });

    if (r.veg_items.length) {
      const lines: VegLine[] = r.veg_items.map((v, i) => ({
        id: `v${Date.now()}${i}`,
        name: findProduce(v.name)?.name ?? v.name,
        rate: v.rate ?? NaN,
        rateQty: v.rate_qty,
        rateUnit: v.rate_unit,
        qty: v.qty ?? NaN,
        qtyUnit: v.qty_unit,
      }));
      actions.push({
        key: "veg",
        kind: "veg",
        icon: "🥕",
        text: `Add to vegetable bill: ${lines.map((l) => `${l.name}${Number.isFinite(l.rate) ? ` (${rateLabel(l.rate, l.rateQty, l.rateUnit)})` : ""}`).join(", ")}`,
        run: async () => {
          // The open bill lives on this device; the bill page picks these up when opened.
          const existing = JSON.parse(localStorage.getItem("veg.bill") ?? "[]");
          localStorage.setItem("veg.bill", JSON.stringify([...existing, ...lines]));
        },
      });
    }

    const allowed = actions.filter((a) => ALLOWED[scope].includes(a.kind));
    setHeard({ text, actions: allowed, unclear: r.unclear });
    setChecked(new Set(allowed.filter((a) => !a.problem).map((a) => a.key)));
    setDone(null);
  }

  async function apply() {
    if (!heard) return;
    setBusy(true);
    const failed: string[] = [];
    for (const a of heard.actions) {
      if (!checked.has(a.key)) continue;
      try {
        await a.run();
      } catch (e) {
        failed.push(`${a.text}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    onSaved?.();
    const savedVeg = checked.has("veg");
    setHeard(null);
    setDone(failed.length ? `Some things didn't save: ${failed.join("; ")}` : savedVeg ? "Saved. Vegetables added to your bill." : "Saved.");
  }

  return (
    <section className="rounded-2xl bg-highlight-soft p-4 shadow-sm md:p-5">
      <MicButton mode={scope} label={COPY[scope].label} hint={COPY[scope].hint} onResult={onResult} />

      {heard && (
        <div className="mt-4 rounded-xl bg-surface p-4">
          <p className="text-sm text-ink-soft">
            Heard: <span className="italic text-ink">&ldquo;{heard.text}&rdquo;</span>
          </p>
          {heard.actions.length === 0 ? (
            <p className="mt-2 text-sm">{heard.unclear ?? "I couldn't find anything to save in that. Try again?"}</p>
          ) : (
            <>
              <ul className="mt-3 flex flex-col gap-2">
                {heard.actions.map((a) => (
                  <li key={a.key} className="flex items-start gap-3">
                    {a.problem ? (
                      <span className="mt-0.5 text-bad">⚠︎</span>
                    ) : (
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[var(--accent)]"
                        checked={checked.has(a.key)}
                        onChange={(e) =>
                          setChecked((c) => {
                            const n = new Set(c);
                            if (e.target.checked) n.add(a.key);
                            else n.delete(a.key);
                            return n;
                          })
                        }
                      />
                    )}
                    <span className="text-sm">
                      <span className="mr-1">{a.icon}</span>
                      {a.text}
                      {a.problem && <span className="block text-xs text-bad">{a.problem}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {heard.unclear && <p className="mt-2 text-xs text-ink-soft">Note: {heard.unclear}</p>}
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={apply}
                  disabled={busy || checked.size === 0}
                  className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Saving…" : `Save ${checked.size} item${checked.size === 1 ? "" : "s"}`}
                </button>
                <button onClick={() => setHeard(null)} className="text-sm text-ink-soft underline">Discard</button>
              </div>
            </>
          )}
        </div>
      )}

      {done && (
        <p className="mt-3 text-sm font-medium text-good">
          {done} {done.includes("bill") && <Link href="/veg" className="text-accent underline">Open bill →</Link>}
        </p>
      )}
    </section>
  );
}
