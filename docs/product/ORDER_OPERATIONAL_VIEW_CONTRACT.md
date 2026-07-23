# OrderOperationalView — Contract

Status: draft for review. Read-only aggregation contract, verified against the current implementation of `orderwatch-backend` and `Graphic Center Group` (2026-07-23). Not implemented yet.

## 0. Purpose and non-goals

`OrderOperationalView` is a **read model**: an aggregated, source-neutral projection of operational state that already exists across several tables and two DB views. It is not a new source of truth, not a new persistence layer, and not a redesign of the matching/classification engine.

It exists to answer, for one order, the question a buyer actually asks: *what do we know, how sure are we, and what's still open* — without the buyer having to open five different tabs (Orders, Receiving, Invoices, Quotes, Dashboard/Altera) that each already show a fragment of this.

Out of scope for this contract (see also the Gap Map §5 and the Metrics doc):
- Redesigning `classifySupplierDocumentCandidate` / matching thresholds.
- The Action Layer itself — only a `proposedActions` placeholder is defined here (§3.15), deliberately empty of behavior.
- Anything requiring a new domain schema. Every field below either already has a source table/view, or is a light aggregation of ones that do.

## 1. Terminology

| Term | Meaning in this contract |
|---|---|
| **Organization** | Tenant. Every table in scope has `organization_id`; every query in this contract MUST filter on it. |
| **Order** | A row in `orders`. The unit this view is keyed on. |
| **Supplier organization** | A row in `contacts` (`type IN ('supplier','both')`) or, for orders that predate contact-registry adoption, the flat `orders.supplier_name`/`suppliers` row. Kept separate from... |
| **Supplier contact** | ...a *person* at that organization: today only `supplier_contacts` (name/email/phone/role) exists; there is no first-class link from `orders` to a specific `supplier_contacts` row (see Gap Map). |
| **Canonical line** | A row from the `canonical_operational_lines` DB view (itself a `UNION ALL` of `project_requirements`, `procurement_requirements`, `quote_lines`, `purchase_order_lines`, `delivery_note_lines` — see §2). |
| **Operational commitment** | A dated, kind-typed promise found in an *outbound* email to a customer (proof/production/shipment/delivery/payment), computed by `lib/outbound-operational-facts.js`. |
| **Evidence** | A reference to the email/document a fact was observed in (`source_email_id` / `source_document_id`), plus the specific structured values observed at that point (`canonical_line_sources.observed_values`, `invoice_sources.observed_values`) — never the raw email body. |
| **Coverage** | Per-source-category signal (inbound email, outbound email, attachments, operational linking) computed by the `data_source_coverage` DB view, expressing whether OrderWatch can see enough of a channel to trust an absence-of-evidence as evidence-of-absence. |
| **Authority level** | See §1.1 below — every field must declare one. |

### 1.1 Authority model

Every contract field carries one of these five authority levels. This vocabulary is deliberately narrower than "confidence 0–1" because a buyer needs to know *what kind* of claim they're looking at, not just how confident the AI was.

| Level | Meaning | Example |
|---|---|---|
| `authoritative` | Set directly by a human action in OrderWatch (buyer edit, approve, send). | `orders.status` after a manual PATCH via `api/orders/[id].js`. |
| `observed` | Extracted from a specific document/email with structural confirmation (DDT number, invoice number, matched reference). | A `delivery_note` with `ddt_number` and `order_reference` both present. |
| `inferred` | Extracted by the AI classifier/extractor with a numeric confidence but no independent structural confirmation. | `orders.material`/`quantity` from a single supplier email extraction. |
| `probable` | The reconciliation engine (`classifySupplierDocumentCandidate`) assigned this with `status: 'probable'` or `'ambiguous'` — plausible but explicitly flagged as not fully confirmed. | A DDT with only 2 of the 3+ structural signals. |
| `unavailable` | Not present. Must be rendered as an explicit "not observed" state, distinguished from `0`/empty/false. See §5 (coverage-aware absence). |

**Rule, non-negotiable:** a field with `authority: 'unavailable'` must never be silently coerced to `false`/`0`/`"-"` by the UI. This is the single most common failure mode found in the Gap Map (§ scenario 9).

## 2. Source map (what's real today)

Everything in this table was verified by reading the code/schema, not inferred from names.

