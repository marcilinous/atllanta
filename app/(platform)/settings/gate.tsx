// Every settings page starts here: a signed-out visitor goes to the legacy
// login page, a signed-in non-admin sees an explanation, and an owner/admin
// gets the OrgAdmin the page's loaders need. The Server Actions repeat the
// check (requireOrgAdmin), and RLS repeats it again on every write.
import { redirect } from "next/navigation";
import { getOrgAdmin, type OrgAdmin } from "@/src/lib/auth/admin";

export async function adminOrNull(): Promise<OrgAdmin | null> {
  const result = await getOrgAdmin();
  if (result.status === "signed-out") redirect("/login");
  return result.status === "ok" ? result.admin : null;
}

export function NotAllowed() {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold">Owners and admins only</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Ask an owner or admin of your organisation if something here needs changing.
      </p>
    </div>
  );
}
