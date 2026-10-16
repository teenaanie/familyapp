// The fruits and vegetables this household usually buys, with the names people
// actually say (Hindi/Malayalam/English) so typed or spoken input can match.

import type { Unit } from "./veg.ts";

export interface Produce {
  name: string;
  category: "fruit" | "vegetable";
  aliases: string[];
  /** How vendors usually quote it. */
  defaultRateUnit: Unit;
  defaultRateQty: number;
  /** What you usually buy. */
  defaultQtyUnit: Unit;
}

const fruit = (
  name: string,
  aliases: string[],
  rateUnit: Unit = "kg",
  rateQty = 1,
  qtyUnit: Unit = rateUnit === "dozen" ? "dozen" : rateUnit,
): Produce => ({ name, category: "fruit", aliases, defaultRateUnit: rateUnit, defaultRateQty: rateQty, defaultQtyUnit: qtyUnit });

const veg = (
  name: string,
  aliases: string[],
  rateUnit: Unit = "kg",
  rateQty = 1,
  qtyUnit: Unit = rateUnit,
): Produce => ({ name, category: "vegetable", aliases, defaultRateUnit: rateUnit, defaultRateQty: rateQty, defaultQtyUnit: qtyUnit });

export const PRODUCE: Produce[] = [
  fruit("Pomegranate", ["anar", "mathalam", "matalam"]),
  fruit("Apple", ["seb", "aapil"]),
  fruit("Orange", ["santra", "narangi", "orenju"]),
  fruit("Grapes", ["angoor", "munthiri", "mundiri"]),
  fruit("Dragon fruit", ["dragon", "pitaya"], "piece"),
  fruit("Banana", ["kela", "pazham", "nendran", "robusta", "poovan", "kadali"], "dozen"),
  fruit("Papaya", ["papita", "kappalanga", "omakka"]),
  fruit("Watermelon", ["tarbooz", "tharbooz", "thannimathan"]),
  fruit("Muskmelon", ["musk melon", "kharbooja", "kharbuja", "shamam"]),
  fruit("Chikoo", ["chiku", "sapota", "sapodilla", "sappotta"]),

  veg("Potato", ["aloo", "alu", "urulakizhangu", "urulakkizhangu"]),
  veg("Tomato", ["tamatar", "thakkali"]),
  veg("Lady's finger", ["bhindi", "okra", "ladies finger", "vendakka", "vendakkai"]),
  veg("Beans", ["french beans", "payar"]),
  veg("Carrot", ["gajar"]),
  veg("Beetroot", ["beet", "chukandar"]),
  veg("Cauliflower", ["gobi", "phool gobi", "cauli"], "piece"),
  veg("Cabbage", ["patta gobi", "band gobi", "muttakos"]),
  veg("Ginger", ["adrak", "inji"], "kg", 1, "g"),
  veg("Garlic", ["lehsun", "lasun", "veluthulli"], "kg", 1, "g"),
  veg("Onion", ["pyaz", "pyaaz", "savala", "ulli"]),
  veg("Green chilli", ["hari mirch", "mirchi", "pachamulaku", "kanthari"], "kg", 1, "g"),
  veg("Coriander", ["dhania", "kothamalli", "malli ila"], "bunch"),
  veg("Curry leaves", ["kadi patta", "kariveppila"], "bunch"),
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

/** Find a catalogue item by its name or any alias. */
export function findProduce(input: string): Produce | undefined {
  const q = norm(input);
  if (!q) return undefined;
  return (
    PRODUCE.find((p) => norm(p.name) === q || p.aliases.some((a) => norm(a) === q)) ??
    PRODUCE.find((p) => norm(p.name).startsWith(q) || p.aliases.some((a) => norm(a).startsWith(q)))
  );
}
