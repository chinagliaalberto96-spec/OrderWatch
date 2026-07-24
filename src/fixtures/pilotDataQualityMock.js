// Mock data for App.jsx's temporary wiring of the Pilot Data Quality
// dashboard, used only until a real API endpoint exists. This is NOT
// imported by src/views/PilotDataQualityView.jsx itself (that component
// takes only the real contract shape as a prop and has no built-in mock
// fallback) — it is imported and passed explicitly by App.jsx, so the
// "mock until API integration" concern is visible at the wiring/integration
// point, not hidden inside the reusable component.
//
// Shape matches the stable contract produced by
// scripts/lib/dataQualityContract.mjs (buildDataQualityContract, v2.1.0)
// exactly, including the additive `orders` array. All identifiers below are
// synthetic (no real order/supplier data). Every number is internally
// consistent (summary/qualityIndicators/orders/findings all agree with each
// other), the same discipline the real contract enforces.

export const MOCK_DATA_QUALITY_CONTRACT = {
  contractVersion: "2.1.0",
  generatedAt: "2026-07-24T09:30:00.000Z",
  organizationId: "11111111-2222-3333-4444-555555555555",
  scope: {
    measures: ["data availability", "evidence traceability", "linking quality", "missing or ambiguous information"],
    doesNotMeasure: [
      "AI/extraction confidence or accuracy — no such score is computed anywhere in this contract",
      "whether an extracted value is factually correct — that requires manual verification against the original source",
      "supplier performance — every finding describes OrderWatch's own pipeline coverage/linking, never supplier behavior"
    ]
  },
  organizationSources: {
    emailsAvailable: true,
    attachmentsAvailable: true,
    sourceCoverageComplete: false
  },
  summary: {
    totalOrders: 3,
    extractedDocuments: 7,
    linkedEvidence: 4
  },
  qualityIndicators: {
    evidenceCoverage: 0.8,
    missingEvidence: { count: 1, evaluatedLines: 5 },
    ambiguousEvidence: { count: 1, evaluatedLines: 5 },
    incompleteOrders: { count: 1, totalOrders: 3 }
  },
  systemIntegrityChecks: {
    documentTraceability: 1,
    documentLinkInvariantViolations: { count: 0, evaluatedDocuments: 7 }
  },
  orders: [
    {
      orderId: "order-mock-1",
      orderCode: "PO-1001",
      supplierName: "Fornitore Alfa Srl",
      evidenceCoverage: { coveredLines: 2, totalLines: 3 },
      findingCount: 2,
      findingsSummary: { critical: 0, warning: 2, info: 0 },
      dataQualityStatus: "incomplete_evidence"
    },
    {
      orderId: "order-mock-2",
      orderCode: "PO-1002",
      supplierName: "Fornitore Beta Sagl",
      evidenceCoverage: { coveredLines: 2, totalLines: 2 },
      findingCount: 1,
      findingsSummary: { critical: 0, warning: 0, info: 1 },
      dataQualityStatus: "open_findings"
    },
    {
      orderId: "order-mock-3",
      orderCode: "PO-1003",
      supplierName: "Fornitore Gamma Srl",
      evidenceCoverage: { coveredLines: 0, totalLines: 0 },
      findingCount: 1,
      findingsSummary: { critical: 0, warning: 0, info: 1 },
      dataQualityStatus: "not_evaluated"
    }
  ],
  findings: [
    {
      findingId: "order-mock-1#0#LINE_WITHOUT_EVIDENCE",
      organizationId: "11111111-2222-3333-4444-555555555555",
      orderId: "order-mock-1",
      orderCode: "PO-1001",
      supplierName: "Fornitore Alfa Srl",
      dimension: "traceability",
      severity: "warning",
      type: "LINE_WITHOUT_EVIDENCE",
      affectedLines: ["line-mock-3"],
      affectedDocuments: [],
      evidenceRefs: [],
      description: "1 of 3 canonical lines have no provenance reference at all.",
      recommendedAction: "Verify this line manually against its source document; no provenance is currently linked.",
      scope: "orderwatch_data_quality"
    },
    {
      findingId: "order-mock-1#1#QUANTITY_CONFLICT",
      organizationId: "11111111-2222-3333-4444-555555555555",
      orderId: "order-mock-1",
      orderCode: "PO-1001",
      supplierName: "Fornitore Alfa Srl",
      dimension: "missingOrAmbiguous",
      severity: "warning",
      type: "QUANTITY_CONFLICT",
      affectedLines: ["line-mock-1"],
      affectedDocuments: [],
      evidenceRefs: ["E1", "E2"],
      description: "Line \"Profilato alluminio 40x40\" has disagreeing observed \"quantity\" values across its evidence: 120, 100.",
      recommendedAction: "Review the cited evidence sources manually to determine which observed quantity is correct.",
      scope: "orderwatch_data_quality"
    },
    {
      findingId: "order-mock-2#0#SOURCE_INCOMPLETE",
      organizationId: "11111111-2222-3333-4444-555555555555",
      orderId: "order-mock-2",
      orderCode: "PO-1002",
      supplierName: "Fornitore Beta Sagl",
      dimension: "availability",
      severity: "info",
      type: "SOURCE_INCOMPLETE",
      affectedLines: [],
      affectedDocuments: [],
      evidenceRefs: [],
      description: "Source \"operationalLinking\" has only partial coverage.",
      recommendedAction: "No action implied — this source has partial coverage only; treat absence of findings from it as inconclusive, not confirmed-clean.",
      scope: "orderwatch_data_quality"
    },
    {
      findingId: "order-mock-3#0#SECTION_NOT_EVALUATED",
      organizationId: "11111111-2222-3333-4444-555555555555",
      orderId: "order-mock-3",
      orderCode: "PO-1003",
      supplierName: "Fornitore Gamma Srl",
      dimension: "availability",
      severity: "info",
      type: "SECTION_NOT_EVALUATED",
      affectedLines: [],
      affectedDocuments: [],
      evidenceRefs: [],
      description: "Section \"unresolvedEvidence\" is not evaluated for this order (available=false) — absence is not evidence of \"none found\".",
      recommendedAction: "This section has not been evaluated yet; absence of findings here is not evidence of correctness.",
      scope: "orderwatch_data_quality"
    }
  ]
};

export const MOCK_ORGANIZATION_NAME = "Graphic Center Group Srl (pilota)";
