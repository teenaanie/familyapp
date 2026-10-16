"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "./HouseholdProvider";

interface Member {
  user_id: string;
  display_name: string | null;
}

export default function FamilyPanel() {
  const { session, householdId, signOut } = useHousehold();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("members").select("user_id, display_name").eq("household_id", householdId)
      .then(({ data }) => setMembers(data ?? []));
    supabase.from("invites").select("email").eq("household_id", householdId)
      .then(({ data }) => setInvites((data ?? []).map((i) => i.email)));
  }, [householdId]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!addr) return;
    const { error } = await supabase.from("invites").insert({ household_id: householdId, email: addr });
    if (error) {
      setMsg(error.code === "23505" ? "Already invited" : error.message);
      return;
    }
    setInvites((i) => [...i, addr]);
    setEmail("");
    setMsg(`Invited. Ask them to open the app and sign in with ${addr}.`);
  }

  return (
    <section className="rounded-2xl bg-surface p-4 shadow-sm md:p-5">
      <h2 className="text-lg font-semibold">Family</h2>
      <ul className="mt-2 text-sm">
        {members.map((m) => (
          <li key={m.user_id} className="py-0.5">
            {m.user_id === session.user.id ? `You (${session.user.email})` : (m.display_name ?? "Family member")}
          </li>
        ))}
        {invites.map((i) => (
          <li key={i} className="py-0.5 text-ink-soft">{i} · invited</li>
        ))}
      </ul>
      <form onSubmit={invite} className="mt-3 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Invite by email"
          className="min-w-0 flex-1 rounded-xl border border-line bg-background px-3 py-2"
        />
        <button className="rounded-xl bg-ink px-4 py-2 font-medium text-background">Invite</button>
      </form>
      {msg && <p className="mt-2 text-sm text-ink-soft">{msg}</p>}
      <button onClick={signOut} className="mt-4 text-sm text-ink-soft underline">Sign out</button>
    </section>
  );
}
