"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { VoiceResult } from "@/lib/voice";

const MAX_SECONDS = 60;

type Phase = "idle" | "recording" | "working";

function pickMimeType() {
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export async function sendToVoiceApi(body: FormData): Promise<{ text: string; result: VoiceResult }> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch("/api/voice", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token}` },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Something went wrong");
  return json;
}

/** Tap to start talking, tap again to stop. Sends the recording and returns the parsed result. */
export default function MicButton({
  mode,
  label = "Tap and speak",
  hint,
  onResult,
  size = "lg",
}: {
  mode: "veg" | "any";
  label?: string;
  hint?: string;
  onResult: (text: string, result: VoiceResult) => void;
  size?: "lg" | "md";
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stopTracks(), []);

  function stopTracks() {
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stopTracks();
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/mp4" });
        void upload(blob);
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setPhase("recording");
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "Microphone access is blocked — allow it in Settings and try again." : (e as Error).message);
    }
  }

  function stop() {
    if (recorder.current?.state === "recording") {
      setPhase("working");
      recorder.current.stop();
    }
  }

  async function upload(blob: Blob) {
    if (blob.size < 1000) {
      setPhase("idle");
      setError("That was too short — hold on a second longer.");
      return;
    }
    try {
      const body = new FormData();
      body.append("mode", mode);
      body.append("audio", new File([blob], "speech", { type: blob.type }));
      const { text, result } = await sendToVoiceApi(body);
      onResult(text, result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  const dim = size === "lg" ? "h-16 w-16" : "h-12 w-12";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={phase === "recording" ? stop : start}
        disabled={phase === "working"}
        aria-label={phase === "recording" ? "Stop recording" : label}
        className={`relative flex ${dim} shrink-0 items-center justify-center rounded-full text-white shadow-md transition active:scale-95 disabled:opacity-60 ${
          phase === "recording" ? "bg-bad" : "bg-accent"
        }`}
      >
        {phase === "recording" && <span className="absolute inset-0 animate-ping rounded-full bg-bad/40" />}
        {phase === "working" ? (
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
          {phase === "recording" ? `Listening… ${seconds}s — tap to finish` : phase === "working" ? "Working it out…" : label}
        </div>
        {error ? <div className="text-bad">{error}</div> : hint && phase === "idle" && <div className="text-ink-soft">{hint}</div>}
      </div>
    </div>
  );
}
