// New-stack expenses screens (Phase 4 item 3, v1.16.0 preview). The legacy
// #/finance screen keeps working until the cutover; the expense report and
// the category settings are still legacy screens, linked from the tabs.
import type { Metadata } from "next";
import { featureContext } from "@/src/lib/auth/permissions";
import ExpensesNav from "./expenses-nav";

export const metadata: Metadata = {
  title: "Expenses · Atllanta",
};

export default async function ExpensesLayout({ children }: LayoutProps<"/hrms/expenses">) {
  // Only people who can approve see the Approvals and Report tabs, and only
  // owners/admins see Categories; the pages check again on their own.
  const approver = await featureContext("finance", "finance", "approve");
  const canApprove = approver !== null;
  const isAdmin = approver?.role === "owner" || approver?.role === "admin";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        {/* A full page load on purpose: "/" is the legacy static app served
            through a rewrite, outside the App Router tree. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/#/dashboard" className="text-sm text-primary hover:underline">
          &larr; Back to Atllanta
        </a>
        <h1 className="text-2xl font-semibold">Expenses</h1>
      </div>
      <ExpensesNav canApprove={canApprove} isAdmin={isAdmin} />
      {children}
    </main>
  );
}
