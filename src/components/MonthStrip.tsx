"use client";

import { useEffect, useRef } from "react";
import { MONTH_NAMES } from "@/lib/pay";
import type { YearMonth } from "./MonthNav";

export interface MonthChip extends YearMonth {
  /** Small line under the month, e.g. "3 reminders" or "₹12,400 paid". */
  sub: string;
  /** Dim months with nothing in them. */
  empty?: boolean;
}

/** A row of months to jump between; scrolls sideways on phones and keeps the chosen one in view. */
export default function MonthStrip({ months, selected, onSelect }: { months: MonthChip[]; selected: YearMonth; onSelect: (m: YearMonth) => void }) {
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selected.year, selected.month]);

  const thisYear = new Date().getFullYear();
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0" role="tablist" aria-label="Months">
      <div className="flex gap-2">
        {months.map((m) => {
          const on = m.year === selected.year && m.month === selected.month;
          return (
            <button
              key={`${m.year}-${m.month}`}
              ref={on ? active : undefined}
              role="tab"
              aria-selected={on}
              onClick={() => onSelect({ year: m.year, month: m.month })}
              className={`flex min-w-24 shrink-0 flex-col items-start rounded-xl px-3 py-2 text-left transition ${
                on ? "bg-accent text-white shadow-sm" : m.empty ? "bg-surface/60 text-ink-soft" : "bg-surface text-ink shadow-sm hover:bg-muted"
              }`}
            >
              <span className="text-sm font-semibold">
                {MONTH_NAMES[m.month - 1].slice(0, 3)}
                {m.year !== thisYear ? ` ’${String(m.year).slice(2)}` : ""}
              </span>
              <span className={`text-xs ${on ? "text-white/80" : "text-ink-soft"}`}>{m.sub}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
