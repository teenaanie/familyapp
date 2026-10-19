"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { startLive, type LiveSession } from "@/lib/liveTranscribe";
import type { VoiceMode, VoiceResult } from "@/lib/voice";

const MAX_SECONDS = 60;

type Phase = "idle" | "starting" | "recording" | "transcribing" | "review" | "working";

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token}` };
}

export async function sendToVoiceApi(body: FormData): Promise<{ text: string; result: VoiceResult }> {
  const res = await fetch("/api/voice", { method: "POST", headers: await authHeader(), body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Something went wrong");
  return json;
}

// ── Getting ready before the tap ──
// A live-transcription key is fetched when the mic appears and kept fresh, so tapping
// doesn't wait for our server. Keys are used once, then replaced in the background.
const KEY_FRESH_MS = 8 * 60 * 1000; // keys last 10 minutes
const keys = new Map<VoiceMode, { at: number; key: Promise<string> }>();

function fetchKey(mode: VoiceMode) {
  const key = authHeader()
    .then((h) => fetch(`/api/voice/session?mode=${mode}`, { method: "POST", headers: h }))
    .then(async (res) => {
      const json = await res.json();
      if (!res.ok || !json.key) throw new Error("no live key");
      return json.key as string;
    });
  key.catch(() => keys.delete(mode));
  keys.set(mode, { at: Date.now(), key });
  return key;
}

function takeKey(mode: VoiceMode): Promise<string> {
  const cached = keys.get(mode);
  const key = cached && Date.now() - cached.at < KEY_FRESH_MS ? cached.key : fetchKey(mode);
  keys.delete(mode);
  setTimeout(() => fetchKey(mode), 0); // ready for next time
  return key;
}

// The first vegetable request of a while is slow while the model prepares; do it early.
function warmUp(mode: VoiceMode) {
  if (mode !== "veg") return;
  try {
    const last = Number(localStorage.getItem("voice.warmed") ?? 0);
    if (Date.now() - last < 20 * 60 * 1000) return;
    localStorage.setItem("voice.warmed", String(Date.now()));
  } catch {}
  const form = new FormData();
  form.append("mode", mode);
  form.append("warm", "1");
  void authHeader().then((h) => fetch("/api/voice", { method: "POST", headers: h, body: form })).catch(() => {});
}

function pickMimeType() {
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

/**
 * Tap to start talking, tap again to stop. Words appear live as you speak (streamed to
 * OpenAI); if live mode isn't available it records and transcribes after you stop.
 */
export default function MicButton({
  mode,
  label = "Tap and speak",
  hint,
  onResult,
  autoContinue = false,
}: {
  mode: VoiceMode;
  label?: string;
  hint?: string;
  onResult: (text: string, result: VoiceResult) => void;
  /** Use the words straight away instead of showing them for checking first (vegetable page). */
  autoContinue?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The words, editable before they're interpreted. */
  const [draft, setDraft] = useState("");

  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const session = useRef<LiveSession | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => () => cleanup(), []);

  // Be ready before the first tap, and stay ready.
  useEffect(() => {
    void fetchKey(mode).catch(() => {});
    warmUp(mode);
    const refresh = setInterval(() => void fetchKey(mode).catch(() => {}), KEY_FRESH_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const cached = keys.get(mode);
      if (!cached || Date.now() - cached.at > KEY_FRESH_MS) void fetchKey(mode).catch(() => {});
      warmUp(mode);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mode]);

  function cleanup() {
    if (timer.current) clearInterval(timer.current);
    session.current?.cancel();
    session.current = null;
    recorder.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
  }

  async function start() {
    setError(null);
    setLive("");
    if (!navigator.mediaDevices?.getUserMedia) return setError("This browser can't record audio.");
    // Create the audio context inside the tap itself — iPhones only allow audio started by a tap.
    try {
      audioCtx.current = new AudioContext({ sampleRate: 24000 });
    } catch {
      audioCtx.current = new AudioContext();
    }
    void audioCtx.current.resume();
    setPhase("starting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      cleanup();
      setPhase("idle");
      return setError((e as Error).name === "NotAllowedError" ? "Microphone access is blocked — allow it in Settings and try again." : (e as Error).message);
    }

    try {
      // Starts capturing now; the connection opens in the background and catches up.
      session.current = await startLive(stream.current, audioCtx.current, takeKey(mode), setLive);
    } catch {
      // Live captions unavailable: record now, transcribe after.
      startRecorder(stream.current);
    }

    setSeconds(0);
    setPhase("recording");
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) setTimeout(() => stopRef.current(), 0);
        return s + 1;
      });
    }, 1000);
  }

  function startRecorder(s: MediaStream) {
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/mp4" });
      cleanup();
      void transcribeRecording(blob);
    };
    recorder.current = rec;
    rec.start();
  }

  async function stop() {
    if (phase !== "recording") return;
    if (timer.current) clearInterval(timer.current);
    setPhase("transcribing");
    if (session.current) {
      const { text, audio } = await session.current.stop();
      session.current = null;
      cleanup();
      if (text) await handleWords(text);
      else await transcribeRecording(audio); // live connection didn't work — send the recording instead
    } else if (recorder.current?.state === "recording") {
      recorder.current.stop(); // onstop transcribes
    }
  }
  stopRef.current = stop;

  async function transcribeRecording(blob: Blob) {
    if (blob.size < 1000) return review("");
    try {
      const form = new FormData();
      form.append("mode", mode);
      form.append("stage", "transcribe");
      form.append("audio", new File([blob], "speech", { type: blob.type }));
      const res = await fetch("/api/voice", { method: "POST", headers: await authHeader(), body: form });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.text) await handleWords(json.text);
      else {
        review("");
        setError(json.error ?? "Couldn't hear that — type it instead, or try again.");
      }
    } catch (e) {
      review("");
      setError((e as Error).message);
    }
  }

  /** Words are ready: check them first, or go straight on when autoContinue is set. */
  async function handleWords(text: string) {
    if (autoContinue && text.trim() && !draft.trim()) {
      setLive(text);
      await submitText(text);
    } else review(text);
  }

  function review(text: string) {
    setLive("");
    // Speaking again while reviewing adds to what's already there.
    setDraft((prev) => [prev.trim(), text.trim()].filter(Boolean).join(" "));
    setPhase("review");
    if (!text) setError("Didn't catch anything — type it below, or tap the mic to try again.");
    else setError(null);
  }

  function cancel() {
    setDraft("");
    setError(null);
    setPhase("idle");
  }

  function typeInstead() {
    setError(null);
    setDraft("");
    setPhase("review");
  }

  async function submit() {
    await submitText(draft);
  }

  async function submitText(raw: string) {
    const text = raw.trim();
    if (!text) return setError("Nothing to use yet — type or say something first.");
    setError(null);
    setPhase("working");
    try {
      const form = new FormData();
      form.append("mode", mode);
      form.append("text", text);
      const { result } = await sendToVoiceApi(form);
      onResult(text, result);
      setDraft("");
      setLive("");
      setPhase("idle");
    } catch (e) {
      setError((e as Error).message);
      setDraft(text);
      setPhase("review");
    }
  }


  const busy = phase === "starting" || phase === "transcribing" || phase === "working";
  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={phase === "recording" ? stop : start}
          disabled={busy}
          aria-label={phase === "recording" ? "Stop and use what I said" : label}
          className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white shadow-md transition active:scale-95 disabled:opacity-70 ${
            phase === "recording" ? "bg-bad" : "bg-accent"
          }`}
        >
          {phase === "recording" && <span className="absolute inset-0 animate-ping rounded-full bg-bad/30" />}
          {busy ? (
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : phase === "recording" ? (
            <span className="h-5 w-5 rounded-sm bg-white" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          )}
        </button>
        <div className="min-w-0 text-sm">
          <div className="font-semibold">
            {phase === "starting"
              ? "Getting the mic ready…"
              : phase === "recording"
                ? `Listening… ${seconds}s — tap to finish`
                : phase === "transcribing"
                  ? "Writing down what you said…"
                  : phase === "review"
                    ? "Check the words, fix anything, then Continue"
                    : phase === "working"
                      ? "Working out the details…"
                      : label}
          </div>
          {error ? (
            <div className="text-bad">{error}</div>
          ) : phase === "idle" ? (
            <div className="text-ink-soft">
              {hint}{" "}
              <button type="button" onClick={typeInstead} className="font-medium text-accent underline">
                Type instead
              </button>
            </div>
          ) : phase === "review" ? (
            <div className="text-ink-soft">Tap the mic to add more by voice.</div>
          ) : null}
        </div>
      </div>

      {(phase === "recording" || phase === "transcribing") && (
        <p aria-live="polite" className="mt-3 min-h-12 rounded-xl bg-surface px-3 py-2 text-base leading-snug">
          {draft && <span className="text-ink-soft">{draft} </span>}
          {live || (
            <span className="text-ink-soft">
              {recorder.current && !session.current ? "Recording… words will show when you finish." : "Start speaking…"}
            </span>
          )}
        </p>
      )}

      {(phase === "review" || phase === "working") && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={phase === "working"}
            rows={3}
            autoFocus={!draft}
            aria-label="What you said — edit if needed"
            placeholder={hint ?? "Type here"}
            className="input w-full resize-y text-base leading-snug"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={phase === "working" || !draft.trim()}
              className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50"
            >
              {phase === "working" ? "Working…" : "Continue"}
            </button>
            <button type="button" onClick={cancel} disabled={phase === "working"} className="text-sm text-ink-soft underline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
