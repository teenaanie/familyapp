import { test } from "node:test";
import assert from "node:assert/strict";
import { matchName, sameName } from "./match.ts";

const payees = ["Ravi (gardener)", "Lakshmi", "Dry cleaner", "Lakshmi Amma"];
const m = (s: string) => matchName(s, payees, (x) => x);

test("matches by first name or role", () => {
  assert.equal(m("Ravi"), "Ravi (gardener)");
  assert.equal(m("the gardener"), "Ravi (gardener)");
  assert.equal(m("dry cleaners"), "Dry cleaner");
});

test("exact match wins over partial", () => {
  assert.equal(m("Lakshmi"), "Lakshmi");
  assert.equal(m("lakshmi amma"), "Lakshmi Amma");
});

test("no match or ambiguous returns null", () => {
  assert.equal(m("Sunita"), null);
  assert.equal(matchName("Lakshmi", ["Lakshmi K", "Lakshmi M"], (x) => x), null);
});

test("duplicates need the same name, not a partial one", () => {
  assert.equal(sameName("Tamanna", "Tamanna Investment"), false);
  assert.equal(sameName("Kickboxing sir", "kickboxing  Sir."), true);
});
