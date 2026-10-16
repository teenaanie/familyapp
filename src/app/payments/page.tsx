import PageHeader, { PageMain } from "@/components/PageHeader";
import MonthlyPayments from "./MonthlyPayments";

// Rendered behind the client-side sign-in gate (see HouseholdProvider).
export const instant = false;

export const metadata = { title: "Monthly payments · Family" };

export default function PaymentsPage() {
  return (
    <PageMain>
      <PageHeader title="Monthly payments" subtitle="Who's been paid this month, and who's still pending." />
      <MonthlyPayments />
    </PageMain>
  );
}
