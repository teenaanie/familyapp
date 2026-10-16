import { createClient } from "@supabase/supabase-js";
import { parseUtterance, transcribe, type VoiceMode } from "@/lib/voice";
import { todayIST } from "@/lib/reminders";

export const maxDuration = 30;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

// Accepts a recording (or typed text) from a signed-in user and returns what was said
// plus the structured actions. Nothing is saved here — the app shows it for confirmation first.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "not signed in" }, { status: 401 });

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: user } = await supabase.auth.getUser(token);
  if (!user.user) return Response.json({ error: "not signed in" }, { status: 401 });

  const form = await request.formData();
  const requested = form.get("mode");
  const mode: VoiceMode = requested === "veg" || requested === "staff" || requested === "payments" || requested === "reminders" ? requested : "any";
  const audio = form.get("audio");
  const typed = form.get("text");

  // Names help both the transcriber and the parser; RLS limits these to the user's household.
  const [staff, payees] = await Promise.all([
    supabase.from("staff").select("name").eq("active", true),
    supabase.from("payees").select("name").eq("active", true),
  ]);
  const ctx = {
    mode,
    today: todayIST(),
    staffNames: (staff.data ?? []).map((s) => s.name),
    payeeNames: (payees.data ?? []).map((p) => p.name),
  };

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
