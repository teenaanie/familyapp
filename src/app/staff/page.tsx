import PageHeader from "@/components/PageHeader";
import StaffAttendance from "./StaffAttendance";

// Rendered behind the client-side sign-in gate (see HouseholdProvider).
export const instant = false;

export const metadata = { title: "Staff attendance · Family" };

export default function StaffPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-6">
      <PageHeader title="Staff attendance" />
      <StaffAttendance />
    </main>
  );
}
