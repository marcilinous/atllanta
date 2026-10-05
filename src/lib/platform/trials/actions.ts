"use server";

// The platform owner's company actions (v1.13.0). Each runs one platform_*
// function as the caller; the function itself refuses anyone who is not a
// platform admin, writes the audit row and publishes the event.

import { revalidatePath } from "next/cache";
import { sql, type SQL } from "drizzle-orm";
import { action, ActionError } from "../../actions";
import { withTransaction } from "../../../db/transaction";
import { getSessionUser } from "../../supabase/server";
import { explainPlatformError } from "./explain";
import { extendTrialSchema, orgActionSchema } from "./schemas";

async function run<T>(query: SQL): Promise<T[]> {
  const user = await getSessionUser();
  if (!user) throw new ActionError("Sign in first.");
  return withTransaction({ id: user.id }, async (tx) => {
    try {
      return (await tx.execute(query)) as unknown as T[];
    } catch (err) {
      const message = explainPlatformError(err);
      if (message) throw new ActionError(message);
      throw err;
    }
  });
}

export const activateOrg = action(orgActionSchema, async (input) => {
  await run(sql`select public.platform_activate_org(${input.orgId}::uuid)`);
  revalidatePath("/platform");
  return { orgId: input.orgId };
});

export const extendTrial = action(extendTrialSchema, async (input) => {
  const [row] = await run<{ ends: string | Date }>(
    sql`select public.platform_extend_trial(${input.orgId}::uuid, ${input.days}::int) as ends`
  );
  revalidatePath("/platform");
  return { orgId: input.orgId, trialEndsAt: new Date(row.ends).toISOString() };
});

export const pauseOrg = action(orgActionSchema, async (input) => {
  await run(sql`select public.platform_pause_org(${input.orgId}::uuid)`);
  revalidatePath("/platform");
  return { orgId: input.orgId };
});
