// The drain half of the event bus, stubbed (Phase 1 item 5): it claims pending
// events, hands each to its subscribers and resolves it, but `subscribers` is
// deliberately empty and nothing calls `drainEvents` yet — production is still
// drained by the legacy cron (`/api/event-processor`), and two drains competing
// for the same rows would double-handle them.
//
// claim_events and resolve_event are security-definer RPCs scoped to the
// caller's orgs, so a drain can only ever see its own tenant's events.

import { ok, fail } from "../actions.ts";
import type { ActionResponse } from "../actions.ts";
import type { EventClient } from "./publish.ts";

export interface DrainEvent {
  id: string;
  org_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export type EventHandler = (event: DrainEvent) => Promise<void>;

/** No subscribers on the new stack yet; modules register here as they migrate. */
export const subscribers: Readonly<Record<string, EventHandler[]>> = {};

function isDrainEvent(value: unknown): value is DrainEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.org_id === "string" &&
    typeof e.event_type === "string" &&
    typeof e.payload === "object" &&
    e.payload !== null &&
    typeof e.attempts === "number"
  );
}

export async function drainEvents(
  client: EventClient,
  batchSize = 20
): Promise<ActionResponse<{ claimed: number; completed: number; failed: number }>> {
  const { data, error } = await client.rpc("claim_events", { batch_size: batchSize });

  if (error) {
    console.error("[events] claim failed", error.message);
    return fail("Could not read pending events.");
  }

  if (!Array.isArray(data)) return ok({ claimed: 0, completed: 0, failed: 0 });

  let claimed = 0;
  let completed = 0;
  let failed = 0;

  for (const raw of data) {
    if (!isDrainEvent(raw)) continue;
    claimed++;

    const handlers = subscribers[raw.event_type] ?? [];
    let handlerFailed = false;

    for (const handler of handlers) {
      try {
        await handler(raw);
      } catch (err) {
        handlerFailed = true;
        console.error("[events] handler failed", raw.event_type, err);
        await client.rpc("resolve_event", {
          event_id: raw.id,
          new_status: "failed",
          p_error: String(err instanceof Error ? err.message : err).slice(0, 500),
        });
        failed++;
        break;
      }
    }

    if (!handlerFailed) {
      await client.rpc("resolve_event", { event_id: raw.id, new_status: "completed" });
      completed++;
    }
  }

  return ok({ claimed, completed, failed });
}