| Concept | Backing object | Kind | Tenant-scoped? | Consumed today by |
|---|---|---|---|---|
| Order row | `orders` | table | yes (`organization_id`) | `api/orders/[id].js` (PATCH/DELETE only), `supabaseServerAdapter.js` (flat dashboard mapper) |
| Canonical lines (all 5 kinds unified) | `canonical_operational_lines` → `canonical_operational_lines_base` | **DB view**, UNION ALL of `project_requirements`, `procurement_requirements`, `quote_lines`, `purchase_order_lines`, `delivery_note_lines` | yes, every branch joins on `organization_id` | `lib/repository.js#listOperationalQueue/listReviewQueue` (backend, dormant — see Gap Map), `server/routes/altera.js` (live) |
| Line-level evidence | `canonical_line_sources` (`entity_type`, `entity_id`, `source_email_id`, `source_document_id`, `source_line_number`, `observed_values`) | table, append-only (upsert with `ignoreDuplicates`) | yes | `server/routes/supplier-orders.js` (writes), nothing reads it back into a UI today |
| Contacts (org + person) | `contacts`, `contact_emails`, `contact_aliases` | tables | yes | `lib/contact-registry.js` (write), nothing in the UI surfaces `contacts.verification_status`/`trusted` on an order |
| Delivery notes + lines | `delivery_notes`, `delivery_note_lines`, `receipt_allocations` | tables | yes | `server/routes/receiving.js` (live, joined server-side, **strips `source_email_id`** before returning) |
| Invoices | `invoices`, `invoice_sources` | tables | yes | not exposed via any Graphic Center Group route found; only via bulk `api/dashboard.js` list |
| Quotes | `quotes`, `quote_lines` | tables | yes | `server/routes/supplier-orders.js` (converts on order creation) — **no `order_id` column, no deterministic order relationship; see §3.9** |
| Outbound commitments | computed by `lib/outbound-operational-facts.js`, called live from `worker/outbound-email-processor.js` | **computed, not a table** — persisted only inside `activities.metadata` (JSONB), never as first-class columns | yes (`organization_id` on `activities`) | nothing reads `activities.metadata.commitments` back structurally today |
| Active vs. superseded commitment resolution | `consolidateCommitments()` in `lib/outbound-operational-facts.js` | pure function | n/a | **only called from `scripts/simulate-mbox-operational-window.js`** (an offline analysis script) — never invoked in the live worker |
| Coverage per source category | `data_source_coverage` | **DB view** (mailbox/email/document/linking stats aggregated live) | yes | `server/routes/altera.js` (live, read-only context) |
| Coverage trend / degradation | `data_source_coverage_snapshots` (base table, hourly) + `system_health_alerts` (view, LATERAL join against the most recent past snapshot) | table + view | yes | `system_health_alerts` is read by `server/routes/altera.js`; nothing in Graphic Center Group's own UI reads either |
| Buyer actions / audit trail | `buyer_actions`, `activities` | tables | yes | written by nearly every route; **no timeline component consumes them in `OrderDetailPanel`** |
| Historical outbound evidence (one-time import) | `historical_email_import_proposals` | table, written once by `scripts/import-mbox-evidence.js` (manual CLI) | yes | read by `server/routes/altera.js` only |
| Altera evidence/citations | `altera_conversations`, `altera_messages` (`highlights`, `citations` jsonb) | tables | yes | `AlteraView.jsx` (live, citations are clickable and navigate) |

**Conclusion of §2** (answers Mandatory Question 1 and 3): the operational context needed for `OrderOperationalView` already exists as tables/views with real tenant scoping. The `canonical_operational_lines` + `data_source_coverage` + `canonical_line_sources` trio is, today, closer to a proto-`OrderOperationalView` than anything bespoke needs to be built. What's missing is (a) a per-order filter/aggregation service and (b) UI wiring — not new domain modeling. This can be built as a **read-only application service**.

## 3. The contract

`OrderOperationalView` is produced by one function, e.g. `getOrderOperationalView({ organizationId, orderId })`, which the owning repository (see §7) exposes as `GET /api/orders/:id/operational-view`. Every field below documents: type · meaning · source · transformation required · authority level · null/unavailable behavior · evidence requirement · tenant-isolation requirement · exists in an API today? · shown in UI today?

