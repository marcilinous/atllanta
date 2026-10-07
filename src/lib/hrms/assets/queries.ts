// Read side of the new-stack assets screens. Every loader takes the caller's
// PermissionContext (both gates already passed) and reads inside
// withTransaction — under RLS as the caller, so the v1.16.2 rules decide what
// is visible: owners and admins see the whole register and its history;
// everyone else only the assets assigned to them.
import "server-only";
import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTransaction } from "../../../db/transaction";
import { users } from "../../../db/schema/platform";
import { assetAssignments, assets } from "../../../db/schema/hrms";
import { featureContext } from "../../auth/permissions";
import type { PermissionContext } from "../../auth/permissions-core";
import { orgCurrency } from "../expenses/queries";
import { orgTimeZone } from "../attendance/queries";
import { dayIn } from "../attendance/schemas";
import type { RegisterFilter } from "./schemas";

/**
 * The register's gate for a page: both gates for People (module on, role
 * grant, feature_access) and an owner or admin — the same people the
 * database lets write. Null means "not for you".
 */
export async function assetAdminContext(): Promise<PermissionContext | null> {
  const ctx = await featureContext("people", "people", "view");
  if (!ctx) return null;
  return ctx.role === "owner" || ctx.role === "admin" ? ctx : null;
}

export interface AssetRow {
  id: string;
  name: string;
  type: string;
  serialNumber: string | null;
  status: string;
  holderId: string | null;
  holderName: string | null;
  /** The org-local day it was assigned ("YYYY-MM-DD"). */
  assignedOn: string | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  warrantyEnd: string | null;
  notes: string | null;
}

export interface RegisterTotals {
  total: number;
  assigned: number;
  available: number;
  maintenance: number;
  retired: number;
}

export interface RegisterData {
  currency: string;
  today: string;
  totals: RegisterTotals;
  rows: AssetRow[];
}

const holder = alias(users, "holder");

const assetColumns = {
  id: assets.id,
  name: assets.name,
  type: assets.type,
  serialNumber: assets.serialNumber,
  status: assets.status,
  holderId: assets.assignedTo,
  holderFullName: holder.fullName,
  holderEmail: holder.email,
  assignedAt: assets.assignedAt,
  purchaseDate: assets.purchaseDate,
  purchaseCost: assets.purchaseCost,
  warrantyEnd: assets.warrantyEnd,
  notes: assets.notes,
};

type AssetSelect = {
  id: string;
  name: string;
  type: string;
  serialNumber: string | null;
  status: string;
  holderId: string | null;
  holderFullName: string | null;
  holderEmail: string | null;
  assignedAt: Date | null;
  purchaseDate: string | null;
  purchaseCost: string | null;
  warrantyEnd: string | null;
  notes: string | null;
};

const toAssetRow = (r: AssetSelect, timeZone: string): AssetRow => ({
  id: r.id,
  name: r.name,
  type: r.type,
  serialNumber: r.serialNumber,
  status: r.status,
  holderId: r.holderId,
  holderName: r.holderId ? r.holderFullName || r.holderEmail || "Unnamed" : null,
  assignedOn: r.assignedAt ? dayIn(timeZone, r.assignedAt) : null,
  purchaseDate: r.purchaseDate,
  purchaseCost: r.purchaseCost == null ? null : Number(r.purchaseCost),
  warrantyEnd: r.warrantyEnd,
  notes: r.notes,
});

/** "%" and "_" typed into the search box are literal characters, not wildcards. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function loadRegister(ctx: PermissionContext, filter: RegisterFilter): Promise<RegisterData> {
  const [currency, timeZone] = await Promise.all([orgCurrency(ctx), orgTimeZone(ctx)]);

  return withTransaction({ id: ctx.userId }, async (tx) => {
    const counts = await tx
      .select({ status: assets.status, n: sql<number>`count(*)::int` })
      .from(assets)
      .where(eq(assets.orgId, ctx.orgId))
      .groupBy(assets.status);
    const totals: RegisterTotals = { total: 0, assigned: 0, available: 0, maintenance: 0, retired: 0 };
    for (const c of counts) {
      totals.total += c.n;
      if (c.status in totals) totals[c.status as keyof RegisterTotals] += c.n;
    }

    const pattern = filter.q ? likePattern(filter.q) : null;
    const rows = await tx
      .select(assetColumns)
      .from(assets)
      .leftJoin(holder, eq(holder.id, assets.assignedTo))
      .where(
        and(
          eq(assets.orgId, ctx.orgId),
          filter.type ? eq(assets.type, filter.type) : undefined,
          filter.status ? eq(assets.status, filter.status) : undefined,
          pattern
            ? or(ilike(assets.name, pattern), ilike(assets.serialNumber, pattern), ilike(holder.fullName, pattern))
            : undefined
        )
      )
      .orderBy(desc(assets.createdAt))
      .limit(500);

    return { currency, today: dayIn(timeZone), totals, rows: rows.map((r) => toAssetRow(r, timeZone)) };
  });
}

export interface HistoryRow {
  id: string;
  personName: string;
  assignedByName: string | null;
  /** Org-local days ("YYYY-MM-DD"). */
  assignedOn: string;
  returnedOn: string | null;
  notes: string | null;
}

