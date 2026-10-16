"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import PushSetup from "@/components/PushSetup";
import VoiceCommand from "@/components/VoiceCommand";
import ListControls, { MatchCount, useRememberedSort } from "@/components/ListControls";
import { Field } from "@/app/staff/StaffAttendance";
import { supabase } from "@/lib/supabase";
import { KIND_EMOJI, loadReminders, prettyDate, repeatLabel, type Reminder, type ReminderView } from "@/lib/reminderData";
import { occurrencesBetween, occurrenceToMark, toDays, todayIST, whenLabel, yearsLabel, type Recurrence, type ReminderKind } from "@/lib/reminders";
import { daysInMonth, dayKey, monthKey, MONTH_NAMES } from "@/lib/pay";
import MonthStrip from "@/components/MonthStrip";
import { shiftMonth, type YearMonth } from "@/components/MonthNav";

const KINDS: { value: ReminderKind; label: string; repeat: Recurrence; leads: number[] }[] = [
  { value: "birthday", label: "Birthday", repeat: "yearly", leads: [1, 0] },
  { value: "anniversary", label: "Anniversary", repeat: "yearly", leads: [3, 0] },
  { value: "bill", label: "Bill", repeat: "monthly", leads: [3, 0] },
  { value: "custom", label: "Other", repeat: "none", leads: [0] },
];

const LEADS = [
  { days: 0, label: "On the day" },
  { days: 1, label: "1 day before" },
  { days: 3, label: "3 days before" },
  { days: 7, label: "1 week before" },
];

