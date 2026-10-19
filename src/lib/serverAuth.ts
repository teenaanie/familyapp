// Server-only: identify the signed-in user from the request's bearer token.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// One client per server instance so the signing keys getClaims() fetches are cached
// between requests — then checking a token needs no network call at all.
const verifier = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

export interface Authed {
  userId: string;
  /** Acts as the user, so row-level security applies. */
  db: SupabaseClient;
}

export async function authenticate(request: Request): Promise<Authed | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return null;
  const { data, error } = await verifier.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) return null;
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, db };
}
