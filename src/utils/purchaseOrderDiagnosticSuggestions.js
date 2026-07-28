import { resolveExistingEvidenceRefs } from "./dataQualityInvestigation";
import { compareEvidenceRefs } from "./observedPurchaseOrderTimeline";
import { sanitizePurchaseOrderSummaryText } from "./purchaseOrderOperationalSummary";
import { PURCHASE_ORDER_FINDING_FACTUAL_COPY } from "./purchaseOrderFindingPresentation.js";

export const PURCHASE_ORDER_DIAGNOSTIC_INITIAL_LIMIT = 3;

const PRIORITY_ORDER = Object.freeze({
  OPERATIONAL_PRIORITY: 0,
  TO_REVIEW: 1,
  TO_MONITOR: 2
});

const TARGET_ORDER = Object.freeze({
  order: 0,
  line: 1,
  document: 2,
  mixed: 3,
  none: 4
});

const PRIORITY_LABELS = Object.freeze({
  OPERATIONAL_PRIORITY: "Priorità operativa",
  TO_REVIEW: "Da verificare",
  TO_MONITOR: "Da monitorare"
});

export const DIAGNOSTIC_ACTION_TAXONOMY = Object.freeze({
  ORDER_LINK_MISSING: Object.freeze({
    actionCode: "REVIEW_ORDER_LINK_MISSING",
    priorityCode: "OPERATIONAL_PRIORITY",
    title: "Verifica collegamento ordine",
    reason: PURCHASE_ORDER_FINDING_FACTUAL_COPY.ORDER_LINK_MISSING,
    orderLevel: true
  }),
  DANGLING_PROVENANCE: Object.freeze({
    actionCode: "REVIEW_DANGLING_PROVENANCE",
    priorityCode: "OPERATIONAL_PRIORITY",
    title: "Verifica riferimento evidenza",
    reason: PURCHASE_ORDER_FINDING_FACTUAL_COPY.DANGLING_PROVENANCE
  }),
  DOCUMENT_LINK_UNPROVEN: Object.freeze({
    actionCode: "REVIEW_DOCUMENT_LINK",
    priorityCode: "OPERATIONAL_PRIORITY",
    title: "Verifica collegamento documenti",
    reason: PURCHASE_ORDER_FINDING_FACTUAL_COPY.DOCUMENT_LINK_UNPROVEN
  }),
  OPERATIONAL_STATE_UNEXPLAINED: Object.freeze({
    actionCode: "REVIEW_OPERATIONAL_STATE_UNEXPLAINED",
    priorityCode: "OPERATIONAL_PRIORITY",
    title: "Verifica stato operativo non spiegato",
    reason: PURCHASE_ORDER_FINDING_FACTUAL_COPY.OPERATIONAL_STATE_UNEXPLAINED,
    orderLevel: true
  }),
  LINE_WITHOUT_EVIDENCE: Object.freeze({
    actionCode: "REVIEW_LINE_WITHOUT_EVIDENCE",
    priorityCode: "TO_REVIEW",
    title: "Verifica righe senza evidenza",
    reason: PURCHASE_ORDER_FINDING_FACTUAL_COPY.LINE_WITHOUT_EVIDENCE
  }),
  QUANTITY_CONFLICT: Object.freeze({
    actionCode: "REVIEW_QUANTITY_CONFLICT",
    priorityCode: "TO_REVIEW",
    title: "Verifica quantità in conflitto",
    reason: PURCHASE_ORDER_FINDING_FACTUAL_COPY.QUANTITY_CONFLICT
  }),
  DATE_CONFLICT: Object.freeze({
    actionCode: "REVIEW_DATE_CONFLICT",
    priorityCode: "TO_REVIEW",
    title: "Verifica date in conflitto",
    reason: PURCHASE_ORDER_FINDING_FACTUAL_COPY.DATE_CONFLICT
  }),
  DUPLICATE_LINE: Object.freeze({
    actionCode: "REVIEW_DUPLICATE_LINE",
    priorityCode: "TO_REVIEW",
    title: "Verifica possibili righe duplicate",
    reason: PURCHASE_ORDER_FINDING_FACTUAL_COPY.DUPLICATE_LINE
  })
});

function exactString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    ? value
    : null;
}

function safeSummary(value, kind) {
  if (!value || typeof value !== "object") return null;
  const id = exactString(value.id);
  if (!id) return null;
  if (kind === "line") {
    return {
      id,
      description: sanitizePurchaseOrderSummaryText(value.description),
      itemCode: sanitizePurchaseOrderSummaryText(value.itemCode)
    };
  }
  return {
    id,
    kind: sanitizePurchaseOrderSummaryText(value.kind),
    number: sanitizePurchaseOrderSummaryText(value.number)
  };
}

