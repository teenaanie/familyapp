import PageHeader, { PageMain } from "@/components/PageHeader";
import Reminders from "./Reminders";

// Rendered behind the client-side sign-in gate (see HouseholdProvider).
export const instant = false;

export const metadata = { title: "Reminders · Family" };

export default function RemindersPage() {
  return (
    <PageMain>
      <PageHeader title="Reminders" subtitle="Birthdays, anniversaries and bills — with a nudge on the morning they're due." />
      <Reminders />
    </PageMain>
  );
}
