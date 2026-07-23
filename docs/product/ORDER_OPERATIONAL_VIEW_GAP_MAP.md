# OrderOperationalView — API/UI Gap Map

Status: draft for review, verified against current code (2026-07-23). Companion to `ORDER_OPERATIONAL_VIEW_CONTRACT.md`.

## Files and modules inspected

**`orderwatch-backend`:** `lib/contact-registry.js`, `lib/canonical-lines.js`, `lib/canonical-persistence.js`, `lib/supplier-document-reconciliation.js`, `lib/invoice-order-matching.js`, `lib/invoice-persistence.js`, `lib/outbound-operational-facts.js`, `lib/outbound-counterparty.js`, `lib/receiving.js`, `lib/supplier-confirmation-matcher.js`, `lib/entity-matching.js`, `lib/workflow-policy.js`, `lib/repository.js`, `lib/supabase.js`, `lib/system-health.js`, `worker/email-processor.js` (2196 lines, read in full), `worker/outbound-email-processor.js`, `worker/imap-watcher.js` (targeted), `api/dashboard.js`, `api/review-queue.js`, `api/operational-queue.js`, `api/orders/[id].js`, `scripts/replay/*` (all 16 files), `tests/replay/*.test.js` (all 5 files).

**`Graphic Center Group`:** `server/routes/orders.js`, `altera.js`, `altera-telegram.js`, `operational-actions.js`, `receiving.js`, `supplier-orders.js`, `customer-confirmations.js`, `server/lib/_auth.js`, `_dataSource.js`, `_supabaseRest.js`, `api/dashboard.js`, `src/adapters/apiAdapter.js`, `src/components/OrderDetailPanel.jsx`, `OperationalEvidence.jsx`, `OperationalRow.jsx`, `src/views/AlteraView.jsx`, `OrdersView.jsx`.

**Live Supabase schema** (project `drwbmnahiygxcbyxxpbx`): full `information_schema.columns` for 40+ tables, plus `pg_views` definitions for `canonical_operational_lines`, `canonical_operational_lines_base`, `data_source_coverage`, `system_health_alerts` — these four are DB-level views **not present in any `.sql` migration file in either repo**, i.e. schema that exists live but is untracked by version control in the codebases inspected.

## Persistence → API → UI trace (summary)

```
canonical_operational_lines_base (VIEW, unions 5 line tables)
  └─ canonical_operational_lines (VIEW, adds purchase_order_line status override)
       ├─ orderwatch-backend/lib/repository.js#listOperationalQueue/listReviewQueue  [DORMANT — see §Security]
       └─ Graphic Center Group/server/routes/altera.js  [LIVE, whole-org, chat context only]
              └─ AlteraView.jsx  [LIVE — citations render + navigate]
       (no per-order filtered consumer exists anywhere)

canonical_line_sources (TABLE, evidence ledger)
  └─ written by: canonical-persistence.js, supplier-orders.js
  └─ read by: nothing (grep-confirmed, no SELECT anywhere in either repo)

delivery_notes + delivery_note_lines + receipt_allocations
  └─ Graphic Center Group/server/routes/receiving.js  [LIVE, joined, source_email_id STRIPPED]
       └─ ReceivingView (not read in this pass, referenced by route only)
       (OrderDetailPanel does not consume this join)

data_source_coverage (VIEW) + data_source_coverage_snapshots (TABLE, hourly)
  └─ system_health_alerts (VIEW, LATERAL joins snapshot for trend)
       └─ altera.js  [LIVE, whole-org, chat context only]
       (no Graphic Center Group UI view renders coverage/health at all)

outbound-operational-facts.js (computed, pure functions)
  └─ normalizeOutboundOperationalFacts()  [LIVE, called from worker/outbound-email-processor.js]
       └─ persisted only inside activities.metadata JSONB — no dedicated table/column
  └─ consolidateCommitments()  [NOT LIVE — only called from scripts/simulate-mbox-operational-window.js]
       (active-vs-superseded commitment resolution has never run against real data)

historical_email_import_proposals (TABLE, one-time import via scripts/import-mbox-evidence.js)
  └─ altera.js  [LIVE, read-only]
  (never surfaced in any Graphic Center Group UI view)

OperationalEvidence.jsx (real evidence UI: source cards, confidence %, "Apri fonte" link)
  └─ used in exactly ONE place: DashboardView.jsx
  (not reused in OrderDetailPanel.jsx, OrdersView.jsx, or ReceivingView)
```

