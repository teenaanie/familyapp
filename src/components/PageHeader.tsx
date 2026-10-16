import Link from "next/link";

export default function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-5 md:mb-8">
      <Link href="/" className="mb-3 inline-block rounded-full bg-muted px-3 py-1 text-sm md:hidden">
        ← Home
      </Link>
      <h1 className="text-2xl font-bold md:text-4xl">{title}</h1>
      {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
    </header>
  );
}

/** Page container: phone-width on phones, wide on computers. */
export function PageMain({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-6xl px-4 pt-6 md:px-8 md:pt-10">{children}</main>;
}
