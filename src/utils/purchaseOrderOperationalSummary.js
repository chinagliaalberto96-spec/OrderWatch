export const PURCHASE_ORDER_QUALITY_ROLES = Object.freeze(["Owner", "Admin", "IT"]);

export const PURCHASE_ORDER_SITUATIONS = Object.freeze({
  UNAVAILABLE: "VALUTAZIONE_QUALITA_NON_DISPONIBILE",
  CLOSED: "CHIUSO",
  TO_VERIFY: "DA_VERIFICARE",
  URGENT_FINDINGS: "URGENZA_OPERATIVA_DATI_DA_VERIFICARE",
  URGENT_NOT_EVALUATED: "URGENZA_OPERATIVA_DATI_NON_VALUTATI",
  URGENT_COMPLETE: "URGENZA_OPERATIVA_NESSUNA_ANOMALIA_RILEVATA",
  CONTROLLED_FINDINGS: "SOTTO_CONTROLLO_DATI_DA_VERIFICARE",
  CONTROLLED_NOT_EVALUATED: "SOTTO_CONTROLLO_DATI_NON_VALUTATI",
  CONTROLLED_COMPLETE: "SOTTO_CONTROLLO_NESSUNA_ANOMALIA_RILEVATA"
});

const KNOWN_QUALITY_STATUSES = new Set([
  "unavailable",
  "not_evaluated",
  "incomplete_evidence",
  "open_findings",
  "complete"
]);
const URGENT_BUSINESS_STATUSES = new Set(["OVERDUE", "CRITICAL"]);
const CONTROLLED_BUSINESS_STATUSES = new Set(["OK", "WARNING"]);
const GENUINE_FINDING_QUALITY_STATUSES = new Set(["incomplete_evidence", "open_findings"]);
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const SEVERITY_ORDER = Object.freeze({ critical: 0, warning: 1, info: 2 });

export const DATA_QUALITY_STATUS_LABELS = Object.freeze({
  unavailable: "Non disponibile",
  not_evaluated: "Non valutata",
  incomplete_evidence: "Evidenza incompleta",
  open_findings: "Segnalazioni aperte",
  complete: "Nessuna anomalia rilevata"
});

export const FINDING_TYPE_LABELS = Object.freeze({
  ORDER_LINK_MISSING: "Ordine non disponibile",
  LINE_WITHOUT_EVIDENCE: "Riga senza evidenza collegata",
  DANGLING_PROVENANCE: "Riferimento evidenza non risolto",
  DOCUMENT_LINK_UNPROVEN: "Collegamento documento non confermato",
  QUANTITY_CONFLICT: "Quantità riportate in conflitto",
  DATE_CONFLICT: "Date riportate in conflitto",
  DUPLICATE_LINE: "Possibile riga duplicata",
  OPERATIONAL_STATE_UNEXPLAINED: "Stato operativo da verificare"
});

const SITUATION_LABELS = Object.freeze({
  [PURCHASE_ORDER_SITUATIONS.UNAVAILABLE]: "Valutazione qualità non disponibile",
  [PURCHASE_ORDER_SITUATIONS.CLOSED]: "Ordine concluso",
  [PURCHASE_ORDER_SITUATIONS.TO_VERIFY]: "Ordine da verificare",
  [PURCHASE_ORDER_SITUATIONS.URGENT_FINDINGS]: "Urgenza operativa · dati da verificare",
  [PURCHASE_ORDER_SITUATIONS.URGENT_NOT_EVALUATED]: "Urgenza operativa · dati non valutati",
  [PURCHASE_ORDER_SITUATIONS.URGENT_COMPLETE]: "Urgenza operativa · nessuna anomalia rilevata",
  [PURCHASE_ORDER_SITUATIONS.CONTROLLED_FINDINGS]: "Sotto controllo · dati da verificare",
  [PURCHASE_ORDER_SITUATIONS.CONTROLLED_NOT_EVALUATED]: "Sotto controllo · dati non valutati",
  [PURCHASE_ORDER_SITUATIONS.CONTROLLED_COMPLETE]: "Sotto controllo · nessuna anomalia rilevata"
});

