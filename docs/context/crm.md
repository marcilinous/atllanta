# CRM module

Two layers in one module: a **generic CRM** (leads → opportunities) that any tenant can
use, and the **partner/distribution vertical** built for RTcompu, which only tenants with
`partner_crm_enabled` can see. Keep the two straight — most CRM confusion comes from
mixing them.

---

## 1. Screens

| Route | File | Layer |
|---|---|---|
| `crm` | `views/crm/index.js` | hub, either layer |
| `crm/leads` | `leads.js` | generic (`crm_leads` key) |
| `crm/opportunities` | `opportunities.js` | generic (`crm_pipeline` key) |
| `crm/partners`, `crm/partner` | `partners.js`, `partner-detail.js` | partner pack |
| `crm/field-sales` | `field-sales.js` | partner pack (Distribution) |
| `crm/log-visit` | `visit-form.js` | partner pack |
| `crm/pjp` | `pjp.js` | partner pack (permanent journey plans) |
| `crm/prospects` | `prospects.js` | partner pack |
| `crm/events` | `events.js` | partner pack (field events) |
| `crm/sales` | `sales.js` (508) | partner pack (sales analytics) |
| `crm/reports` | `reports.js` (502) | partner pack (Tally report import) |
| `crm/exports` | `exports.js` | partner pack |

Gating: generic keys need `organizations.crm_enabled`; every partner key needs
`partner_crm_enabled`. Org admins cannot bypass either (`js/features.js`).

## 2. Tables

**Generic:** `crm_leads`, `crm_contacts`, `crm_opportunities`, `crm_pipeline_stages`
(per-tenant stage configuration), `crm_activities`.
**Partner pack:** `crm_partner_details` (41 columns — the partner master;
`crm_accounts` is a backward-compatibility **view** over it with INSTEAD OF triggers
`crm_accounts_view_ins|upd|del`), `crm_visits`, `crm_calls`, `crm_events`,
`crm_event_attendees`, `crm_pjp_day_plans`, `crm_pjp_month_locks`,
`crm_report_imports`, `crm_report_rows`.

Materialised views: `crm_sales_facts`, `crm_field_facts`, `crm_opportunity_features_mv`.
They are **not** refreshed automatically — see §4.

## 3. Database functions (the analytics live in SQL, not the browser)

- Sales: `crm_sales_series(from,to,grain)`, `crm_sales_by(dim,from,to)`,
  `crm_sales_tier_summary(from,to)`, `crm_partner_trend(from,to,grain)`,
  `crm_partner_opportunity(...)`, `crm_territory_potential()`, `crm_coverage()`,
  `crm_inactive_but_buying()`, `crm_uncovered_partners(owner)`.
- Field: `crm_visit_series`, `crm_visit_outcomes`, `crm_visit_split`,
  `crm_call_outcomes`, `crm_partner_activity`, `crm_partner_actions`.
- PJP: `crm_pjp_day_accounts(territory)`, `crm_pjp_gap_accounts(territory)`,
  `crm_pjp_adherence(from,to)`, `crm_pjp_visit_adherence(from,to)`.
- Imports: `crm_insert_report_rows(import_id, rows)` (security **invoker** — dedupes by
  `content_hash` = `md5(data::text)`, so re-uploading a file adds nothing),
  `crm_report_event_date(txt)`, `crm_report_ids()`, `crm_report_windows()`.
- Refresh: `crm_refresh_sales_facts()`, `crm_refresh_field_facts()`,
  `crm_refresh_opportunity_features()` — service-role only.
- Misc: `crm_convert_prospect(partner, mobile, firm)`, `crm_seed_default_stages(org)`
  (+ `crm_seed_stages_on_org` trigger), `crm_telecaller_names()`, `crm_telecaller_book()`.

## 4. Things that catch people out

- **Sales analytics lag imports.** After a report import, `crm_sales_facts` only reflects
  the new rows once `crm_refresh_sales_facts()` runs, and the anon UI cannot call it.
  An admin/edge refresh trigger is still an open follow-up.
- **`crm_accounts` is a view, not a table.** Writes go through the INSTEAD OF triggers to
  `crm_partner_details`.
- **Report import dedupe is content-based**, not filename-based: identical rows never
  land twice, so "nothing imported" usually means "already there".
- **Sales tab filter behaviour is deliberate**: the grain toggle redraws only the time
  series, the dimension toggle only the ranking chart, and the Range presets are the one
  global refilter (`views/crm/sales.js`).
- Several `crm_*` functions are SECURITY DEFINER **and executable by `anon`** — a known
  security-advisor finding queued for the security patch (`ops.md` §7). Don't add more.
- The schema diverges from CLAUDE.md §6.4's proposal (opportunities, not deals; PJP,
  visits and report imports aren't in the doc). The live schema is the truth; §6.4 needs
  reconciling.

## 5. Events

`crm.lead.created|updated`, `crm.visit.logged`, `crm.pjp.planned`, `crm.event.executed`,
`crm.partner.deleted`. Lead conversion and won deals are the two reactions worth knowing:
converted lead → account + opportunity + notify owner; won deal → notify owner/manager.
