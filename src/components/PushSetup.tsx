"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type State = "checking" | "unsupported" | "install" | "off" | "denied" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    { endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

/** Lets this device receive reminder notifications. */
export default function PushSetup() {
  const [state, setState] = useState<State>("checking");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState(isIOS() && !isInstalled() ? "install" : "unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      if (Notification.permission === "denied") return setState("denied");
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await saveSubscription(sub).catch(() => {}); // keep the server copy fresh
        setState("on");
      } else setState("off");
    })().catch((e) => {
      setState("unsupported");
      setMsg((e as Error).message);
    });
  }, []);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      await saveSubscription(sub);
      setState("on");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    const { data } = await supabase.auth.getSession();
    const res = await fetch("/api/push/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session?.access_token}` },
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? "Sent — it should pop up in a few seconds." : (body.error ?? "Couldn't send"));
  }

  return (
    <section className={`rounded-2xl p-4 shadow-sm ${state === "on" ? "bg-surface" : "bg-highlight-soft"}`}>
      <h2 className="font-semibold">Notifications on this device</h2>
      {state === "checking" && <p className="mt-1 text-sm text-ink-soft">Checking…</p>}
      {state === "install" && (
        <p className="mt-1 text-sm">
          On iPhone, notifications only work from the Home Screen app. In Safari tap <b>Share</b> → <b>Add to Home Screen</b>,
          open Family Helper from there, and come back to this page.
        </p>
      )}
      {state === "unsupported" && <p className="mt-1 text-sm text-ink-soft">This browser can&apos;t receive notifications.</p>}
      {state === "denied" && (
        <p className="mt-1 text-sm">
          Notifications are blocked. Turn them on in your phone&apos;s Settings → Notifications → Family, then reopen the app.
        </p>
      )}
      {state === "off" && (
        <>
          <p className="mt-1 text-sm">Get a reminder every morning at 8 AM for birthdays, bills and payments due.</p>
          <button onClick={enable} disabled={busy} className="mt-3 rounded-xl bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50">
            {busy ? "Turning on…" : "Turn on notifications"}
          </button>
        </>
      )}
      {state === "on" && (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-good">✓ On — daily at 8 AM</span>
          <button onClick={test} disabled={busy} className="text-ink-soft underline disabled:opacity-50">
            Send a test
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-ink-soft">{msg}</p>}
    </section>
  );
}
