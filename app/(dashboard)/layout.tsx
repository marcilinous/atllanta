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
  return <>{children}</>;
}
