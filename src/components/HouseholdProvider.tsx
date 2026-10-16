"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import SignIn from "./SignIn";

interface Household {
  session: Session;
  householdId: string;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Household | null>(null);

export function useHousehold(): Household {
  const h = useContext(Ctx);
  if (!h) throw new Error("useHousehold outside HouseholdProvider");
  return h;
}

/** Shows sign-in until there's a session, then makes sure the user belongs to a household. */
export default function HouseholdProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    supabase.rpc("ensure_household").then(({ data, error }) => {
      if (error) setError(error.message);
      else setHouseholdId(data as string);
    });
  }, [userId]);

  if (session === undefined) return <Splash text="Loading…" />;
  if (!session) return <SignIn />;
  if (error) return <Splash text={`Couldn't load your home: ${error}`} />;
  if (!householdId) return <Splash text="Setting up your home…" />;

  return (
    <Ctx.Provider value={{ session, householdId, signOut: async () => void (await supabase.auth.signOut()) }}>
      {children}
    </Ctx.Provider>
  );
}

function Splash({ text }: { text: string }) {
  return <main className="flex flex-1 items-center justify-center p-8 text-center text-ink-soft">{text}</main>;
}
