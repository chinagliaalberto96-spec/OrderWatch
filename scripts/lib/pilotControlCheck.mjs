// Pilot Control Check — read-only core logic.
//
// This module is deliberately NOT under server/ or api/: it is a CLI-only
// reporting tool, never wired into the production HTTP surface, never
// imported by anything that runs in Vercel. It reuses the same
// getOrderOperationalView() the production route uses (so it inherits its
// tenant-isolation and read-only guarantees rather than re-implementing
// them), plus a few additional light, tenant-scoped GET-only queries needed
// for candidate selection across many orders at once.
//
// Scope discipline (per PILOT_RELIABILITY_AND_VALUE_METRICS.md): this tool
// measures coverage, internal consistency and traceability only. It never
// computes or claims an "accuracy", "health" or "confidence" score, and
// every ratio with a zero/undetermined denominator is null + a reason code,
// never 0 or 100%.

import { orgFilter, supabaseRequest } from "../../server/lib/_supabaseRest.js";
import { getOrderOperationalView } from "../../server/routes/order-operational-view.js";

export const KNOWN_PILOT_ORDER_CODE = "0013545497";

export const ISSUE_CATEGORIES = Object.freeze({
  ORDER_LINK_MISSING: "ORDER_LINK_MISSING",
  LINE_WITHOUT_EVIDENCE: "LINE_WITHOUT_EVIDENCE",
  DANGLING_PROVENANCE: "DANGLING_PROVENANCE",
  DOCUMENT_LINK_UNPROVEN: "DOCUMENT_LINK_UNPROVEN",
  QUANTITY_CONFLICT: "QUANTITY_CONFLICT",
  DATE_CONFLICT: "DATE_CONFLICT",
  DUPLICATE_LINE: "DUPLICATE_LINE",
  SOURCE_UNWATCHED: "SOURCE_UNWATCHED",
  SOURCE_INCOMPLETE: "SOURCE_INCOMPLETE",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  SECTION_NOT_EVALUATED: "SECTION_NOT_EVALUATED",
  OPERATIONAL_STATE_UNEXPLAINED: "OPERATIONAL_STATE_UNEXPLAINED"
});

// Kinds this route is proven (live-verified, see ORDER_OPERATIONAL_VIEW_CONTRACT.md
// §3.9) to link via a real order_id foreign key. Any other kind appearing in
// linkedDocuments would mean the deterministic-link invariant regressed.
const DETERMINISTIC_LINK_KINDS = new Set(["delivery_note", "invoice", "document"]);

const COVERAGE_KEYS = ["inboundEmail", "outboundEmail", "attachments", "operationalLinking"];

function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ *
 * Metric primitives — every ratio returns null (never 0/100%) when its
 * denominator is zero or the source was not evaluated.
 * ------------------------------------------------------------------ */

export function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  if (!Number.isFinite(numerator)) return null;
  return numerator / denominator;
}

/* ------------------------------------------------------------------ *
 * Per-order pilot case: coverage, internal consistency, traceability,
 * system limitations. Built entirely from one getOrderOperationalView()
 * response — no independent re-querying of the same facts, so it can
 * never drift from what the buyer-facing view actually shows.
 * ------------------------------------------------------------------ */

