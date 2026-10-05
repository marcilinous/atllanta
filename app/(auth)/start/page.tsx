// Company sign-up (v1.12.0). Reached from the legacy shell when a signed-in
// person has no account row. Anyone who already belongs to an organisation
// is sent back to the app — one company per account.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/src/lib/supabase/server";
import { withTransaction } from "@/src/db/transaction";
import { users } from "@/src/db/schema/platform";
import { CURRENCIES, SIGNUP_MODULES, TIME_ZONES } from "@/src/lib/platform/signup/schemas";
import StartForm from "./start-form";

export const metadata: Metadata = {
  title: "Set up your company · Atllanta",
};

export default async function StartPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [member] = await withTransaction({ id: user.id }, (tx) =>
    tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).limit(1)
  );
  if (member) redirect("/");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Set up your company</h1>
        <p className="text-sm text-muted-foreground">
          You&rsquo;ll be its owner. Your 14-day trial starts today.
        </p>
      </div>
      <StartForm
        modules={SIGNUP_MODULES.map((m) => ({ key: m.key, label: m.label }))}
        timeZones={[...TIME_ZONES]}
        currencies={[...CURRENCIES]}
      />
    </main>
  );
}
