import { notFound } from "next/navigation";
import { loadCustomRole } from "@/src/lib/settings/queries";
import { adminOrNull, NotAllowed } from "../../gate";
import RoleForm from "../role-form";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditRolePage({ params }: PageProps<"/settings/roles/[roleId]">) {
  const admin = await adminOrNull();
  if (!admin) return <NotAllowed />;
  const { roleId } = await params;
  if (!UUID_RE.test(roleId)) notFound();
  const role = await loadCustomRole(admin, roleId);
  if (!role) notFound();

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Edit {role.name}</h2>
        <p className="text-sm text-muted-foreground">
          {role.memberCount === 1 ? "1 person has" : `${role.memberCount} people have`} this role.
        </p>
      </div>
      <RoleForm key={role.id} role={role} />
    </section>
  );
}