export function buildPilotCase({ organizationId, orderId, selectionReason, view, error }) {
  const evaluatedAt = nowIso();
  const base = {
    pilotCaseId: `pcc-${orderId}`,
    organizationId,
    orderId,
    orderCode: null,
    supplier: null,
    selectionReason: selectionReason || null,
    evaluatedAt
  };

  if (!view) {
    // orderAvailable is the only coverage signal we can report when the
    // order itself could not be loaded (e.g. cross-tenant / deleted).
    return {
      ...base,
      coverage: {
        orderAvailable: false,
        supplierResolved: null,
        canonicalLineCount: null,
        linesWithEvidence: null,
        evidenceCoverageRatio: null,
        linkedDocumentCount: null,
        observedSourceStates: null,
        missingSourceStates: null,
        unavailableSections: []
      },
      internalConsistency: {
        quantityConflicts: null,
        dateConflicts: null,
        duplicateCanonicalLines: null,
        duplicateEvidenceReferences: null,
        unmatchedEvidenceReferences: null,
        contradictoryOrderStateSignals: null
      },
      traceability: {
        linesWithoutProvenance: null,
        danglingProvenanceRefs: null,
        evidenceWithoutSafeExcerpt: null,
        documentsWithoutDeterministicOrderLink: null,
        documentTraceabilityRatio: null,
        unresolvedDataAvailable: null,
        ambiguousDataAvailable: null
      },
      systemLimitations: {
        inboundOriginalContentAvailable: false,
        attachmentOriginalContentAvailable: false,
        commitmentsEvaluated: null,
        sourceCoverageComplete: null,
        limitationReasonCodes: ["ORDER_NOT_FOUND_UNDER_TENANT"]
      },
      manualReview: { reviewerVerdict: null, reviewerNotes: "", buyerCanDecideWithoutExternalSearch: null },
      issues: [{ category: ISSUE_CATEGORIES.ORDER_LINK_MISSING, message: error || "Order not found under this organization.", orderCode: null }]
    };
  }

  const lines = Array.isArray(view.canonicalMaterialLines) ? view.canonicalMaterialLines : [];
  const evidenceReferences = Array.isArray(view.evidenceReferences) ? view.evidenceReferences : [];
  const safeExcerpts = Array.isArray(view.safeEvidenceExcerpts) ? view.safeEvidenceExcerpts : [];
  const linkedDocuments = Array.isArray(view.linkedDocuments) ? view.linkedDocuments : [];
  const evidenceRefSet = new Set(evidenceReferences.map((e) => e.ref));
  const excerptByRef = new Map(safeExcerpts.map((s) => [s.ref, s.excerpt]));

  const issues = [];

  // --- Coverage --------------------------------------------------------
  const linesWithEvidence = lines.filter((l) => Array.isArray(l.provenanceRefs) && l.provenanceRefs.length > 0).length;
  const canonicalLineCount = lines.length;
  const evidenceCoverageRatio = ratio(linesWithEvidence, canonicalLineCount);
  if (canonicalLineCount === 0) issues.push({ category: ISSUE_CATEGORIES.SECTION_NOT_EVALUATED, message: "No canonical lines exist for this order — evidence coverage ratio is undetermined, not 0.", orderCode: view.orderNumber });

  const coverageEntries = COVERAGE_KEYS.map((k) => view.coverageAndSyncHealth?.[k] || null);
  const observedSourceStates = coverageEntries.filter((e) => e && (e.status === "available" || e.status === "partial")).length;
  const missingSourceStates = coverageEntries.filter((e) => !e || e.status === "unavailable").length;
  COVERAGE_KEYS.forEach((key, i) => {
    const entry = coverageEntries[i];
    if (!entry) issues.push({ category: ISSUE_CATEGORIES.SOURCE_UNAVAILABLE, message: `Source coverage entry "${key}" was not returned at all (outside current coverage, not an error).`, orderCode: view.orderNumber });
    else if (entry.status === "unavailable") issues.push({ category: ISSUE_CATEGORIES.SOURCE_UNWATCHED, message: `Source "${key}" is not currently watched (status: unavailable).`, orderCode: view.orderNumber });
    else if (entry.status === "partial") issues.push({ category: ISSUE_CATEGORIES.SOURCE_INCOMPLETE, message: `Source "${key}" has only partial coverage.`, orderCode: view.orderNumber });
  });

  const unavailableSections = [];
  if (view.unresolvedEvidenceAvailable === false) unavailableSections.push("unresolvedEvidence");
  if (view.ambiguousEvidenceAvailable === false) unavailableSections.push("ambiguousEvidence");
  if (view.activeCommitmentsAvailable === false) unavailableSections.push("activeCommitments");
  if (view.supersededCommitmentsAvailable === false) unavailableSections.push("supersededCommitments");
  for (const s of unavailableSections) issues.push({ category: ISSUE_CATEGORIES.SECTION_NOT_EVALUATED, message: `Section "${s}" is not evaluated for this order (available=false) — absence is not evidence of "none found".`, orderCode: view.orderNumber });

  // --- Internal consistency --------------------------------------------
  const canonicalKeyGroups = new Map();
  for (const l of lines) {
    if (!l.canonicalKey) continue;
    canonicalKeyGroups.set(l.canonicalKey, (canonicalKeyGroups.get(l.canonicalKey) || 0) + 1);
  }
  let duplicateCanonicalLines = 0;
  for (const count of canonicalKeyGroups.values()) {
    if (count > 1) {
      duplicateCanonicalLines += count - 1;
      issues.push({ category: ISSUE_CATEGORIES.DUPLICATE_LINE, message: `${count} canonical lines share the same canonicalKey.`, orderCode: view.orderNumber });
    }
  }

  const refCounts = new Map();
  for (const e of evidenceReferences) refCounts.set(e.ref, (refCounts.get(e.ref) || 0) + 1);
  const duplicateEvidenceReferences = Array.from(refCounts.values()).filter((c) => c > 1).reduce((sum, c) => sum + (c - 1), 0);

  let danglingProvenanceRefs = 0;
  const referencedRefs = new Set();
  for (const l of lines) {
    for (const ref of Array.isArray(l.provenanceRefs) ? l.provenanceRefs : []) {
      referencedRefs.add(ref);
      if (!evidenceRefSet.has(ref)) {
        danglingProvenanceRefs += 1;
        issues.push({ category: ISSUE_CATEGORIES.DANGLING_PROVENANCE, message: `Line "${l.description || l.id}" cites evidence ref "${ref}" which does not resolve to any evidenceReferences entry.`, orderCode: view.orderNumber });
      }
    }
  }
  // Evidence pool entries never cited by any line's provenanceRefs, other
  // than the ones that back a linkedDocuments row directly (those are used
  // by the linked-document list itself, not by a canonical line).
  const linkedDocRefs = new Set();
  for (const e of evidenceReferences) {
    if (e.kind && DETERMINISTIC_LINK_KINDS.has(e.kind)) linkedDocRefs.add(e.ref);
  }
  const unmatchedEvidenceReferences = evidenceReferences.filter((e) => e.kind === "line_source" && !referencedRefs.has(e.ref) && !linkedDocRefs.has(e.ref)).length;

  let quantityConflicts = 0;
  let dateConflicts = 0;
  for (const l of lines) {
    const refs = Array.isArray(l.provenanceRefs) ? l.provenanceRefs : [];
    const parsed = refs.map((ref) => {
      const raw = excerptByRef.get(ref);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }).filter(Boolean);
    for (const field of ["quantity"]) {
      const values = new Set(parsed.map((p) => p[field]).filter((v) => v !== undefined && v !== null && v !== ""));
      if (values.size > 1) {
        quantityConflicts += 1;
        issues.push({ category: ISSUE_CATEGORIES.QUANTITY_CONFLICT, message: `Line "${l.description || l.id}" has disagreeing observed "${field}" values across its evidence: ${Array.from(values).join(", ")}.`, orderCode: view.orderNumber });
      }
    }
    for (const field of ["due_date", "required_date"]) {
      const values = new Set(parsed.map((p) => p[field]).filter((v) => v !== undefined && v !== null && v !== ""));
      if (values.size > 1) {
        dateConflicts += 1;
        issues.push({ category: ISSUE_CATEGORIES.DATE_CONFLICT, message: `Line "${l.description || l.id}" has disagreeing observed "${field}" values across its evidence: ${Array.from(values).join(", ")}.`, orderCode: view.orderNumber });
      }
    }
  }

  // The order's own real status (daysRemaining, alertLevel) vs the
  // currentObservedSituation rollup. Today the backend always returns the
  // literal placeholder {severity:'ok', label:null, reasonCodes:[]} — this
  // check surfaces exactly the "Scaduto vs Livello: ok" contradiction found
  // and fixed at the UI layer, now instrumented at the data layer for every
  // order, not just the one that happened to be screenshotted.
  const daysRemaining = view.summary?.daysRemaining;
  const situation = view.currentObservedSituation || {};
  const isUnvalidatedPlaceholder = !situation.label && (!Array.isArray(situation.reasonCodes) || situation.reasonCodes.length === 0);
  const contradictoryOrderStateSignals = (Number.isFinite(daysRemaining) && daysRemaining < 0 && situation.severity === "ok" && isUnvalidatedPlaceholder) ? 1 : 0;
  if (contradictoryOrderStateSignals) {
    issues.push({ category: ISSUE_CATEGORIES.OPERATIONAL_STATE_UNEXPLAINED, message: `Order is ${daysRemaining} days overdue but currentObservedSituation still reports the unvalidated "ok" placeholder (label:null, reasonCodes:[]) — never presented as healthy without this being explained.`, orderCode: view.orderNumber });
  }

  // --- Traceability ------------------------------------------------------
  const linesWithoutProvenance = canonicalLineCount - linesWithEvidence;
  if (linesWithoutProvenance > 0) issues.push({ category: ISSUE_CATEGORIES.LINE_WITHOUT_EVIDENCE, message: `${linesWithoutProvenance} of ${canonicalLineCount} canonical lines have no provenance reference at all.`, orderCode: view.orderNumber });

  const evidenceWithoutSafeExcerpt = evidenceReferences.filter((e) => (excerptByRef.get(e.ref) ?? null) === null).length;

  const documentsWithoutDeterministicOrderLink = linkedDocuments.filter((d) => !DETERMINISTIC_LINK_KINDS.has(d.kind)).length;
  if (documentsWithoutDeterministicOrderLink > 0) issues.push({ category: ISSUE_CATEGORIES.DOCUMENT_LINK_UNPROVEN, message: `${documentsWithoutDeterministicOrderLink} linked document(s) have a kind outside the proven deterministic-link set (${Array.from(DETERMINISTIC_LINK_KINDS).join(", ")}).`, orderCode: view.orderNumber });
  const documentTraceabilityRatio = ratio(linkedDocuments.length - documentsWithoutDeterministicOrderLink, linkedDocuments.length);

  // --- System limitations -------------------------------------------------
  const sourceCoverageComplete = coverageEntries.every((e) => e && e.status !== "unavailable");
  const limitationReasonCodes = [
    "ORIGINAL_INBOUND_EMAIL_CONTENT_NOT_AVAILABLE",
    "ORIGINAL_ATTACHMENT_CONTENT_NOT_AVAILABLE"
  ];
  if (!view.activeCommitmentsAvailable) limitationReasonCodes.push("COMMITMENTS_NOT_EVALUATED");
  if (!sourceCoverageComplete) limitationReasonCodes.push("SOURCE_COVERAGE_INCOMPLETE");

  return {
    ...base,
    orderCode: view.orderNumber || null,
    supplier: view.resolvedSupplierOrganization?.legalName || view.summary?.supplierOrganizationName || null,
    coverage: {
      orderAvailable: true,
      supplierResolved: Boolean(view.resolvedSupplierOrganization),
      canonicalLineCount,
      linesWithEvidence,
      evidenceCoverageRatio,
      linkedDocumentCount: linkedDocuments.length,
      observedSourceStates,
      missingSourceStates,
      unavailableSections
    },
    internalConsistency: {
      quantityConflicts,
      dateConflicts,
      duplicateCanonicalLines,
      duplicateEvidenceReferences,
      unmatchedEvidenceReferences,
      contradictoryOrderStateSignals
    },
    traceability: {
      linesWithoutProvenance,
      danglingProvenanceRefs,
      evidenceWithoutSafeExcerpt,
      documentsWithoutDeterministicOrderLink,
      documentTraceabilityRatio,
      unresolvedDataAvailable: view.unresolvedEvidenceAvailable !== false,
      ambiguousDataAvailable: view.ambiguousEvidenceAvailable !== false
    },
    systemLimitations: {
      inboundOriginalContentAvailable: false, // fixed pilot-wide limitation, never computed as true
      attachmentOriginalContentAvailable: false, // fixed pilot-wide limitation, never computed as true
      commitmentsEvaluated: Boolean(view.activeCommitmentsAvailable),
      sourceCoverageComplete,
      limitationReasonCodes
    },
    manualReview: { reviewerVerdict: null, reviewerNotes: "", buyerCanDecideWithoutExternalSearch: null },
    issues
  };
}

