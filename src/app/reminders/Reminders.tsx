"use client";

import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import PushSetup from "@/components/PushSetup";
import { Field } from "@/app/staff/StaffAttendance";
import { supabase } from "@/lib/supabase";
import { KIND_EMOJI, loadReminders, prettyDate, repeatLabel, type Reminder, type ReminderView } from "@/lib/reminderData";
import { occurrenceToMark, todayIST, whenLabel, yearsLabel, type Recurrence, type ReminderKind } from "@/lib/reminders";

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

  const overdue = rows?.filter((r) => r.status.overdue) ?? [];
  const soon = rows?.filter((r) => !r.status.overdue && (r.status.daysUntil ?? 99) <= 7) ?? [];
  const later = rows?.filter((r) => !r.status.overdue && (r.status.daysUntil ?? 99) > 7) ?? [];

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
        {error && <p className="text-sm text-bad">{error}</p>}
        {rows === null && <p className="text-ink-soft">Loading…</p>}
        {rows?.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-ink-soft">
            No reminders yet. Add birthdays, anniversaries and bills — you&apos;ll get a notification on the morning they&apos;re due.
          </p>
        )}
        <Group title="Needs attention" items={overdue} tone="bad" onDone={markDone} onEdit={setEditing} />
        <Group title="This week" items={soon} onDone={markDone} onEdit={setEditing} />
        <Group title="Coming up" items={later} onDone={markDone} onEdit={setEditing} />
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

function Group({
  title,
  items,
  tone,
  onDone,
  onEdit,
}: {
  title: string;
  items: ReminderView[];
  tone?: "bad";
  onDone: (r: ReminderView) => void;
  onEdit: (r: Reminder) => void;
}) {
  if (!items.length) return null;
  return (
    <section>
      <h2 className={`mb-2 text-sm font-semibold uppercase tracking-wide ${tone === "bad" ? "text-bad" : "text-ink-soft"}`}>{title}</h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((r) => {
          const s = r.status;
          const date = s.overdue?.date ?? s.next!;
          const years = yearsLabel(r, date);
          const actionable = Boolean(s.overdue) || (s.daysUntil ?? 99) <= 7;
          return (
            <li key={r.id} className="flex gap-3 rounded-2xl bg-surface p-4 shadow-sm">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-highlight-soft text-xl">{KIND_EMOJI[r.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-snug">{r.title}</h3>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      s.overdue ? "bg-bad/10 text-bad" : s.daysUntil === 0 ? "bg-highlight text-ink" : "bg-muted text-ink-soft"
                    }`}
                  >
                    {s.overdue ? `${s.overdue.daysLate}d late` : whenLabel(s.daysUntil!)}
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
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
      <h2 className="text-lg font-semibold">{reminder ? "Edit reminder" : "New reminder"}</h2>
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
