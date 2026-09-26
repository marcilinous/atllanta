import { adminOrNull, NotAllowed } from "../../gate";
import RoleForm from "../role-form";

export default async function NewRolePage() {
  const admin = await adminOrNull();
  if (!admin) return <NotAllowed />;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">New custom role</h2>
      <RoleForm />
    </section>
  );
}
