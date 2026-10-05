// Input for the platform owner's company actions. No `server-only`: tests import it.
import { z } from "zod";

export const orgActionSchema = z.object({ orgId: z.uuid("Choose a company.") });

export const extendTrialSchema = z.object({
  orgId: z.uuid("Choose a company."),
  days: z.union([z.literal(7), z.literal(14), z.literal(30)], { message: "Extend by 7, 14 or 30 days." }),
});

export type PlatformOrgState = "ok" | "trial_ended" | "paused";

export interface PlatformOrg {
  id: string;
  name: string;
  people: number;
  planTier: string;
  paymentStatus: string;
  state: PlatformOrgState;
  trialEndsAt: string | null;
  trialExtendedDays: number;
  maxTrialExtensionDays: number;
  createdAt: string;
}
