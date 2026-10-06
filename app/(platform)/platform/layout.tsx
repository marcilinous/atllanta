// The platform owner's area (v1.15.0 adds the Feedback tab). One admin check
// for every tab; anyone else gets a 404, and the SQL functions refuse them
// anyway.
import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getSessionUser } from "@/src/lib/supabase/server";
import { isPlatformAdmin } from "@/src/lib/platform/access";
import { withTransaction } from "@/src/db/transaction";
import PlatformNav from "./platform-nav";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await isPlatformAdmin(user.id))) notFound();

  const [{ n: unread }] = (await withTransaction({ id: user.id }, (tx) =>
    tx.execute(sql`select count(*)::int as n from public.platform_feedback_list(true)`)
  )) as unknown as { n: number }[];

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
        <PlatformNav unread={unread} />
      </div>
      {children}
    </div>
  );
}
