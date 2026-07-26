// Data Quality Contract — a stable, minimal JSON shape derived entirely from
// pilotCases already produced by pilotControlCheck.mjs (buildPilotCase /
// runPilotControlCheck). This module adds NO new data access, NO new
// business logic about the pipeline, and NO AI/confidence scoring — it only
// re-projects already-computed structural facts into the shape a future
// dashboard can consume directly, plus a fixed, documented severity and
// recommended-action lookup keyed by the existing ISSUE_CATEGORIES.
//
// Hard rules (per the task that created this contract, tightened by the
// v2.0.0 architecture-review pass):
//   - No confidence/accuracy/health score of any kind, anywhere.
//   - No inference about whether an extracted value is factually correct.
//   - Every number here is a direct count or ratio of already-computed
//     structural facts (see pilotControlCheck.mjs), never a new computation
//     over raw data.
//   - severity/recommendedAction/dimension come from a FIXED lookup table
//     keyed by category. There is NO fallback: an issue category missing
//     from CATEGORY_META is a bug and throws, rather than silently
//     defaulting to a low severity (see metaFor()).
//   - Organization-level facts (source coverage, which is identical across
//     every order in the same org — see ORDER_OPERATIONAL_VIEW_CONTRACT.md
//     §3.15) are NEVER counted as if they were independent per-order
//     observations. They live only in `organizationSources`, once, and are
//     never folded into `incompleteOrders` or any other per-order count.
//   - Metrics that represent invariant/regression validation rather than a
//     genuine, currently-variable quality signal (documentTraceability) live
//     in `systemIntegrityChecks`, kept separate from `qualityIndicators`.
//   - v2.1.0 adds `orders` (per-order breakdown) additively — no existing
//     field's meaning or shape changed. It exists so a dashboard's "orders
//     table" can be built from the real contract instead of separate mock
//     data (see src/views/PilotDataQualityView.jsx).
//   - v2.2.0, driven by the "support/admin investigation tool" architecture
//     review, makes this contract self-contained enough for a support
//     operator to investigate a finding without a database query:
//       * `affectedLines`/`affectedDocuments` on findings are now
//         {id, description/itemCode|kind/number} summaries instead of bare
//         UUIDs (a genuine shape change to those two fields, not purely
//         additive — see the review's item B.1).
//       * SOURCE_UNAVAILABLE/SOURCE_UNWATCHED/SOURCE_INCOMPLETE, which
//         describe an organization-wide fact (identical for every order —
//         see ORDER_OPERATIONAL_VIEW_CONTRACT.md §3.15), are deduplicated
//         out of the per-order `findings[]` into a new `organizationFindings`
//         array instead of being repeated once per evaluated order. This
//         closes the one place the contract previously violated its own
//         "organization-level facts are never counted as if per-order" rule
//         (the metrics already respected it; the findings list did not).
//       * Coverage-related findings now carry a structured `sourceKey`/
//         `sectionKey` instead of naming their subject only in prose.
//       * OPERATIONAL_STATE_UNEXPLAINED's recommendedAction is rewritten for
//         a support operator (what to check before talking to the customer),
//         not for a product/engineering decision.
//   - v2.3.0 deduplicates pilot cases and contract orders by their stable
//     `orderId`, preventing duplicated findings and inflated per-order counts.
//     It also refines `dataQualityStatus` semantics:
//       * orders whose only findings are SECTION_NOT_EVALUATED are classified
//         as `not_evaluated`, while those findings remain visible;
//       * missing line evidence continues to produce `incomplete_evidence`;
//       * genuine order-specific findings continue to produce
//         `open_findings`;
//       * `complete` is never fabricated when required sections are
//         unavailable.
//
// The four dimensions this contract preserves, matching the task's explicit
// requirement:
//   - availability          : is the source/section observable at all
//   - traceability           : can a line/document be traced to its evidence
//   - linking                : is a document's order relationship proven
//   - missingOrAmbiguous     : evidence is present but disagrees or is absent

import { ISSUE_CATEGORIES, ratio } from "./pilotControlCheck.mjs";

// Categories describing an organization-wide fact (see comment above and in
// pilotControlCheck.mjs's COVERAGE_KEYS loop) — represented once in
// `organizationFindings`, never repeated per order in `findings`.
const ORG_WIDE_CATEGORIES = new Set([
  ISSUE_CATEGORIES.SOURCE_UNAVAILABLE,
  ISSUE_CATEGORIES.SOURCE_UNWATCHED,
  ISSUE_CATEGORIES.SOURCE_INCOMPLETE
]);

