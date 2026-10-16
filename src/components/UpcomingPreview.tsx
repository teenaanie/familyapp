"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useHousehold } from "./HouseholdProvider";
import { KIND_EMOJI, loadReminders, prettyDate, type ReminderView } from "@/lib/reminderData";
import { whenLabel } from "@/lib/reminders";

export default function UpcomingPreview() {
  const { householdId } = useHousehold();
  const [rows, setRows] = useState<ReminderView[] | null>(null);

  useEffect(() => {
    loadReminders(householdId).then((r) => setRows(r.slice(0, 5))).catch(() => setRows([]));
  }, [householdId]);

  return (
    <section className="rounded-2xl bg-surface p-4 shadow-sm md:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Coming up</h2>
        <Link href="/reminders" className="text-sm text-accent underline-offset-2 hover:underline">All reminders →</Link>
      </div>
      {rows === null ? (
        <p className="mt-3 text-sm text-ink-soft">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">
          Nothing yet. <Link href="/reminders" className="text-accent underline">Add a birthday or bill</Link>.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className="text-xl">{KIND_EMOJI[r.kind]}</span>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="hidden text-sm text-ink-soft sm:inline">{prettyDate(r.status.overdue?.date ?? r.status.next!)}</span>
              <span
                className={`w-24 shrink-0 text-right text-sm font-medium ${
                  r.status.overdue ? "text-bad" : r.status.daysUntil === 0 ? "text-accent" : "text-ink-soft"
                }`}
              >
                {r.status.overdue ? `${r.status.overdue.daysLate}d late` : whenLabel(r.status.daysUntil!)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