/* ------------------------------------------------------------------ *
 * Runs getOrderOperationalView for one order and wraps any failure as a
 * pilot case with orderAvailable:false, instead of throwing — a candidate
 * that disappears mid-run must still show up in the report, not crash it.
 * ------------------------------------------------------------------ */
export async function evaluateOrder({ organizationId, orderId, selectionReason, reqDb }) {
  try {
    const view = await getOrderOperationalView(organizationId, orderId, { supabaseRequestOverride: reqDb });
    return buildPilotCase({ organizationId, orderId, selectionReason, view });
  } catch (error) {
    return buildPilotCase({ organizationId, orderId, selectionReason, view: null, error: error?.statusCode === 404 ? "Order not found under this organization." : "Order could not be evaluated." });
  }
}

/* ------------------------------------------------------------------ *
 * Candidate selection — deterministic, tenant-scoped, GET-only.
 * ------------------------------------------------------------------ */

const STRATA = Object.freeze([
  { key: "high_evidence", label: "high-evidence" },
  { key: "low_evidence", label: "low-evidence" },
  { key: "multi_line", label: "multi-line" },
  { key: "overdue_attention", label: "overdue/attention" },
  { key: "incomplete_coverage_unresolved", label: "incomplete-coverage or unresolved" }
]);

function isOverdueOrAttention(order) {
  const days = Number(order.days_remaining);
  return order.alert_level === "critical" || order.alert_level === "warning" || (Number.isFinite(days) && days < 0) || order.status === "Scaduto";
}

