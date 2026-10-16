// Server-only: speech → text (OpenAI) → structured actions (Claude).
// The model only extracts numbers and names; every sum is done by the app's own code.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI, { toFile } from "openai";
import * as z from "zod/v4";
import { PRODUCE } from "./produce";

const UNITS = ["kg", "g", "piece", "dozen", "bunch"] as const;

export const VoiceResult = z.object({
  veg_items: z.array(
    z.object({
      name: z.string().describe("Canonical English name from the catalogue when it matches, else the spoken name in English"),
      rate: z.number().nullable().describe("Price the vendor quoted, in rupees; null if not said"),
      rate_qty: z.number().describe("How much that price is for, e.g. 1 (kg), 250 (g), 3 (pieces)"),
      rate_unit: z.enum(UNITS),
      qty: z.number().nullable().describe("How much is being bought; null if not said"),
      qty_unit: z.enum(UNITS),
    }),
  ),
  absences: z.array(
    z.object({
      staff_name: z.string(),
      date: z.string().describe("YYYY-MM-DD"),
      status: z.enum(["absent", "half_day", "extra"]),
    }),
  ),
  payments: z.array(
    z.object({
      payee_name: z.string(),
      amount: z.number(),
      date: z.string().describe("YYYY-MM-DD the money was paid"),
      mode: z.enum(["cash", "upi", "bank"]).nullable(),
      is_advance: z.boolean(),
    }),
  ),
  reminders: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(["birthday", "anniversary", "bill", "custom"]),
      date: z.string().describe("YYYY-MM-DD of the next (or birth) date"),
      recurrence: z.enum(["none", "monthly", "yearly", "every_n_days"]),
      every_n_days: z.number().nullable(),
    }),
  ),
  unclear: z.string().nullable().describe("Short note about anything that couldn't be understood, else null"),
});
export type VoiceResult = z.infer<typeof VoiceResult>;

export type VoiceMode = "veg" | "staff" | "payments" | "any";

export interface VoiceContext {
  mode: VoiceMode;
  today: string; // YYYY-MM-DD, India
  staffNames: string[];
  payeeNames: string[];
}

const catalogue = PRODUCE.map((p) => `${p.name} (${p.aliases.join(", ")})`).join("; ");

/** Words the transcriber should expect — improves Indian names and vegetable words. */
export function transcriptionHint(ctx: VoiceContext) {
  return [
    "Indian English with Hindi and Malayalam words. Vegetables and fruits:",
    PRODUCE.flatMap((p) => [p.name, ...p.aliases.slice(0, 2)]).join(", ") + ".",
    "Units: kilo, kg, grams, paav, aadha kilo, ara kilo, kaal kilo, dozen, piece, bunch. Rupees.",
    ctx.staffNames.length ? `People: ${[...ctx.staffNames, ...ctx.payeeNames].join(", ")}.` : "",
  ].join(" ");
}

let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;

export async function transcribe(audio: Blob, filename: string, ctx: VoiceContext): Promise<string> {
  openai ??= new OpenAI();
  const res = await openai.audio.transcriptions.create({
    file: await toFile(audio, filename),
    model: "gpt-4o-mini-transcribe",
    // Force English letters: auto-detection sometimes picked Urdu and heard "ten" as "teen" (three).
    language: "en",
    prompt: transcriptionHint(ctx),
  });
  return res.text.trim();
}

const MODE_FOCUS: Record<VoiceMode, string> = {
  veg: "They are at a vegetable/fruit vendor: put everything into veg_items and leave the other lists empty.",
  staff: "They are on the staff attendance page: they are almost certainly marking leave, half days or extra days, so use absences (other lists only if clearly said).",
  payments: "They are on the monthly payments page: they are almost certainly recording money paid, so use payments (other lists only if clearly said).",
  any: "Work out which lists each part belongs to. Anything about buying produce goes in veg_items.",
};

function systemPrompt(ctx: VoiceContext) {
  const weekday = new Date(ctx.today + "T00:00").toLocaleDateString("en-IN", { weekday: "long" });
  return `You turn what a person in Kerala, India said into structured data for their family app. Speech is English, often mixed with Hindi or Malayalam (Manglish/Hinglish), and may contain transcription mistakes — use common sense.

Today is ${weekday}, ${ctx.today}.

${MODE_FOCUS[ctx.mode]}

VEG ITEMS — extract, never calculate prices:
- Catalogue (name, then what people call it): ${catalogue}. Use the catalogue name when it matches.
- "forty rupees a kilo" / "kilo forty" / "40 per kg" → rate 40, rate_qty 1, rate_unit kg.
- "15 rupees for 250 grams" / "paav 15" → rate 15, rate_qty 250, rate_unit g.
- "3 for 100" (pieces) → rate 100, rate_qty 3, rate_unit piece. "60 a dozen" → rate 60, rate_qty 1, rate_unit dozen.
- Quantities: paav / pav / kaal kilo = 250 g; aadha kilo / ara kilo / half kilo = 500 g; "dedh kilo" = 1.5 kg; "dhai kilo" = 2.5 kg; "600 grams" or "point six kilo" = 600 g (qty 600, qty_unit g) or 0.6 kg — keep the unit they said.
- If no rate was said, rate is null. If no quantity was said, qty is null. Default units: kg for rate, the same kind for quantity.

STAFF ATTENDANCE (absences): household staff are: ${ctx.staffNames.join(", ") || "none yet"}. Match names loosely to these. "didn't come", "on leave", "absent" → absent; "came only half day" → half_day; "came on Sunday / extra day" → extra. Resolve "today", "yesterday", weekday names to dates (the most recent past one).

PAYMENTS: people/things they pay monthly: ${ctx.payeeNames.join(", ") || "none yet"}. "Paid the gardener 1500 by GPay" → payee_name gardener's name from that list if it matches, amount 1500, mode upi (GPay/PhonePe/Paytm = upi), is_advance true only if they say advance.

REMINDERS: birthdays and anniversaries repeat yearly; bills usually monthly; otherwise none. Use a future date unless it's a birth date.

If nothing usable was said, return empty lists and explain briefly in unclear.`;
}

export async function parseUtterance(text: string, ctx: VoiceContext): Promise<VoiceResult> {
  anthropic ??= new Anthropic();
  const res = await anthropic.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: systemPrompt(ctx),
    messages: [{ role: "user", content: text }],
    output_config: { format: zodOutputFormat(VoiceResult) },
  });
  if (!res.parsed_output) throw new Error("Couldn't understand that — please try again.");
  return res.parsed_output;
}
