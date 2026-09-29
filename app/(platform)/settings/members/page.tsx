import { loadMembers } from "@/src/lib/settings/queries";
import { adminOrNull, NotAllowed } from "../gate";
import MembersTable from "./members-table";

export default async function MembersPage() {
  const admin = await adminOrNull();
  if (!admin) return <NotAllowed />;
  const data = await loadMembers(admin);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Members</h2>
        <p className="text-sm text-muted-foreground">
          Give a person one of your custom roles. It changes what they may do in the modules the role lists; everywhere
          else their built-in role applies. Built-in roles are changed under Admin &rarr; User Management.
        </p>
      </div>
      <MembersTable data={data} />
    </section>
  );
}