// Collects the light, org-wide signals needed to stratify candidates without
// running the full (heavier) getOrderOperationalView for every order in the
// tenant. Every query here is GET-only and tenant-scoped.
export async function collectCandidateSignals({ organizationId, reqDb }) {
  const filter = orgFilter(organizationId);
  const orders = await reqDb(`orders?${filter}&select=id,order_code,status,alert_level,days_remaining&order=id.asc`);
  const lines = await reqDb(`canonical_operational_lines?${filter}&order_id=not.is.null&select=id,order_id,needs_review`);
  const sourceEntityIds = new Set(
    (await reqDb(`canonical_line_sources?${filter}&select=entity_id`)).map((r) => r.entity_id)
  );

  const linesByOrder = new Map();
  for (const l of lines || []) {
    if (!linesByOrder.has(l.order_id)) linesByOrder.set(l.order_id, []);
    linesByOrder.get(l.order_id).push(l);
  }

  return (orders || []).map((o) => {
    const orderLines = linesByOrder.get(o.id) || [];
    const lineCount = orderLines.length;
    const linesWithEvidence = orderLines.filter((l) => sourceEntityIds.has(l.id)).length;
    const needsReviewLines = orderLines.filter((l) => l.needs_review).length;
    return {
      id: o.id,
      orderCode: o.order_code || null,
      lineCount,
      linesWithEvidence,
      evidenceRatio: ratio(linesWithEvidence, lineCount),
      needsReviewLines,
      overdueOrAttention: isOverdueOrAttention(o),
      incompleteOrUnresolved: needsReviewLines > 0 || (lineCount > 0 && linesWithEvidence < lineCount)
    };
  });
}