function normalizeTargets(values, kind) {
  const byId = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const summary = safeSummary(value, kind);
    if (summary && !byId.has(summary.id)) byId.set(summary.id, summary);
  }
  return Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeEvidenceRefs(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(exactString)
      .filter(Boolean)
  )).sort((left, right) => compareEvidenceRefs({ ref: left }, { ref: right }));
}

function deriveTargetLevel({ lines, documents, orderLevel }) {
  if (lines.length && documents.length) return "mixed";
  if (lines.length) return "line";
  if (documents.length) return "document";
  if (orderLevel) return "order";
  return "none";
}

function resolvedTargetIds(summaries, availableRows) {
  const available = new Set(
    (Array.isArray(availableRows) ? availableRows : [])
      .map((row) => exactString(row?.id))
      .filter(Boolean)
  );
  return summaries.map((summary) => summary.id).filter((id) => available.has(id));
}

function derivePrimaryNavigationTarget({
  resolvedEvidenceRefs,
  resolvedLineIds,
  resolvedDocumentIds
}) {
  if (resolvedEvidenceRefs.length) return { type: "evidence", ref: resolvedEvidenceRefs[0] };
  if (resolvedLineIds.length) return { type: "line", id: resolvedLineIds[0] };
  if (resolvedDocumentIds.length) return { type: "document", id: resolvedDocumentIds[0] };
  return null;
}

export function comparePurchaseOrderDiagnosticActions(left, right) {
  return (PRIORITY_ORDER[left.priorityCode] ?? Number.MAX_SAFE_INTEGER)
    - (PRIORITY_ORDER[right.priorityCode] ?? Number.MAX_SAFE_INTEGER)
    || (TARGET_ORDER[left.targetLevel] ?? Number.MAX_SAFE_INTEGER)
    - (TARGET_ORDER[right.targetLevel] ?? Number.MAX_SAFE_INTEGER)
    || left.internalKey.localeCompare(right.internalKey)
    || left.actionCode.localeCompare(right.actionCode);
}

export function buildPurchaseOrderDiagnosticSuggestions({
  qualityState,
  operationalData
}) {
  if (qualityState?.status !== "loaded" || !qualityState.qualityContract) return [];

  const evidenceReferences = Array.isArray(operationalData?.evidenceReferences)
    ? operationalData.evidenceReferences
    : [];
  const availableLines = Array.isArray(operationalData?.canonicalMaterialLines)
    ? operationalData.canonicalMaterialLines
    : [];
  const availableDocuments = Array.isArray(operationalData?.linkedDocuments)
    ? operationalData.linkedDocuments
    : [];
  const actions = [];

  for (const finding of Array.isArray(qualityState.qualityContract.findings)
    ? qualityState.qualityContract.findings
    : []) {
    const findingId = exactString(finding?.findingId);
    const taxonomy = DIAGNOSTIC_ACTION_TAXONOMY[finding?.type];
    if (!findingId || !taxonomy) continue;

    const affectedLines = normalizeTargets(finding.affectedLines, "line");
    const affectedDocuments = normalizeTargets(finding.affectedDocuments, "document");
    const declaredEvidenceRefs = normalizeEvidenceRefs(finding.evidenceRefs);
    const resolvedEvidenceRefs = resolveExistingEvidenceRefs(
      declaredEvidenceRefs,
      evidenceReferences
    ).sort((left, right) => compareEvidenceRefs({ ref: left }, { ref: right }));
    const resolvedLineIds = resolvedTargetIds(affectedLines, availableLines);
    const resolvedDocumentIds = resolvedTargetIds(affectedDocuments, availableDocuments);

    actions.push({
      actionCode: taxonomy.actionCode,
      domain: "diagnostic",
      priorityCode: taxonomy.priorityCode,
      priorityLabel: PRIORITY_LABELS[taxonomy.priorityCode],
      title: taxonomy.title,
      reason: taxonomy.reason,
      internalKey: findingId,
      targetLevel: deriveTargetLevel({
        lines: affectedLines,
        documents: affectedDocuments,
        orderLevel: taxonomy.orderLevel
      }),
      affectedLines,
      affectedDocuments,
      declaredEvidenceRefs,
      resolvedEvidenceRefs,
      primaryNavigationTarget: derivePrimaryNavigationTarget({
        resolvedEvidenceRefs,
        resolvedLineIds,
        resolvedDocumentIds
      }),
      unavailableEvidenceNote: declaredEvidenceRefs.length > 0 && resolvedEvidenceRefs.length === 0
        ? "Collegamento all'evidenza non disponibile."
        : null
    });
  }

  return actions.sort(comparePurchaseOrderDiagnosticActions);
}
