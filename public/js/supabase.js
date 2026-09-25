// One session, shared with the Next.js stack (TRANSITION.md, 2026-09-23).
//
// This was the plain supabase-js client, which keeps the session in
// localStorage — invisible to a server-rendered page. `createBrowserClient`
// from @supabase/ssr stores the same session in cookies, in the format the
// Next.js server client reads, so a screen on either stack sees the same
// signed-in user. Nothing else about the client changes.
//
// Keep the pinned version in step with the `@supabase/ssr` dependency in
// package.json: both stacks must write the cookie the same way.
import { createBrowserClient } from "https://cdn.jsdelivr.net/npm/@supabase/ssr@0.12.7/+esm";

const cfg = window.ATLLANTA_CONFIG;
const sb = createBrowserClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

export default sb;
