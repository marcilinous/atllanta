// The platform owner's Companies screen (v1.13.0): every company, its trial,
// and Activate / Extend / Pause. Anyone who is not a platform admin gets a
// 404 — the page does not admit it exists — and the SQL functions refuse
// them anyway.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getSessionUser } from "@/src/lib/supabase/server";
import { isPlatformAdmin } from "@/src/lib/platform/access";
import { withTransaction } from "@/src/db/transaction";
import type { PlatformOrg, PlatformOrgState } from "@/src/lib/platform/trials/schemas";
import CompaniesTable from "./companies-table";

export const metadata: Metadata = {
  title: "Companies · Atllanta platform",
};

type Row = {
  id: string;
  name: string;
  people: number | string;
  plan_tier: string;
  payment_status: string;
  state: PlatformOrgState;
  trial_ends_at: string | Date | null;
  trial_extended_days: number;
  max_trial_extension_days: number;
  created_at: string | Date;
};

export default async function PlatformPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin(user.id))) notFound();

  const rows = (await withTransaction({ id: user.id }, (tx) =>
    tx.execute(sql`select * from public.platform_orgs()`)
  )) as unknown as Row[];

  const orgs: PlatformOrg[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    people: Number(r.people),
    planTier: r.plan_tier,
    paymentStatus: r.payment_status,
    state: r.state,
    trialEndsAt: r.trial_ends_at ? new Date(r.trial_ends_at).toISOString() : null,
    trialExtendedDays: r.trial_extended_days,
    maxTrialExtensionDays: r.max_trial_extension_days,
    createdAt: new Date(r.created_at).toISOString(),
  }));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-1">
        {/* A full page load on purpose: "/" is the legacy static app. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/#/dashboard" className="text-sm text-primary hover:underline">
          &larr; Back to Atllanta
        </a>
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Trials end after 14 days. Activate a company, extend its trial (7, 14 or 30 days, within its limit), or pause it.
          Every change is audited.
        </p>
      </div>
      <CompaniesTable orgs={orgs} now={new Date().toISOString()} />
    </main>
  );
}
