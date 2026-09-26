// Phase 3 Step 4: the first real new-stack screens. The legacy app links
// here from its Settings page (public/views/settings/org.js); the link back
// returns to the legacy Settings route.
import type { Metadata } from "next";
import SettingsNav from "./settings-nav";

export const metadata: Metadata = {
  title: "Settings · Atllanta",
};

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3">
        {/* A full page load on purpose: "/" is the legacy static app served
            through a rewrite, outside the App Router tree. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/#/settings"className="text-sm text-primary hover:underline">
          &larr; Back to Atllanta
        </a>
        <div>
          <h1 className="text-2xl font-semibold">Organisation settings</h1>
          <p className="text-sm text-muted-foreground">
            Which modules your organisation uses, custom roles, and who sees what.
          </p>
        </div>
      </div>
      <SettingsNav />
      {children}
    </main>
  );
}