function sortDeterministic(list, keyFn, direction) {
  return [...list].sort((a, b) => {
    const av = keyFn(a);
    const bv = keyFn(b);
    if (av !== bv) return direction === "desc" ? bv - av : av - bv;
    return String(a.id).localeCompare(String(b.id)); // stable, deterministic tiebreaker
  });
}

// Deterministic 10-(or `limit`-)order selection across 5 strata. Returns
// { selections: [{id, orderCode, stratum, reason}], deficits: [...] } —
// never mutates or tags any order row.
export function selectPilotCandidates(candidates, { limit = 10, knownOrderCode = KNOWN_PILOT_ORDER_CODE } = {}) {
  const selected = [];
  const selectedIds = new Set();
  const deficits = [];

  const known = knownOrderCode ? candidates.find((c) => c.orderCode === knownOrderCode) : null;
  if (known) {
    selected.push({ id: known.id, orderCode: known.orderCode, stratum: "known_pilot_case", reason: `Known pilot case: order ${known.orderCode} is the explicit first-case requirement.` });
    selectedIds.add(known.id);
  }

  const remainingSlots = Math.max(0, limit - selected.length);
  const perStratumBase = Math.floor(remainingSlots / STRATA.length);
  const extra = remainingSlots - perStratumBase * STRATA.length;

  const pools = {
    high_evidence: sortDeterministic(candidates.filter((c) => c.evidenceRatio !== null && c.evidenceRatio >= 0.8 && c.lineCount > 0), (c) => c.evidenceRatio, "desc"),
    low_evidence: sortDeterministic(candidates.filter((c) => c.lineCount > 0 && (c.evidenceRatio === null || c.evidenceRatio <= 0.3)), (c) => (c.evidenceRatio ?? 0), "asc"),
    multi_line: sortDeterministic(candidates.filter((c) => c.lineCount >= 2), (c) => c.lineCount, "desc"),
    overdue_attention: sortDeterministic(candidates.filter((c) => c.overdueOrAttention), (c) => c.needsReviewLines, "desc"),
    incomplete_coverage_unresolved: sortDeterministic(candidates.filter((c) => c.incompleteOrUnresolved), (c) => c.needsReviewLines + (c.lineCount - c.linesWithEvidence), "desc")
  };

  STRATA.forEach((stratum, idx) => {
    const wanted = perStratumBase + (idx < extra ? 1 : 0);
    const pool = pools[stratum.key].filter((c) => !selectedIds.has(c.id));
    let picked = pool.slice(0, wanted);
    if (picked.length < wanted) {
      deficits.push({ stratum: stratum.label, wanted, found: picked.length, reason: "Not enough eligible, not-yet-selected candidates in this stratum." });
      // Only reuse an already-selected candidate as an explicit last resort,
      // and only if the whole eligible pool (including already-selected) is
      // itself smaller than requested — never to pad past genuine scarcity.
      const fullPool = pools[stratum.key];
      if (fullPool.length > picked.length) {
        const reuse = fullPool.filter((c) => !picked.some((p) => p.id === c.id)).slice(0, wanted - picked.length);
        picked = picked.concat(reuse);
      }
    }
    for (const c of picked) {
      const reused = selectedIds.has(c.id);
      selected.push({
        id: c.id,
        orderCode: c.orderCode,
        stratum: stratum.key,
        reason: `${stratum.label}${reused ? " (reused — insufficient distinct eligible candidates)" : ""}: lines=${c.lineCount}, evidenceRatio=${c.evidenceRatio === null ? "null" : c.evidenceRatio.toFixed(2)}, needsReviewLines=${c.needsReviewLines}, overdueOrAttention=${c.overdueOrAttention}`
      });
      selectedIds.add(c.id);
    }
  });

  return { selections: selected.slice(0, limit), deficits };
}

