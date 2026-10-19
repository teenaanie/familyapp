"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import VoiceCommand from "@/components/VoiceCommand";
import ListControls, { MatchCount, useRememberedSort } from "@/components/ListControls";
import MonthNav, { shiftMonth, thisMonth, type YearMonth } from "@/components/MonthNav";
import MonthStrip from "@/components/MonthStrip";
import { Field } from "@/app/staff/StaffAttendance";
import { supabase } from "@/lib/supabase";
import { loadStaffMonth } from "@/lib/staffData";
import { monthKey } from "@/lib/pay";
import { formatRupees } from "@/lib/veg";

interface Payee {
  id: string;
  name: string;
  category: string | null;
  expected_amount: number | null;
  due_day: number | null;
  staff_id: string | null;
  frequency: "monthly" | "weekly";
  note: string | null;
}

interface Payment {
  id: string;
  payee_id: string;
  for_month: string;
  amount: number;
  paid_on: string;
  mode: string | null;
  is_advance: boolean;
  note: string | null;
}

interface Row {
  payee: Payee;
  /** Staff: payable from attendance. Others: the fixed amount, if any. */
  expected: number | null;
  payments: Payment[];
  paid: number;
}

const MODES = ["cash", "upi", "bank"] as const;

function shortDate(iso: string) {
  return new Date(iso + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function MonthlyPayments() {
  const { householdId } = useHousehold();
  const [ym, setYm] = useState<YearMonth>(thisMonth);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [editingPayment, setEditingPayment] = useState<string | null>(null);
  const [editing, setEditing] = useState<Payee | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [sort, chooseSort] = useRememberedSort("payments.sort", ["due", "name", "pending"] as const, "due");

  // Paid per month for the month strip: the past 11 months, this month and next month.
  const stripMonths = Array.from({ length: 13 }, (_, i) => shiftMonth(thisMonth(), i - 11));
  const [paidByMonth, setPaidByMonth] = useState<Map<string, number>>(new Map());
  const loadTotals = useCallback(async () => {
    const first = stripMonths[0];
    const last = stripMonths[stripMonths.length - 1];
    const { data } = await supabase
      .from("payments")
      .select("for_month, amount")
      .eq("household_id", householdId)
      .gte("for_month", monthKey(first.year, first.month))
      .lte("for_month", monthKey(last.year, last.month));
    const totals = new Map<string, number>();
    for (const p of data ?? []) totals.set(p.for_month.slice(0, 7), (totals.get(p.for_month.slice(0, 7)) ?? 0) + Number(p.amount));
    setPaidByMonth(totals);
    // stripMonths only changes when the calendar month does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId]);

  const reload = useCallback(async () => {
    void loadTotals();
    try {
      const [{ data: payees, error: e1 }, { data: payments, error: e2 }, staff] = await Promise.all([
        supabase
          .from("payees")
          .select("id, name, category, expected_amount, due_day, staff_id, frequency, note")
          .eq("household_id", householdId)
          .eq("active", true)
          .order("due_day", { nullsFirst: false })
          .order("name"),
        supabase
          .from("payments")
          .select("id, payee_id, for_month, amount, paid_on, mode, is_advance, note")
          .eq("household_id", householdId)
          .eq("for_month", monthKey(ym.year, ym.month))
          .order("paid_on"),
        loadStaffMonth(householdId, ym.year, ym.month),
      ]);
      if (e1 || e2) throw e1 ?? e2;
      const payable = new Map(staff.map((s) => [s.staff.id, s.pay.payable]));
      setRows(
        (payees ?? []).map((p) => {
          const mine = (payments ?? [])
            .filter((x) => x.payee_id === p.id)
            .map((x) => ({ ...x, amount: Number(x.amount) }));
          return {
            payee: { ...p, expected_amount: p.expected_amount === null ? null : Number(p.expected_amount) },
            // Weekly payees have no single monthly figure; they just show what was paid this month.
            expected: p.staff_id
              ? (payable.get(p.staff_id) ?? null)
              : p.frequency === "weekly" || p.expected_amount === null
                ? null
                : Number(p.expected_amount),
            payments: mine,
            paid: mine.reduce((s, x) => s + x.amount, 0),
          };
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [householdId, ym, loadTotals]);

  useEffect(() => {
    // reload only sets state after its awaits resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function undo(p: Payment) {
    if (!confirm(`Delete payment of ${formatRupees(p.amount)} on ${shortDate(p.paid_on)}?`)) return;
    await supabase.from("payments").delete().eq("id", p.id);
    reload();
  }

  const totals = (rows ?? []).reduce(
    (t, r) => ({ expected: t.expected + (r.expected ?? r.paid), paid: t.paid + r.paid }),
    { expected: 0, paid: 0 },
  );
  const q = query.trim().toLowerCase();
  const shownRows = (rows ?? [])
    .filter((r) => !q || [r.payee.name, r.payee.category, r.payee.note].some((t) => t?.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort === "name") return byName(a, b);
      if (sort === "pending") return statusRank(a) - statusRank(b) || byDue(a, b);
      return byDue(a, b);
    });

  const pendingCount = (rows ?? []).filter((r) => r.expected !== null && r.paid < r.expected).length;

  return (
    <div className="flex flex-col gap-4 pb-16">
      <VoiceCommand scope="payments" onSaved={reload} />
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-4">
      <div className="md:w-80 md:shrink-0 md:self-center"><MonthNav value={ym} onChange={setYm} /></div>
      {rows && rows.length > 0 && (
        <dl className="grid flex-1 grid-cols-3 gap-2 text-center">
          <Stat label="Expected" value={formatRupees(totals.expected)} />
          <Stat label="Paid" value={formatRupees(totals.paid)} />
          <Stat label="Pending" value={`${pendingCount} · ${formatRupees(Math.max(0, totals.expected - totals.paid))}`} highlight={pendingCount > 0} />
        </dl>
      )}
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}
      {rows === null && <p className="text-center text-ink-soft">Loading…</p>}
      {rows?.length === 0 && editing === null && (
        <p className="text-center text-ink-soft">
          Nobody to pay yet. Staff you add under Staff attendance appear here automatically; add others below.
        </p>
      )}

      <MonthStrip
        selected={ym}
        onSelect={setYm}
        months={stripMonths.map((m) => {
          const paid = paidByMonth.get(`${m.year}-${String(m.month).padStart(2, "0")}`) ?? 0;
          return { ...m, sub: paid ? `${formatRupees(Math.round(paid))} paid` : "Nothing paid", empty: paid === 0 };
        })}
      />

      {rows && rows.length > 0 && (
        <>
          <ListControls
            query={query}
            onQuery={setQuery}
            placeholder="Search by name, type or note"
            sort={sort}
            onSort={chooseSort}
            options={[
              { value: "due", label: "Due date" },
              { value: "name", label: "Name A–Z" },
              { value: "pending", label: "Pending first" },
            ]}
          />
          <MatchCount query={query} shown={shownRows.length} total={rows.length} noun="payees" />
        </>
      )}

      <ul className="grid items-start gap-3 lg:grid-cols-2">
        {shownRows.map((r) => {
          if (editing !== "new" && editing?.id === r.payee.id) {
            return (
              <li key={r.payee.id}>
                <PayeeForm
                  payee={editing}
                  onDone={() => {
                    setEditing(null);
                    reload();
                  }}
                />
              </li>
            );
          }
          const weekly = r.payee.frequency === "weekly";
          const done = weekly ? false : r.expected !== null ? r.paid >= r.expected : r.paid > 0;
          const remaining = r.expected !== null ? Math.max(0, r.expected - r.paid) : null;
          return (
            <li key={r.payee.id} className="rounded-2xl bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{r.payee.name}</h2>
                  <p className="text-sm text-ink-soft">
                    {[
                      r.payee.category,
                      weekly ? "weekly" : r.payee.due_day ? `due on ${r.payee.due_day}` : null,
                      r.payee.staff_id ? "salary from attendance" : null,
                      r.payee.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold tabular-nums">
                    {r.expected !== null
                      ? formatRupees(r.expected)
                      : weekly && r.payee.expected_amount !== null
                        ? `${formatRupees(Number(r.payee.expected_amount))}/wk`
                        : "varies"}
                  </div>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                      weekly
                        ? "bg-muted text-ink-soft"
                        : done
                          ? "bg-good/15 text-good"
                          : r.paid > 0
                            ? "bg-amber-400/20 text-amber-700"
                            : "bg-bad/10 text-bad"
                    }`}
                  >
                    {weekly
                      ? `${formatRupees(r.paid)} this month`
                      : done
                        ? "Paid ✓"
                        : r.paid > 0
                          ? `${formatRupees(remaining ?? 0)} left`
                          : "Pending"}
                  </span>
                </div>
              </div>

              {r.payments.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-2 text-sm">
                  {r.payments.map((p) =>
                    editingPayment === p.id ? (
                      <li key={p.id}>
                        <PayForm
                          row={r}
                          payment={p}
                          forMonth={p.for_month}
                          onDone={() => {
                            setEditingPayment(null);
                            reload();
                          }}
                        />
                      </li>
                    ) : (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="tabular-nums">{formatRupees(p.amount)}</span>
                        <span className="min-w-0 text-ink-soft">
                          {shortDate(p.paid_on)}
                          {p.mode ? ` · ${p.mode.toUpperCase()}` : ""}
                          {p.is_advance ? " · advance" : ""}
                          {p.note ? ` · ${p.note}` : ""}
                        </span>
                        <span className="ml-auto flex shrink-0 gap-3">
                          <button
                            onClick={() => {
                              setPaying(null);
                              setEditingPayment(p.id);
                            }}
                            className="text-xs font-medium text-accent underline"
                          >
                            Edit
                          </button>
                          <button onClick={() => undo(p)} className="text-xs text-ink-soft underline">
                            Delete
                          </button>
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              )}

              {paying === r.payee.id ? (
                <PayForm
                  row={r}
                  forMonth={monthKey(ym.year, ym.month)}
                  defaultAmount={remaining ?? r.payee.expected_amount ?? undefined}
                  onDone={() => {
                    setPaying(null);
                    reload();
                  }}
                />
              ) : (
                <div className="mt-3 flex items-center gap-4">
                  {!done && (
                    <button onClick={() => { setEditingPayment(null); setPaying(r.payee.id); }} className="rounded-xl bg-accent px-4 py-2 font-semibold text-white">
                      Record payment
                    </button>
                  )}
                  {done && (
                    <button onClick={() => { setEditingPayment(null); setPaying(r.payee.id); }} className="text-sm text-ink-soft underline">
                      Add another payment
                    </button>
                  )}
                  {r.payee.staff_id ? (
                    <Link href="/staff" className="ml-auto rounded-lg bg-muted px-3 py-1 text-sm font-medium">
                      Edit in Staff
                    </Link>
                  ) : (
                    <button onClick={() => setEditing(r.payee)} className="ml-auto rounded-lg bg-muted px-3 py-1 text-sm font-medium">
                      Edit
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {editing === "new" ? (
        <div className="lg:w-[calc(50%-0.375rem)]">
        <PayeeForm
          payee={null}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
        </div>
      ) : (
        <button onClick={() => setEditing("new")} className="rounded-2xl border border-dashed border-line py-4 font-medium text-ink-soft hover:bg-surface lg:w-[calc(50%-0.375rem)]">
          + Add someone you pay regularly
        </button>
      )}
    </div>
  );
}

const byName = (a: Row, b: Row) => a.payee.name.localeCompare(b.payee.name, "en", { sensitivity: "base" });

/** Monthly payees by due day; weekly or undated ones after, then by name. */
const byDue = (a: Row, b: Row) => {
  const day = (r: Row) => (r.payee.frequency === "monthly" && r.payee.due_day ? r.payee.due_day : 99);
  return day(a) - day(b) || byName(a, b);
};

/** Unpaid first, then part-paid, then weekly (no fixed amount), then fully paid. */
function statusRank(r: Row) {
  if (r.payee.frequency === "weekly") return 2;
  const done = r.expected !== null ? r.paid >= r.expected : r.paid > 0;
  if (done) return 3;
  return r.paid > 0 ? 1 : 0;
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 shadow-sm ${highlight ? "bg-bad/10" : "bg-surface"}`}>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function PayForm({
  row,
  payment,
  forMonth,
  defaultAmount,
  onDone,
}: {
  row: Row;
  /** Given when editing an existing payment. */
  payment?: Payment;
  forMonth: string;
  defaultAmount?: number;
  onDone: () => void;
}) {
  const { householdId } = useHousehold();
  const [amount, setAmount] = useState(payment ? String(payment.amount) : defaultAmount ? String(defaultAmount) : "");
  const [paidOn, setPaidOn] = useState(() => payment?.paid_on ?? new Date().toLocaleDateString("en-CA"));
  // Which month's payment this is — e.g. September's salary paid on 2 October.
  const [month, setMonth] = useState(forMonth.slice(0, 7));
  const [mode, setMode] = useState<(typeof MODES)[number]>((payment?.mode as (typeof MODES)[number]) ?? "upi");
  const [advance, setAdvance] = useState(payment?.is_advance ?? false);
  const [note, setNote] = useState(payment?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(Number(amount) > 0)) return setError("Enter the amount");
    setBusy(true);
    const fields = {
      for_month: `${month || forMonth.slice(0, 7)}-01`,
      amount: Number(amount),
      paid_on: paidOn,
      mode,
      is_advance: advance,
      note: note.trim() || null,
    };
    const { error } = payment
      ? await supabase.from("payments").update(fields).eq("id", payment.id)
      : await supabase.from("payments").insert({ ...fields, household_id: householdId, payee_id: row.payee.id });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <form onSubmit={submit} className={`flex flex-col gap-3 ${payment ? "my-2 rounded-xl bg-muted/60 p-3" : "mt-3 border-t border-line pt-3"}`}>
      {payment && <p className="text-sm font-semibold">Edit payment</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)">
          <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
        </Field>
        <Field label="Paid on">
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="input" />
        </Field>
        <Field label="Counts for month">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <button
            type="button"
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3 py-1.5 text-sm ${mode === m ? "bg-ink text-background" : "bg-muted text-ink-soft"}`}
          >
            {m === "upi" ? "UPI" : m === "bank" ? "Bank" : "Cash"}
          </button>
        ))}
        {row.payee.staff_id && (
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
            Advance
          </label>
        )}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="input" />
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : payment ? "Save changes" : "Save payment"}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-ink-soft underline">Cancel</button>
      </div>
    </form>
  );
}

function PayeeForm({ payee, onDone }: { payee: Payee | null; onDone: () => void }) {
  const { householdId } = useHousehold();
  const [name, setName] = useState(payee?.name ?? "");
  const [category, setCategory] = useState(payee?.category ?? "");
  const [amount, setAmount] = useState(payee?.expected_amount != null ? String(payee.expected_amount) : "");
  const [dueDay, setDueDay] = useState(payee?.due_day ? String(payee.due_day) : "");
  const [frequency, setFrequency] = useState<Payee["frequency"]>(payee?.frequency ?? "monthly");
  const [note, setNote] = useState(payee?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const day = Number(dueDay);
    const row = {
      name: name.trim(),
      category: category.trim() || null,
      expected_amount: amount.trim() ? Number(amount) : null,
      due_day: frequency === "monthly" && day >= 1 && day <= 31 ? day : null,
      frequency,
      note: note.trim() || null,
    };
    const { error } = payee
      ? await supabase.from("payees").update(row).eq("id", payee.id)
      : await supabase.from("payees").insert({ ...row, household_id: householdId });
    if (error) setError(error.message);
    else onDone();
  }

  async function remove() {
    if (!payee || !confirm(`Stop tracking ${payee.name}? Past payments are kept.`)) return;
    await supabase.from("payees").update({ active: false }).eq("id", payee.id);
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm ring-2 ring-accent/30">
      <h2 className="text-lg font-semibold">{payee ? `Edit ${payee.name}` : "Add someone you pay regularly"}</h2>
      <Field label="Name">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi (gardener)" className="input" />
      </Field>
      <Field label="Type">
        <input value={category} onChange={(e) => setCategory(e.target.value)} list="payee-cats" placeholder="Gardener, dry cleaner, newspaper…" className="input" />
        <datalist id="payee-cats">
          {["Gardener", "Dry cleaner", "Cleaner", "Newspaper", "Milk", "Maintenance", "Car wash", "Internet", "Other"].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="How often">
        <div className="flex gap-1.5">
          {(["monthly", "weekly"] as const).map((f) => (
            <button
              type="button"
              key={f}
              onClick={() => setFrequency(f)}
              className={`rounded-lg px-3 py-1.5 text-sm ${frequency === f ? "bg-accent text-white" : "bg-muted text-ink-soft"}`}
            >
              {f === "monthly" ? "Every month" : "Every week"}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Usual amount per ${frequency === "weekly" ? "week" : "month"} (₹)`}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Blank if it varies" className="input" />
        </Field>
        {frequency === "monthly" && (
          <Field label="Due on day">
            <input inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="1–31" className="input" />
          </Field>
        )}
      </div>
      <Field label="Note (optional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ₹2,000–3,000 a week" className="input" />
      </Field>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex items-center gap-3">
        <button className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white">Save</button>
        <button type="button" onClick={onDone} className="text-sm text-ink-soft underline">Cancel</button>
        {payee && (
          <button type="button" onClick={remove} className="ml-auto text-sm text-bad underline">Remove</button>
        )}
      </div>
    </form>
  );
}
