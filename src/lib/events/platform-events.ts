// The events the Phase 3 admin screens publish (src/lib/settings/actions.ts),
// after their transaction commits. `module.entity.action` per CLAUDE.md §6.
//
// Nothing consumes them yet — CLAUDE.md §4 defines no reaction to a module
// switch or a role change — so every processor completes them untouched:
// the legacy cron (server/legacy/event-processor.js) and browser processor
// (public/js/event-processor.js) mark any event without a recipe completed,
// and the new-stack drain (drain.ts) does the same for an event with no
// subscribers. tests/platform-events.test.mjs holds all three to that. A
// future consumer (e.g. Step 3's enforcement refreshing a cached gate)
// registers a subscriber in drain.ts; it must not be a legacy recipe, which
// runs as the service role.
//
// No `server-only` import: node:test imports this file directly.

export const PLATFORM_EVENTS = {
  moduleEnabled: "platform.module.enabled",
  moduleDisabled: "platform.module.disabled",
  roleCreated: "platform.role.created",
  roleUpdated: "platform.role.updated",
  // Not named in CLAUDE.md §3.5, which lists created/updated only; added
  // with Step 4 so a deletion is not invisible on the bus.
  roleDeleted: "platform.role.deleted",
} as const;

export type PlatformEventType = (typeof PLATFORM_EVENTS)[keyof typeof PLATFORM_EVENTS];
export const PLATFORM_EVENT_TYPES = Object.values(PLATFORM_EVENTS) as PlatformEventType[];
