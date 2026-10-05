"use server";

// Company sign-up (v1.12.0). The caller has no organisation yet — that is the
// point — so there is no permission gate; create_company() itself refuses
// anyone who already belongs to one, checks the input again, and makes the
// org, the owner, the chosen modules, three leave types, the audit row and
// the platform.org.created event in this one transaction.

import { sql } from "drizzle-orm";
import { action, ActionError } from "../../actions";
import { withTransaction } from "../../../db/transaction";
import { getSessionUser } from "../../supabase/server";
import { createCompanySchema } from "./schemas";

/** Walks Drizzle/postgres.js error wrapping. */
function pgError(err: unknown): { code?: string; message?: string } {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return { code, message: String((e as { message?: unknown }).message ?? "") };
    e = (e as { cause?: unknown }).cause;
  }
  return {};
}

export const createCompany = action(createCompanySchema, async (input) => {
  const user = await getSessionUser();
  if (!user) throw new ActionError("Sign in to create a company.");

  const orgId = await withTransaction({ id: user.id }, async (tx) => {
    try {
      const rows = (await tx.execute(
        sql`select public.create_company(
          ${input.name},
          ${input.timeZone},
          ${input.currency},
          array(select jsonb_array_elements_text(${JSON.stringify(input.modules)}::jsonb))
        ) as id`
      )) as unknown as { id: string }[];
      return rows[0].id;
    } catch (err) {
      const { code, message = "" } = pgError(err);
      // A second, simultaneous click: the first call's owner row wins.
      if (code === "23505") throw new ActionError("You already belong to an organisation.");
      if (code === "42501" || code === "22023") throw new ActionError(message.replace(/^.*?:\s*/, "") || "That isn't allowed.");
      throw err;
    }
  });

  return { orgId };
});