## Ten scenarios

For each: what's stored vs. queried vs. returned vs. rendered, and the gap classification.

### 1. Known supplier, known contact
- **Stored:** `contacts` (verified), `contact_emails` (verified+match_enabled), `orders.supplier_contact_id`.
- **Queried:** only implicitly, via `lib/contact-registry.js#resolveContactByEmail` at ingestion time — never re-queried for display.
- **Returned:** no API returns `contacts.verification_status`/`legal_name` joined to an order.
- **Rendered:** `OrderDetailPanel` shows only `order.supplierName` (flat string) — cannot tell a verified canonical contact from an unverified AI guess.
- **Gap:** `QUERY_OR_SERVICE` — the join is trivial (single FK lookup), no new table needed.

### 2. Known supplier, unknown contact
- **Stored:** `contacts` row exists; `supplier_contacts` (person-level) has **0 rows in production**, confirmed via live query.
- **Queried/Returned/Rendered:** n/a — there is nothing to query.
- **Gap:** `DATA_MODEL_GAP` — but narrowly: the table (`supplier_contacts`) and its columns already exist; what's missing is a **population path** (nothing in the ingestion pipeline writes to it), not a schema change. Classify as data-model gap only in the "populate it" sense, not "design it" sense.

### 3. Order with active commitment
- **Stored:** individual commitments are computed live (`normalizeOutboundOperationalFacts`, called from `worker/outbound-email-processor.js`) and persisted, but **only inside `activities.metadata` JSONB** — there is no `commitments` table/column.
- **Queried:** `activities` is queried elsewhere (buyer_action feeds) but never filtered/parsed for `metadata.commitments`.
- **Returned:** no API surfaces this.
- **Rendered:** nowhere.
- **Gap:** `QUERY_OR_SERVICE` for the "read it back and run `consolidateCommitments()`" part (the function already exists and is tested) — but flag clearly that this is the first time it would run against live data, so treat the first integration as needing careful verification against real orders (see Alberto checklist), not as a zero-risk aggregation.

### 4. Order with superseded commitment
- Same storage/query path as #3. **`consolidateCommitments()` has literally never been invoked against real `activities` rows** (only against a synthetic fixture in `scripts/simulate-mbox-operational-window.js`). This is the highest-uncertainty scenario in the whole gap map.
- **Gap:** `UNKNOWN_REQUIRES_TEST` — until it's run against real data at least once, we don't know if real-world commitment `kind`+`scope` keys collide/behave as the function assumes.

