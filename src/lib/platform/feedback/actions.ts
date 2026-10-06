"use server";

// Send feedback (anyone signed in, blocked companies included) and, for the
// platform owner, mark it read. Both run as the caller; the SQL functions do
// the checks and stamp the sender.
import { revalidatePath } from "next/cache";
import { sql, type SQL } from "drizzle-orm";
import { action, ActionError } from "../../actions";
import { withTransaction } from "../../../db/transaction";
import { getSessionUser } from "../../supabase/server";
import { explainFeedbackError } from "./explain";
import { markReadSchema, safeFrom, submitFeedbackSchema } from "./schemas";

async function run<T>(query: SQL): Promise<T[]> {
  const user = await getSessionUser();
  if (!user) throw new ActionError("Sign in to send feedback.");
  return withTransaction({ id: user.id }, async (tx) => {
    try {
      return (await tx.execute(query)) as unknown as T[];
    } catch (err) {
      const message = explainFeedbackError(err);
      if (message) throw new ActionError(message);
      throw err;
    }
  });
}

export const submitFeedback = action(submitFeedbackSchema, async (input) => {
  const [row] = await run<{ id: string }>(
    sql`select public.submit_feedback(${input.kind}, ${input.rating}::int, ${input.message}, ${safeFrom(input.page)}) as id`
  );
  return { id: row.id };
});

export const markFeedbackRead = action(markReadSchema, async (input) => {
  await run(sql`select public.platform_feedback_mark_read(${input.id}::uuid, ${input.read})`);
  revalidatePath("/platform/feedback");
  revalidatePath("/platform");
  return { id: input.id, read: input.read };
});
