// Module 1 (HRMS) tables, hand-written against the live Supabase database
// (Phase 4 item 1), in the same way as platform.ts — declarations of the
// existing schema only. Nothing here is pushed or migrated: the database is
// shared with the legacy app, which keeps using these tables until each HRMS
// screen is cut over.
//
// Verified read-only on 2026-09-29 against project `nburswxjpukntgdwuyme`:
// every column, type, nullability and default via information_schema.columns
// (tests/hrms-schema.test.mjs holds the declared columns equal to that
// snapshot), the 32 foreign keys (with their ON DELETE rules), and the unique
// and CHECK constraints via pg_constraint. `leave_balances.balance` is a
// generated column (opening_balance + accrued - used) and must never be
// written.
//
// Scope: the 14 HRMS tables. Lifecycle, generated letters and the document
// store have no tables of their own — they are built on users, events and
// files (platform.ts). Helpdesk is Module 5 (Phase 8).
//
// Live names win over CLAUDE.md's sketch where they differ (decision
// 2026-09-18), e.g. holidays.date (not holiday_date), leave_types.annual_quota
// (not default_days), assets.type (not category), expenses.receipt_url (not
// receipt_file_id), and work_schedules' shift_start/shift_end/weekly_offs
// (not details jsonb).
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  date,
  time,
  unique,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
// `.ts` extension: tests/hrms-schema.test.mjs imports this file directly
// under node:test (allowImportingTsExtensions, as permissions-core.ts does).
import { organizations, users } from "./platform.ts";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow();

