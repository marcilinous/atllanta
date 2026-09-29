// Aggregated schema export (CLAUDE.md §5). Modules add their file here as
// they migrate. src/db/index.ts still builds its client from platform.ts
// alone; plain select/insert/update against any table below works without
// registering it there, and relational queries are not used yet.
export * from "./platform";
export * from "./hrms";
