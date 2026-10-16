import Link from "next/link";
import FamilyPanel from "@/components/FamilyPanel";

// Rendered behind the client-side sign-in gate (see HouseholdProvider).
export const instant = false;

const TILES = [
  { href: "/veg", title: "Vegetable bill", note: "Check the vendor's maths", ready: true, emoji: "🥕" },
  { href: "#", title: "Reminders", note: "Birthdays, bills, anniversaries", ready: false, emoji: "🔔" },
  { href: "/staff", title: "Staff attendance", note: "Mark absences, salary", ready: true, emoji: "🧹" },
  { href: "/payments", title: "Monthly payments", note: "Paid & pending this month", ready: true, emoji: "💸" },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-10 pb-10">
      <h1 className="text-4xl font-bold text-accent">Home</h1>
      <p className="mt-1 text-ink-soft">Our family helper</p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        {TILES.map((t) =>
          t.ready ? (
            <Link
              key={t.title}
              href={t.href}
              className="flex min-h-36 flex-col justify-between rounded-2xl bg-surface p-4 shadow-sm active:scale-[0.98]"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-highlight-soft text-2xl">{t.emoji}</span>
              <span>
                <span className="block text-lg font-semibold leading-tight">{t.title}</span>
                <span className="text-sm text-ink-soft">{t.note}</span>
              </span>
            </Link>
          ) : (
            <div
              key={t.title}
              className="flex min-h-36 flex-col justify-between rounded-2xl border border-dashed border-line p-4 opacity-60"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-2xl grayscale">{t.emoji}</span>
              <span>
                <span className="block text-lg font-semibold leading-tight">{t.title}</span>
                <span className="text-sm text-ink-soft">Coming soon</span>
              </span>
            </div>
          ),
        )}
      </div>
      <FamilyPanel />
    </main>
  );
}