export const FINDING_SCOPE = "orderwatch_data_quality";

// Fixed, documented per-category classification. Adding a new category to
// ISSUE_CATEGORIES (in pilotControlCheck.mjs) without adding a matching
// entry here is a bug: metaFor() throws rather than defaulting, so it can
// never be missed silently (see `regression: unmapped issue category throws`
// test).
const CATEGORY_META = Object.freeze({
  [ISSUE_CATEGORIES.ORDER_LINK_MISSING]: {
    severity: "critical",
    dimension: "availability",
    recommendedAction: "Confirm the order still exists under this tenant before relying on this pilot case."
  },
  [ISSUE_CATEGORIES.LINE_WITHOUT_EVIDENCE]: {
    severity: "warning",
    dimension: "traceability",
    recommendedAction: "Verify this line manually against its source document; no provenance is currently linked."
  },
  [ISSUE_CATEGORIES.DANGLING_PROVENANCE]: {
    severity: "critical",
    dimension: "traceability",
    recommendedAction: "Investigate why this evidence reference does not resolve; this points to a data pipeline inconsistency, not a content error."
  },
  [ISSUE_CATEGORIES.DOCUMENT_LINK_UNPROVEN]: {
    severity: "critical",
    dimension: "linking",
    recommendedAction: "Confirm this document's order relationship manually before treating it as linked."
  },
  [ISSUE_CATEGORIES.QUANTITY_CONFLICT]: {
    severity: "warning",
    dimension: "missingOrAmbiguous",
    recommendedAction: "Review the cited evidence sources manually to determine which observed quantity is correct."
  },
  [ISSUE_CATEGORIES.DATE_CONFLICT]: {
    severity: "warning",
    dimension: "missingOrAmbiguous",
    recommendedAction: "Review the cited evidence sources manually to determine which observed date is correct."
  },
  [ISSUE_CATEGORIES.DUPLICATE_LINE]: {
    severity: "warning",
    dimension: "linking",
    recommendedAction: "Review whether these canonical lines represent the same real-world item and should be reconciled."
  },
  [ISSUE_CATEGORIES.SOURCE_UNWATCHED]: {
    severity: "info",
    dimension: "availability",
    recommendedAction: "No action implied — this source is outside current coverage, not a defect to fix."
  },
  [ISSUE_CATEGORIES.SOURCE_INCOMPLETE]: {
    severity: "info",
    dimension: "availability",
    recommendedAction: "No action implied — this source has partial coverage only; treat absence of findings from it as inconclusive, not confirmed-clean."
  },
  [ISSUE_CATEGORIES.SOURCE_UNAVAILABLE]: {
    severity: "info",
    dimension: "availability",
    recommendedAction: "No action implied — this source was not returned at all; it is outside current coverage, not an error."
  },
  [ISSUE_CATEGORIES.SECTION_NOT_EVALUATED]: {
    severity: "info",
    dimension: "availability",
    recommendedAction: "This section has not been evaluated yet; absence of findings here is not evidence of correctness."
  },
  [ISSUE_CATEGORIES.OPERATIONAL_STATE_UNEXPLAINED]: {
    severity: "critical",
    dimension: "missingOrAmbiguous",
    recommendedAction: "Check this order's due date, recent linked documents and recent supplier communication manually before responding to the customer — OrderWatch has not yet computed a validated operational status for this overdue order, so the absence of an alert here is not confirmation that the order is on track."
  }
});

const KNOWN_SEVERITIES = Object.freeze(["critical", "warning", "info"]);
const KNOWN_DIMENSIONS = Object.freeze(["availability", "traceability", "linking", "missingOrAmbiguous"]);

// Fixed, exhaustive vocabulary for the per-order `dataQualityStatus` field —
// derived only from structural facts already computed for that order
// (whether it loaded, its evidence coverage, its own finding count). This is
// deliberately NOT the order's business status (see
// src/utils/statusRules.js's "Scaduto"/"Confermato"/... vocabulary, which is
// about the order itself) — it must never be confused with, or presented
// as, a verdict on order correctness.
const ORDER_STATUS = Object.freeze({
  UNAVAILABLE: "unavailable",
  NOT_EVALUATED: "not_evaluated",
  INCOMPLETE_EVIDENCE: "incomplete_evidence",
  OPEN_FINDINGS: "open_findings",
  COMPLETE: "complete"
});
const KNOWN_ORDER_STATUSES = Object.freeze(Object.values(ORDER_STATUS));

