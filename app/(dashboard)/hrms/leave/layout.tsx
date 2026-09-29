// New-stack leave screens (Phase 4 item 3). Since v1.9.0 the legacy
// #/leave and #/leave/approvals routes forward here; the team calendar and
// the leave report are still legacy screens, linked from the tabs.
import type { Metadata } from "next";
import { featureContext } from "@/src/lib/auth/permissions";
import LeaveNav from "./leave-nav";

export const metadata: Metadata = {
  title: "Leave · Atllanta",
};

export default async function LeaveLayout({ children }: LayoutProps<"/hrms/leave">) {
  // Only people who can approve see the Approvals and Report tabs; the
  // pages check again on their own.
  const canApprove = (await featureContext("me", "me", "approve")) !== null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        {/* A full page load on purpose: "/" is the legacy static app served
            through a rewrite, outside the App Router tree. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/#/dashboard" className="text-sm text-primary hover:underline">
          &larr; Back to Atllanta
        </a>
        <h1 className="text-2xl font-semibold">Leave</h1>
      </div>
      <LeaveNav canApprove={canApprove} />
      {children}
    </main>
  );
}
