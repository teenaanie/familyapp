"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Code-based sign-in: an email link would open Safari instead of the home-screen app on iPhone.
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-bold">Family Helper</h1>
      <p className="mt-1 text-ink-soft">Sign in to your home</p>

      {!sent ? (
        <form onSubmit={sendCode} className="mt-8 flex flex-col gap-3">
          <label className="text-sm text-ink-soft" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-lg"
          />
          <button disabled={busy} className="rounded-xl bg-accent py-3 text-lg font-semibold text-white disabled:opacity-60">
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-8 flex flex-col gap-3">
          <p className="text-sm text-ink-soft">
            We sent a code to <b className="text-ink">{email}</b>. Type it here.
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            maxLength={8}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-center text-2xl tracking-[0.4em]"
          />
          <button disabled={busy} className="rounded-xl bg-accent py-3 text-lg font-semibold text-white disabled:opacity-60">
            {busy ? "Checking…" : "Sign in"}
          </button>
          <button type="button" onClick={() => { setSent(false); setCode(""); }} className="text-sm text-ink-soft underline">
            Use a different email
          </button>
        </form>
      )}
      {error && <p className="mt-4 text-sm text-bad">{error}</p>}
    </main>
  );
}
