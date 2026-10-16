"use client";

import Link from "next/link";
import { useState } from "react";
import MicButton from "./MicButton";
import { useHousehold } from "./HouseholdProvider";
import { DraftEditor, icon, problem, save, summary, type Draft, type Lookups } from "./voiceDrafts";
import { supabase } from "@/lib/supabase";
import { matchName } from "@/lib/match";
import { findProduce } from "@/lib/produce";
import type { VoiceResult } from "@/lib/voice";

type Scope = "any" | "staff" | "payments" | "reminders";

/** What each page's mic is allowed to save. */
const ALLOWED: Record<Scope, Draft["kind"][]> = {
  any: ["absence", "payment", "new_payee", "new_staff", "reminder", "veg"],
  staff: ["absence", "new_staff"],
  payments: ["payment", "new_payee", "new_staff"],
  reminders: ["reminder"],
};

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

interface Item {
  key: string;
  draft: Draft;
  checked: boolean;
  editing: boolean;
}

/** Turns the parsed result into editable drafts, matching spoken names to people already added. */
function toDrafts(r: VoiceResult, l: Lookups): Draft[] {
  const drafts: Draft[] = [];
  for (const a of r.absences) {
    drafts.push({ kind: "absence", spoken: a.staff_name, staff_id: matchName(a.staff_name, l.staff, (s) => s.name)?.id ?? null, date: a.date, status: a.status });
  }
  for (const p of r.payments) {
    // A staff member's name should find their salary payee too.
    const staff = matchName(p.payee_name, l.staff, (s) => s.name);
    const payee = matchName(p.payee_name, l.payees, (x) => x.name) ?? (staff ? l.payees.find((x) => x.staff_id === staff.id) : undefined);
    drafts.push({ kind: "payment", spoken: p.payee_name, payee_id: payee?.id ?? null, amount: p.amount, date: p.date, mode: p.mode, is_advance: p.is_advance });
  }
  for (const n of r.new_staff) {
    drafts.push({
      kind: "new_staff",
      name: n.name,
      role: n.role ?? "",
      salary: n.monthly_salary,
      work_days: n.work_days?.length ? n.work_days : [1, 2, 3, 4, 5, 6],
      leaves: n.paid_leaves ?? 2,
    });
  }
  for (const n of r.new_payees) {
    drafts.push({
      kind: "new_payee",
      name: n.name,
      category: n.category ?? "",
      frequency: n.frequency,
      amount: n.amount,
      due_day: n.due_day && n.due_day >= 1 && n.due_day <= 31 ? Math.round(n.due_day) : null,
      note: n.note ?? "",
    });
  }
  for (const m of r.reminders) {
    drafts.push({ kind: "reminder", title: m.title, rkind: m.kind, date: m.date, recurrence: m.recurrence, every_n_days: m.every_n_days });
  }
  if (r.veg_items.length) {
    drafts.push({
      kind: "veg",
      lines: r.veg_items.map((v, i) => ({
        id: `v${Date.now()}${i}`,
        name: findProduce(v.name)?.name ?? v.name,
        rate: v.rate ?? NaN,
        rateQty: v.rate_qty,
        rateUnit: v.rate_unit,
        qty: v.qty ?? NaN,
        qtyUnit: v.qty_unit,
      })),
    });
  }
  return drafts;
}

/**
 * Voice panel: one sentence can mark leave, record payments, add people, reminders and veg
 * items. Everything understood is listed for checking and editing before it's saved.
 */
