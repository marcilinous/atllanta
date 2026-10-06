// Every new-stack workspace screen (/hrms/*) sits under this layout. A
// company whose trial has ended or which Atllanta paused goes to /paused —
// the database refuses its data anyway; this just explains (v1.13.0).
import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { getOrgAccess } from "@/src/lib/platform/access";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const access = user ? await getOrgAccess(user.id) : null;
  if (access && access.state !== "ok") redirect("/paused");
  return (
    <>
      <div className="mx-auto flex w-full max-w-4xl justify-end px-4 pt-3 sm:px-6">
        <a href="/feedback?from=/hrms" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Send feedback
        </a>
      </div>
      {children}
    </>
  );
}
