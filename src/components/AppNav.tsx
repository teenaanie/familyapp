"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const SECTIONS = [
  { href: "/veg", label: "Vegetable bill" },
  { href: "/reminders", label: "Reminders" },
  { href: "/staff", label: "Staff" },
  { href: "/payments", label: "Payments" },
];

/** Top bar on tablets and computers; phones navigate from the home screen instead. */
export default function AppNav() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-20 hidden border-b border-line bg-background/90 backdrop-blur md:block">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-8">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={32} height={32} className="rounded-lg" />
          <span className="font-display text-lg font-bold text-accent">Family Helper</span>
        </Link>
        <ul className="ml-auto flex items-center gap-1">
          {SECTIONS.map((s) => {
            const active = path.startsWith(s.href);
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-accent text-white" : "text-ink-soft hover:bg-muted hover:text-ink"
                  }`}
                >
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
