# RT Compu — partner analysis

Queries that run against the CRM data already loaded in Supabase
(`crm_report_rows` + `crm_accounts`). Read-only. Run them in the Supabase
SQL editor and use **Download CSV** to export.

## Data currently loaded

| Import | Period | Rows | Site ID matched |
|---|---|---|---|
| LFY Activation Report | FY2025-26 | 27,050 | 100% |
| Activation Report | FY2026-27 | 9,523 | 99.9% |
| TL/BDE Visits | — | 2,222 | 98% |
| Telecalling Report | — | 8,516 | 99% |
| CM visits | — | 844 | **0%** — no site ID column mapped |

## Field notes

- **TP (new licence)** = `data->>'activation type' = 'New'`.
  Other types: `TSS`, `Rental`, `VAS`, `Upgrade`, `TVU`.
- **Value** = `data->>'sum of activation value'`.
  Do *not* use `activation value` — it is populated on 5 rows out of 36,573.
- **UAP** = partner with at least one `New` row in the current FY.
- FY runs 1 April – 31 March. CFY data currently ends **3 Aug 2026**.

## Headline numbers

| | |
|---|---|
| Partners transacting | 3,035 |
| Bought a new licence LFY | 1,228 |
| UAP so far this FY | 650 |
| New licences — CFY to date | 1,325 |
| New licences — LFY same period | 1,258 |
| **Pace** | **+5.3% ahead of last year** |

### The reactivation gap

| | Partners | LFY licences | LFY value |
|---|---|---|---|
| Bought LFY, nothing CFY | 737 | 1,260 | ₹6.30 Cr |
| — of those, **still transacting CFY** | **387** | **794** | — |
| — of those, **never visited** | **203** | **376** | **₹2.15 Cr** |

794 licences is **60% of everything sold so far this year**, sitting in
partners who are still paying us and have not bought a single new licence.

## Files

- `reactivation-list.sql` — the 387 warm lapsed partners, ranked
- `headline-numbers.sql` — the summary table above
