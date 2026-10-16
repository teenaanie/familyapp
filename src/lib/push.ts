// Server-only: sends Web Push messages.
import webpush from "web-push";

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:family@pippypets.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

/** Sends to each target; returns ids of subscriptions that no longer exist (to delete). */
export async function sendPush(targets: PushTarget[], msg: PushMessage): Promise<{ sent: number; gone: string[] }> {
  configure();
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    targets.map(async (t) => {
      try {
        await webpush.sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          JSON.stringify(msg),
          { TTL: 60 * 60 * 12 },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(t.id);
        else console.error("push failed", status, (e as Error).message);
      }
    }),
  );
  return { sent, gone };
}
