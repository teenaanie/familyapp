"use client";

import { useState } from "react";

const parse = (s: string) => (s.trim() === "" || s.trim() === "." ? NaN : Number(s.replace(",", ".")));

/**
 * Numeric input that keeps the raw text while typing, so "0." and "0.6" survive
 * (converting every keystroke to a number would drop the trailing dot).
 */
export default function DecimalInput({
  value,
  onChange,
  className,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "");
  // Adopt outside changes (e.g. a remembered rate filled in), but not our own keystrokes.
  const shown = Object.is(parse(text), value) || (Number.isNaN(value) && Number.isNaN(parse(text))) ? text : Number.isFinite(value) ? String(value) : "";

  return (
    <input
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^\d*[.,]?\d*$/.test(raw)) return; // digits and one decimal point only
        setText(raw);
        onChange(parse(raw));
      }}
    />
  );
}
