"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { startLive, type LiveSession } from "@/lib/liveTranscribe";
import type { VoiceResult } from "@/lib/voice";

const MAX_SECONDS = 60;

type Phase = "idle" | "starting" | "recording" | "working";

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
}: {
  mode: "veg" | "any";
  label?: string;
  hint?: string;
  onResult: (text: string, result: VoiceResult) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const session = useRef<LiveSession | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => () => cleanup(), []);

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
      const res = await fetch("/api/voice/session", { method: "POST", headers: await authHeader() });
      const { key } = await res.json();
      if (!res.ok || !key) throw new Error("no live key");
      session.current = await startLive(stream.current, audioCtx.current, key, setLive);
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
      void submit((form) => form.append("audio", new File([blob], "speech", { type: blob.type })), blob.size < 1000);
    };
    recorder.current = rec;
    rec.start();
  }

  async function stop() {
    if (phase !== "recording") return;
    if (timer.current) clearInterval(timer.current);
    setPhase("working");
    if (session.current) {
      const text = await session.current.stop();
      session.current = null;
      cleanup();
      setLive(text);
      await submit((form) => form.append("text", text), !text);
    } else if (recorder.current?.state === "recording") {
      recorder.current.stop(); // onstop submits
    }
  }
  stopRef.current = stop;

  async function submit(fill: (f: FormData) => void, empty: boolean) {
    if (empty) {
      setPhase("idle");
      return setError("Didn't catch anything — try again a little closer to the phone.");
    }
    try {
      const form = new FormData();
      form.append("mode", mode);
      fill(form);
      const { text, result } = await sendToVoiceApi(form);
      setLive("");
      onResult(text, result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase === "starting" || phase === "working";
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
                : phase === "working"
                  ? "Working out the numbers…"
                  : label}
          </div>
          {error ? <div className="text-bad">{error}</div> : hint && phase === "idle" && <div className="text-ink-soft">{hint}</div>}
        </div>
      </div>
      {(phase === "recording" || phase === "working") && (
        <p aria-live="polite" className="mt-3 min-h-12 rounded-xl bg-surface px-3 py-2 text-base leading-snug">
          {live || <span className="text-ink-soft">{recorder.current && !session.current ? "Recording… words will show when you finish." : "Start speaking…"}</span>}
        </p>
      )}
    </div>
  );
}