// Status/type values, exactly as the live CHECK constraints allow them.
export const ATTENDANCE_STATUSES = ["present", "absent", "half_day", "late", "on_leave", "holiday", "weekly_off"] as const;
export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export const LEAVE_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export const EXPENSE_STATUSES = ["pending", "approved", "rejected", "reimbursed"] as const;
export const ASSET_STATUSES = ["available", "assigned", "maintenance", "retired"] as const;
export const ASSET_TYPES = ["Laptop", "Phone", "Access Card", "Monitor", "Keyboard", "Mouse", "Headset", "Other"] as const;
export const POST_TYPES = ["announcement", "shoutout", "update", "milestone"] as const;

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} = ANY (ARRAY[${values.map((v) => `'${v}'::text`).join(", ")}])`);

// --- Attendance --------------------------------------------------------------

export const workLocations = pgTable("work_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  lat: numeric("lat").notNull(),
  lng: numeric("lng").notNull(),
  radiusM: integer("radius_m").notNull().default(150),
  isActive: boolean("is_active").notNull().default(true),
  // No FK in the live database.
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workSchedules = pgTable("work_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shiftStart: time("shift_start").notNull().default("09:00:00"),
  shiftEnd: time("shift_end").notNull().default("18:00:00"),
  weeklyOffs: integer("weekly_offs").array().default(sql`'{1,7}'::integer[]`),
  isDefault: boolean("is_default").default(false),
  createdAt: createdAt(),
});

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    date: date("date").notNull(),
    checkIn: timestamp("check_in", { withTimezone: true }),
    checkOut: timestamp("check_out", { withTimezone: true }),
    checkInLat: numeric("check_in_lat"),
    checkInLng: numeric("check_in_lng"),
    checkOutLat: numeric("check_out_lat"),
    checkOutLng: numeric("check_out_lng"),
    status: text("status").default("present"),
    totalHours: numeric("total_hours"),
    notes: text("notes"),
    createdAt: createdAt(),
    checkInSelfiePath: text("check_in_selfie_path"),
    checkOutSelfiePath: text("check_out_selfie_path"),
    checkInLocationId: uuid("check_in_location_id").references(() => workLocations.id, { onDelete: "set null" }),
    checkOutLocationId: uuid("check_out_location_id").references(() => workLocations.id, { onDelete: "set null" }),
  },
  (t) => [
    unique("attendance_user_id_date_key").on(t.userId, t.date),
    check("attendance_status_check", inList("status", ATTENDANCE_STATUSES)),
  ]
);

export const attendanceRegularizations = pgTable(
  "attendance_regularizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    attendanceId: uuid("attendance_id").notNull().references(() => attendance.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    requestedCheckIn: timestamp("requested_check_in", { withTimezone: true }),
    requestedCheckOut: timestamp("requested_check_out", { withTimezone: true }),
    status: text("status").default("pending"),
    // No FK in the live database.
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  () => [check("attendance_regularizations_status_check", inList("status", REVIEW_STATUSES))]
);

export const holidays = pgTable("holidays", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  date: date("date").notNull(),
  isOptional: boolean("is_optional").default(false),
  year: integer("year").notNull(),
  createdAt: createdAt(),
});

// --- Leave -------------------------------------------------------------------

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    annualQuota: integer("annual_quota").notNull().default(12),
    carryForward: boolean("carry_forward").default(false),
    maxCarryForward: integer("max_carry_forward").default(0),
    maxConsecutiveDays: integer("max_consecutive_days"),
    requiresDocument: boolean("requires_document").default(false),
    isPaid: boolean("is_paid").default(true),
    isActive: boolean("is_active").default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("leave_types_org_id_code_key").on(t.orgId, t.code)]
);

export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    openingBalance: numeric("opening_balance").default("0"),
    accrued: numeric("accrued").default("0"),
    used: numeric("used").default("0"),
    // Generated by Postgres; never write it.
    balance: numeric("balance").generatedAlwaysAs(sql`((opening_balance + accrued) - used)`),
  },
  (t) => [unique("leave_balances_user_id_leave_type_id_year_key").on(t.userId, t.leaveTypeId, t.year)]
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    leaveTypeId: uuid("leave_type_id").notNull().references(() => leaveTypes.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    days: numeric("days").notNull(),
    reason: text("reason"),
    documentUrl: text("document_url"),
    status: text("status").default("pending"),
    // No FK in the live database.
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewComment: text("review_comment"),
    createdAt: createdAt(),
  },
  () => [check("leave_requests_status_check", inList("status", LEAVE_REQUEST_STATUSES))]
);

// --- Assets ------------------------------------------------------------------

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    type: text("type").notNull().default("Other"),
    serialNumber: text("serial_number"),
    purchaseDate: date("purchase_date"),
    purchaseCost: numeric("purchase_cost"),
    warrantyEnd: date("warranty_end"),
    notes: text("notes"),
    status: text("status").notNull().default("available"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("assets_status_check", inList("status", ASSET_STATUSES)),
    check("assets_type_check", inList("type", ASSET_TYPES)),
    // v1.16.2 (assets integrity).
    check(
      "assets_holder_consistent",
      sql`(${t.status} = 'assigned') = (${t.assignedTo} is not null) and (${t.assignedTo} is null) = (${t.assignedAt} is null)`
    ),
    check("assets_purchase_cost_nonnegative", sql`${t.purchaseCost} is null or ${t.purchaseCost} >= 0`),
  ]
);

export const assetAssignments = pgTable(
  "asset_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    assignedBy: uuid("assigned_by").references(() => users.id),
    notes: text("notes"),
  },
  // v1.16.2 (assets integrity): at most one open record per asset.
  (t) => [uniqueIndex("asset_assignments_one_open").on(t.assetId).where(sql`${t.returnedAt} is null`)]
);

// --- Expenses ----------------------------------------------------------------

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    spendingLimit: numeric("spending_limit"),
    isActive: boolean("is_active").default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("expense_categories_org_id_code_key").on(t.orgId, t.code)]
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    categoryId: uuid("category_id").references(() => expenseCategories.id),
    title: text("title").notNull(),
    amount: numeric("amount").notNull(),
    currency: text("currency").default("INR"),
    expenseDate: date("expense_date").notNull(),
    receiptUrl: text("receipt_url"),
    description: text("description"),
    status: text("status").default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewComment: text("review_comment"),
    reimbursedAt: timestamp("reimbursed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("expenses_status_check", inList("status", EXPENSE_STATUSES)),
    // v1.15.1 (expenses integrity).
    check("expenses_amount_positive", sql`${t.amount} > 0`),
  ]
);

// --- Announcements & noticeboard ---------------------------------------------

export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  pinned: boolean("pinned").default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    // No FK in the live database.
    authorId: uuid("author_id").notNull(),
    content: text("content").notNull(),
    type: text("type").notNull().default("announcement"),
    pinned: boolean("pinned").default(false),
    reactions: jsonb("reactions").default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [check("posts_type_check", inList("type", POST_TYPES))]
);
