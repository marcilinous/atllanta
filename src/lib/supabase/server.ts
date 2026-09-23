// The per-request Supabase client for the new stack (Phase 2 item 1).
//
// It reads the session from cookies, which is the same session the legacy app
// now writes (public/js/supabase.js uses @supabase/ssr's browser client), so a
// user signed in on a legacy screen is signed in here too.
//
// Every query made with this client runs under the caller's own RLS — it
// carries the anon key and the user's token, never the service key. Module 0's
// policies decide what comes back, exactly as they do for the legacy app.

import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Public config, safe in a client bundle; RLS is what protects the data. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * A Supabase client bound to this request's cookies.
 *
 * In a Server Component cookies are read-only, so a refreshed token cannot be
 * written back; `setAll` is a no-op there and Next throws nothing. Refresh
 * belongs in middleware or a Server Action, which Phase 2 item 1 adds next.
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Read-only cookie store (Server Component): the caller refreshes.
        }
      },
    },
  });
}

/** The signed-in user, or null. Never throws on an anonymous request. */
export async function getSessionUser(): Promise<{ id: string; email?: string } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? undefined };
  } catch {
    return null;
  }
}
