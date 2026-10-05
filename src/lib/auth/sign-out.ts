"use server";

// Ends the session (both stacks share the cookie) and goes to sign-in.
// Used from /paused, where the legacy app's own sign-out is out of reach.
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "../supabase/server";

export async function signOut(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
