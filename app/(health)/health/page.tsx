import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/src/db";
import { ComponentSample } from "./component-sample";

// Rendered per request so the database check is live. This costs one serverless
// function (budget: 10, see global constraints). Deliberately shows no counts:
// the page is public and the connection runs as a role that bypasses RLS, so
// any count would be platform-wide tenant and user numbers.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Health — Atllanta",
};

function readVersion(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

async function checkDatabase(): Promise<void> {
  // Deliberately not caching/leaking any driver detail: getDb() throws a
  // plain "Database is not configured" error when the connection string env
  // var is absent, and any real connection failure surfaces as an ordinary
  // Error too. Both are caught by the caller and turned into the same
  // "not reachable" UI — the raw error text and the connection string
  // itself must never reach the page.
  await getDb().execute(sql`select 1`);
}

export default async function HealthPage() {
  const version = readVersion();
  let reachable = false;

  try {
    await checkDatabase();
    reachable = true;
  } catch (err) {
    // Server log only, for telling "variable missing" from "connection failed".
    // Never the message: driver messages can carry the host or user name.
    const code = (err as { code?: unknown } | null)?.code;
    console.error("health: database check failed", {
      envPresent: isDatabaseConfigured(),
      code: typeof code === "string" ? code : undefined,
    });
  }

  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Health</h1>

      <p className="text-sm">
        Database: <span className="font-semibold">{reachable ? "reachable" : "not reachable"}</span>
      </p>
      {!reachable && (
        <p className="rounded-lg border border-warning bg-(--color-warning-light) px-4 py-3 text-sm text-warning">
          Database not reachable. Check the database connection string in the
          environment.
        </p>
      )}

      <ComponentSample />

      <p className="text-sm text-muted-foreground">Version {version}</p>
    </main>
  );
}
