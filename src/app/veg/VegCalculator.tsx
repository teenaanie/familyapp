"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { supabase } from "@/lib/supabase";
import { PRODUCE, findProduce, type Produce } from "@/lib/produce";
import {
  billTotal,
  formatRupees,
  linePrice,
  roundPaise,
  type Unit,
  type VegLine,
} from "@/lib/veg";

// Until Supabase is wired up, the open bill and remembered rates live on this device.
const BILL_KEY = "veg.bill";
const RATES_KEY = "veg.rates";

type SavedRate = Pick<VegLine, "rate" | "rateQty" | "rateUnit">;

const RATE_BASES: { value: string; label: string }[] = [
  { value: "1|kg", label: "per kg" },
  { value: "500|g", label: "per 500 g" },
  { value: "250|g", label: "per 250 g" },
  { value: "100|g", label: "per 100 g" },
  { value: "1|piece", label: "per piece" },
  { value: "1|dozen", label: "per dozen" },
  { value: "1|bunch", label: "per bunch" },
];

const QTY_UNITS: Unit[] = ["g", "kg", "piece", "dozen", "bunch"];

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const newId = () => Math.random().toString(36).slice(2, 10);

function lineFor(p: Produce, saved?: SavedRate): VegLine {
  return {
    id: newId(),
    name: p.name,
    rate: saved?.rate ?? NaN,
    rateQty: saved?.rateQty ?? p.defaultRateQty,
    rateUnit: saved?.rateUnit ?? p.defaultRateUnit,
    qty: NaN,
    qtyUnit: p.defaultQtyUnit,
  };
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const show = (n: number) => (Number.isFinite(n) ? String(n) : "");

export default function VegCalculator() {
  const { householdId } = useHousehold();
  const rateTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [lines, setLines] = useState<VegLine[]>([]);
  const [rates, setRates] = useState<Record<string, SavedRate>>({});
  const [vendorSaid, setVendorSaid] = useState("");
  const [tab, setTab] = useState<"vegetable" | "fruit">("vegetable");
  const [custom, setCustom] = useState("");
  const [loaded, setLoaded] = useState(false);

  // localStorage only exists in the browser, so restore after mount to avoid a hydration mismatch.
  // NaN is saved as null, hence the `?? NaN`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(load<VegLine[]>(BILL_KEY, []).map((l) => ({ ...l, rate: l.rate ?? NaN, qty: l.qty ?? NaN })));
    setRates(load(RATES_KEY, {}));
    setLoaded(true);
  }, []);

  // Shared rates from the household override this device's copy.
  useEffect(() => {
    supabase
      .from("veg_rates")
      .select("name, rate, rate_qty, rate_unit")
      .eq("household_id", householdId)
      .then(({ data }) => {
        if (!data?.length) return;
        setRates((local) => {
          const merged = { ...local };
          for (const r of data) {
            merged[r.name] = { rate: Number(r.rate), rateQty: Number(r.rate_qty), rateUnit: r.rate_unit as Unit };
          }
          save(RATES_KEY, merged);
          return merged;
        });
      });
  }, [householdId]);

  function rememberRate(name: string, r: SavedRate) {
    clearTimeout(rateTimers.current[name]);
    rateTimers.current[name] = setTimeout(() => {
      supabase
        .from("veg_rates")
        .upsert({
          household_id: householdId,
          name,
          rate: r.rate,
          rate_qty: r.rateQty,
          rate_unit: r.rateUnit,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => error && console.warn("rate not synced", error.message));
    }, 1000);
  }

  async function saveBill() {
    const valid = lines.filter((l) => linePrice(l).ok && Number.isFinite(l.rate) && Number.isFinite(l.qty));
    if (!valid.length) return;
    setSaving(true);
    const { data: bill, error } = await supabase
      .from("veg_bills")
      .insert({
        household_id: householdId,
        total: billTotal(valid),
        vendor_asked: Number.isFinite(vendor) ? vendor : null,
      })
      .select("id")
      .single();
    if (!error && bill) {
      const { error: itemsError } = await supabase.from("veg_items").insert(
        valid.map((l) => ({
          bill_id: bill.id,
          household_id: householdId,
          name: l.name,
          rate: l.rate,
          rate_qty: l.rateQty,
          rate_unit: l.rateUnit,
          qty: l.qty,
          qty_unit: l.qtyUnit,
          price: (linePrice(l) as { price: number }).price,
        })),
      );
      if (itemsError) console.warn(itemsError.message);
    }
    setSaving(false);
    if (error) {
      setSavedMsg("Couldn't save — check your connection");
      return;
    }
    setLines([]);
    setVendorSaid("");
    setSavedMsg(`Saved bill of ${formatRupees(billTotal(valid))}`);
    setTimeout(() => setSavedMsg(null), 3000);
  }

  useEffect(() => {
    if (loaded) save(BILL_KEY, lines);
  }, [lines, loaded]);

  const total = useMemo(() => billTotal(lines), [lines]);
  const vendor = num(vendorSaid);
  const diff = Number.isFinite(vendor) ? roundPaise(vendor - total) : null;

  function add(p: Produce) {
    setLines((ls) => [...ls, lineFor(p, rates[p.name])]);
  }

  function addCustom() {
    const name = custom.trim();
    if (!name) return;
    const known = findProduce(name);
    add(
      known ?? {
        name: name[0].toUpperCase() + name.slice(1),
        category: "vegetable",
        aliases: [],
        defaultRateUnit: "kg",
        defaultRateQty: 1,
        defaultQtyUnit: "g",
      },
    );
    setCustom("");
  }

  function update(id: string, patch: Partial<VegLine>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if ("rate" in patch || "rateQty" in patch || "rateUnit" in patch) {
          if (Number.isFinite(next.rate)) {
            const saved = { rate: next.rate, rateQty: next.rateQty, rateUnit: next.rateUnit };
            const r = { ...rates, [next.name]: saved };
            setRates(r);
            save(RATES_KEY, r);
            rememberRate(next.name, saved);
          }
        }
        return next;
      }),
    );
  }

  function clearBill() {
    if (lines.length && !confirm("Clear this bill?")) return;
    setLines([]);
    setVendorSaid("");
  }

  const chips = PRODUCE.filter((p) => p.category === tab);

  return (
    <div className="flex flex-col gap-5 pb-48">
      {/* Quick pick */}
      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <div className="mb-3 flex gap-2">
          {(["vegetable", "fruit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                tab === t ? "bg-accent text-white" : "bg-muted text-ink-soft"
              }`}
            >
              {t === "vegetable" ? "Vegetables" : "Fruits"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {chips.map((p) => (
            <button
              key={p.name}
              onClick={() => add(p)}
              className="rounded-xl border border-line bg-background px-3 py-2 text-[15px] active:scale-95"
            >
              {p.name}
              {rates[p.name] && (
                <span className="ml-1.5 text-xs text-ink-soft">₹{rates[p.name].rate}</span>
              )}
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addCustom();
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Something else… (aloo, inji…)"
            className="min-w-0 flex-1 rounded-xl border border-line bg-background px-3 py-2"
          />
          <button className="rounded-xl bg-ink px-4 py-2 font-medium text-background">Add</button>
        </form>
      </section>

      {/* Lines */}
      {lines.length === 0 ? (
        <p className="px-2 text-center text-ink-soft">Tap an item above to start the bill.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {lines.map((l) => {
            const r = linePrice(l);
            const filled = Number.isFinite(l.rate) && Number.isFinite(l.qty);
            return (
              <li key={l.id} className="rounded-2xl bg-surface p-4 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold">{l.name}</h3>
                  <div className="text-right">
                    <div className="text-xl font-bold tabular-nums">
                      {filled && r.ok ? formatRupees(r.price) : "—"}
                    </div>
                    {filled && !r.ok && <div className="text-xs text-bad">{r.error}</div>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs text-ink-soft">
                    Rate (₹)
                    <div className="flex overflow-hidden rounded-xl border border-line bg-background">
                      <input
                        inputMode="decimal"
                        value={show(l.rate)}
                        onChange={(e) => update(l.id, { rate: num(e.target.value) })}
                        className="w-full min-w-0 bg-transparent px-3 py-2.5 text-lg text-ink"
                        placeholder="40"
                      />
                    </div>
                    <select
                      value={`${l.rateQty}|${l.rateUnit}`}
                      onChange={(e) => {
                        const [q, u] = e.target.value.split("|");
                        update(l.id, { rateQty: Number(q), rateUnit: u as Unit });
                      }}
                      className="rounded-lg bg-muted px-2 py-1.5 text-sm text-ink"
                    >
                      {RATE_BASES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-ink-soft">
                    Buying
                    <div className="flex overflow-hidden rounded-xl border border-line bg-background">
                      <input
                        inputMode="decimal"
                        value={show(l.qty)}
                        onChange={(e) => update(l.id, { qty: num(e.target.value) })}
                        className="w-full min-w-0 bg-transparent px-3 py-2.5 text-lg text-ink"
                        placeholder={l.qtyUnit === "g" ? "500" : "1"}
                      />
                    </div>
                    <select
                      value={l.qtyUnit}
                      onChange={(e) => update(l.id, { qtyUnit: e.target.value as Unit })}
                      className="rounded-lg bg-muted px-2 py-1.5 text-sm text-ink"
                    >
                      {QTY_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u === "g" ? "grams" : u === "kg" ? "kg" : u === "piece" ? "pieces" : u}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                  className="mt-3 text-sm text-ink-soft underline-offset-2 hover:underline"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {lines.length > 0 && (
        <div className="flex items-center justify-center gap-6">
          <button onClick={clearBill} className="text-sm text-ink-soft underline">
            Clear bill
          </button>
          <button
            onClick={saveBill}
            disabled={saving || total === 0}
            className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save bill"}
          </button>
        </div>
      )}
      {savedMsg && <p className="text-center text-sm font-medium text-good">{savedMsg}</p>}

      {/* Sticky total */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-ink-soft">
              Total · {lines.length} item{lines.length === 1 ? "" : "s"}
            </span>
            <span className="font-display text-3xl font-bold tabular-nums text-accent">{formatRupees(total)}</span>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="vendor" className="text-sm text-ink-soft">
              Vendor asked ₹
            </label>
            <input
              id="vendor"
              inputMode="decimal"
              value={vendorSaid}
              onChange={(e) => setVendorSaid(e.target.value)}
              className="w-24 rounded-lg border border-line bg-background px-2 py-1.5"
            />
            {diff !== null && (
              <span
                className={`ml-auto text-sm font-semibold ${
                  Math.abs(diff) < 1 ? "text-good" : diff > 0 ? "text-bad" : "text-good"
                }`}
              >
                {Math.abs(diff) < 1
                  ? "Matches ✓"
                  : diff > 0
                    ? `${formatRupees(diff)} extra`
                    : `${formatRupees(-diff)} less`}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
