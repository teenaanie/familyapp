"use client";

import { MONTH_NAMES } from "@/lib/pay";

export interface YearMonth {
  year: number;
  month: number; // 1–12
}

export function thisMonth(): YearMonth {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function shiftMonth({ year, month }: YearMonth, by: number): YearMonth {
  const i = year * 12 + (month - 1) + by;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

export default function MonthNav({ value, onChange }: { value: YearMonth; onChange: (v: YearMonth) => void }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface px-2 py-1.5 shadow-sm">
      <button onClick={() => onChange(shiftMonth(value, -1))} className="rounded-xl px-4 py-2 text-xl" aria-label="Previous month">
        ‹
      </button>
      <span className="font-semibold">
        {MONTH_NAMES[value.month - 1]} {value.year}
      </span>
      <button onClick={() => onChange(shiftMonth(value, 1))} className="rounded-xl px-4 py-2 text-xl" aria-label="Next month">
        ›
      </button>
    </div>
  );
}
