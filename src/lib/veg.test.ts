import { test } from "node:test";
import assert from "node:assert/strict";
import { linePrice, billTotal, type VegLine } from "./veg.ts";
import { findProduce } from "./produce.ts";

const line = (p: Partial<VegLine>): VegLine => ({
  id: "x",
  name: "Tomato",
  rate: 40,
  rateQty: 1,
  rateUnit: "kg",
  qty: 1,
  qtyUnit: "kg",
  ...p,
});

const price = (p: Partial<VegLine>) => {
  const r = linePrice(line(p));
  assert.ok(r.ok, !r.ok ? r.error : "");
  return r.price;
};

test("per-kg rate, buying grams", () => {
  assert.equal(price({ rate: 40, qty: 750, qtyUnit: "g" }), 30);
  assert.equal(price({ rate: 60, qty: 300, qtyUnit: "g" }), 18);
});

test("per-250g rate, buying kg", () => {
  assert.equal(price({ rate: 15, rateQty: 250, rateUnit: "g", qty: 1, qtyUnit: "kg" }), 60);
  assert.equal(price({ rate: 15, rateQty: 250, rateUnit: "g", qty: 400, qtyUnit: "g" }), 24);
});

test("fractional kg", () => {
  assert.equal(price({ rate: 30, qty: 1.5, qtyUnit: "kg" }), 45);
});

test("piece and dozen", () => {
  assert.equal(price({ rate: 60, rateUnit: "dozen", qty: 6, qtyUnit: "piece" }), 30);
  assert.equal(price({ rate: 80, rateUnit: "piece", qty: 2, qtyUnit: "piece" }), 160);
});

test("rounds to paise", () => {
  assert.equal(price({ rate: 35, qty: 333, qtyUnit: "g" }), 11.66);
});

test("rejects weight vs count mismatch", () => {
  const r = linePrice(line({ rateUnit: "kg", qtyUnit: "piece" }));
  assert.equal(r.ok, false);
});

test("bill total skips invalid lines", () => {
  const total = billTotal([
    line({ rate: 40, qty: 750, qtyUnit: "g" }),
    line({ rate: 15, rateQty: 250, rateUnit: "g", qty: 500, qtyUnit: "g" }),
    line({ rate: 30, qty: 2, qtyUnit: "kg" }),
    line({ qtyUnit: "piece" }),
  ]);
  assert.equal(total, 30 + 30 + 60);
});

test("produce aliases", () => {
  assert.equal(findProduce("aloo")?.name, "Potato");
  assert.equal(findProduce("Bhindi")?.name, "Lady's finger");
  assert.equal(findProduce("chiku")?.name, "Chikoo");
  assert.equal(findProduce("anar")?.name, "Pomegranate");
  assert.equal(findProduce("thakkali")?.name, "Tomato");
});