// No silent fallback: an issue category absent from CATEGORY_META throws
// immediately. A dashboard must never render an under-classified "info"
// severity for a category nobody actually decided on.
function metaFor(category) {
  const meta = CATEGORY_META[category];
  if (!meta) {
    throw new Error(`No CATEGORY_META mapping defined for issue category "${category}". Add one to scripts/lib/dataQualityContract.mjs before this category can be represented in the data quality contract.`);
  }
  return meta;
}

/* ------------------------------------------------------------------ *
 * Organization-level source availability — computed ONCE per contract,
 * never counted per order. coverageAndSyncHealth is identical across every
 * order in the same organization (org-wide view, not order-specific — see
 * ORDER_OPERATIONAL_VIEW_CONTRACT.md §3.15), so representing it as a
 * per-order count (as an earlier version of this contract did) silently
 * inflates/deflates every per-order metric whenever a single org-wide
 * source is or isn't watched. It belongs here, exactly once.
 * ------------------------------------------------------------------ */
function buildOrganizationSources(pilotCases) {
  const reference = pilotCases.find((pc) => pc.coverage.orderAvailable && pc.coverage.coverageByKey);
  if (!reference) {
    return { emailsAvailable: null, attachmentsAvailable: null, sourceCoverageComplete: null };
  }
  return {
    emailsAvailable: reference.coverage.coverageByKey.inboundEmail === "available",
    attachmentsAvailable: reference.coverage.coverageByKey.attachments === "available",
    sourceCoverageComplete: reference.systemLimitations.sourceCoverageComplete === true
  };
}

/* ------------------------------------------------------------------ *
 * Summary metrics — direct counts/sums over the evaluated pilotCases.
 * These describe the evaluated sample, not the whole tenant: a dashboard
 * consuming this contract must read totalOrders as "orders included in
 * this run", exactly like every other count here.
 * ------------------------------------------------------------------ */
function buildSummary(pilotCases) {
  const available = pilotCases.filter((pc) => pc.coverage.orderAvailable);
  return {
    totalOrders: pilotCases.length,
    extractedDocuments: available.reduce((sum, pc) => sum + (pc.coverage.linkedDocumentCount || 0), 0),
    linkedEvidence: available.reduce((sum, pc) => sum + (pc.coverage.linesWithEvidence || 0), 0)
  };
}

/* ------------------------------------------------------------------ *
 * Quality indicators — ORDER-LEVEL signals only. Every count metric
 * carries its evaluation denominator alongside it (never a bare number
 * with no context of how much was actually evaluated).
 * ------------------------------------------------------------------ */
function buildQualityIndicators(pilotCases) {
  const available = pilotCases.filter((pc) => pc.coverage.orderAvailable);
  const totalLines = available.reduce((sum, pc) => sum + (pc.coverage.canonicalLineCount || 0), 0);
  const linesWithEvidence = available.reduce((sum, pc) => sum + (pc.coverage.linesWithEvidence || 0), 0);
  const missingEvidenceCount = available.reduce((sum, pc) => sum + (pc.traceability.linesWithoutProvenance || 0), 0);
  // "Ambiguous" = the system observed two or more disagreeing explicit
  // values for the same fact (quantity/date conflicts) — never inferred,
  // only counted when explicitly present in the cited evidence.
  const ambiguousEvidenceCount = available.reduce((sum, pc) => sum + (pc.internalConsistency.quantityConflicts || 0) + (pc.internalConsistency.dateConflicts || 0), 0);
  // Strictly order-level structural signals only — organization-wide facts
  // (source coverage) are never inputs to this count (see buildOrganizationSources).
  const incompleteOrdersCount = available.filter((pc) => (
    (pc.traceability.linesWithoutProvenance || 0) > 0
    || (pc.traceability.documentsWithoutDeterministicOrderLink || 0) > 0
  )).length;

  return {
    evidenceCoverage: ratio(linesWithEvidence, totalLines),
    missingEvidence: { count: missingEvidenceCount, evaluatedLines: totalLines },
    ambiguousEvidence: { count: ambiguousEvidenceCount, evaluatedLines: totalLines },
    incompleteOrders: { count: incompleteOrdersCount, totalOrders: available.length }
  };
}

