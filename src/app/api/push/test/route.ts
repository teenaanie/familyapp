import { createClient } from "@supabase/supabase-js";
import { sendPush } from "@/lib/push";

// Sends a test notification to the signed-in user's own devices.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "not signed in" }, { status: 401 });

  // Acts as the user, so row-level security limits this to their own subscriptions.
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: subs, error } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!subs?.length) return Response.json({ error: "No devices registered yet" }, { status: 400 });

  const result = await sendPush(subs, {
    title: "Family Helper",
    body: "Notifications are working 🎉",
    url: "/reminders",
    tag: "test",
  });
  if (result.gone.length) await supabase.from("push_subscriptions").delete().in("id", result.gone);
  return Response.json(result);
}
