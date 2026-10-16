import PageHeader from "@/components/PageHeader";
import MonthlyPayments from "./MonthlyPayments";

// Rendered behind the client-side sign-in gate (see HouseholdProvider).
export const instant = false;

export const metadata = { title: "Monthly payments · Family" };

export default function PaymentsPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-6">
      <PageHeader title="Monthly payments" />
      <MonthlyPayments />
    </main>
  );
}
