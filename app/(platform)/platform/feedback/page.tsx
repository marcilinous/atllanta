// Feedback for the platform owner (v1.15.0). The layout already checked the
// platform admin; platform_feedback_list() checks again.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getSessionUser } from "@/src/lib/supabase/server";
import { withTransaction } from "@/src/db/transaction";
import { FEEDBACK_KINDS, type FeedbackKind, type FeedbackRow } from "@/src/lib/platform/feedback/schemas";
import FeedbackList from "./feedback-list";

export const metadata: Metadata = {
  title: "Feedback · Atllanta platform",
};

type Row = {
  id: string; created_at: string | Date; kind: FeedbackKind; rating: number | null; message: string; page: string | null;
  read_at: string | Date | null; user_name: string | null; user_email: string | null; role: string | null; org_name: string | null;
};

export default async function FeedbackPage({ searchParams }: PageProps<"/platform/feedback">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const sp = (await searchParams) as { unread?: string; kind?: string };
  const onlyUnread = sp.unread === "1";
  const kind = FEEDBACK_KINDS.some((k) => k.key === sp.kind) ? (sp.kind ?? null) : null;

  const rows = (await withTransaction({ id: user.id }, (tx) =>
    tx.execute(sql`select * from public.platform_feedback_list(${onlyUnread}, ${kind})`)
  )) as unknown as Row[];

  const items: FeedbackRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    kind: r.kind,
    rating: r.rating,
    message: r.message,
    page: r.page,
    readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
    userName: r.user_name,
    userEmail: r.user_email,
    role: r.role,
    orgName: r.org_name,
  }));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <p className="text-sm text-muted-foreground">Private to you. Newest first.</p>
      </div>
      <FeedbackList items={items} onlyUnread={onlyUnread} kind={kind} />
    </main>
  );
}