export default function VoiceCommand({ scope = "any", onSaved }: { scope?: Scope; onSaved?: () => void }) {
  const { householdId } = useHousehold();
  const [heard, setHeard] = useState<{ text: string; unclear: string | null } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ staff: [], payees: [] });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function onResult(text: string, r: VoiceResult) {
    // Fresh names each time, so someone added a moment ago is recognised.
    const [{ data: staff }, { data: payees }] = await Promise.all([
      supabase.from("staff").select("id, name").eq("household_id", householdId).eq("active", true).order("name"),
      supabase.from("payees").select("id, name, staff_id").eq("household_id", householdId).eq("active", true).order("name"),
    ]);
    const l: Lookups = { staff: staff ?? [], payees: payees ?? [] };
    const drafts = toDrafts(r, l).filter((d) => ALLOWED[scope].includes(d.kind));
    setLookups(l);
    setItems(drafts.map((d, i) => ({ key: `${d.kind}${i}`, draft: d, checked: !problem(d, l), editing: false })));
    setHeard({ text, unclear: r.unclear });
    setDone(null);
  }

  function update(key: string, patch: Partial<Item>) {
    setItems((its) =>
      its.map((it) => {
        if (it.key !== key) return it;
        const next = { ...it, ...patch };
        // Fixing a problem under Edit ticks the item; one that still has a problem can't be ticked.
        if (patch.draft) {
          const before = problem(it.draft, lookups);
          const after = problem(patch.draft, lookups);
          if (after) next.checked = false;
          else if (before) next.checked = true;
        }
        return next;
      }),
    );
  }

  async function apply() {
    setBusy(true);
    const failed: string[] = [];
    for (const it of items) {
      if (!it.checked || problem(it.draft, lookups)) continue;
      try {
        await save(it.draft, householdId);
      } catch (e) {
        failed.push(`${summary(it.draft, lookups)}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    onSaved?.();
    const savedVeg = items.some((it) => it.checked && it.draft.kind === "veg");
    setHeard(null);
    setItems([]);
    setDone(failed.length ? `Some things didn't save: ${failed.join("; ")}` : savedVeg ? "Saved. Vegetables added to your bill." : "Saved.");
  }

  const toSave = items.filter((it) => it.checked && !problem(it.draft, lookups)).length;

  return (
    <section className="rounded-2xl bg-highlight-soft p-4 shadow-sm md:p-5">
      <MicButton mode={scope} label={COPY[scope].label} hint={COPY[scope].hint} onResult={onResult} />

      {heard && (
        <div className="mt-4 rounded-xl bg-surface p-4">
          <p className="text-sm text-ink-soft">
            From: <span className="italic text-ink">&ldquo;{heard.text}&rdquo;</span>
          </p>
          {items.length === 0 ? (
            <p className="mt-2 text-sm">{heard.unclear ?? "I couldn't find anything to save in that. Try again?"}</p>
          ) : (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">Check before saving — tap Edit to change anything</p>
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {items.map((it) => {
                  const issue = problem(it.draft, lookups);
                  return (
                    <li key={it.key} className="py-2.5">
                      <div className="flex items-start gap-3">
                        {issue ? (
                          <span className="mt-0.5 w-4 text-center text-bad" aria-label="Needs attention">⚠︎</span>
                        ) : (
                          <input
                            type="checkbox"
                            aria-label="Save this"
                            className="mt-1 h-4 w-4 accent-[var(--accent)]"
                            checked={it.checked}
                            onChange={(e) => update(it.key, { checked: e.target.checked })}
                          />
                        )}
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="mr-1">{icon(it.draft)}</span>
                          {summary(it.draft, lookups)}
                          {issue && <span className="block text-xs text-bad">{issue}</span>}
                        </span>
                        {it.draft.kind !== "veg" && (
                          <button
                            onClick={() => update(it.key, { editing: !it.editing })}
                            className={`shrink-0 rounded-lg px-3 py-1 text-sm font-medium ${it.editing ? "bg-accent text-white" : "bg-muted"}`}
                          >
                            {it.editing ? "Done" : "Edit"}
                          </button>
                        )}
                      </div>
                      {it.editing && (
                        <div className="mt-3 ml-7 rounded-xl bg-muted/60 p-3">
                          <DraftEditor draft={it.draft} lookups={lookups} onChange={(d) => update(it.key, { draft: d })} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {heard.unclear && <p className="mt-2 text-xs text-ink-soft">Note: {heard.unclear}</p>}
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={apply}
                  disabled={busy || toSave === 0}
                  className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50"
                >
                  {busy ? "Saving…" : `Save ${toSave} item${toSave === 1 ? "" : "s"}`}
                </button>
                <button
                  onClick={() => {
                    setHeard(null);
                    setItems([]);
                  }}
                  className="text-sm text-ink-soft underline"
                >
                  Discard
                </button>
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
