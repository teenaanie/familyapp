import { createClient } from "@supabase/supabase-js";

// Browser-only client: the app is a client-rendered PWA, sessions live in localStorage.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } },
);
