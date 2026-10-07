"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabClass = (active: boolean) =>
  `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
  }`;

export default function AssetsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname() ?? "";
  const tabs = [{ href: "/hrms/assets", label: "My assets", active: pathname === "/hrms/assets" }];
  if (isAdmin) {
    tabs.push({ href: "/hrms/assets/register", label: "Register", active: pathname.startsWith("/hrms/assets/register") });
  }

  return (
    <nav aria-label="Assets sections" className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={tabClass(tab.active)}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
