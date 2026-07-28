import { daysFromToday } from "./dateUtils.js";

export const PURCHASE_ORDER_ACTION_CODES = Object.freeze({
  VERIFY_ORDER_STATUS: "VERIFY_ORDER_STATUS",
  ATTENTION_OVERDUE: "ATTENTION_OVERDUE",
  ATTENTION_APPROACHING_DEADLINE: "ATTENTION_APPROACHING_DEADLINE",
  VERIFY_EXPIRED_LINE_COMMITMENT: "VERIFY_EXPIRED_LINE_COMMITMENT"
});

export const PURCHASE_ORDER_ACTION_PRIORITIES = Object.freeze({
  OPERATIONAL_PRIORITY: "OPERATIONAL_PRIORITY",
  TO_REVIEW: "TO_REVIEW",
  TO_MONITOR: "TO_MONITOR"
});

export const PURCHASE_ORDER_SUGGESTIONS_INITIAL_LIMIT = 3;

const PRIORITY_LABELS = Object.freeze({
  OPERATIONAL_PRIORITY: "Priorità operativa",
  TO_REVIEW: "Da verificare",
  TO_MONITOR: "Da monitorare"
});

const PRIORITY_ORDER = Object.freeze({
  OPERATIONAL_PRIORITY: 0,
  TO_REVIEW: 1,
  TO_MONITOR: 2
});

const TARGET_ORDER = Object.freeze({
  order: 0,
  line: 1
});

const KNOWN_BUSINESS_STATUSES = new Set([
  "TO_VERIFY",
  "OVERDUE",
  "CRITICAL",
  "WARNING",
  "OK",
  "CLOSED"
]);

function stableId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function hasPositiveFiniteRemainingQuantity(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value !== "string") return false;

  const normalized = value.trim();
  if (!normalized) return false;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return false;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0;
}

function qualifyingCommitments(line, referenceDate) {
  const candidates = [
    { field: "dueDate", label: "Data prevista", value: line?.dueDate },
    { field: "requiredDate", label: "Richiesta entro", value: line?.requiredDate }
  ];

  return candidates.filter((candidate) => {
    if (!candidate.value) return false;
    const dayDelta = daysFromToday(candidate.value, referenceDate);
    return Number.isFinite(dayDelta) && dayDelta <= 0;
  });
}

function orderAction({
  orderId,
  actionCode,
  priorityCode,
  title,
  reason
}) {
  return {
    actionCode,
    domain: "operational",
    priorityCode,
    priorityLabel: PRIORITY_LABELS[priorityCode],
    title,
    reason,
    targetLevel: "order",
    lineDescription: null,
    commitmentDetails: [],
    internalKey: `${orderId}:${actionCode}`,
    orderId,
    lineId: null
  };
}

function compareActions(left, right) {
  return (PRIORITY_ORDER[left.priorityCode] ?? Number.MAX_SAFE_INTEGER)
    - (PRIORITY_ORDER[right.priorityCode] ?? Number.MAX_SAFE_INTEGER)
    || (TARGET_ORDER[left.targetLevel] ?? Number.MAX_SAFE_INTEGER)
    - (TARGET_ORDER[right.targetLevel] ?? Number.MAX_SAFE_INTEGER)
    || String(left.orderId).localeCompare(String(right.orderId))
    || String(left.lineId || "").localeCompare(String(right.lineId || ""))
    || String(left.actionCode).localeCompare(String(right.actionCode));
}

export function buildPurchaseOrderOperationalSuggestions({
  data,
  businessStatus,
  referenceDate = new Date()
}) {
  const orderId = stableId(data?.orderId);
  if (!orderId || !KNOWN_BUSINESS_STATUSES.has(businessStatus) || businessStatus === "CLOSED") {
    return [];
  }

  const actions = [];

  if (businessStatus === "TO_VERIFY") {
    actions.push(orderAction({
      orderId,
      actionCode: PURCHASE_ORDER_ACTION_CODES.VERIFY_ORDER_STATUS,
      priorityCode: PURCHASE_ORDER_ACTION_PRIORITIES.OPERATIONAL_PRIORITY,
      title: "Verifica ordine",
      reason: "Lo stato operativo di questo ordine richiede una verifica manuale."
    }));
  } else if (businessStatus === "OVERDUE") {
    actions.push(orderAction({
      orderId,
      actionCode: PURCHASE_ORDER_ACTION_CODES.ATTENTION_OVERDUE,
      priorityCode: PURCHASE_ORDER_ACTION_PRIORITIES.OPERATIONAL_PRIORITY,
      title: "Ordine in ritardo",
      reason: "L'ordine è oltre la data prevista. Verifica lo stato aggiornato dell'ordine e valuta il canale operativo più appropriato."
    }));
  } else if (businessStatus === "CRITICAL") {
    actions.push(orderAction({
      orderId,
      actionCode: PURCHASE_ORDER_ACTION_CODES.ATTENTION_APPROACHING_DEADLINE,
      priorityCode: PURCHASE_ORDER_ACTION_PRIORITIES.TO_REVIEW,
      title: "Ordine in scadenza",
      reason: "L'ordine si avvicina alla data prevista. Verifica che le informazioni operative disponibili siano aggiornate."
    }));
  }

  // The order-level overdue action is authoritative for this phase: line
  // actions would repeat the same operational condition without new evidence.
  if (businessStatus === "OVERDUE") return actions;

  for (const line of Array.isArray(data?.canonicalMaterialLines) ? data.canonicalMaterialLines : []) {
    const lineId = stableId(line?.id);
    if (!lineId || !hasPositiveFiniteRemainingQuantity(line?.remainingQuantity)) continue;
    const commitmentDetails = qualifyingCommitments(line, referenceDate);
    if (!commitmentDetails.length) continue;

    actions.push({
      actionCode: PURCHASE_ORDER_ACTION_CODES.VERIFY_EXPIRED_LINE_COMMITMENT,
      domain: "operational",
      priorityCode: PURCHASE_ORDER_ACTION_PRIORITIES.TO_REVIEW,
      priorityLabel: PRIORITY_LABELS.TO_REVIEW,
      title: "Verifica riga oltre la data prevista",
      reason: "La data prevista per questa riga è trascorsa e nei dati correnti risulta ancora una quantità residua. Verifica lo stato della riga.",
      targetLevel: "line",
      lineDescription: typeof line.description === "string" && line.description.trim()
        ? line.description.trim()
        : "Riga materiale",
      commitmentDetails,
      internalKey: `${orderId}:${PURCHASE_ORDER_ACTION_CODES.VERIFY_EXPIRED_LINE_COMMITMENT}:${lineId}`,
      orderId,
      lineId
    });
  }

  return actions.sort(compareActions);
}
