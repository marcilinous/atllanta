"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabClass = (active: boolean) =>
  `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
  }`;

export default function AttendanceNav({ canApprove }: { canApprove: boolean }) {
  const pathname = usePathname() ?? "";
  const tabs = [{ href: "/hrms/attendance", label: "My attendance" }];
  if (canApprove) tabs.push({ href: "/hrms/attendance/approvals", label: "Approvals" });

  return (
    <nav aria-label="Attendance sections" className="flex flex-wrap gap-1 border-b border-border">
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
      {/* Still legacy screens: full page loads into the hash router. Not
          #/attendance: since v1.11.0 that forwards back here. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/#/attendance/overview" className={tabClass(false)}>
        Overview
      </a>
      {canApprove ? (
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a href="/#/attendance/report" className={tabClass(false)}>
          Report
        </a>
      ) : null}
    </nav>
  );
}
