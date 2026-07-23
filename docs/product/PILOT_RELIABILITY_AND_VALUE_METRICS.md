# Pilot Reliability and Value Metrics

Status: draft for review, verified against current code and live data (2026-07-23, org `graphic-center`, Supabase project `drwbmnahiygxcbyxxpbx`). Companion to the `OrderOperationalView` contract and gap map.

No estimated time savings or financial ROI figures appear anywhere in this document, per instruction — every metric below is a count, rate, or timestamp with a verifiable source.

## How to read this document

Each metric states: exact meaning · numerator/denominator (where applicable) · source · aggregation period · tenant isolation · risk of misleading interpretation. Metrics marked **(new)** require light aggregation work (all sources already exist); metrics marked **(exists)** can be read directly from an existing table/view today.

## A. Reliability metrics

### A1. Connector / mailbox status
- **Meaning:** whether each configured mailbox is currently connected and being polled.
- **Source (exists):** `mailboxes.connection_status`, `mailboxes.active` — read live in `data_source_coverage` view's `mailbox_stats` CTE.
- **Aggregation period:** point-in-time (current state), not a rate.
- **Tenant isolation:** `organization_id` on `mailboxes`.
- **Risk of misleading interpretation:** `connection_status` has **no code path that sets it** in the current system (verified by grep across both repos) other than a manual DB edit and a one-time seed row — a mailbox can look "connected" in the DB while the worker has silently stopped polling it, unless cross-checked against `last_check_at` recency (see A2). Do not report A1 alone as proof of health.

### A2. Last successful synchronization / A3. Last failed synchronization
- **Meaning:** most recent `last_check_at` on each mailbox (A2), and most recent `last_check_at` where `last_error` is non-empty (A3).
- **Source (exists):** `mailboxes.last_check_at`, `mailboxes.last_error` — written by `worker/imap-watcher.js#recordMailboxCheck`.
- **Important limitation, verified in code:** the worker writes **the same `last_check_at` timestamp on both success and failure** — there is no separate "last successful" vs. "last failed" pair. A3 must therefore be derived as "the last `last_check_at` where `last_error` was populated *at that time*", which the current schema cannot reconstruct after the fact (only the *current* `last_error` string is stored, not its history). **(new, partial)** — a true A2/A3 split requires logging each check's outcome as an append-only row, which does not exist today; what can be built now is only "is there currently an error" (point-in-time), not a historical last-failure timestamp.
- **Tenant isolation:** `organization_id` on `mailboxes`.
- **Risk:** reporting "last check" as "last success" overstates reliability during an ongoing outage.

