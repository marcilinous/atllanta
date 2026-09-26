import { loadModules } from "@/src/lib/settings/queries";
import { adminOrNull, NotAllowed } from "../gate";
import ModuleToggles from "./module-toggles";

export default async function ModulesPage() {
  const admin = await adminOrNull();
  if (!admin) return <NotAllowed />;
  const modules = await loadModules(admin);
  const onCount = modules.filter((m) => m.isEnabled).length;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Modules</h2>
        <p className="text-sm text-muted-foreground">
          Switch on the modules your organisation uses. {onCount} of {modules.length} are on. Switching a module off
          hides it for everyone, owners and admins included.
        </p>
      </div>
      <ModuleToggles modules={modules} />
    </section>
  );
}