/* ------------------------------------------------------------------ *
 * Aggregate report assembly
 * ------------------------------------------------------------------ */

export function aggregateIssues(pilotCases) {
  const byCategory = new Map();
  for (const pc of pilotCases) {
    for (const issue of pc.issues || []) {
      if (!byCategory.has(issue.category)) byCategory.set(issue.category, []);
      byCategory.get(issue.category).push({ orderCode: pc.orderCode, message: issue.message });
    }
  }
  return Array.from(byCategory.entries()).map(([category, occurrences]) => ({ category, count: occurrences.length, occurrences }));
}

export function buildJsonReport({ organizationId, limit, pilotCases, deficits, generatedAt }) {
  return {
    generatedAt,
    organizationId,
    limit,
    scope: {
      measures: ["data coverage", "internal consistency", "traceability", "operational usability (manual review, left blank)"],
      doesNotMeasure: ["absolute extraction accuracy against original inbound emails/attachments — not available for this pilot"]
    },
    selectionDeficits: deficits,
    pilotCases,
    aggregateIssues: aggregateIssues(pilotCases)
  };
}

function fmtRatio(r) {
  return r === null || r === undefined ? "null" : r.toFixed(2);
}

export function buildMarkdownReport(report) {
  const { generatedAt, organizationId, pilotCases, selectionDeficits, aggregateIssues: issues } = report;
  const lines = [];
  lines.push("# Pilot Control Check");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Organization: ${organizationId}`);
  lines.push("");
  lines.push("## Scope and limitations");
  lines.push("");
  lines.push("This report measures **data coverage, internal consistency and traceability only**. It does NOT measure absolute extraction accuracy: the reviewer does not have access to the full original inbound emails or every original attachment. Any claim about whether an extracted value is factually correct requires manual verification against the original source, which is out of scope here. Manual-review fields (`reviewerVerdict`, `reviewerNotes`, `buyerCanDecideWithoutExternalSearch`) are left blank by design.");
  lines.push("");
  if (selectionDeficits?.length) {
    lines.push("## Selection deficits");
    lines.push("");
    for (const d of selectionDeficits) lines.push(`- **${d.stratum}**: wanted ${d.wanted}, found ${d.found} eligible — ${d.reason}`);
    lines.push("");
  }
  lines.push("## Selected orders");
  lines.push("");
  for (const pc of pilotCases) {
    lines.push(`### ${pc.orderCode || pc.orderId}`);
    lines.push("");
    lines.push(`- Selection reason: ${pc.selectionReason || "n/a"}`);
    lines.push(`- Supplier: ${pc.supplier || "Non disponibile"}`);
    if (!pc.coverage.orderAvailable) {
      lines.push(`- **Order not available under this organization.**`);
      lines.push("");
      continue;
    }
    lines.push("");
    lines.push("**Coverage**");
    lines.push(`- Canonical lines: ${pc.coverage.canonicalLineCount} (with evidence: ${pc.coverage.linesWithEvidence}, ratio: ${fmtRatio(pc.coverage.evidenceCoverageRatio)})`);
    lines.push(`- Linked documents: ${pc.coverage.linkedDocumentCount}`);
    lines.push(`- Supplier resolved: ${pc.coverage.supplierResolved}`);
    lines.push(`- Source states observed/missing: ${pc.coverage.observedSourceStates}/${pc.coverage.missingSourceStates}`);
    lines.push(`- Unavailable sections: ${pc.coverage.unavailableSections.length ? pc.coverage.unavailableSections.join(", ") : "none"}`);
    lines.push("");
    lines.push("**Internal consistency**");
    lines.push(`- Quantity conflicts: ${pc.internalConsistency.quantityConflicts}, Date conflicts: ${pc.internalConsistency.dateConflicts}`);
    lines.push(`- Duplicate canonical lines: ${pc.internalConsistency.duplicateCanonicalLines}, Duplicate evidence refs: ${pc.internalConsistency.duplicateEvidenceReferences}`);
    lines.push(`- Unmatched evidence references: ${pc.internalConsistency.unmatchedEvidenceReferences}`);
    lines.push(`- Contradictory order-state signals: ${pc.internalConsistency.contradictoryOrderStateSignals}`);
    lines.push("");
    lines.push("**Traceability**");
    lines.push(`- Lines without provenance: ${pc.traceability.linesWithoutProvenance}`);
    lines.push(`- Dangling provenance refs: ${pc.traceability.danglingProvenanceRefs}`);
    lines.push(`- Evidence without safe excerpt: ${pc.traceability.evidenceWithoutSafeExcerpt}`);
    lines.push(`- Documents without deterministic order link: ${pc.traceability.documentsWithoutDeterministicOrderLink} (ratio: ${fmtRatio(pc.traceability.documentTraceabilityRatio)})`);
    lines.push(`- Unresolved/ambiguous data available: ${pc.traceability.unresolvedDataAvailable}/${pc.traceability.ambiguousDataAvailable}`);
    lines.push("");
    lines.push("**Explicit unavailable information**");
    lines.push(`- Original inbound email content available: ${pc.systemLimitations.inboundOriginalContentAvailable}`);
    lines.push(`- Original attachment content available: ${pc.systemLimitations.attachmentOriginalContentAvailable}`);
    lines.push(`- Commitments evaluated: ${pc.systemLimitations.commitmentsEvaluated}`);
    lines.push(`- Source coverage complete: ${pc.systemLimitations.sourceCoverageComplete}`);
    lines.push(`- Limitation reason codes: ${pc.systemLimitations.limitationReasonCodes.join(", ")}`);
    lines.push("");
    lines.push("**Manual review (left blank for human reviewer)**");
    lines.push(`- reviewerVerdict: ${pc.manualReview.reviewerVerdict ?? "null"}`);
    lines.push(`- reviewerNotes: ${pc.manualReview.reviewerNotes ? pc.manualReview.reviewerNotes : "(empty)"}`);
    lines.push(`- buyerCanDecideWithoutExternalSearch: ${pc.manualReview.buyerCanDecideWithoutExternalSearch ?? "null"}`);
    lines.push("");
  }
  lines.push("## Aggregate issue categories");
  lines.push("");
  if (!issues.length) {
    lines.push("No issues recorded across selected orders.");
  } else {
    lines.push("| Category | Count |");
    lines.push("|---|---|");
    for (const i of issues) lines.push(`| ${i.category} | ${i.count} |`);
  }
  lines.push("");
  lines.push("## Recommended next investigation");
  lines.push("");
  lines.push("- Manually review each selected order against its original source (email/attachment) where access allows, and fill in `reviewerVerdict`/`reviewerNotes`/`buyerCanDecideWithoutExternalSearch` — this report intentionally does not do this automatically.");
  lines.push("- For any `OPERATIONAL_STATE_UNEXPLAINED` finding, decide whether `currentObservedSituation` should be wired to a real computation or continue to be presented as \"not yet calculated\" (see `docs/product/ORDER_OPERATIONAL_VIEW_CONTRACT.md` §3.5).");
  lines.push("- For any `QUANTITY_CONFLICT`/`DATE_CONFLICT` finding, check the cited evidence refs manually — this report only flags disagreement, it does not decide which observed value is correct.");
  lines.push("- No automatic remediation is proposed or performed by this tool.");
  lines.push("");
  return lines.join("\n");
}

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsvReport(pilotCases) {
  const headers = [
    "pilotCaseId", "orderId", "orderCode", "supplier", "selectionReason",
    "orderAvailable", "canonicalLineCount", "linesWithEvidence", "evidenceCoverageRatio", "linkedDocumentCount",
    "quantityConflicts", "dateConflicts", "duplicateCanonicalLines", "unmatchedEvidenceReferences", "contradictoryOrderStateSignals",
    "linesWithoutProvenance", "danglingProvenanceRefs", "documentsWithoutDeterministicOrderLink",
    "sourceCoverageComplete", "reviewerVerdict"
  ];
  const rows = pilotCases.map((pc) => [
    pc.pilotCaseId, pc.orderId, pc.orderCode, pc.supplier, pc.selectionReason,
    pc.coverage.orderAvailable, pc.coverage.canonicalLineCount, pc.coverage.linesWithEvidence, fmtRatio(pc.coverage.evidenceCoverageRatio), pc.coverage.linkedDocumentCount,
    pc.internalConsistency.quantityConflicts, pc.internalConsistency.dateConflicts, pc.internalConsistency.duplicateCanonicalLines, pc.internalConsistency.unmatchedEvidenceReferences, pc.internalConsistency.contradictoryOrderStateSignals,
    pc.traceability.linesWithoutProvenance, pc.traceability.danglingProvenanceRefs, pc.traceability.documentsWithoutDeterministicOrderLink,
    pc.systemLimitations.sourceCoverageComplete, pc.manualReview.reviewerVerdict
  ].map(csvEscape).join(","));
  return [headers.join(","), ...rows].join("\n");
}

/* ------------------------------------------------------------------ *
 * Top-level entrypoint used by the CLI.
 * ------------------------------------------------------------------ */
export async function runPilotControlCheck({ organizationId, orderId, limit = 10, reqDb }) {
  if (!organizationId) {
    const err = new Error("Missing organizationId. Pass --organization-id <uuid>.");
    err.failedClosed = true;
    throw err;
  }
  const db = reqDb || supabaseRequest;
  const generatedAt = nowIso();

  if (orderId) {
    const pc = await evaluateOrder({ organizationId, orderId, selectionReason: "explicit --order-id", reqDb: db });
    return buildJsonReport({ organizationId, limit: 1, pilotCases: [pc], deficits: [], generatedAt });
  }

  const candidates = await collectCandidateSignals({ organizationId, reqDb: db });
  const { selections, deficits } = selectPilotCandidates(candidates, { limit });
  const pilotCases = [];
  for (const s of selections) {
    // Sequential, not parallel: keeps output ordering deterministic and
    // load on the database predictable regardless of tenant size.
    pilotCases.push(await evaluateOrder({ organizationId, orderId: s.id, selectionReason: s.reason, reqDb: db }));
  }
  return buildJsonReport({ organizationId, limit, pilotCases, deficits, generatedAt });
}