### A4. Coverage start and end / A5. Missing coverage intervals
- **Meaning:** the window during which OrderWatch has actually been observing a mailbox, and any gaps within it.
- **Source:** **does not exist as implemented capability**, confirmed by exhaustive search of `lib/mailbox-configs.js`, `worker/imap-watcher.js`, `lib/system-health.js` — none compute a coverage window or gap; they track only a single rolling `last_check_at`/`last_sent_check_at` pair used to bound the IMAP search window, not to expose history.
- **Classification:** `DATA_MODEL_GAP` for true gap detection (would need a periodic "coverage snapshot" written even when nothing changed, which `data_source_coverage_snapshots` (hourly, per source, already live per A6) partially provides — see A6 for what's genuinely available today as a proxy).
- **Recommendation:** do not report A4/A5 as delivered metrics for this pilot; report A6 instead, which is real and already flowing.

### A6. Coverage reliability trend (available today, closest real proxy to A4/A5)
- **Meaning:** hourly snapshots of per-source-category reliability (`inbound_email`, `outbound_email`, `email_attachments`, `operational_linking`), with degradation detection.
- **Source (exists):** `data_source_coverage_snapshots` (base table, written hourly by `lib/system-health.js#captureSystemHealthSnapshots`, called from every `worker/index.js#pollAllMailboxes()` cycle — confirmed live, this is the one piece of "coverage infrastructure" confirmed running in production) joined against current `data_source_coverage` inside the `system_health_alerts` view, which already flags "tracciabilità in peggioramento" when reliability drops ≥5 points hour-over-hour.
- **Tenant isolation:** `organization_id` on both the table and the view.
- **Risk:** this is a *reliability-of-linking* trend (are lines getting connected to orders), not literally "was the mailbox reachable" — don't conflate the two when reporting.

### A7. Acquired messages / A8. Processed messages / A9. Failed messages
- **Meaning:** A7 = all inbound/outbound messages seen; A8 = successfully classified/extracted; A9 = ended in `status = 'error'`.
- **Source (exists):** `processed_emails` — A7 = `count(*)`, A8 = `count(*) WHERE status != 'error' AND classification_type IS NOT NULL`, A9 = `count(*) WHERE lower(status) = 'error'`. The `data_source_coverage` view already computes the inbound/outbound split and error count as `email_stats`/`error_count`.
- **Aggregation period:** cumulative by default; report both cumulative and trailing-N-days (the `system_health_alerts` view already uses a 72h window for its own error alert, `extraction-errors-72h` — reuse that window for consistency).
- **Tenant isolation:** `organization_id` on `processed_emails`.
- **Risk:** a period with **zero** processed emails is ambiguous between "quiet week, nothing came in" and "mailbox stopped syncing" — always report alongside A2/A6, never alone.

### A10. Pending retries
- **Meaning:** messages currently stuck mid-processing.
- **Source (exists):** `system_health_alerts` view already computes this exactly — `processing-stuck` alert, `processed_emails` rows with `status = 'processing'` for >30 minutes.
- **Tenant isolation:** `organization_id`.
- **Risk:** none significant — this is a direct count with a clear, already-encoded threshold.

### A11. Unresolved evidence / A12. Ambiguous evidence
- **Meaning:** A11 = items in `extraction_candidates` with `status = 'needs_review'`; A12 = the subset specifically flagged `candidate_type = 'line_ambiguity'` or `'invoice_order_match'` (genuine multi-interpretation conflicts, distinct from "just not reviewed yet" — see Gap Map scenario 10 distinction).
- **Source (exists):** `extraction_candidates` table, already read by `orderwatch-backend/lib/repository.js#listReviewQueue` (though that specific caller is currently dormant per the Gap Map — the table and its data are real regardless of that caller's status).
- **Aggregation period:** point-in-time count + age distribution (the `system_health_alerts` view already flags items aged >24h via `aged-extraction-review`).
- **Tenant isolation:** `organization_id`.
- **Risk:** A12 will read as small today specifically because `reconcileTrustedSupplierClassification` (one of the four conflict-detection mechanisms) is gated behind the `engine.supplier_purchase_cycle_reconciliation` setting, which defaults off — don't interpret a low A12 as "the system rarely sees conflicts" without checking whether that flag is on for the tenant being measured.

### A13. Manual-review rate
- **Meaning:** % of processed emails/documents/lines that required `needs_review = true` at any point.
- **Numerator:** `count(needs_review = true)` across `processed_emails`, `documents`, `canonical_operational_lines` (unioned). **Denominator:** total count in the same set, same period.
- **Source (exists):** all four tables already carry `needs_review`.
- **Tenant isolation:** `organization_id`.
- **Risk:** a *falling* review rate over time can mean genuine improvement (learning rules maturing, per `lib/learning-rules.js`/`entity_aliases`) or can mean review fatigue causing buyers to stop checking flagged items — cross-check against A14 before treating a falling rate as unambiguously good.

### A14. Replay/evaluation health
- **Meaning:** whether the offline replay/ground-truth harness (`scripts/replay/*`) is being run and what it currently reports.
- **Source (exists, but manual):** `docs/baseline/ENGINE_REPLAY_BASELINE.json`/`.md` (written by `npm run replay:baseline`), plus the review-gate's own pass/fail state (`groundTruthGate`, requiring ≥30 cases, ≥3/category, dual human sign-off).
- **Important limitation, verified in code:** this entire harness is **CLI-invoked only, with no CI** (confirmed: no `.github`/CI config exists in either repo) — "replay health" is a manual, point-in-time artifact from whenever someone last ran it, not a continuously-updated metric. As of the last verified run (per `tests/fixtures/supplier-document-reconciliation-real-cases.anonymized.json`'s own header), the 16/17-case regression fixture is explicitly labeled **not yet operationally approved ground truth**, pending Alberto's sign-off.
- **Risk:** never report this as a live/real-time health signal — always date-stamp it with the last manual run.

## B. Value metrics

### B1. Orders covered
- **Meaning:** count of `orders` rows with at least one linked canonical line/document (i.e., genuinely populated by the pipeline, not an empty shell).
- **Numerator:** distinct `orders.id` referenced by `canonical_operational_lines.order_id IS NOT NULL` OR any of `delivery_notes`/`invoices`/`quotes`.order_id. **Denominator:** total `orders` count, same tenant/period.
- **Source (exists):** direct query across already-live tables.
- **Tenant isolation:** `organization_id`.
- **Risk:** counts an order as "covered" even if its only link is a single low-confidence line — pair with A13 (review rate) so "covered" isn't read as "verified."

### B2. Exceptions detected
- **Meaning:** count of orders/lines currently in an actionable exception state (overdue, needs-review, unlinked) — i.e., what already populates the "Oggi" operational queue.
- **Source (exists):** `lib/repository.js#listOperationalQueue`'s own classification logic (`classifyDateState`, `unlinked`/`needsReview` checks) — already implemented, just currently served from a dormant backend caller (see Gap Map); the classification logic itself is real and reusable regardless of which endpoint calls it.
- **Aggregation period:** point-in-time snapshot, report daily.
- **Tenant isolation:** `organization_id`.
- **Risk:** this number naturally goes up as more data flows in even with a *constant* underlying exception rate — always report alongside B1 as a ratio (exceptions / orders covered), not as a raw count trending over time.

### B3. Missing confirmations detected
- **Meaning:** supplier order dispatches sent but never confirmed within an expected window.
- **Source (exists):** `supplier_order_dispatches` where `status IN ('sent','waiting_confirmation')` and `sent_at` older than a configurable threshold — the table and status values already exist and are actively used by `lib/supplier-confirmation-matcher.js`.
- **Tenant isolation:** `organization_id`.
- **Risk:** a dispatch can look "unconfirmed" simply because the supplier replied in a way the matcher couldn't link (see A12/ambiguous evidence) — don't present this as proof the supplier never responded; cross-reference against unresolved/ambiguous evidence for the same dispatch before concluding "no response."

### B4. Commitments extracted / B5. Commitments updated or superseded
- **Meaning:** count of outbound operational commitments observed (B4), and how many were later revised (B5).
- **Source:** B4 **(new, light aggregation)** — count `activities` rows with non-empty `metadata.commitments`, computed live by `normalizeOutboundOperationalFacts` (confirmed running in production via `worker/outbound-email-processor.js`). B5 **(new, higher risk)** — requires running `consolidateCommitments()` against those rows, which per the Gap Map has **never been executed against real data** before. Report B4 with confidence; report B5 only after the Alberto validation pass described in the Gap Map, and label it "experimental" until then.
- **Tenant isolation:** `organization_id` on `activities`.

### B6. Documents reconciled
- **Meaning:** count of `documents`/`delivery_notes`/`invoices`/`quotes` rows with a non-null `order_id` (or `match_status = 'matched'` for invoices specifically).
- **Source (exists):** direct query, all tables already carry these columns.
- **Tenant isolation:** `organization_id`.
- **Risk:** an invoice matched via a low-confidence ranked candidate (`rankInvoiceOrderCandidates`) still always requires human confirmation before `match_status` becomes `'matched'` (verified in `worker/email-processor.js`: ranked candidates never auto-link) — so this count, by construction, only includes human-confirmed or exact-reference matches. That's a feature, not a caveat, but worth stating so the number isn't second-guessed as "too conservative."

### B7. Proposed actions / B8. Actions reviewed / B9. Actions copied or approved / B10. Actions dismissed
- **Meaning/Source:** **do not exist yet**, by design — the Action Layer is explicitly out of scope for this phase (Contract §3.20's `proposedActions` is a placeholder). These four metrics cannot be reported until that layer exists. Listed here only so the eventual instrumentation plan is anchored to the same field names as the future contract, avoiding a rename later.

### B11. User-reported false positives
- **Meaning:** count of times a buyer explicitly corrected a system-proposed classification/link.
- **Source (exists):** `classification_feedback` table (`original_type`/`corrected_type`/`correction_reason`) — schema exists, confirmed in live database; **grep confirms no code in either repo currently writes to it.** This is a real, ready-to-use table with zero rows and no writer.
- **Classification:** `DATA_MODEL_GAP` in the "no population path" sense (same pattern as `supplier_contacts` in the Gap Map) — the table doesn't need redesigning, it needs a UI action (e.g. a "questo non è corretto" button) wired to insert into it.
- **Risk:** until a writer exists, B11 will always read as zero — do not report "zero false positives" as a quality signal; report "not yet instrumented."

### B12. Supplier responses observed after an action
- **Meaning:** for a given buyer action (reminder sent, order dispatched), whether a supplier reply was subsequently observed.
- **Source (exists):** join `buyer_actions`/`supplier_order_dispatches` (action) against `processed_emails` (subsequent inbound from the same supplier domain, or a matched confirmation via `matchSupplierDispatch`) — the matching logic already exists (`lib/supplier-confirmation-matcher.js`), this metric is a read of its outcome, not new logic.
- **Tenant isolation:** `organization_id`.
- **Risk:** absence of a matched reply is not proof the supplier didn't reply — matching can fail (ambiguous/ signature line only, see A12) even when a real reply arrived. State this explicitly whenever B12 is reported as "no response," consistent with the Contract's `unavailable`-is-not-`false` rule.

## Anti-gaming and interpretation warnings (consolidated)

1. **Never report a reliability metric without its paired coverage context.** A11/A13/B2 falling could mean genuine improvement or could mean a mailbox silently stopped syncing (A1–A3) and nothing new is being observed at all. Always pair volume metrics (A7–A9, B1–B2) with a coverage/status metric (A1, A2, A6) in the same report.
2. **Don't let "matched/confirmed" counts imply full automation.** By construction (verified in code), invoices and ambiguous references never auto-link without either an exact reference match or human confirmation — B6 is already conservative by design, not inflated.
3. **B5 (superseded commitments) and A4/A5 (coverage gaps) are the two genuinely unverified metrics in this document** — both rely on logic (`consolidateCommitments`, gap-window computation) that has either never run against real data or doesn't exist yet. Do not present these with the same confidence as the others in the first pilot report.
4. **Zero is not always good news.** B11 (false positives) and B7–B10 (actions) will read as zero not because the system is flawless, but because nothing writes to them yet. Every "zero" in a pilot report must state whether it's "measured and genuinely zero" or "not yet instrumented."
5. **The replay/evaluation harness (A14) is not a live signal.** It reflects whatever was last run manually, by a human, and its own ground-truth fixture explicitly disclaims being fully approved. Never present it as continuously monitored.

## Minimum pilot report structure

A single pilot status report should present, in this order:

1. **Coverage snapshot** (A1, A2, A6) — "can we even see what's happening" comes first, because every other number is conditioned on it.
2. **Volume** (A7, A8, A9) — what came through, cumulative + trailing 7/30 days.
3. **Quality/review load** (A11, A12, A13, A10) — how much of what came through needed a human, and how much is still waiting.
4. **Operational coverage** (B1, B2 as a ratio, B6) — how much of the actual order book is genuinely populated and reconciled.
5. **Supplier-facing outcomes** (B3, B12) — dispatches and their observed responses, with the explicit non-response caveat.
6. **Customer-facing commitments** (B4 confidently, B5 labeled experimental).
7. **Instrumentation gaps, stated plainly** (B7–B11: not yet built/wired, by design or by omission — list which).
8. **Last replay/ground-truth check** (A14), date-stamped, with its own known limitation (manual, not yet operationally approved).

No section of this report should ever omit its own known limitation from this document — the limitation is part of the metric, not a footnote to drop under pressure to look further along than the pilot actually is.
