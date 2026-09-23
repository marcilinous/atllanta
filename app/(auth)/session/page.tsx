// This page is a wiring check proving cookie auth is wired end to end — not
// a finished screen. The real login/register/reset screens come later.

import { getSessionUser, isSupabaseConfigured } from "@/src/lib/supabase/server";

export default async function SessionPage() {
  const user = await getSessionUser();
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Session</h1>
      <p className="text-sm text-muted-foreground">Supabase configured: {configured ? "Yes" : "No"}</p>
      {user ? (
        <p className="text-sm text-muted-foreground">Signed in as: {user.email ?? user.id}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Signed out</p>
      )}
    </main>
  );
}
