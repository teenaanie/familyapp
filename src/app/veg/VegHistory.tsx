"use client";

import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import MonthNav, { thisMonth, type YearMonth } from "@/components/MonthNav";
import { supabase } from "@/lib/supabase";
import { daysInMonth, dayKey, monthKey } from "@/lib/pay";
import { todayIST } from "@/lib/reminders";
import { formatRupees, rateLabel, UNIT_LABEL } from "@/lib/veg";
import { BILL_SAVED_EVENT, EDIT_BILL_EVENT, type SavedBill, type SavedBillItem } from "@/lib/vegBills";

type Bill = SavedBill;
type Item = SavedBillItem;

function dayHeading(iso: string) {
  const today = todayIST();
  const yesterday = new Date(Date.parse(today + "T00:00Z") - 86_400_000).toISOString().slice(0, 10);
  const label = new Date(iso + "T00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  return iso === today ? `Today · ${label}` : iso === yesterday ? `Yesterday · ${label}` : label;
}

/** Saved vegetable bills for a month, grouped by day. */
export default function VegHistory() {
  const { householdId } = useHousehold();
  const [ym, setYm] = useState<YearMonth>(thisMonth);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const reload = useCallback(() => {
    supabase
      .from("veg_bills")
      .select("id, bought_on, vendor, total, vendor_asked, veg_items(name, qty, qty_unit, rate, rate_qty, rate_unit, price)")
      .eq("household_id", householdId)
      .gte("bought_on", monthKey(ym.year, ym.month))
      .lte("bought_on", dayKey(ym.year, ym.month, daysInMonth(ym.year, ym.month)))
      .order("bought_on", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data }) =>
        setBills(
          (data ?? []).map((b) => ({
            ...b,
            total: Number(b.total),
            vendor_asked: b.vendor_asked === null ? null : Number(b.vendor_asked),
            veg_items: (b.veg_items as Item[]).map((i) => ({
              ...i,
              qty: Number(i.qty),
              rate: Number(i.rate),
              rate_qty: Number(i.rate_qty),
              price: Number(i.price),
            })),
          })),
        ),
      );
  }, [householdId, ym]);

  useEffect(reload, [reload]);
  useEffect(() => {
    window.addEventListener(BILL_SAVED_EVENT, reload);
    return () => window.removeEventListener(BILL_SAVED_EVENT, reload);
  }, [reload]);

  async function remove(b: Bill) {
    if (!confirm(`Delete the ${formatRupees(b.total)} bill from ${dayHeading(b.bought_on)}?`)) return;
    await supabase.from("veg_bills").delete().eq("id", b.id);
    reload();
  }

  const days = new Map<string, Bill[]>();
  for (const b of bills ?? []) days.set(b.bought_on, [...(days.get(b.bought_on) ?? []), b]);
  const monthTotal = (bills ?? []).reduce((s, b) => s + b.total, 0);

  return (
    <section className="mt-10 pb-44 lg:pb-16">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Past bills</h2>
          <p className="text-ink-soft">
            {bills?.length
              ? `${formatRupees(Math.round(monthTotal * 100) / 100)} on ${bills.length} bill${bills.length === 1 ? "" : "s"} this month`
              : "Saved bills appear here, by day."}
          </p>
        </div>
        <div className="md:w-80">
          <MonthNav value={ym} onChange={setYm} />
        </div>
      </div>

      {bills === null && <p className="text-ink-soft">Loading…</p>}
      {bills?.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-ink-soft">No bills saved in this month.</p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {[...days].map(([day, list]) => (
          <div key={day} className="rounded-2xl bg-surface p-4 shadow-sm">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="font-semibold">{dayHeading(day)}</h3>
              {list.length > 1 && (
                <span className="text-sm text-ink-soft">{formatRupees(list.reduce((s, b) => s + b.total, 0))}</span>
              )}
            </div>
            <ul className="divide-y divide-line">
              {list.map((b) => (
                <li key={b.id} className="py-2">
                  <button onClick={() => setOpen(open === b.id ? null : b.id)} className="flex w-full items-center gap-3 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {b.vendor ? `${b.vendor} · ` : ""}
                        {b.veg_items.map((i) => i.name).join(", ")}
                      </span>
                      {b.vendor_asked !== null && Math.abs(b.vendor_asked - b.total) >= 1 && (
                        <span className="text-xs text-bad">Vendor asked {formatRupees(b.vendor_asked)}</span>
                      )}
                    </span>
                    <span className="font-semibold tabular-nums">{formatRupees(b.total)}</span>
                    <span className="text-ink-soft">{open === b.id ? "▴" : "▾"}</span>
                  </button>
                  {open === b.id && (
                    <div className="mt-2 rounded-xl bg-muted p-3 text-sm">
                      <table className="w-full">
                        <tbody>
                          {b.veg_items.map((i, n) => (
                            <tr key={n}>
                              <td className="py-0.5">{i.name}</td>
                              <td className="py-0.5 text-ink-soft">
                                {i.qty} {UNIT_LABEL[i.qty_unit]} @ {rateLabel(i.rate, i.rate_qty, i.rate_unit)}
                              </td>
                              <td className="py-0.5 text-right tabular-nums">{formatRupees(i.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="mt-3 flex items-center gap-4">
                        <button
                          onClick={() => window.dispatchEvent(new CustomEvent(EDIT_BILL_EVENT, { detail: b }))}
                          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
                        >
                          Edit this bill
                        </button>
                        <button onClick={() => remove(b)} className="ml-auto text-xs text-bad underline">
                          Delete this bill
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
