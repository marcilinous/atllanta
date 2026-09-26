import { loadAccess } from "@/src/lib/settings/queries";
import { adminOrNull, NotAllowed } from "../gate";
import AccessEditor from "./access-editor";

export default async function AccessPage() {
  const admin = await adminOrNull();
  if (!admin) return <NotAllowed />;
  const data = await loadAccess(admin);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Feature access</h2>
        <p className="text-sm text-muted-foreground">
          Hide sections of the app from a role or a person. This only hides them from view &mdash; your data stays
          protected by security rules either way. A module switched off under Modules stays hidden regardless.
        </p>
      </div>
      <AccessEditor data={data} />
    </section>
  );
}
