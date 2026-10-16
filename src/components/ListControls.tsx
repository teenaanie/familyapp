"use client";

import { useState } from "react";

/** Sort choice remembered on this device, per list. */
export function useRememberedSort<T extends string>(key: string, options: readonly T[], fallback: T) {
  const [sort, setSort] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      return saved && options.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  function choose(s: T) {
    setSort(s);
    try {
      localStorage.setItem(key, s);
    } catch {}
  }
  return [sort, choose] as const;
}

/** Search box + sort switch, shared by lists. */
export default function ListControls<T extends string>({
  query,
  onQuery,
  placeholder,
  sort,
  onSort,
  options,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  sort: T;
  onSort: (s: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input w-full pl-10"
        />
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="shrink-0 text-ink-soft">Sort by</span>
        <div className="flex flex-wrap rounded-xl bg-muted p-1" role="group" aria-label="Sort">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => onSort(o.value)}
              aria-pressed={sort === o.value}
              className={`rounded-lg px-3 py-1.5 font-medium whitespace-nowrap ${sort === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "3 of 12 match …" line under a search box. */
export function MatchCount({ query, shown, total, noun }: { query: string; shown: number; total: number; noun: string }) {
  const q = query.trim();
  if (!q) return null;
  return (
    <p className="text-sm text-ink-soft">
      {shown ? `${shown} of ${total} ${noun} match “${q}”` : `No ${noun} match “${q}”.`}
    </p>
  );
}