### 5. Linked supplier confirmation
- **Stored:** `supplier_order_dispatches.status = 'confirmed'`, `orders.supplier_order_status`, activity log entry — all written by `lib/supplier-confirmation-matcher.js#applySupplierConfirmation`.
- **Queried:** yes, `supplier-orders.js` reads dispatch status for its own workflow.
- **Returned:** dispatch status is returned by `supplier-orders.js`'s own endpoints, but not joined onto the order detail response.
- **Rendered:** `OrderDetailPanel` shows a dead field, `order.supplierResponse` — populated only by the legacy `airtableAdapter.js`, **never by the production Supabase mapper** (confirmed by grep: `supabaseServerAdapter.js`'s orders mapper does not set this key). This field silently renders `"-"` in production today.
- **Gap:** `UI_ONLY` for wiring the real dispatch status in; separately flag the dead field as a `UI_ONLY` cleanup item (remove or repoint, not a functional gap, a correctness/trust gap since it looks populated but never is).

### 6. Linked DDT/delivery document
- **Stored:** `delivery_notes`/`delivery_note_lines`/`receipt_allocations`, with `match_method`/`confidence` per allocation.
- **Queried:** yes, fully joined server-side in `receiving.js`.
- **Returned:** `receiving.js` returns `matchMethod`/`confidence` (real evidence) but **explicitly strips `source_email_id`** from every mapped shape (`mappedOrderLines`, `mappedAllocations`, `deliveryNotes` — confirmed by reading the full mapping code).
- **Rendered:** shown in the Receiving view (not `OrderDetailPanel`).
- **Gap:** `API_ONLY` — add `sourceEmailId` back to the existing response shape (one field, no new query); separately, `QUERY_OR_SERVICE` to reuse this join from order-detail instead of only from Receiving.

### 7. Unmatched or ambiguous document
- **Stored:** `extraction_candidates` (`candidate_type: 'line_ambiguity'` or `'invoice_order_match'`), plus prose-only ambiguity notes buried in `activities.detail` for reference-conflict cases (`'ambiguous_reference'`/`'supplier_reference_conflict'` from `findOrderForSupplierDocument`).
- **Queried:** `listReviewQueue` reads `extraction_candidates` (backend, dormant), nothing reads the `activities`-embedded conflict prose structurally.
- **Returned/Rendered:** nowhere per-order.
- **Gap:** `QUERY_OR_SERVICE` for `extraction_candidates` (structured already); `DATA_MODEL_GAP` (small) for the reference-conflict case — today it's a string in `activities.detail`, needs a structured field (reasonCode + competing order ids) to become genuinely queryable, per Contract §3.13.

### 8. Incomplete mailbox coverage
- **Stored/Queried:** the `data_source_coverage` view computes this live and correctly (verified by reading its SQL) — including the "quiet channel vs. unwatched channel" distinction required by the task (Mandatory Question 9).
- **Returned:** only inside `altera.js`'s org-wide chat context.
- **Rendered:** **nowhere in Graphic Center Group's own UI.** Confirmed: no view file references `data_source_coverage` or `system_health_alerts`.
- **Gap:** `UI_ONLY` — the hardest part (the SQL) is already done; this is purely a rendering gap. High priority given it directly affects trust in every other field ("was this order's silence actually checked, or just never observed").

### 9. No operational evidence
- **Stored:** an order with zero canonical lines, zero linked documents.
- **Queried/Returned:** would correctly come back as empty arrays from the queries above.
- **Rendered:** **risk of misleading empty state** — `OrderDetailPanel` today has no distinction between "this order genuinely has no linked lines" and "the join was never attempted" (because today no join is attempted at all, so every order effectively looks like scenario 9 from the UI's point of view, whether or not lines exist).
- **Gap:** `UI_ONLY` once the API exists, but flag now: any implementation MUST render `coverageAndSyncHealth` next to an empty `canonicalMaterialLines`/`linkedDocuments`, or the empty state will read as "nothing happened" when it might mean "not observed" — this is the exact anti-pattern the Contract's authority model (§1.1) exists to prevent.

### 10. Conflicting or uncertain evidence
- Covered structurally by §3.13 (`ambiguousEvidence`) and the four explicit conflict-detection mechanisms found in `worker/email-processor.js`: `reconcileSupplierClassification` (type vs. extraction contradiction), `normalizeClassificationV2`'s origin-contradiction check, `reconcileTrustedSupplierClassification` (contact-registry vs. AI — **inert today**, gated behind the `engine.supplier_purchase_cycle_reconciliation` setting, which is `false` by default and has no seed row anywhere), and line-identity ambiguity (`findAmbiguousLineIdentities`).
- **Gap:** `QUERY_OR_SERVICE` for the three live mechanisms; note the fourth (`reconcileTrustedSupplierClassification`) is currently dead code in production — don't count it as "already surfaced" anywhere until the flag is actually turned on for a tenant.

## Security gaps found (beyond the 10 scenarios)

**`orderwatch-backend/api/*` has no tenant filtering at all.** Read in full: `lib/repository.js#listReviewQueue`/`listOperationalQueue` query `orders`, `documents`, `canonical_operational_lines`, `quotes`, `delivery_notes`, `invoices`, `buyer_actions`, `extraction_candidates`, `mailboxes`, `settings`, `entity_aliases`, `learning_rules` with **zero `.eq('organization_id', ...)`** anywhere in either function, using `lib/supabase.js`'s service-role client (bypasses RLS). Callers (`api/dashboard.js`, `api/review-queue.js`, `api/operational-queue.js`) pass no tenant context either. Classified `SECURITY_GAP`, but with an important caveat verified before writing this: this API surface **has no `.vercel/project.json`** and project docs confirm only `worker/*` is deployed (to Railway) — so this is not believed to be live/reachable today, but it is a real landmine if anyone redeploys this folder as-is. Recommendation: delete `orderwatch-backend/api/*` or explicitly mark it dead in a README, rather than silently leaving it.

**No other cross-tenant issue found.** Every route inspected in `Graphic Center Group` (the actually-deployed surface) filters consistently via `orgFilter()`/`withOrg()`, confirmed exhaustively in `operational-actions.js` (15+ call sites checked), `orders.js`, `altera.js`, `receiving.js`.

## N+1 / performance risks

- `server/routes/altera.js#buildOperationalContext` already does the right thing (parallel `Promise.all` of ~13 queries, capped limits per table) — use this as the template for `getOrderOperationalView`, not a per-row loop.
- A naive per-order implementation that re-queries `canonical_operational_lines` + 4 document tables + `activities` + `data_source_coverage` for every order in a list view (e.g. if `OrdersView` were changed to eagerly fetch operational-view for every row) would be an N+1 risk. Recommendation (Contract §7 already reflects this): the operational view is a **detail-view, on-demand** fetch (one order at a time), not a list-view enrichment.

## Duplicate logic between backend and frontend

- Severity/urgency classification exists **twice** with different implementations: `orderwatch-backend/lib/repository.js#classifyDateState` (server-side, dormant) vs. client-side severity logic feeding `SeverityHighlight`/`OrdersView`'s aggregate banner. Recommendation: `currentObservedSituation` (Contract §3.5) should be the single server-side source once built; client-side severity computation should be retired in favor of consuming it.

## Missing/misleading empty states (beyond scenario 9)

- `OrderDetailPanel.jsx` renders four fields (`supplierOrderRef`, `supplierResponse`, `reminderCount`, `aiConfidence`) that are **only ever populated by the legacy Airtable adapter**, never by the production Supabase path — they silently render as `"-"` today, which looks like "no data" rather than "this field doesn't exist in this data source." This is a pre-existing UI correctness issue, independent of `OrderOperationalView`, worth fixing in the same pass since the new contract's fields will sit right next to these on the same panel.

## Implementation file list (verified, minimal)

**Required now:**
- New: `Graphic Center Group/server/routes/order-operational-view.js` (or a method added to `server/routes/orders.js`) — the aggregation service per Contract §3–§7.
- New: a thin client method in `src/adapters/apiAdapter.js` (there is currently no `getOrderDetail`-shaped method at all — confirmed).
- Modify: `Graphic Center Group/src/components/OrderDetailPanel.jsx` — extend to render §3.6–3.15, reusing `OperationalEvidence.jsx` (already built, already used successfully on `DashboardView.jsx`) rather than inventing new evidence UI.
- Modify: `Graphic Center Group/server/routes/receiving.js` — add `sourceEmailId` back into the response shapes (currently stripped) so it's available once order-detail reuses this join.

**Useful but deferrable:**
- Wiring `consolidateCommitments()` against live `activities` rows for the first time (Contract §3.10/3.11) — deferrable behind a feature check per organization, given it's never been run against real data (scenario 4's `UNKNOWN_REQUIRES_TEST`).
- A dedicated coverage/health panel reusing `data_source_coverage`/`system_health_alerts` in Graphic Center Group's own UI (currently only visible inside Altera's internal context) — valuable but separable from the order-detail work.
- Populating `supplier_contacts` from ingestion (scenario 2) — real product value, but a pipeline change, not a read-model change.
- Structuring the `'ambiguous_reference'`/`'supplier_reference_conflict'` case (scenario 7) out of prose `activities.detail` into a queryable shape.

