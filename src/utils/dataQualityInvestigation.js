// Phase 1B presentation helpers for a Data Quality investigation handoff.
//
// Responsibilities:
//   - allowlist and normalize the finding context already present in the
//     Data Quality Contract;
//   - derive deterministic, factual banner copy;
//   - redact raw UUIDs from visible summaries;
//   - resolve line, document and evidence focus by exact stable identifiers.
//
// Boundaries:
//   - no data fetching, persistence, matching, scoring or inference;
//   - no parsing of finding prose to reconstruct missing structured fields;
//   - no fuzzy fallback when a referenced line, document or evidence item is
//     absent from the current operational-view response.

const FINDING_LABELS = Object.freeze({
  ORDER_LINK_MISSING: "Ordine non disponibile",
  LINE_WITHOUT_EVIDENCE: "Riga senza evidenza",
  DANGLING_PROVENANCE: "Riferimento evidenza non risolto",
  DOCUMENT_LINK_UNPROVEN: "Collegamento documento non confermato",
  QUANTITY_CONFLICT: "Quantità in conflitto",
  DATE_CONFLICT: "Date in conflitto",
  DUPLICATE_LINE: "Possibile riga duplicata",
  OPERATIONAL_STATE_UNEXPLAINED: "Stato operativo da verificare",
  SECTION_NOT_EVALUATED: "Verifica non eseguita"
});

const CANNOT_CONFIRM_BY_TYPE = Object.freeze({
  LINE_WITHOUT_EVIDENCE:
    "OrderWatch non dispone di un'evidenza collegata per questa riga. Il contenuto della riga non può essere verificato rispetto a una fonte.",
  QUANTITY_CONFLICT:
    "Le fonti disponibili riportano quantità differenti. OrderWatch non determina quale valore sia corretto.",
  DATE_CONFLICT:
    "Le fonti disponibili riportano date differenti. OrderWatch non determina quale data sia corretta.",
  DOCUMENT_LINK_UNPROVEN:
    "Il documento è disponibile, ma il collegamento con questo ordine non è stato confermato.",
  OPERATIONAL_STATE_UNEXPLAINED:
    "Lo stato richiede una verifica delle date, dei documenti collegati e delle comunicazioni recenti prima di rispondere al cliente.",
  SECTION_NOT_EVALUATED:
    "Questa verifica non è stata eseguita con le fonti attualmente disponibili. L'assenza di un risultato non conferma che l'ordine sia completo o corretto."
});

const GENERIC_CANNOT_CONFIRM =
  "La segnalazione indica un elemento da verificare. OrderWatch non conferma automaticamente che l'ordine sia completo o corretto.";

const DOCUMENT_KIND_LABELS = Object.freeze({
  delivery_note: "Bolla di consegna",
  invoice: "Fattura",
  quote: "Preventivo",
  document: "Documento"
});

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalVisibleString(value) {
  const text = optionalString(value);
  return text ? text.replace(UUID_PATTERN, "riferimento interno") : null;
}

function normalizeLineSummary(value) {
  if (!value || typeof value !== "object" || !optionalString(value.id)) return null;
  return {
    id: value.id,
    description: optionalVisibleString(value.description),
    itemCode: optionalVisibleString(value.itemCode)
  };
}

function normalizeDocumentSummary(value) {
  if (!value || typeof value !== "object" || !optionalString(value.id)) return null;
  return {
    id: value.id,
    kind: optionalVisibleString(value.kind),
    number: optionalVisibleString(value.number)
  };
}

function normalizeSummaries(values, normalizer) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const item = normalizer(value);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    normalized.push(item);
  }
  return normalized;
}

export function normalizeFocusIds(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const ids = [];
  for (const value of values) {
    const id = typeof value === "string" ? value : value?.id;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function isExactIdFocused(entity, focusIds) {
  if (!entity || typeof entity.id !== "string") return false;
  return normalizeFocusIds(focusIds).includes(entity.id);
}

export function resolveExistingEvidenceRefs(requestedRefs, evidenceReferences) {
  const available = new Set(
    (Array.isArray(evidenceReferences) ? evidenceReferences : [])
      .map((entry) => entry?.ref)
      .filter((ref) => typeof ref === "string" && ref)
  );
  const seen = new Set();
  const matches = [];
  for (const ref of Array.isArray(requestedRefs) ? requestedRefs : []) {
    if (typeof ref !== "string" || !ref || seen.has(ref) || !available.has(ref)) continue;
    seen.add(ref);
    matches.push(ref);
  }
  return matches;
}

export function normalizeFindingContext(value) {
  if (!value || typeof value !== "object") return null;
  const findingId = optionalString(value.findingId);
  const type = optionalString(value.type);
  const orderId = optionalString(value.orderId);
  if (!findingId || !type || !orderId) return null;

  return {
    findingId,
    type,
    dimension: optionalString(value.dimension),
    severity: optionalString(value.severity),
    orderId,
    orderCode: optionalString(value.orderCode),
    affectedLines: normalizeSummaries(value.affectedLines, normalizeLineSummary),
    affectedDocuments: normalizeSummaries(value.affectedDocuments, normalizeDocumentSummary),
    evidenceRefs: Array.from(new Set(
      (Array.isArray(value.evidenceRefs) ? value.evidenceRefs : [])
        .filter((ref) => typeof ref === "string" && ref)
    )),
    description: optionalVisibleString(value.description),
    recommendedAction: optionalVisibleString(value.recommendedAction)
  };
}

function lineDisplay(summary) {
  if (summary.description && summary.itemCode) return `${summary.description} (${summary.itemCode})`;
  return summary.description || summary.itemCode || null;
}

function documentDisplay(summary) {
  const kind = summary.kind ? (DOCUMENT_KIND_LABELS[summary.kind] || "Documento") : null;
  if (kind && summary.number) return `${kind} ${summary.number}`;
  return summary.number || kind || null;
}

export function buildInvestigationBannerModel(value) {
  const context = normalizeFindingContext(value);
  if (!context) return null;

  return {
    label: "Ordine aperto dal controllo qualità",
    findingLabel: FINDING_LABELS[context.type] || "Segnalazione qualità dati",
    severity: context.severity,
    affectedLineSummaries: context.affectedLines.map(lineDisplay).filter(Boolean),
    affectedDocumentSummaries: context.affectedDocuments.map(documentDisplay).filter(Boolean),
    description: context.description,
    recommendedAction: context.recommendedAction,
    cannotConfirm: CANNOT_CONFIRM_BY_TYPE[context.type] || GENERIC_CANNOT_CONFIRM
  };
}

export function investigationContextMatchesOrder(value, orderId) {
  const context = normalizeFindingContext(value);
  return Boolean(context && typeof orderId === "string" && context.orderId === orderId);
}
