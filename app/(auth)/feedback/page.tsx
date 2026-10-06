// Send feedback (v1.15.0) — private to the Atllanta platform owner. Open to
// anyone signed in, including a company whose trial ended: that is exactly
// when "why didn't you continue?" is worth hearing.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { getOrgAccess } from "@/src/lib/platform/access";
import { safeFrom } from "@/src/lib/platform/feedback/schemas";
import FeedbackForm from "./feedback-form";

export const metadata: Metadata = {
  title: "Send feedback · Atllanta",
};

export default async function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await getOrgAccess(user.id);
  if (!access) redirect("/start");
  const sp = (await searchParams) as { from?: string };
  const from = safeFrom(sp.from);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Send feedback</h1>
        <p className="text-sm text-muted-foreground">
          An idea, a problem, or something you like — it goes privately to the Atllanta team.
        </p>
      </div>
      <FeedbackForm from={from} />
    </main>
  );
}
