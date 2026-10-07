// New-stack assets screens (Phase 4 item 3, v1.17.0 preview). The legacy
// #/assets screen keeps working until the cutover.
import type { Metadata } from "next";
import { assetAdminContext } from "@/src/lib/hrms/assets/queries";
import AssetsNav from "./assets-nav";

export const metadata: Metadata = {
  title: "Assets · Atllanta",
};

export default async function AssetsLayout({ children }: LayoutProps<"/hrms/assets">) {
  // Only owners and admins see the Register tab; its pages check again.
  const isAdmin = (await assetAdminContext()) !== null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        {/* A full page load on purpose: "/" is the legacy static app served
            through a rewrite, outside the App Router tree. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/#/dashboard" className="text-sm text-primary hover:underline">
          &larr; Back to Atllanta
        </a>
        <h1 className="text-2xl font-semibold">Assets</h1>
      </div>
      <AssetsNav isAdmin={isAdmin} />
      {children}
    </main>
  );
}
