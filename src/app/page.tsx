import Link from "next/link";
import FamilyPanel from "@/components/FamilyPanel";
import UpcomingPreview from "@/components/UpcomingPreview";
import VoiceCommand from "@/components/VoiceCommand";
import { PageMain } from "@/components/PageHeader";

// Rendered behind the client-side sign-in gate (see HouseholdProvider).
export const instant = false;

const TILES = [
  { href: "/veg", title: "Vegetable bill", note: "Check the vendor's maths", emoji: "🥕" },
  { href: "/reminders", title: "Reminders", note: "Birthdays, bills, anniversaries", emoji: "🔔" },
  { href: "/staff", title: "Staff attendance", note: "Mark absences, salary", emoji: "🧹" },
  { href: "/payments", title: "Monthly payments", note: "Paid & pending this month", emoji: "💸" },
];

export default function Home() {
  return (
    <PageMain>
      <h1 className="text-4xl font-bold text-accent md:text-5xl">Home</h1>
      <p className="mt-1 text-ink-soft md:text-lg">Our family helper</p>

      <div className="mt-6 md:mt-8">
        <VoiceCommand />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:mt-8 md:gap-4 lg:grid-cols-4">
        {TILES.map((t) => (
          <Link
            key={t.title}
            href={t.href}
            className="flex min-h-36 flex-col justify-between gap-4 rounded-2xl bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] md:min-h-44 md:p-5"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-highlight-soft text-2xl">{t.emoji}</span>
            <span>
              <span className="block text-lg font-semibold leading-tight">{t.title}</span>
              <span className="text-sm text-ink-soft">{t.note}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid items-start gap-4 pb-10 md:mt-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <UpcomingPreview />
        </div>
        <FamilyPanel />
      </div>
    </PageMain>
  );
}
