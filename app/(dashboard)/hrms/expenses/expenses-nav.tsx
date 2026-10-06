"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabClass = (active: boolean) =>
  `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
  }`;

export default function ExpensesNav({ canApprove, isAdmin }: { canApprove: boolean; isAdmin: boolean }) {
  const pathname = usePathname() ?? "";
  const tabs = [{ href: "/hrms/expenses", label: "My expenses" }];
  if (canApprove) tabs.push({ href: "/hrms/expenses/approvals", label: "Approvals" });

  return (
    <nav aria-label="Expenses sections" className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? "page" : undefined}
          className={tabClass(pathname === tab.href)}
        >
          {tab.label}
        </Link>
      ))}
      {/* Still legacy screens: full page loads into the hash router. */}
      {canApprove ? (
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a href="/#/reports/expenses" className={tabClass(false)}>
          Report
        </a>
      ) : null}
      {isAdmin ? (
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a href="/#/finance/categories" className={tabClass(false)}>
          Categories
        </a>
      ) : null}
    </nav>
  );
}