/* ------------------------------------------------------------------ *
 * System integrity checks — invariant/regression validation, not a
 * variable quality signal a buyer should watch trend on. Document
 * traceability lives here: getOrderOperationalView() only ever returns
 * linkedDocuments of a kind proven to carry a real order_id foreign key
 * (see ORDER_OPERATIONAL_VIEW_CONTRACT.md §3.9), so this ratio is expected
 * to always read 1 (or null) — a drop below 1 signals a regression in that
 * invariant, not a fluctuating "quality" the way evidenceCoverage does.
 * ------------------------------------------------------------------ */
function buildSystemIntegrityChecks(pilotCases) {
  const available = pilotCases.filter((pc) => pc.coverage.orderAvailable);
  const totalDocs = available.reduce((sum, pc) => sum + (pc.coverage.linkedDocumentCount || 0), 0);
  const unprovenDocs = available.reduce((sum, pc) => sum + (pc.traceability.documentsWithoutDeterministicOrderLink || 0), 0);
  const provenDocs = totalDocs - unprovenDocs;

  return {
    documentTraceability: ratio(provenDocs, totalDocs),
    documentLinkInvariantViolations: { count: unprovenDocs, evaluatedDocuments: totalDocs }
  };
}

/* ------------------------------------------------------------------ *
 * Findings — one row per issue already detected by buildPilotCase(),
 * re-shaped into the dashboard-facing contract. No new detection logic:
 * every finding traces back to an existing pilotCase.issues entry.
 * ORG_WIDE_CATEGORIES are skipped here — they are represented once in
 * `organizationFindings` instead (see buildOrganizationFindings below).
 * ------------------------------------------------------------------ */
