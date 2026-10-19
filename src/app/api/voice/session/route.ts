import { PRODUCE } from "@/lib/produce";
import { authenticate } from "@/lib/serverAuth";

/** How long the phone may hold a key before connecting; it fetches one in advance and refreshes it. */
const KEY_SECONDS = 600;

// Mints a short-lived OpenAI key for live transcription, so the phone can stream the
// microphone straight to OpenAI and show words as they're spoken. The real key stays here.
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return Response.json({ error: "not signed in" }, { status: 401 });
  const mode = new URL(request.url).searchParams.get("mode");

  // Staff and payee names only matter outside the vegetable page.
  const [staff, payees] =
    mode === "veg"
      ? [{ data: [] as { name: string }[] }, { data: [] as { name: string }[] }]
      : await Promise.all([auth.db.from("staff").select("name").eq("active", true), auth.db.from("payees").select("name").eq("active", true)]);
  const keywords = [
    ...new Set([
      ...PRODUCE.flatMap((p) => [p.name, ...p.aliases.slice(0, 3)]),
      "kilo", "paav", "aadha kilo", "ara kilo", "kaal kilo", "dozen", "rupees",
      ...(staff.data ?? []).map((s) => s.name),
      ...(payees.data ?? []).map((p) => p.name),
    ]),
  ];

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: KEY_SECONDS },
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            // English letters even for Hindi/Malayalam words ("teen" vs "ten" mix-ups came from auto-detecting Urdu).
            transcription: { model: "gpt-live-transcribe", language: "en", keywords },
            turn_detection: null,
            noise_reduction: { type: "far_field" },
          },
        },
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("realtime session failed", json);
    return Response.json({ error: "Live transcription unavailable" }, { status: 502 });
  }
  return Response.json({ key: json.value });
}