const SITUATION_QUALITY_COPY = Object.freeze({
  [PURCHASE_ORDER_SITUATIONS.UNAVAILABLE]:
    "La valutazione strutturale dei dati non è disponibile per questo ordine.",
  [PURCHASE_ORDER_SITUATIONS.CLOSED]:
    "L'ordine risulta concluso nello stato operativo.",
  [PURCHASE_ORDER_SITUATIONS.TO_VERIFY]:
    "Lo stato operativo dell'ordine richiede una verifica.",
  [PURCHASE_ORDER_SITUATIONS.URGENT_FINDINGS]:
    "Sono presenti segnalazioni strutturali da verificare.",
  [PURCHASE_ORDER_SITUATIONS.URGENT_NOT_EVALUATED]:
    "Le sezioni richieste non risultano valutate con i dati disponibili.",
  [PURCHASE_ORDER_SITUATIONS.URGENT_COMPLETE]:
    "Nel perimetro valutato non sono state rilevate anomalie strutturali.",
  [PURCHASE_ORDER_SITUATIONS.CONTROLLED_FINDINGS]:
    "Sono presenti segnalazioni strutturali da verificare.",
  [PURCHASE_ORDER_SITUATIONS.CONTROLLED_NOT_EVALUATED]:
    "Le sezioni richieste non risultano valutate con i dati disponibili.",
  [PURCHASE_ORDER_SITUATIONS.CONTROLLED_COMPLETE]:
    "Nel perimetro valutato non sono state rilevate anomalie strutturali."
});

function operationalCopy(businessStatus) {
  if (businessStatus === "OVERDUE") return "L'ordine è già in ritardo sulla consegna prevista.";
  if (businessStatus === "CRITICAL") return "L'ordine si avvicina alla scadenza prevista.";
  if (businessStatus === "WARNING") return "Lo stato operativo è in attenzione secondo le soglie configurate.";
  if (businessStatus === "OK") return "Lo stato operativo è sotto controllo secondo le soglie configurate.";
  return null;
}

export function canViewPurchaseOrderQualitySummary(role) {
  return PURCHASE_ORDER_QUALITY_ROLES.includes(role);
}

export function derivePurchaseOrderSituation({
  businessStatus,
  dataQualityStatus,
  qualityEvaluationObtainable
}) {
  if (businessStatus === "CLOSED") return PURCHASE_ORDER_SITUATIONS.CLOSED;
  if (businessStatus === "TO_VERIFY") return PURCHASE_ORDER_SITUATIONS.TO_VERIFY;

  if (
    qualityEvaluationObtainable !== true
    || !KNOWN_QUALITY_STATUSES.has(dataQualityStatus)
    || dataQualityStatus === "unavailable"
  ) {
    return PURCHASE_ORDER_SITUATIONS.UNAVAILABLE;
  }

  if (URGENT_BUSINESS_STATUSES.has(businessStatus)) {
    if (GENUINE_FINDING_QUALITY_STATUSES.has(dataQualityStatus)) {
      return PURCHASE_ORDER_SITUATIONS.URGENT_FINDINGS;
    }
    if (dataQualityStatus === "not_evaluated") {
      return PURCHASE_ORDER_SITUATIONS.URGENT_NOT_EVALUATED;
    }
    if (dataQualityStatus === "complete") {
      return PURCHASE_ORDER_SITUATIONS.URGENT_COMPLETE;
    }
  }

  if (CONTROLLED_BUSINESS_STATUSES.has(businessStatus)) {
    if (GENUINE_FINDING_QUALITY_STATUSES.has(dataQualityStatus)) {
      return PURCHASE_ORDER_SITUATIONS.CONTROLLED_FINDINGS;
    }
    if (dataQualityStatus === "not_evaluated") {
      return PURCHASE_ORDER_SITUATIONS.CONTROLLED_NOT_EVALUATED;
    }
    if (dataQualityStatus === "complete") {
      return PURCHASE_ORDER_SITUATIONS.CONTROLLED_COMPLETE;
    }
  }

  return PURCHASE_ORDER_SITUATIONS.UNAVAILABLE;
}

export function getPurchaseOrderSituationCopy(situation, businessStatus) {
  const label = SITUATION_LABELS[situation] || SITUATION_LABELS[PURCHASE_ORDER_SITUATIONS.UNAVAILABLE];
  const qualityCopy = SITUATION_QUALITY_COPY[situation] || SITUATION_QUALITY_COPY[PURCHASE_ORDER_SITUATIONS.UNAVAILABLE];
  const urgencyCopy = operationalCopy(businessStatus);
  return {
    label,
    copy: urgencyCopy && ![PURCHASE_ORDER_SITUATIONS.CLOSED, PURCHASE_ORDER_SITUATIONS.TO_VERIFY, PURCHASE_ORDER_SITUATIONS.UNAVAILABLE].includes(situation)
      ? `${urgencyCopy} ${qualityCopy}`
      : qualityCopy
  };
}

