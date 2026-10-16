// Vegetable/fruit bill maths. All arithmetic lives here — the AI only extracts
// numbers, it never computes prices.

export type Unit = "kg" | "g" | "piece" | "dozen" | "bunch";

export const UNIT_LABEL: Record<Unit, string> = {
  kg: "kg",
  g: "g",
  piece: "pc",
  dozen: "dozen",
  bunch: "bunch",
};

const WEIGHT_UNITS: Unit[] = ["kg", "g"];

export function isWeight(unit: Unit): boolean {
  return WEIGHT_UNITS.includes(unit);
}

/** Convert an amount to its base unit: grams for weight, pieces for count. */
export function toBase(amount: number, unit: Unit): number {
  switch (unit) {
    case "kg":
      return amount * 1000;
    case "g":
      return amount;
    case "dozen":
      return amount * 12;
    case "piece":
    case "bunch":
      return amount;
  }
}

export interface VegLine {
  id: string;
  name: string;
  /** Price the vendor quotes, e.g. ₹40 … */
  rate: number;
  /** … for this much, e.g. 1 kg or 250 g or 1 piece. */
  rateQty: number;
  rateUnit: Unit;
  /** What you are actually buying. */
  qty: number;
  qtyUnit: Unit;
}

export type LineResult =
  | { ok: true; price: number }
  | { ok: false; error: string };

export function roundPaise(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function linePrice(line: VegLine): LineResult {
  const { rate, rateQty, rateUnit, qty, qtyUnit } = line;
  if (!(rate >= 0) || !(qty >= 0) || !(rateQty > 0)) {
    return { ok: false, error: "Enter rate and quantity" };
  }
  // Bunches only compare with bunches; pieces/dozens with each other.
  const sameKind =
    isWeight(rateUnit) === isWeight(qtyUnit) &&
    (rateUnit === "bunch") === (qtyUnit === "bunch");
  if (!sameKind) {
    return {
      ok: false,
      error: `Rate is per ${UNIT_LABEL[rateUnit]} but quantity is in ${UNIT_LABEL[qtyUnit]}`,
    };
  }
  const price = (rate * toBase(qty, qtyUnit)) / toBase(rateQty, rateUnit);
  return { ok: true, price: roundPaise(price) };
}

export function billTotal(lines: VegLine[]): number {
  return roundPaise(
    lines.reduce((sum, l) => {
      const r = linePrice(l);
      return r.ok ? sum + r.price : sum;
    }, 0),
  );
}

export function formatRupees(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

/** Short label for a rate, e.g. "₹40 / kg", "₹15 / 250 g". */
export function rateLabel(rate: number, rateQty: number, rateUnit: Unit): string {
  const qty = rateQty === 1 ? "" : `${rateQty} `;
  return `${formatRupees(rate)} / ${qty}${UNIT_LABEL[rateUnit]}`;
}
