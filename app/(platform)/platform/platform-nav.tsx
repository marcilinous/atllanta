"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabClass = (active: boolean) =>
  `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
  }`;

export default function PlatformNav({ unread }: { unread: number }) {
  const pathname = usePathname() ?? "";
  const tabs = [
    { href: "/platform", label: "Companies" },
    { href: "/platform/feedback", label: unread > 0 ? `Feedback (${unread} unread)` : "Feedback" },
  ];
  return (
    <nav aria-label="Platform sections" className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={pathname === t.href ? "page" : undefined} className={tabClass(pathname === t.href)}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