export function sanitizePurchaseOrderSummaryText(value) {
  if (typeof value !== "string") return "";
  return value.replace(UUID_PATTERN, "riferimento interno").trim();
}

export function formatEvidenceCoverage(evidenceCoverage) {
  const totalLines = Number(evidenceCoverage?.totalLines);
  const coveredLines = Number(evidenceCoverage?.coveredLines);
  if (!Number.isFinite(totalLines) || totalLines <= 0 || !Number.isFinite(coveredLines)) {
    return "Non disponibile";
  }
  return `${Math.max(0, coveredLines)} di ${totalLines} righe hanno evidenza collegata`;
}

export function isGenuineOrderFinding(finding) {
  return Boolean(finding && finding.type !== "SECTION_NOT_EVALUATED");
}

export function sortGenuineOrderFindings(findings) {
  return (Array.isArray(findings) ? findings : [])
    .filter(isGenuineOrderFinding)
    .slice()
    .sort((a, b) => {
      const severityDifference = (SEVERITY_ORDER[a?.severity] ?? 3) - (SEVERITY_ORDER[b?.severity] ?? 3);
      if (severityDifference !== 0) return severityDifference;
      return String(a?.findingId || "").localeCompare(String(b?.findingId || ""));
    });
}

export function selectCompactOrderFindings(findings, limit = 3) {
  const genuine = sortGenuineOrderFindings(findings);
  return {
    visible: genuine.slice(0, limit),
    remainingCount: Math.max(0, genuine.length - limit),
    totalCount: genuine.length
  };
}

export function countSectionNotEvaluated(findings) {
  return (Array.isArray(findings) ? findings : [])
    .filter((finding) => finding?.type === "SECTION_NOT_EVALUATED")
    .length;
}

export function countOrganizationFindings(organizationFindings) {
  return Array.isArray(organizationFindings) ? organizationFindings.length : 0;
}

export function extractSingleOrderQualityContract(contract, orderId) {
  if (!contract || typeof contract !== "object" || typeof orderId !== "string" || !orderId) return null;
  const orderQuality = (Array.isArray(contract.orders) ? contract.orders : [])
    .find((entry) => entry?.orderId === orderId);
  if (!orderQuality) return null;

  return {
    generatedAt: contract.generatedAt || null,
    orderQuality,
    findings: (Array.isArray(contract.findings) ? contract.findings : [])
      .filter((finding) => finding?.orderId === orderId),
    organizationFindings: Array.isArray(contract.organizationFindings)
      ? contract.organizationFindings
      : []
  };
}

export function buildPurchaseOrderOperationalSummary({
  businessStatus,
  qualityContract,
  qualityEvaluationObtainable
}) {
  const dataQualityStatus = qualityContract?.orderQuality?.dataQualityStatus || "unavailable";
  const situation = derivePurchaseOrderSituation({
    businessStatus,
    dataQualityStatus,
    qualityEvaluationObtainable
  });
  const situationCopy = getPurchaseOrderSituationCopy(situation, businessStatus);
  const compactFindings = selectCompactOrderFindings(qualityContract?.findings);

  return {
    situation,
    situationLabel: situationCopy.label,
    situationCopy: situationCopy.copy,
    businessStatus,
    dataQualityStatus,
    dataQualityLabel: DATA_QUALITY_STATUS_LABELS[dataQualityStatus] || DATA_QUALITY_STATUS_LABELS.unavailable,
    evidenceCoverage: formatEvidenceCoverage(qualityContract?.orderQuality?.evidenceCoverage),
    findings: compactFindings.visible.map((finding) => ({
      key: finding?.findingId || `${finding?.type || "finding"}-${finding?.severity || "info"}`,
      severity: finding?.severity || "info",
      label: FINDING_TYPE_LABELS[finding?.type] || "Segnalazione strutturale da verificare",
      description: sanitizePurchaseOrderSummaryText(finding?.description)
    })),
    remainingFindingCount: compactFindings.remainingCount,
    genuineFindingCount: compactFindings.totalCount,
    sectionNotEvaluatedCount: countSectionNotEvaluated(qualityContract?.findings),
    organizationFindingCount: countOrganizationFindings(qualityContract?.organizationFindings),
    generatedAt: qualityContract?.generatedAt || null
  };
}
