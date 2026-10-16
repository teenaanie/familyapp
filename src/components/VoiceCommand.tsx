"use client";

import Link from "next/link";
import { useState } from "react";
import MicButton from "./MicButton";
import { useHousehold } from "./HouseholdProvider";
import { supabase } from "@/lib/supabase";
import { matchName } from "@/lib/match";
import { findProduce } from "@/lib/produce";
import { prettyDate } from "@/lib/reminderData";
import { formatRupees, rateLabel, type VegLine } from "@/lib/veg";
import type { VoiceResult } from "@/lib/voice";

interface Named {
  id: string;
  name: string;
}

interface Action {
  key: string;
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
    label: "Tap and say what you paid",
    hint: 'e.g. "Paid Ravi 1500 by GPay", "Gave Lakshmi 2000 advance in cash"',
  },
} as const;

/**
 * Voice panel: one sentence can mark leave, record payments, add reminders and veg items.
 * On the staff and payments pages it focuses on that page's kind of entry.
 */
export default function VoiceCommand({ scope = "any", onSaved }: { scope?: "any" | "staff" | "payments"; onSaved?: () => void }) {
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

    r.reminders.forEach((m, i) => {
      actions.push({
        key: `rem${i}`,
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
        icon: "🥕",
        text: `Add to vegetable bill: ${lines.map((l) => `${l.name}${Number.isFinite(l.rate) ? ` (${rateLabel(l.rate, l.rateQty, l.rateUnit)})` : ""}`).join(", ")}`,
        run: async () => {
          // The open bill lives on this device; the bill page picks these up when opened.
          const existing = JSON.parse(localStorage.getItem("veg.bill") ?? "[]");
          localStorage.setItem("veg.bill", JSON.stringify([...existing, ...lines]));
        },
      });
    }

    setHeard({ text, actions, unclear: r.unclear });
    setChecked(new Set(actions.filter((a) => !a.problem).map((a) => a.key)));
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
