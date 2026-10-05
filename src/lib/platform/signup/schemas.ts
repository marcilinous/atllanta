// Input for company sign-up (/start). The org, the person and the role never
// come from input — create_company() takes the caller from the session and
// always makes them owner. The database checks everything again; these
// lists are only what the form offers.
//
// No `server-only` import: tests import this file directly.
import { z } from "zod";

export const SIGNUP_MODULES = [
  { key: "people", label: "People — directory, assets, letters" },
  { key: "me", label: "Me — attendance and leave" },
  { key: "inbox", label: "Inbox and approvals" },
  { key: "documents", label: "Documents" },
  { key: "finance", label: "Finance — expenses" },
  { key: "announcements", label: "Announcements" },
  { key: "recruitment", label: "Recruitment" },
  { key: "crm", label: "CRM" },
  { key: "analytics", label: "Analytics" },
  { key: "helpdesk", label: "Helpdesk" },
  { key: "projects", label: "Projects" },
  { key: "ai", label: "AI Assistant" },
] as const;

export type SignupModuleKey = (typeof SIGNUP_MODULES)[number]["key"];

const MODULE_KEYS = SIGNUP_MODULES.map((m) => m.key) as [SignupModuleKey, ...SignupModuleKey[]];

export const TIME_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
] as const;

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"] as const;

export const createCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters.")
    .max(100, "Company name must be 100 characters or fewer."),
  timeZone: z.string().regex(/^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/, "Choose a time zone."),
  currency: z.string().regex(/^[A-Z]{3}$/, "Choose a currency."),
  modules: z.array(z.enum(MODULE_KEYS)).min(1, "Choose at least one module."),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
