// Introspection only in Phase 0. Never run `drizzle-kit push` or apply a
// generated migration here — the legacy app owns this schema until its
// screens are retired module by module (see CLAUDE.md, TRANSITION.md).
//
// Regenerate src/db/schema/platform.ts against the live database once
// DATABASE_URL is set (`npm run db:introspect`), then diff the result against
// the hand-written version below before replacing anything.
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  schemaFilter: ["public"],
} satisfies Config;