### 3.1 `tenantId`
- **Type:** `string` (uuid)
- **Meaning:** the organization this view belongs to; must equal the caller's authenticated `organizationId` (never taken from the request).
- **Source:** `orders.organization_id`.
- **Transformation:** none.
- **Authority:** `authoritative`.
- **Null behavior:** never null — the endpoint 404s before this is built if the order isn't found under the caller's tenant (matches the existing pattern in `api/orders/[id].js`).
- **Evidence:** n/a.
- **Tenant isolation:** this field *is* the isolation boundary; every downstream query in the service must filter on it.
- **Exists in API today?** Implicit (every route already resolves `user.organizationId` via `_auth.js`), not returned as an explicit field.
- **Shown in UI?** No (correctly — this is a server-internal check, not user-facing).

### 3.2 `orderId`
- **Type:** `string` (uuid) · **Source:** `orders.id` · **Transformation:** none · **Authority:** `authoritative` · **Null:** never · **Evidence:** n/a · **Tenant isolation:** filtered by §3.1 · **API today:** yes (`orders.id`) · **UI today:** yes (implicit key).

### 3.3 `orderNumber`
- **Type:** `string | null` · **Source:** `orders.order_code` (fallback `orders.normalized_reference`) · **Transformation:** none · **Authority:** `authoritative` if set by a buyer edit, `observed` if only ever extracted · **Null:** legitimately null for orders created from an unresolved document (rare; render as "senza codice", never as empty string) · **Evidence:** n/a · **API today:** yes · **UI today:** yes (`OrderDetailPanel.jsx` row 1).