export default function Reminders() {
  const { householdId } = useHousehold();
  const [rows, setRows] = useState<ReminderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reminder | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [sort, chooseSort] = useRememberedSort("reminders.sort", ["date", "month", "name"] as const, "date");
  const [monthSel, setMonthSel] = useState<YearMonth>(() => {
    const t = todayIST();
    return { year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) };
  });

  const reload = useCallback(() => {
    loadReminders(householdId).then(setRows).catch((e) => setError(e.message));
  }, [householdId]);
  useEffect(reload, [reload]);

  async function markDone(r: ReminderView) {
    const occ = occurrenceToMark(r, todayIST());
    if (!occ) return;
    await supabase.from("reminders").update({ done_for: occ }).eq("id", r.id);
    reload();
  }

  const q = query.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !q || r.title.toLowerCase().includes(q));
  const today = todayIST();
  const thisYm = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };

  // Date view: overdue first, then each upcoming reminder under the month it's next due.
  const overdue: Entry[] = shown.filter((r) => r.status.overdue).map((r) => ({ r, date: r.status.overdue!.date }));
  const upcomingByMonth = groupByMonth(shown.filter((r) => !r.status.overdue && r.status.next).map((r) => ({ r, date: r.status.next! })));

  const byName: Entry[] = [...shown]
    .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }))
    .map((r) => ({ r, date: r.status.overdue?.date ?? r.status.next! }));

  // Month view: every occurrence over the next 12 months, so monthly bills appear in each month.
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(thisYm, i));
  const yearStart = monthKey(months[0].year, months[0].month);
  const yearEnd = dayKey(months[11].year, months[11].month, daysInMonth(months[11].year, months[11].month));
  const occurrences = groupByMonth(shown.flatMap((r) => occurrencesBetween(r, yearStart, yearEnd).map((date) => ({ r, date }))));
  const chosenKey = `${monthSel.year}-${String(monthSel.month).padStart(2, "0")}`;
  const chosen = occurrences.get(chosenKey) ?? [];

  const form = editing && (
    <ReminderForm
      reminder={editing === "new" ? null : editing}
      onDone={() => {
        setEditing(null);
        reload();
      }}
    />
  );

  return (
    <div className="grid items-start gap-6 pb-16 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <VoiceCommand scope="reminders" onSaved={reload} />
        {error && <p className="text-sm text-bad">{error}</p>}
        {rows === null && <p className="text-ink-soft">Loading…</p>}
        {rows?.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-ink-soft">
            No reminders yet. Add birthdays, anniversaries and bills — you&apos;ll get a notification on the morning they&apos;re due.
          </p>
        )}
        {rows && rows.length > 0 && (
          <ListControls
            query={query}
            onQuery={setQuery}
            placeholder="Search reminders by name"
            sort={sort}
            onSort={chooseSort}
            options={[
              { value: "date", label: "Reminder date" },
              { value: "month", label: "By month" },
              { value: "name", label: "Name A–Z" },
            ]}
          />
        )}
        <MatchCount query={query} shown={shown.length} total={rows?.length ?? 0} noun="reminders" />
        {sort === "date" && (
          <>
            <Group title="Needs attention" entries={overdue} tone="bad" onDone={markDone} onEdit={setEditing} />
            {[...upcomingByMonth].map(([key, entries]) => (
              <Group key={key} title={monthTitle(key, thisYm)} entries={entries} onDone={markDone} onEdit={setEditing} />
            ))}
          </>
        )}
        {sort === "name" && <Group title="All reminders, A–Z" entries={byName} onDone={markDone} onEdit={setEditing} />}
        {sort === "month" && rows && rows.length > 0 && (
          <>
            <MonthStrip
              selected={monthSel}
              onSelect={setMonthSel}
              months={months.map((m) => {
                const n = occurrences.get(`${m.year}-${String(m.month).padStart(2, "0")}`)?.length ?? 0;
                return { ...m, sub: n ? `${n} reminder${n === 1 ? "" : "s"}` : "None", empty: n === 0 };
              })}
            />
            {chosen.length ? (
              <Group title={monthTitle(chosenKey, thisYm)} entries={chosen} onDone={markDone} onEdit={setEditing} />
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-ink-soft">Nothing in {monthTitle(chosenKey, thisYm)}.</p>
            )}
          </>
        )}
        {/* On phones the form opens inline below the list. */}
        <div className="lg:hidden">
          {form ?? (
            <button onClick={() => setEditing("new")} className="w-full rounded-2xl border border-dashed border-line py-4 font-medium text-ink-soft">
              + Add reminder
            </button>
          )}
        </div>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        <PushSetup />
        <div className="hidden lg:block">
          {form ?? (
            <button onClick={() => setEditing("new")} className="w-full rounded-2xl bg-accent py-3 font-semibold text-white">
              + Add reminder
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

/** Entries grouped under "YYYY-MM", in date order. */
function groupByMonth(entries: Entry[]): Map<string, Entry[]> {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.r.title.localeCompare(b.r.title));
  const map = new Map<string, Entry[]>();
  for (const e of sorted) map.set(e.date.slice(0, 7), [...(map.get(e.date.slice(0, 7)) ?? []), e]);
  return map;
}

function monthTitle(key: string, now: YearMonth) {
  const [y, m] = key.split("-").map(Number);
  const name = `${MONTH_NAMES[m - 1]}${y !== now.year ? ` ${y}` : ""}`;
  return y === now.year && m === now.month ? `${name} · this month` : name;
}

interface Entry {
  r: ReminderView;
  /** The occurrence this card is about. */
  date: string;
}

function Group({
  title,
  entries,
  tone,
  onDone,
  onEdit,
}: {
  title: string;
  entries: Entry[];
  tone?: "bad";
  onDone: (r: ReminderView) => void;
  onEdit: (r: Reminder) => void;
}) {
  if (!entries.length) return null;
  const today = todayIST();
  const t = toDays(today);
  return (
    <section>
      <h2 className={`mb-2 text-sm font-semibold uppercase tracking-wide ${tone === "bad" ? "text-bad" : "text-ink-soft"}`}>{title}</h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {entries.map(({ r, date }) => {
          const s = r.status;
          const days = toDays(date) - t;
          const late = s.overdue?.date === date;
          const done = r.done_for === date;
          const years = yearsLabel(r, date);
          const actionable = !done && date === occurrenceToMark(r, today) && (late || days <= 7);
          return (
            <li key={`${r.id}-${date}`} className="flex gap-3 rounded-2xl bg-surface p-4 shadow-sm">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-highlight-soft text-xl">{KIND_EMOJI[r.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-snug">{r.title}</h3>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      late ? "bg-bad/10 text-bad" : done ? "bg-good/15 text-good" : days === 0 ? "bg-highlight text-ink" : "bg-muted text-ink-soft"
                    }`}
                  >
                    {late ? `${s.overdue!.daysLate}d late` : done ? "Done ✓" : days < 0 ? "Past" : whenLabel(days)}
                  </span>
                </div>
                <p className="text-sm text-ink-soft">
                  {[prettyDate(date), years, repeatLabel(r), r.shared ? null : "Only me"].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-2 flex items-center gap-4 text-sm">
                  {actionable && (
                    <button onClick={() => onDone(r)} className="rounded-lg bg-accent px-3 py-1 font-medium text-white">
                      {r.kind === "bill" ? "Paid" : "Done"}
                    </button>
                  )}
                  <button onClick={() => onEdit(r)} className="text-ink-soft underline">
                    Edit
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ReminderForm({ reminder, onDone }: { reminder: Reminder | null; onDone: () => void }) {
  const { householdId } = useHousehold();
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [kind, setKind] = useState<ReminderKind>(reminder?.kind ?? "birthday");
  const [date, setDate] = useState(reminder?.due_date ?? "");
  const [repeat, setRepeat] = useState<Recurrence>(reminder?.recurrence ?? "yearly");
  const [everyN, setEveryN] = useState(String(reminder?.every_n_days ?? 30));
  const [leads, setLeads] = useState<number[]>(reminder?.lead_days ?? [1, 0]);
  const [shared, setShared] = useState(reminder?.shared ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // On phones the form sits below the list; bring it into view when it opens.
  useEffect(() => {
    const el = formRef.current;
    if (el && el.offsetParent !== null) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  function pickKind(k: (typeof KINDS)[number]) {
    setKind(k.value);
    if (!reminder) {
      setRepeat(k.repeat);
      setLeads(k.leads);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!leads.length) return setError("Pick at least one time to be reminded");
    setBusy(true);
    const row = {
      title: title.trim(),
      kind,
      due_date: date,
      recurrence: repeat,
      every_n_days: repeat === "every_n_days" ? Math.max(1, Number(everyN) || 1) : null,
      lead_days: [...leads].sort((a, b) => b - a),
      shared,
    };
    const { error } = reminder
      ? await supabase.from("reminders").update({ ...row, done_for: reminder.due_date === date ? reminder.done_for : null }).eq("id", reminder.id)
      : await supabase.from("reminders").insert({ ...row, household_id: householdId });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  async function remove() {
    if (!reminder || !confirm(`Delete "${reminder.title}"?`)) return;
    await supabase.from("reminders").delete().eq("id", reminder.id);
    onDone();
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm ring-2 ring-accent/30">
      <h2 className="text-lg font-semibold">{reminder ? `Edit “${reminder.title}”` : "New reminder"}</h2>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            type="button"
            key={k.value}
            onClick={() => pickKind(k)}
            className={`rounded-lg px-3 py-1.5 text-sm ${kind === k.value ? "bg-accent text-white" : "bg-muted text-ink-soft"}`}
          >
            {KIND_EMOJI[k.value]} {k.label}
          </button>
        ))}
      </div>
      <Field label="What">
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === "birthday" ? "Amma's birthday" : kind === "bill" ? "KSEB electricity bill" : kind === "anniversary" ? "Our anniversary" : "Renew car insurance"}
          className="input"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={kind === "birthday" ? "Date of birth" : kind === "bill" ? "Next due date" : "Date"}>
          <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        <Field label="Repeats">
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Recurrence)} className="input">
            <option value="none">Once</option>
            <option value="monthly">Every month</option>
            <option value="yearly">Every year</option>
            <option value="every_n_days">Every N days</option>
          </select>
        </Field>
      </div>
      {kind === "birthday" && <p className="-mt-1 text-xs text-ink-soft">Use the real birth year to see their age; any year works otherwise.</p>}
      {repeat === "every_n_days" && (
        <Field label="Every how many days">
          <input inputMode="numeric" value={everyN} onChange={(e) => setEveryN(e.target.value.replace(/\D/g, ""))} className="input" />
        </Field>
      )}
      <Field label="Remind me">
        <div className="flex flex-wrap gap-1.5">
          {LEADS.map((l) => (
            <button
              type="button"
              key={l.days}
              onClick={() => setLeads((ls) => (ls.includes(l.days) ? ls.filter((x) => x !== l.days) : [...ls, l.days]))}
              className={`rounded-lg px-3 py-1.5 text-sm ${leads.includes(l.days) ? "bg-ink text-background" : "bg-muted text-ink-soft"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!shared} onChange={(e) => setShared(!e.target.checked)} />
        Only remind me (not the rest of the family)
      </label>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-ink-soft underline">Cancel</button>
        {reminder && (
          <button type="button" onClick={remove} className="ml-auto text-sm text-bad underline">Delete</button>
        )}
      </div>
    </form>
  );
}