export interface PersonOption {
  id: string;
  name: string;
  email: string | null;
}

export interface AssetDetail {
  currency: string;
  today: string;
  asset: AssetRow;
  history: HistoryRow[];
  people: PersonOption[];
}

const person = alias(users, "person");
const assigner = alias(users, "assigner");

/** One asset with its history and the people it can be assigned to; null if not visible. */
export async function loadAsset(ctx: PermissionContext, assetId: string): Promise<AssetDetail | null> {
  const [currency, timeZone] = await Promise.all([orgCurrency(ctx), orgTimeZone(ctx)]);

  return withTransaction({ id: ctx.userId }, async (tx) => {
    const [found] = await tx
      .select(assetColumns)
      .from(assets)
      .leftJoin(holder, eq(holder.id, assets.assignedTo))
      .where(and(eq(assets.id, assetId), eq(assets.orgId, ctx.orgId)))
      .limit(1);
    if (!found) return null;

    const history = await tx
      .select({
        id: assetAssignments.id,
        personFullName: person.fullName,
        personEmail: person.email,
        assignerFullName: assigner.fullName,
        assignerEmail: assigner.email,
        assignedAt: assetAssignments.assignedAt,
        returnedAt: assetAssignments.returnedAt,
        notes: assetAssignments.notes,
      })
      .from(assetAssignments)
      .leftJoin(person, eq(person.id, assetAssignments.userId))
      .leftJoin(assigner, eq(assigner.id, assetAssignments.assignedBy))
      .where(and(eq(assetAssignments.assetId, assetId), eq(assetAssignments.orgId, ctx.orgId)))
      .orderBy(desc(assetAssignments.assignedAt));

    // Anyone in the company who hasn't left — the same rule assets_guard()
    // applies (people on notice can still be given equipment).
    const people = await tx
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(and(eq(users.orgId, ctx.orgId), ne(users.status, "exited")))
      .orderBy(asc(users.fullName));

    return {
      currency,
      today: dayIn(timeZone),
      asset: toAssetRow(found, timeZone),
      history: history.map((h) => ({
        id: h.id,
        personName: h.personFullName || h.personEmail || "Unnamed",
        assignedByName: h.assignerFullName || h.assignerEmail || null,
        assignedOn: dayIn(timeZone, h.assignedAt),
        returnedOn: h.returnedAt ? dayIn(timeZone, h.returnedAt) : null,
        notes: h.notes,
      })),
      people: people.map((p) => ({ id: p.id, name: p.fullName || p.email || "Unnamed", email: p.email })),
    };
  });
}

export interface MyAssetRow {
  id: string;
  name: string;
  type: string;
  serialNumber: string | null;
  /** The org-local day it was assigned ("YYYY-MM-DD"). */
  assignedOn: string | null;
  warrantyEnd: string | null;
}

export interface MyAssetsData {
  today: string;
  rows: MyAssetRow[];
}

/** What the caller holds now. RLS already limits a non-admin to these. */
export async function loadMyAssets(ctx: PermissionContext): Promise<MyAssetsData> {
  const timeZone = await orgTimeZone(ctx);
  const rows = await withTransaction({ id: ctx.userId }, (tx) =>
    tx
      .select({
        id: assets.id,
        name: assets.name,
        type: assets.type,
        serialNumber: assets.serialNumber,
        assignedAt: assets.assignedAt,
        warrantyEnd: assets.warrantyEnd,
      })
      .from(assets)
      .where(and(eq(assets.assignedTo, ctx.userId), eq(assets.orgId, ctx.orgId)))
      .orderBy(desc(assets.assignedAt))
  );
  return {
    today: dayIn(timeZone),
    rows: rows.map(({ assignedAt, ...r }) => ({ ...r, assignedOn: assignedAt ? dayIn(timeZone, assignedAt) : null })),
  };
}
