import fs from "node:fs";
import path from "node:path";
import { count } from "drizzle-orm";
import { getDb } from "@/src/db";
import { organizations, users } from "@/src/db/schema/platform";

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

async function readCounts(): Promise<{ organizations: number; users: number }> {
  // Deliberately not caching/leaking any driver detail: getDb() throws a
  // plain "Database is not configured" error when the connection string env
  // var is absent, and any real connection failure surfaces as an ordinary
  // Error too. Both are caught by the caller and turned into the same
  // "not configured" UI — the raw error text and the connection string
  // itself must never reach the page.
  const db = getDb();
  const [[orgRow], [userRow]] = await Promise.all([
    db.select({ value: count() }).from(organizations),
    db.select({ value: count() }).from(users),
  ]);
  return { organizations: orgRow.value, users: userRow.value };
}

export default async function HealthPage() {
  const version = readVersion();
  let counts: { organizations: number; users: number } | null = null;
  let configured = true;

  try {
    counts = await readCounts();
  } catch {
    configured = false;
  }

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Health</h1>

      {configured && counts ? (
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-zinc-500">Organizations</dt>
            <dd className="text-3xl font-semibold">{counts.organizations}</dd>
          </div>
          <div>
            <dt className="text-sm text-zinc-500">Users</dt>
            <dd className="text-3xl font-semibold">{counts.users}</dd>
          </div>
        </dl>
      ) : (
        <p className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Database not configured. Set the database connection string in the
          environment to enable this check.
        </p>
      )}

      <p className="text-sm text-zinc-500">Version {version}</p>
    </main>
  );
}
