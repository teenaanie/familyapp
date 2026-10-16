import Link from "next/link";
import VegCalculator from "./VegCalculator";

// Rendered behind the client-side sign-in gate (see HouseholdProvider).
export const instant = false;

export const metadata = { title: "Vegetable bill · Family" };

export default function VegPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-6">
      <header className="mb-5 flex items-center gap-3">
        <Link href="/" className="rounded-full bg-muted px-3 py-1 text-sm">
          ← Home
        </Link>
        <h1 className="text-2xl font-bold">Vegetable bill</h1>
      </header>
      <VegCalculator />
    </main>
  );
}
