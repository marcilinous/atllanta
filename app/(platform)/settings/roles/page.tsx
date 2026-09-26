import Link from "next/link";
import { loadRoles } from "@/src/lib/settings/queries";
import { MODULE_LABELS, PERMISSION_LABELS } from "@/src/lib/settings/catalogue";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { adminOrNull, NotAllowed } from "../gate";

function people(n: number) {
  return n === 1 ? "1 person" : `${n} people`;
}

export default async function RolesPage() {
  const admin = await adminOrNull();
  if (!admin) return <NotAllowed />;
  const { system, custom } = await loadRoles(admin);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Custom roles</h2>
            <p className="text-sm text-muted-foreground">
              A custom role changes what someone may do in specific modules. They keep their built-in role for
              everything else.
            </p>
          </div>
          <Link href="/settings/roles/new" className={buttonVariants()}>
            New role
          </Link>
        </div>
        {custom.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No custom roles yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {custom.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="flex flex-col gap-1">
                  <Link href={`/settings/roles/${r.id}`} className="text-sm font-medium text-primary hover:underline">
                    {r.name}
                  </Link>
                  {r.description ? <p className="text-xs text-muted-foreground">{r.description}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {r.grants.length === 0
                      ? "Uses the base role's defaults everywhere."
                      : r.grants
                          .map(
                            (g) =>
                              `${MODULE_LABELS[g.moduleKey].label}: ${g.permissions.map((p) => PERMISSION_LABELS[p]).join(", ")}`
                          )
                          .join(" · ")}
                  </p>
                </div>
                <Badge variant="outline">{people(r.memberCount)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Built-in roles</h2>
          <p className="text-sm text-muted-foreground">
            These can&rsquo;t be changed. Each applies in every module your organisation has switched on.
          </p>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {system.map((r) => (
            <li key={r.slug} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.defaults.map((p) => PERMISSION_LABELS[p]).join(", ")}</p>
              </div>
              <Badge variant="outline">{people(r.memberCount)}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