**Explicitly out of scope** (per task instructions, reconfirmed against what was actually found — nothing found in this research changes this list):
matcher redesign · new confidence thresholds · pgvector · semantic search · multi-agent routing · fine-tuning · automatic email sending · Microsoft Graph implementation · ERP connectors · forecasting · MCP · Temporal.

## Risks

1. **`consolidateCommitments()` is untested against reality** (scenario 3/4) — the single highest-uncertainty item in this whole map. Budget explicit manual verification before trusting `activeCommitments`/`supersededCommitments` in front of a customer.
2. **DB views (`canonical_operational_lines`, `data_source_coverage`, `system_health_alerts`) exist only live in Supabase, untracked in either repo's migrations.** Any schema change to these views would currently happen invisibly to version control. Recommend exporting their definitions into a tracked migration file as a first, near-zero-risk step, independent of the rest of this work.
3. **`orderwatch-backend/api/*`'s missing tenant filtering** (Security Gaps section) — low likelihood of live exposure today, but should be resolved (delete or fix) before anyone assumes that folder is safe to redeploy.
4. **`supplier_contacts` has zero rows in production** — building UI for `resolvedSupplierContact` (Contract §3.7) will show an empty state for every single order until a population path exists; sequence this after confirming with Alberto whether it's worth populating at all versus documenting as permanently out of scope for the pilot.

