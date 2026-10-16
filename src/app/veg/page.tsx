import PageHeader, { PageMain } from "@/components/PageHeader";
import VegCalculator from "./VegCalculator";
import VegHistory from "./VegHistory";

// Rendered behind the client-side sign-in gate (see HouseholdProvider).
export const instant = false;

export const metadata = { title: "Vegetable bill · Family" };

export default function VegPage() {
  return (
    <PageMain>
      <PageHeader title="Vegetable bill" subtitle="Add what you bought; the total is worked out for you." />
      <VegCalculator />
      <VegHistory />
    </PageMain>
  );
}
