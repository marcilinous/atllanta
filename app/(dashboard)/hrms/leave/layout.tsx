// New-stack leave screens (Phase 4 item 3). They run beside the legacy leave
// screens until the owner switches the legacy nav over to them.
import type { Metadata } from "next";
import LeaveNav from "./leave-nav";

export const metadata: Metadata = {
  title: "Leave · Atllanta",
};

export default function LeaveLayout({ children }: LayoutProps<"/hrms/leave">) {
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
      <LeaveNav />
      {children}
    </main>
  );
}