### 3.4 `summary`
- **Type:** `{ supplierOrganizationName, projectCode, material, quantity, status, alertLevel, orderDate, dueDate, requiredDate, daysRemaining }`
- **Source:** `orders` flat columns, unchanged.
- **Transformation:** none — this is intentionally the *existing* flat view (`supabaseServerAdapter.js`'s current orders mapper), kept as-is so nothing regresses; everything below is *additive*.
- **Authority:** mixed per sub-field (`status`/`alertLevel` are `authoritative` once a buyer has acted, `inferred` otherwise).
- **Null:** `dueDate`/`requiredDate` can be legitimately null (never extracted) — must render as "non specificata", not "-".
- **API today:** yes, this is exactly what `api/dashboard.js` already returns per order.
- **UI today:** yes, this is exactly what `OrderDetailPanel.jsx` already renders.

### 3.5 `currentObservedSituation`
- **Type:** `{ label: string, severity: 'ok'|'attention'|'critical', reasonCodes: string[], asOf: ISO8601 }`
- **Meaning:** a single human-readable rollup of "where things stand right now" — the equivalent of the severity banner already computed client-side in `OrdersView.jsx`/`SeverityHighlight`, but computed server-side so Altera and the order-detail view use the *same* logic instead of two implementations.
- **Source:** derived from `orders.status`/`alert_level`/`needs_review` + the most severe unresolved item among §3.9 (unresolved evidence) and §3.11 (anomalies).
- **Transformation:** aggregation only (no new classification logic) — reuses the existing severity thresholds already implemented client-side.
- **Authority:** `inferred` (it's a rollup of other fields' authority, capped at the lowest one present).
- **Null:** never — worst case `severity: 'ok'`, `reasonCodes: []`.
- **Evidence:** `reasonCodes` must reference the specific ids driving the rollup (e.g. `["unresolved_ddt:<id>"]`), not just prose.
- **API today:** no. **UI today:** partially (client-side only, in `OrdersView`'s aggregate banner, not per-order, not server-authoritative).

### 3.6 `resolvedSupplierOrganization`
- **Type:** `{ contactId: string|null, legalName: string|null, verificationStatus: 'pending'|'verified'|null, matchMethod: string|null } | null`
- **Meaning:** the canonical company, kept **separate** from the person (§3.7), per the task's explicit requirement.
- **Source:** `contacts` row referenced by `orders.supplier_contact_id` if set; else `orders.supplier_id` → `suppliers` row (legacy path, pre-contact-registry); else `orders.supplier_name` (flat string only, no contact resolved).
- **Transformation:** a 3-tier fallback lookup (contact → legacy supplier row → flat name), returning which tier resolved it in `matchMethod`.
- **Authority:** `authoritative`/`observed` if `contacts.verification_status === 'verified'`; `inferred` otherwise (per `lib/contact-registry.js#registerDetectedContact`'s own trust model).
- **Null:** legitimately `null` only if `orders.supplier_name` is also empty (should not happen in practice; flag as anomaly if it does).
- **Evidence:** none beyond the contact row itself — this is registry state, not per-instance evidence.
- **API today:** no (orders never join `contacts`). **UI today:** no (`OrderDetailPanel` shows only the flat `supplierName` string, confirmed by code read).

### 3.7 `resolvedSupplierContact`
- **Type:** `{ id, name, email, phone, role, isPrimary } | null`
- **Meaning:** the *person*, kept separate from §3.6.
- **Source:** `supplier_contacts` filtered by `supplier_id` (legacy) — **note: this table has 0 rows in production today** (verified via live query) and has no foreign key from `orders`/`contacts` at all. This is the weakest-populated field in the whole contract.
- **Transformation:** none (simple lookup once populated).
- **Authority:** `unavailable` today, universally — not a code gap, a data gap.
- **Null:** must render as "nessun referente registrato", never as a blank supplier line implying "no supplier".
- **API today:** no. **UI today:** no.

### 3.8 `canonicalMaterialLines`
- **Type:** `Array<{ id, entityKind, description, itemCode, quantity, deliveredQuantity, remainingQuantity, unit, requiredDate, dueDate, status, confidence, needsReview, canonicalKey }>`
- **Source:** `canonical_operational_lines` view, filtered `order_id = :orderId AND organization_id = :tenantId`.
- **Transformation:** none beyond the existing view — this field is a direct pass-through, already computed by the DB.
- **Authority:** per-row, from `confidence`/`needs_review` (>=0.85 and !needs_review → `observed`; else `inferred`; `status = 'Da verificare'` → `probable`).
- **Null:** empty array is valid and must be distinguished in UI from "not yet loaded".
- **Evidence:** each line's `id` is the join key into §3.10 (`canonicalLineSources`).
- **API today:** no per-order filter exists; the view itself is queried unfiltered-by-order only in `listOperationalQueue`/`listReviewQueue` (backend, dormant per Gap Map) and `altera.js` (whole-org snapshot, not per-order).
- **UI today:** no — `OrderDetailPanel` shows one flattened `material`/`quantity` string instead of this array (confirmed by code read).

### 3.9 `linkedDocuments`
- **Type:** `Array<{ id, kind: 'delivery_note'|'invoice'|'quote'|'document', number, status, receivedAt, confidence, needsReview }>`. `'quote'` remains part of the shape for a future version where a real relationship exists (see below), but is never emitted today.
- **Source (corrected — see Gap Map / implementation history):** `delivery_notes`, `invoices`, `documents`, filtered by `order_id = :orderId`. **`quotes` is not queried.** The original version of this section stated that all four tables share an `order_id` column filterable this way; that was never true and was only discovered live, in production, as a `PostgreSQL 42703: column quotes.order_id does not exist` error — `quotes` has no `order_id` (or `order_code`) column at all, verified against `information_schema.columns`.
  - `delivery_notes.order_id`, `invoices.order_id`, `documents.order_id` are real, tenant-scoped (`organization_id`-filtered) foreign keys to `orders.id` — verified live against `information_schema.table_constraints`. These three may be linked to a specific order safely and deterministically.
  - `quotes` currently has **no deterministic relationship to a specific order** anywhere in the schema. Its only relational column toward the order's context is `project_id` (→ `projects.id`), and `project_id` is **insufficient** for this field: a project can contain many orders and many quotes, so filtering quotes by the order's `project_id` would attach every quote in the project to this one order, not just the quote(s) that actually produced it — i.e. it would misrepresent project-wide (effectively organization-wide, from this order's point of view) quotes as order-linked documents.
  - The only place the codebase currently associates a quote with an order is `server/routes/supplier-orders.js#markQuoteConverted`, which — when a buyer manually converts a quote into a purchase order — writes a **free-text note** onto `quotes.notes` (e.g. "Convertito manualmente dal buyer nell'ordine PO-1234.") and sets `quotes.status = 'converted'`. This is a human-readable audit trail, not a structured, queryable foreign key, and **must not be parsed or treated as an authoritative relationship** — no inferred or free-text-derived link may be presented to the buyer as a verified order↔quote relationship. `canonical_operational_lines` was also checked as a possible per-row join path (it carries both `order_id` and `quote_id` columns): live data confirms `quote_line` rows never carry `order_id` and `purchase_order_line` rows never carry `quote_id` (0 rows with both, across the current dataset), so no row-level join exists there either.
  - **Until a real, structured order↔quote relationship is introduced** (e.g. a dedicated `quote_id` column populated on the resulting `orders`/`purchase_order_lines` row at conversion time), quotes **must remain omitted** from `linkedDocuments` — never approximated via `project_id`, `quote_code` matching, or the free-text conversion note. This matches the general contract rule (§0 non-goals / evidence discipline): an unproven relationship is represented as *absent*, not as a guess.
- **Transformation:** union + normalize into one shape.
- **Authority:** per-row from each table's own `confidence`/`needs_review`/`status`.
- **Null:** empty array valid — including the case where an order legitimately has delivery notes/invoices/documents but no representable quotes; this is "quotes unavailable for this relationship", not "no quotes exist".
- **Evidence:** each entry carries `source_email_id`/`source_document_id` (present on all three queried tables) — **must be included here**, unlike `server/routes/receiving.js` which currently strips it before returning to the client (confirmed gap).
- **API today:** implemented in `server/routes/order-operational-view.js` for `delivery_notes`/`invoices`/`documents` only, per-order, tenant-scoped; `receiving.js` separately does a delivery-notes-only join within the Receiving view, not per-order.
- **UI today:** yes — `OrderOperationalView.jsx` renders this array; it will never contain a `'quote'` entry until the relationship above is resolved.

### 3.10 `activeCommitments` / 3.11 `supersededCommitments`
- **Type:** `Array<{ kind, date, datePrecision, scope, description, explicit, confidence, observedAt, sourceMessageId }>` (identical shape, split by `status`)
- **Meaning:** kept as **two separate arrays**, per the task's explicit requirement that active/superseded never merge into one field.
- **Source:** `consolidateCommitments()` (already implemented, pure function, `lib/outbound-operational-facts.js`) applied to the set of `activities` rows for this order whose `metadata.commitments` is non-empty (today the only place these are persisted — see §2).
- **Transformation:** **this is the one place in the contract that requires new wiring, not new logic** — `consolidateCommitments` exists and is tested, but is never invoked by anything reading from the live `activities` table; it's only exercised against an offline fixture in `scripts/simulate-mbox-operational-window.js`. Building this field means calling the existing function against real `activities` rows for the first time in a live code path.
- **Authority:** `observed` (each commitment came from a specific outbound email) unless `explicit === false`, then `inferred`.
- **Null:** both arrays empty is valid (no outbound customer commitments observed yet) — must be distinguished from "outbound email reading isn't even enabled" (`data_source_coverage.outbound_email.status === 'unavailable'`, see §3.14).
- **Evidence:** `sourceMessageId` → `processed_emails.id`.
- **API today:** no. **UI today:** no.

### 3.12 `unresolvedEvidence`
- **Type:** `Array<{ id, kind, reasonCodes, needsReview: true, createdAt }>`
- **Meaning:** items that reference this order (or are ambiguous candidates that *might*) but aren't fully linked/confirmed.
- **Source:** `extraction_candidates` where `resolved_entity_id = :orderId` (or `status = 'needs_review'` and the payload references the order's code), plus canonical lines / documents / invoices with `needs_review = true` for this order (subset of §3.8/§3.9, surfaced separately for buyer triage — same data, different lens).
- **Transformation:** filter + reshape, no new logic.
- **Authority:** `probable`/`inferred` by definition (that's what "unresolved" means here).
- **Null:** empty array is the success case.
- **API today:** no (existing `listReviewQueue` is whole-org, not per-order, and is itself dormant — see Gap Map). **UI today:** no.

### 3.13 `ambiguousEvidence`
- **Type:** `Array<{ id, entityType, competingInterpretations: Array<{ label, reasonCodes }> }>`
- **Meaning:** distinct from §3.12 — this is specifically the output of a genuine two-way (or more) conflict, not just "not yet reviewed". Two concrete real sources:
  1. `findAmbiguousLineIdentities`/`recordLineAmbiguity` output (`extraction_candidates.candidate_type = 'line_ambiguity'`) — a canonical line whose identity-key occurrence count disagrees with the prior document.
  2. `findOrderForSupplierDocument`'s `'ambiguous_reference'`/`'supplier_reference_conflict'` match methods (currently only visible as an in-memory branch in `email-processor.js`, surfaced to the buyer only via a generic "activities" note — not structured).
- **Transformation:** requires a small amount of new surfacing work for source (2) — today it's prose in an `activities.detail` string, not a structured record. Source (1) is already structured.
- **Authority:** `probable` by definition.
- **Null:** empty array is the success case.
- **API today:** no. **UI today:** no.

### 3.14 `anomaliesAndAttention`
- **Type:** `Array<{ code, severity, message, targetView }>`
- **Source:** rows from `system_health_alerts` view filtered to ones relevant to this order (mailbox/extraction-category alerts are org-wide, not order-specific — include only if `metadata` references this order/supplier; otherwise this array is empty and the org-wide alert stays visible only in the Settings/coverage panel, per the view's own `target_view` field).
- **Transformation:** filter by relevance; no new logic (the view already computes severity/message/action_label).
- **Authority:** `observed` (computed directly from live aggregates, not AI-inferred).
- **Null:** empty array valid.
- **API today:** read by `altera.js` at org level; no per-order filter exists. **UI today:** no.

### 3.15 `coverageAndSyncHealth`
- **Type:** `{ inboundEmail: CoverageEntry, outboundEmail: CoverageEntry, attachments: CoverageEntry, operationalLinking: CoverageEntry }` where `CoverageEntry = { status: 'available'|'partial'|'unavailable', reliability: number, message, limitation }`
- **Meaning:** this is **not order-specific** — it's the same org-wide `data_source_coverage` view rows, included here so the UI can render "why might this order's picture be incomplete" next to the order itself, rather than making the buyer cross-reference Settings.
- **Source:** `data_source_coverage` view, `organization_id = :tenantId` (4 rows, no order filter — same set for every order in the org).
- **Transformation:** none, pass-through.
- **Authority:** `observed`.
- **Null:** never — the view always returns 4 rows (worst case all `unavailable`).
- **This is the field that answers Mandatory Question 9**: yes, the coverage model already distinguishes "nothing happened" (`observed_count = 0` with `status: 'available'`, meaning the channel is watched and simply quiet) from "OrderWatch did not observe the source" (`status: 'unavailable'`, e.g. `connected_mailboxes = 0` or the outbound-read setting is off) — this distinction is already correctly implemented in the `data_source_coverage` view's `CASE` logic (verified by reading the view definition).
- **API today:** read by `altera.js` (org-wide). **UI today:** no Graphic Center Group view renders this at all today — it exists only inside the Altera chat's internal context, never as visible UI.

### 3.16 `confidence`
- **Type:** `number` (0–1) · **Meaning:** overall confidence for the view as a whole — the minimum of all `observed`/`authoritative`-vs-`inferred` weighted confidences across §3.6–3.14, **not** a new number invented for this contract.
- **Transformation:** `min()` aggregation, documented so it's auditable, never a black-box score.
- **Authority:** derived. **Null:** never (defaults to the order's own `confidence` if all sub-arrays are empty).

### 3.17 `reasonCodes`
- **Type:** `string[]` — the union of every reason code surfaced by any sub-field above (kept as machine-readable codes, e.g. `EXTRACTED_DDT_TYPE`, `DDT_ORDER_REFERENCE_MISSING`, `SUPPLIER_REFERENCE_CONFLICT` — these already exist verbatim in `lib/supplier-document-reconciliation.js`/`worker/email-processor.js` and must be reused, not reinvented).

### 3.18 `evidenceReferences`
- **Type:** `Array<{ ref: string, kind, sourceEmailId, sourceDocumentId, sourceLineNumber }>`
- **Meaning:** a flat, deduplicated list of every evidence pointer used anywhere in this view, with a short `ref` (`E1`, `E2`, ...) — reusing exactly the `addRefs`/citation pattern already implemented and working in `server/routes/altera.js`, so Altera and the order-detail view can cite the *same* refs (answers Mandatory Question 10: yes, Altera can consume this exact structure without creating a second source of truth, because it already generates and validates refs this way).

### 3.19 `safeEvidenceExcerpts`
- **Type:** `Array<{ ref: string, excerpt: string }> `
- **Meaning:** **does not exist today and is the one field in this contract requiring a genuinely new capability**, not just aggregation. Per the backend research, no code path currently produces a redacted/safe excerpt of source content — `canonical_line_sources.observed_values`/`invoice_sources.observed_values` store normalized *structured values* (item description, quantity, dates), not a verbatim (even if trimmed) quote of the original text, and `lib/safe-language.js`/`lib/security-redaction.js` are used for error-log and report-wording sanitization only, never for this.
- **Recommendation:** scope this narrowly at first — reuse `observed_values` (already structured, already safe) as the excerpt, rather than building a new text-redaction pipeline. A true "quote from the email" feature is out of scope for the first version of this contract.
- **Authority:** `observed`. **API today:** no. **UI today:** no.

### 3.20 `proposedActions` (placeholder only)
- **Type:** `Array<{}> ` — **intentionally empty shape**, per the task's explicit instruction not to design the Action Layer yet.
- **Meaning:** a marker field so the contract's consumers (UI, Altera) know where action suggestions will attach later, without any behavior defined now.
- **Authority:** n/a. **Must always be `[]` in this phase** — any non-empty value here would be scope creep.

## 4. Synthetic example response

All values below are invented for illustration; no real tenant/order data is reproduced.

```json
{
  "tenantId": "9f3b6b0e-0000-4000-8000-000000000001",
  "orderId": "b7c1a2d4-0000-4000-8000-000000000002",
  "orderNumber": "OF-176",
  "summary": {
    "supplierOrganizationName": "Meccanica Esempio Srl",
    "projectCode": "LAV-2026-041",
    "material": "Profilato alluminio 40x40",
    "quantity": "120",
    "status": "In ritardo",
    "alertLevel": "critical",
    "orderDate": "2026-06-30",
    "dueDate": "2026-07-18",
    "requiredDate": "2026-07-20",
    "daysRemaining": -5
  },
  "currentObservedSituation": {
    "label": "Consegna in ritardo di 5 giorni, DDT non ancora ricevuto",
    "severity": "critical",
    "reasonCodes": ["order_overdue", "unresolved_delivery_note:none"],
    "asOf": "2026-07-23T09:00:00Z"
  },
  "resolvedSupplierOrganization": {
    "contactId": "c1111111-0000-4000-8000-000000000010",
    "legalName": "Meccanica Esempio Srl",
    "verificationStatus": "verified",
    "matchMethod": "contact_registry"
  },
  "resolvedSupplierContact": null,
  "canonicalMaterialLines": [
    {
      "id": "d2222222-0000-4000-8000-000000000020",
      "entityKind": "purchase_order_line",
      "description": "Profilato alluminio 40x40",
      "itemCode": "AL-4040",
      "quantity": 120,
      "deliveredQuantity": 0,
      "remainingQuantity": 120,
      "unit": "M",
      "requiredDate": "2026-07-20",
      "dueDate": "2026-07-18",
      "status": "Confermato",
      "confidence": 0.93,
      "needsReview": false,
      "canonicalKey": "sha256:example"
    }
  ],
  "linkedDocuments": [
    {
      "id": "e3333333-0000-4000-8000-000000000030",
      "kind": "delivery_note",
      "number": "DDT-2026-088",
      "status": "confirmed",
      "receivedAt": "2026-06-28T10:00:00Z",
      "confidence": 0.97,
      "needsReview": false
    }
  ],
  "activeCommitments": [
    {
      "kind": "SHIPMENT",
      "date": "2026-07-18",
      "datePrecision": "exact",
      "scope": null,
      "description": "Spedizione confermata dal fornitore via email.",
      "explicit": true,
      "confidence": 0.9,
      "observedAt": "2026-07-10T08:00:00Z",
      "sourceMessageId": "f4444444-0000-4000-8000-000000000040"
    }
  ],
  "supersededCommitments": [],
  "unresolvedEvidence": [],
  "ambiguousEvidence": [],
  "anomaliesAndAttention": [],
  "coverageAndSyncHealth": {
    "inboundEmail": { "status": "available", "reliability": 1, "message": "479 email in entrata osservate da 2 caselle collegate.", "limitation": null },
    "outboundEmail": { "status": "partial", "reliability": 0.55, "message": "Sono state osservate solo 2 email in uscita.", "limitation": "Lo storico osservato e insufficiente: le conclusioni su solleciti e conferme inviate restano parziali." },
    "attachments": { "status": "available", "reliability": 1, "message": "58 email con allegati e 59 documenti estratti.", "limitation": null },
    "operationalLinking": { "status": "partial", "reliability": 0.82, "message": "46 righe su 56 sono collegate a un ordine o a un lavoro.", "limitation": "10 righe restano da collegare o verificare." }
  },
  "confidence": 0.82,
  "reasonCodes": ["order_overdue"],
  "evidenceReferences": [
    { "ref": "E1", "kind": "delivery_note", "sourceEmailId": "f5555555-0000-4000-8000-000000000050", "sourceDocumentId": null, "sourceLineNumber": null }
  ],
  "safeEvidenceExcerpts": [
    { "ref": "E1", "excerpt": "DDT-2026-088, 120 M profilato alluminio 40x40, consegna 18/07." }
  ],
  "proposedActions": []
}
```

## 5. Security rules

1. Every query executed while building `OrderOperationalView` MUST include `.eq('organization_id', tenantId)`, following the pattern already established in `server/lib/_supabaseRest.js`'s `orgFilter`/`withOrg` helpers and `server/routes/operational-actions.js`'s exhaustive per-query filtering.
2. `tenantId` MUST come from the authenticated session (`_auth.js#requireApiUser`), never from a request parameter — matching the existing invariant already documented and enforced in every Graphic Center Group route.
3. **Do not build this in `orderwatch-backend/api/*`.** That API surface (`lib/repository.js#listReviewQueue`/`listOperationalQueue`, `api/dashboard.js`, `api/review-queue.js`, `api/operational-queue.js`) queries `orders`, `canonical_operational_lines`, `quotes`, `delivery_notes`, `invoices`, `buyer_actions`, `documents`, `mailboxes`, `settings` etc. with **zero `organization_id` filtering anywhere** (verified by reading `lib/repository.js` in full — no `.eq('organization_id', ...)` appears in `listReviewQueue`/`listOperationalQueue`, and their callers pass no tenant context at all), using a Supabase client authenticated with the **service-role key** (`lib/supabase.js`), which bypasses Postgres RLS entirely. This is a real cross-tenant data leak *if this API surface were ever deployed*. It is not currently deployed (no `.vercel/project.json` in `orderwatch-backend`; the docs confirm only the worker runs, on Railway) — but it must not be reused as a starting point for this contract, and ideally should be deleted or explicitly marked dead (see Gap Map).
4. `resolvedSupplierContact`/`resolvedSupplierOrganization` must never be inferred by fuzzy name match at read time — reuse the already-resolved `contacts`/`supplier_contacts` rows only; do not re-run matching logic inside a read-only view.
5. `safeEvidenceExcerpts` (§3.19) must only ever surface `observed_values` (already-normalized structured fields), never raw email/document body text, until a dedicated redaction review happens.

## 6. Deterministic behavior

- For a given `(organizationId, orderId, asOfTimestamp)`, the view must be a pure function of persisted state — no live AI calls, no live matching re-computation. (This mirrors the replay harness's own `assertReplayEnvironmentSafe` discipline: read-only, side-effect-free.)
- Array ordering must be deterministic (e.g. `canonicalMaterialLines` sorted by `line_number`/`created_at`), so UI diffing and Altera citation refs stay stable across repeated calls.
- `evidenceReferences` ref codes (`E1`, `E2`, ...) must be assigned in the same deterministic order every time, for the same reason `addRefs()` in `altera.js` already needs this today.

## 7. Repository ownership (answers Mandatory Questions 4–5)

- **Endpoint owner: `Graphic Center Group`.** This is where tenant auth (`_auth.js`), the Supabase adapter pattern, and every other order-facing route already live. `orderwatch-backend` should not own this endpoint — it has no authenticated multi-tenant HTTP surface at all today (its `api/*` folder is legacy/undeployed, see §5.3).
- **UI owner: `Graphic Center Group`.** `OrderDetailPanel.jsx` is the natural host; `OperationalEvidence.jsx` (already built, already tenant-safe, already used on the Dashboard) is the component to *reuse*, not rebuild, for rendering §3.8–3.14.

## 8. Acceptance criteria

1. `GET /api/orders/:id/operational-view` returns a payload matching §3 for an order that has: a resolved verified supplier contact, at least one canonical line, at least one linked document, at least one active commitment, and zero anomalies — verified against a real order in a non-production/pilot organization.
2. The same endpoint, called with a valid order id belonging to a *different* organization than the caller's, returns 404 (not 403, not empty payload) — matching the existing pattern in `api/orders/[id].js`.
3. `coverageAndSyncHealth` correctly distinguishes a channel with `observed_count = 0` (quiet but watched) from one with `configured_sources/connected_mailboxes = 0` (not watched) — verified against the `data_source_coverage` view's own logic, not reimplemented.
4. `activeCommitments`/`supersededCommitments` correctly split when two commitments of the same `kind`+`scope` exist at different dates for the same order — verified with a case exercising `consolidateCommitments()` against real `activities` rows for the first time (this is new integration, not new logic).
5. No field in the response is ever a fabricated/interpolated value not traceable to a source row — every non-empty field has a `reasonCodes`/`evidenceReferences` entry or is one of the flat `summary` passthroughs explicitly exempted in §3.4.
6. Ten real orders manually reviewed by Alberto (see Gap Map §"Alberto validation checklist") confirm the view's `currentObservedSituation`/`confidence` match what a human buyer would actually conclude looking at the same underlying emails/documents.
