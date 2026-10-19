import { parseUtterance, transcribe, warmVeg, type VoiceMode } from "@/lib/voice";
import { todayIST } from "@/lib/reminders";
import { authenticate } from "@/lib/serverAuth";

export const maxDuration = 30;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MODES: VoiceMode[] = ["veg", "staff", "payments", "reminders", "any"];

// Accepts a recording (or typed text) from a signed-in user and returns what was said
// plus the structured actions. Nothing is saved here — the app shows it for confirmation first.
export async function POST(request: Request) {
  const [auth, form] = await Promise.all([authenticate(request), request.formData()]);
  if (!auth) return Response.json({ error: "not signed in" }, { status: 401 });

  const requested = form.get("mode") as VoiceMode;
  const mode: VoiceMode = MODES.includes(requested) ? requested : "any";

  // Sent when the vegetable page opens, so the first real request isn't the slow one.
  if (form.get("warm")) {
    await warmVeg().catch((e) => console.error("warm failed", e));
    return Response.json({ ok: true });
  }

  const audio = form.get("audio");
  const typed = form.get("text");

  // Names help with leave and payments; the vegetable page doesn't need them.
  const names =
    mode === "veg"
      ? { staffNames: [] as string[], payeeNames: [] as string[] }
      : await Promise.all([
          auth.db.from("staff").select("name").eq("active", true),
          auth.db.from("payees").select("name").eq("active", true),
        ]).then(([staff, payees]) => ({
          staffNames: (staff.data ?? []).map((s) => s.name),
          payeeNames: (payees.data ?? []).map((p) => p.name),
        }));
  const ctx = { mode, today: todayIST(), ...names };

  try {
    let text: string;
    if (audio instanceof File && audio.size > 0) {
      if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "Recording too long — keep it under a minute." }, { status: 413 });
      const ext = audio.type.includes("webm") ? "webm" : audio.type.includes("ogg") ? "ogg" : audio.type.includes("wav") ? "wav" : "m4a";
      text = await transcribe(audio, `speech.${ext}`, ctx);
    } else if (typeof typed === "string" && typed.trim()) {
      text = typed.trim().slice(0, 2000);
    } else {
      return Response.json({ error: "Nothing to process" }, { status: 400 });
    }
    if (!text) return Response.json({ text, error: "Didn't catch anything — try again a little closer to the phone." }, { status: 422 });
    // Transcribe only, so the person can correct the words before they're interpreted.
    if (form.get("stage") === "transcribe") return Response.json({ text });

    const result = await parseUtterance(text, ctx);
    return Response.json({ text, result });
  } catch (e) {
    console.error("voice failed", e);
    return Response.json({ error: "Couldn't process that — please try again." }, { status: 502 });
  }
}
