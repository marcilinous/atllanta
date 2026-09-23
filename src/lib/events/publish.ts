// Events are written only through the `publish_event` security-definer RPC: the
// events table has no INSERT policy, so a direct insert is refused by RLS. The
// RPC stamps the actor (auth.uid()) and refuses an org the caller isn't a member
// of, which is why publishing can be trusted from a user-scoped client.
//
// The client is injected rather than built here — Phase 2 owns the per-request
// Supabase client, and injecting it keeps this module testable.

import { ok, fail } from "../actions.ts";
import type { ActionResponse } from "../actions.ts";

export interface EventClient {
  // PromiseLike, not Promise: supabase-js returns a PostgrestFilterBuilder,
  // which is thenable but has no catch/finally. This function only ever awaits
  // the result, so a thenable is all it needs — declaring Promise would reject
  // the real client while accepting nothing this module actually uses.
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface PublishEventInput {
  /** `module.entity.action`, e.g. "people.employee.updated". */
  eventType: string;
  orgId: string;
  payload?: Record<string, unknown>;
}

export async function publishEvent(
  client: EventClient,
  input: PublishEventInput
): Promise<ActionResponse<string>> {
  const eventType = input.eventType.trim();
  if (!eventType) return fail("An event type is required.");

  const orgId = input.orgId.trim();
  if (!orgId) return fail("An organisation is required.");

  const { data, error } = await client.rpc("publish_event", {
    p_event_type: eventType,
    p_payload: input.payload ?? {},
    p_org_id: orgId,
  });

  if (error) {
    console.error("[events] publish failed", error.message);
    return fail("Could not record that change. Please try again.");
  }

  if (typeof data !== "string" || !data) {
    console.error("[events] publish returned no event id", data);
    return fail("Could not record that change. Please try again.");
  }

  return ok(data);
}
