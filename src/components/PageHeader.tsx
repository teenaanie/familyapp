import Link from "next/link";

export default function PageHeader({ title }: { title: string }) {
  return (
    <header className="mb-5 flex items-center gap-3">
      <Link href="/" className="rounded-full bg-muted px-3 py-1 text-sm">
        ← Home
      </Link>
      <h1 className="text-2xl font-bold">{title}</h1>
    </header>
  );
}