## Recommended sequence

1. Export the four untracked DB views into a real migration file (near-zero risk, closes a real repo-hygiene gap, no product behavior change).
2. Build `getOrderOperationalView` covering §3.1–3.9 + §3.14–3.15 (summary, resolved supplier org, canonical lines, linked documents incl. `sourceEmailId` fix, anomalies, coverage) — everything that's pure aggregation of already-live data.
3. Wire it into `OrderDetailPanel.jsx` via `OperationalEvidence.jsx` reuse.
4. Separately, as an explicitly flagged experimental addition: integrate `consolidateCommitments()` against live `activities` (§3.10/3.11), verified first against the 10 real orders in the Alberto checklist below, before treating it as trustworthy for a customer-facing view.
5. Decide (with Alberto) whether `supplier_contacts` population is worth pursuing for the pilot, or whether §3.7 stays permanently "unavailable" for now — don't build UI for it until that's decided.
6. Delete or clearly mark dead `orderwatch-backend/api/*`.

## Alberto validation checklist (10 real orders)

For each of 10 real orders (mix of: overdue, on-track, with a DDT, with an invoice, with a quote-converted origin, with at least one flagged as `needs_review`), Alberto should manually confirm, reading the original emails/documents directly:
1. Does `currentObservedSituation` match what he'd actually conclude?
2. Is `resolvedSupplierOrganization` the correct company, and is `verificationStatus` honestly reflecting his own trust in that link?
3. Do `canonicalMaterialLines` match the real order lines, including quantities?
4. For orders with a DDT: does `linkedDocuments` show the right document, and does `evidenceReferences` actually point at the right email?
5. For orders with outbound customer communication: do `activeCommitments` reflect real promises made, and — critically, since this is the untested path — are there any commitments that should show as `superseded` but don't (or vice versa)?
6. Does `coverageAndSyncHealth` correctly explain any gap he already knows about from memory (e.g. "we know outbound reading was off for two weeks in June")?