function buildFindings(organizationId, pilotCases) {
  const findings = [];
  for (const pc of pilotCases) {
    (pc.issues || []).forEach((issue, index) => {
      if (ORG_WIDE_CATEGORIES.has(issue.category)) return;
      const meta = metaFor(issue.category);
      findings.push({
        findingId: `${pc.orderId}#${index}#${issue.category}`,
        organizationId,
        orderId: pc.orderId,
        orderCode: pc.orderCode,
        supplierName: pc.supplier,
        dimension: meta.dimension,
        severity: meta.severity,
        type: issue.category,
        affectedLines: Array.isArray(issue.lineIds) ? issue.lineIds : [],
        affectedDocuments: Array.isArray(issue.documentIds) ? issue.documentIds : [],
        evidenceRefs: Array.isArray(issue.evidenceRefs) ? issue.evidenceRefs : [],
        // Structured, not just prose: which SECTION_NOT_EVALUATED this is
        // about. Present only on that category — null everywhere else,
        // rather than a key that only sometimes exists.
        sectionKey: issue.sectionKey || null,
        description: issue.message,
        recommendedAction: meta.recommendedAction,
        scope: FINDING_SCOPE
      });
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ *
 * Organization findings — the ORG_WIDE_CATEGORIES facts, represented
 * exactly once per (category, sourceKey) regardless of how many orders
 * were evaluated. No orderId/orderCode/supplierName: these findings are
 * not about any one order, and must never be attributed to one. Iteration
 * order over pilotCases/issues is deterministic, and a Map preserves
 * insertion order, so output ordering is deterministic.
 * ------------------------------------------------------------------ */
function buildOrganizationFindings(organizationId, pilotCases) {
  const seen = new Map();
  for (const pc of pilotCases) {
    for (const issue of pc.issues || []) {
      if (!ORG_WIDE_CATEGORIES.has(issue.category)) continue;
      const key = `${issue.category}:${issue.sourceKey || ""}`;
      if (seen.has(key)) continue;
      const meta = metaFor(issue.category);
      seen.set(key, {
        findingId: `org#${key}`,
        organizationId,
        sourceKey: issue.sourceKey || null,
        dimension: meta.dimension,
        severity: meta.severity,
        type: issue.category,
        description: issue.message,
        recommendedAction: meta.recommendedAction,
        scope: FINDING_SCOPE
      });
    }
  }
  return Array.from(seen.values());
}

// Derives the fixed dataQualityStatus enum for one order from structural
// facts only (never inferred, never a score). "unavailable" takes priority
// over everything else (an order that couldn't even be loaded has nothing
// else meaningfully evaluated); "not_evaluated" means the order loaded but
// lacks enough evaluated sections to make a structural assessment. Pure
// SECTION_NOT_EVALUATED findings are still visible in findings[], but do not
// imply the order itself has an open problem.
function deriveDataQualityStatus({ orderAvailable, totalLines, coveredLines, orderFindings }) {
  if (!orderAvailable) return ORDER_STATUS.UNAVAILABLE;
  if (!totalLines) return ORDER_STATUS.NOT_EVALUATED;
  if (coveredLines < totalLines) return ORDER_STATUS.INCOMPLETE_EVIDENCE;
  const findings = Array.isArray(orderFindings) ? orderFindings : [];
  const evaluatedFindings = findings.filter((f) => f.type !== ISSUE_CATEGORIES.SECTION_NOT_EVALUATED);
  if (evaluatedFindings.length > 0) return ORDER_STATUS.OPEN_FINDINGS;
  if (findings.some((f) => f.type === ISSUE_CATEGORIES.SECTION_NOT_EVALUATED)) return ORDER_STATUS.NOT_EVALUATED;
  return ORDER_STATUS.COMPLETE;
}

function uniquePilotCasesByOrderId(pilotCases) {
  const seen = new Set();
  const unique = [];
  for (const pc of pilotCases || []) {
    const key = pc?.orderId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(pc);
  }
  return unique;
}

/* ------------------------------------------------------------------ *
 * Orders — the per-order breakdown a dashboard "orders table" needs.
 * Additive: this does not change any existing field. Built entirely from
 * pilotCases + the already-built `findings` (no separate detection logic,
 * no re-querying) so it can never drift from what `findings` itself says.
 * evidenceCoverage is exposed as {coveredLines, totalLines} — a plain
 * structural count pair, not a pre-computed ratio/percentage, consistent
 * with "no scoring metric": the dashboard divides them itself, and must
 * treat a zero denominator as "not evaluated", never as 0%.
 * ------------------------------------------------------------------ */
function buildOrders(pilotCases, findings) {
  const findingsByOrder = new Map();
  for (const f of findings) {
    if (!findingsByOrder.has(f.orderId)) findingsByOrder.set(f.orderId, []);
    findingsByOrder.get(f.orderId).push(f);
  }

  return pilotCases.map((pc) => {
    const orderFindings = findingsByOrder.get(pc.orderId) || [];
    const findingsSummary = { critical: 0, warning: 0, info: 0 };
    for (const f of orderFindings) findingsSummary[f.severity] = (findingsSummary[f.severity] || 0) + 1;

    const totalLines = pc.coverage.orderAvailable ? (pc.coverage.canonicalLineCount || 0) : 0;
    const coveredLines = pc.coverage.orderAvailable ? (pc.coverage.linesWithEvidence || 0) : 0;

    return {
      orderId: pc.orderId,
      orderCode: pc.orderCode,
      supplierName: pc.supplier,
      evidenceCoverage: { coveredLines, totalLines },
      findingCount: orderFindings.length,
      findingsSummary,
      dataQualityStatus: deriveDataQualityStatus({ orderAvailable: pc.coverage.orderAvailable, totalLines, coveredLines, orderFindings })
    };
  });
}

/* ------------------------------------------------------------------ *
 * Public entrypoint. Pure function of pilotCases — deterministic given
 * the same input, no I/O, no clock dependency beyond the caller-supplied
 * generatedAt (so callers can pin it for reproducible snapshots/tests).
 * ------------------------------------------------------------------ */
export function buildDataQualityContract({ organizationId, generatedAt, pilotCases }) {
  const uniquePilotCases = uniquePilotCasesByOrderId(pilotCases);
  const findings = buildFindings(organizationId, uniquePilotCases);
  return {
    contractVersion: "2.3.0",
    generatedAt,
    organizationId,
    scope: {
      measures: ["data availability", "evidence traceability", "linking quality", "missing or ambiguous information"],
      doesNotMeasure: [
        "AI/extraction confidence or accuracy — no such score is computed anywhere in this contract",
        "whether an extracted value is factually correct — that requires manual verification against the original source",
        "supplier performance — every finding describes OrderWatch's own pipeline coverage/linking, never supplier behavior"
      ]
    },
    organizationSources: buildOrganizationSources(uniquePilotCases),
    organizationFindings: buildOrganizationFindings(organizationId, uniquePilotCases),
    summary: buildSummary(uniquePilotCases),
    qualityIndicators: buildQualityIndicators(uniquePilotCases),
    systemIntegrityChecks: buildSystemIntegrityChecks(uniquePilotCases),
    orders: buildOrders(uniquePilotCases, findings),
    findings
  };
}

export { KNOWN_SEVERITIES, KNOWN_DIMENSIONS, CATEGORY_META, metaFor, ORDER_STATUS, KNOWN_ORDER_STATUSES, ORG_WIDE_CATEGORIES };
