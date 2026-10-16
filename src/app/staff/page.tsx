import PageHeader, { PageMain } from "@/components/PageHeader";
import StaffAttendance from "./StaffAttendance";

// Rendered behind the client-side sign-in gate (see HouseholdProvider).
export const instant = false;

export const metadata = { title: "Staff attendance · Family" };

export default function StaffPage() {
  return (
    <PageMain>
      <PageHeader title="Staff attendance" subtitle="Tap a day to mark leave; pay is worked out for you." />
      <StaffAttendance />
    </PageMain>
  );
}
