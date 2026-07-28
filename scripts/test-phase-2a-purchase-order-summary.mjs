import assert from "assert";
import { readFile } from "fs/promises";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  DATA_QUALITY_STATUS_LABELS,
  PURCHASE_ORDER_SITUATIONS,
  buildPurchaseOrderOperationalSummary,
  canViewPurchaseOrderQualitySummary,
  countOrganizationFindings,
  countSectionNotEvaluated,
  derivePurchaseOrderSituation,
  extractSingleOrderQualityContract,
  formatEvidenceCoverage,
  getPurchaseOrderSituationCopy,
  selectCompactOrderFindings,
  sortGenuineOrderFindings
} from "../src/utils/purchaseOrderOperationalSummary.js";
import {
  PURCHASE_ORDER_FINDING_FACTUAL_COPY,
  UNKNOWN_PURCHASE_ORDER_FINDING_FACTUAL_COPY
} from "../src/utils/purchaseOrderFindingPresentation.js";

const QUALITY_STATES = ["incomplete_evidence", "open_findings", "not_evaluated", "complete"];

const expectedByBusinessStatus = {
  OVERDUE: {
    incomplete_evidence: PURCHASE_ORDER_SITUATIONS.URGENT_FINDINGS,
    open_findings: PURCHASE_ORDER_SITUATIONS.URGENT_FINDINGS,
    not_evaluated: PURCHASE_ORDER_SITUATIONS.URGENT_NOT_EVALUATED,
    complete: PURCHASE_ORDER_SITUATIONS.URGENT_COMPLETE
  },
  CRITICAL: {
    incomplete_evidence: PURCHASE_ORDER_SITUATIONS.URGENT_FINDINGS,
    open_findings: PURCHASE_ORDER_SITUATIONS.URGENT_FINDINGS,
    not_evaluated: PURCHASE_ORDER_SITUATIONS.URGENT_NOT_EVALUATED,
    complete: PURCHASE_ORDER_SITUATIONS.URGENT_COMPLETE
  },
  OK: {
    incomplete_evidence: PURCHASE_ORDER_SITUATIONS.CONTROLLED_FINDINGS,
    open_findings: PURCHASE_ORDER_SITUATIONS.CONTROLLED_FINDINGS,
    not_evaluated: PURCHASE_ORDER_SITUATIONS.CONTROLLED_NOT_EVALUATED,
    complete: PURCHASE_ORDER_SITUATIONS.CONTROLLED_COMPLETE
  },
  WARNING: {
    incomplete_evidence: PURCHASE_ORDER_SITUATIONS.CONTROLLED_FINDINGS,
    open_findings: PURCHASE_ORDER_SITUATIONS.CONTROLLED_FINDINGS,
    not_evaluated: PURCHASE_ORDER_SITUATIONS.CONTROLLED_NOT_EVALUATED,
    complete: PURCHASE_ORDER_SITUATIONS.CONTROLLED_COMPLETE
  }
};

function makeFinding(overrides = {}) {
  return {
    findingId: "finding-1",
    orderId: "order-1",
    type: "LINE_WITHOUT_EVIDENCE",
    severity: "warning",
    description: "Riga senza evidenza.",
    recommendedAction: "Verificare la fonte collegata.",
    ...overrides
  };
}

function makeContract(overrides = {}) {
  return {
    contractVersion: "2.3.0",
    generatedAt: "2026-07-26T09:30:00.000Z",
    organizationId: "org-fixture",
    orders: [{
      orderId: "order-1",
      orderCode: "PO-FIXTURE-1",
      supplierName: "Fornitore sintetico",
      evidenceCoverage: { coveredLines: 1, totalLines: 2 },
      findingCount: 1,
      findingsSummary: { critical: 0, warning: 1, info: 0 },
      dataQualityStatus: "incomplete_evidence"
    }],
    findings: [makeFinding()],
    organizationFindings: [],
    ...overrides
  };
}

console.log("Test: every combined-situation decision-table branch is deterministic");
for (const qualityState of [...QUALITY_STATES, "unavailable"]) {
  assert.strictEqual(
    derivePurchaseOrderSituation({
      businessStatus: "CLOSED",
      dataQualityStatus: qualityState,
      qualityEvaluationObtainable: qualityState !== "unavailable"
    }),
    PURCHASE_ORDER_SITUATIONS.CLOSED
  );
  assert.strictEqual(
    derivePurchaseOrderSituation({
      businessStatus: "TO_VERIFY",
      dataQualityStatus: qualityState,
      qualityEvaluationObtainable: qualityState !== "unavailable"
    }),
    PURCHASE_ORDER_SITUATIONS.TO_VERIFY
  );
}
for (const [businessStatus, expected] of Object.entries(expectedByBusinessStatus)) {
  for (const qualityState of QUALITY_STATES) {
    assert.strictEqual(
      derivePurchaseOrderSituation({
        businessStatus,
        dataQualityStatus: qualityState,
        qualityEvaluationObtainable: true
      }),
      expected[qualityState],
      `${businessStatus} × ${qualityState}`
    );
  }
}
assert.strictEqual(
  derivePurchaseOrderSituation({
    businessStatus: "OVERDUE",
    dataQualityStatus: "complete",
    qualityEvaluationObtainable: false
  }),
  PURCHASE_ORDER_SITUATIONS.UNAVAILABLE
);
assert.strictEqual(
  derivePurchaseOrderSituation({
    businessStatus: "UNKNOWN",
    dataQualityStatus: "complete",
    qualityEvaluationObtainable: true
  }),
  PURCHASE_ORDER_SITUATIONS.UNAVAILABLE
);
assert.strictEqual(
  derivePurchaseOrderSituation({
    businessStatus: "OK",
    dataQualityStatus: "unexpected",
    qualityEvaluationObtainable: true
  }),
  PURCHASE_ORDER_SITUATIONS.UNAVAILABLE
);
console.log("PASS");

console.log("Test: fixed urgency and complete copy obey the trust language");
{
  const overdue = getPurchaseOrderSituationCopy(PURCHASE_ORDER_SITUATIONS.URGENT_COMPLETE, "OVERDUE");
  const critical = getPurchaseOrderSituationCopy(PURCHASE_ORDER_SITUATIONS.URGENT_COMPLETE, "CRITICAL");
  assert.ok(overdue.copy.includes("L'ordine è già in ritardo sulla consegna prevista."));
  assert.ok(critical.copy.includes("L'ordine si avvicina alla scadenza prevista."));
  assert.ok(!critical.copy.includes("già in ritardo"));
  assert.ok(critical.copy.includes("Nel perimetro valutato non sono state rilevate anomalie strutturali."));
  assert.ok(!/dati (corretti|completi e coerenti)|fornitore.*colpa/i.test(critical.copy));
}
console.log("PASS");

console.log("Test: coverage formatting never fabricates a percentage or a zero-line result");
{
  assert.strictEqual(formatEvidenceCoverage({ coveredLines: 2, totalLines: 3 }), "2 di 3 righe hanno evidenza collegata");
  assert.strictEqual(formatEvidenceCoverage({ coveredLines: 0, totalLines: 0 }), "Non disponibile");
  assert.strictEqual(formatEvidenceCoverage(null), "Non disponibile");
}
console.log("PASS");

console.log("Test: genuine findings are severity/id sorted, capped at three, and SECTION_NOT_EVALUATED stays neutral");
{
  const findings = [
    makeFinding({ findingId: "z-info", severity: "info" }),
    makeFinding({ findingId: "b-warning", severity: "warning" }),
    makeFinding({ findingId: "section", type: "SECTION_NOT_EVALUATED", severity: "info", recommendedAction: "Non usare." }),
    makeFinding({ findingId: "a-critical", severity: "critical" }),
    makeFinding({ findingId: "a-warning", severity: "warning" })
  ];
  assert.deepStrictEqual(
    sortGenuineOrderFindings(findings).map((finding) => finding.findingId),
    ["a-critical", "a-warning", "b-warning", "z-info"]
  );
  const compact = selectCompactOrderFindings(findings);
  assert.deepStrictEqual(compact.visible.map((finding) => finding.findingId), ["a-critical", "a-warning", "b-warning"]);
  assert.strictEqual(compact.remainingCount, 1);
  assert.strictEqual(countSectionNotEvaluated(findings), 1);
}
console.log("PASS");

console.log("Test: Phase 2A never exposes recommended actions in its presentation model");
{
  const findings = [
    makeFinding({ findingId: "f-1", recommendedAction: "Verificare la fonte." }),
    makeFinding({ findingId: "f-3", recommendedAction: "Controllare il documento." }),
    makeFinding({ findingId: "section", type: "SECTION_NOT_EVALUATED", recommendedAction: "Non deve apparire." })
  ];
  const model = buildPurchaseOrderOperationalSummary({
    businessStatus: "OK",
    qualityEvaluationObtainable: true,
    qualityContract: extractSingleOrderQualityContract(
      makeContract({ findings }),
      "order-1"
    )
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(model, "recommendedActions"));
  assert.ok(!JSON.stringify(model).includes("Verificare la fonte."));
  assert.ok(!JSON.stringify(model).includes("Controllare il documento."));
  assert.ok(!JSON.stringify(model).includes("Non deve apparire."));
}
console.log("PASS");

console.log("Test: all eight genuine finding types use the approved deterministic Italian copy");
{
  for (const [type, expectedCopy] of Object.entries(PURCHASE_ORDER_FINDING_FACTUAL_COPY)) {
    const rawDescription = `RAW ENGLISH DESCRIPTION ${type}`;
    const model = buildPurchaseOrderOperationalSummary({
      businessStatus: "OK",
      qualityEvaluationObtainable: true,
      qualityContract: extractSingleOrderQualityContract(
        makeContract({
          findings: [makeFinding({
            findingId: `finding-${type}`,
            type,
            description: rawDescription
          })]
        }),
        "order-1"
      )
    });
    assert.strictEqual(model.findings[0].description, expectedCopy, type);
    assert.ok(!JSON.stringify(model).includes(rawDescription), type);
  }
  assert.strictEqual(
    PURCHASE_ORDER_FINDING_FACTUAL_COPY.OPERATIONAL_STATE_UNEXPLAINED,
    "Lo stato operativo corrente non è completamente spiegato dai dati disponibili."
  );
}
console.log("PASS");

console.log("Test: unknown genuine types fail closed to neutral copy without exposing raw input");
{
  const rawDescription = "CONTACT THE SUPPLIER IMMEDIATELY";
  const rawAction = "DELETE INTERNAL RECORD";
  const model = buildPurchaseOrderOperationalSummary({
    businessStatus: "OK",
    qualityEvaluationObtainable: true,
    qualityContract: extractSingleOrderQualityContract(
      makeContract({
        findings: [makeFinding({
          findingId: "opaque-unknown-finding",
          type: "UNAPPROVED_INTERNAL_TYPE",
          description: rawDescription,
          recommendedAction: rawAction
        })]
      }),
      "order-1"
    )
  });
  assert.strictEqual(model.findings.length, 1);
  assert.strictEqual(model.findings[0].description, UNKNOWN_PURCHASE_ORDER_FINDING_FACTUAL_COPY);
  assert.ok(!JSON.stringify(model).includes("UNAPPROVED_INTERNAL_TYPE"));
  assert.ok(!JSON.stringify(model).includes(rawDescription));
  assert.ok(!JSON.stringify(model).includes(rawAction));
}
console.log("PASS");

console.log("Test: organization findings remain separate and cannot alter the order situation");
{
  assert.strictEqual(countOrganizationFindings([{ findingId: "org-1" }, { findingId: "org-2" }]), 2);
  const withoutOrganizationFinding = buildPurchaseOrderOperationalSummary({
    businessStatus: "OK",
    qualityEvaluationObtainable: true,
    qualityContract: extractSingleOrderQualityContract(makeContract(), "order-1")
  });
  const withOrganizationFinding = buildPurchaseOrderOperationalSummary({
    businessStatus: "OK",
    qualityEvaluationObtainable: true,
    qualityContract: extractSingleOrderQualityContract(
      makeContract({ organizationFindings: [{ findingId: "org-1" }] }),
      "order-1"
    )
  });
  assert.strictEqual(withoutOrganizationFinding.situation, withOrganizationFinding.situation);
  assert.strictEqual(withOrganizationFinding.organizationFindingCount, 1);
}
console.log("PASS");

console.log("Test: single-order extraction is exact and never falls back to another order");
{
  const contract = makeContract({
    orders: [
      makeContract().orders[0],
      { ...makeContract().orders[0], orderId: "order-decoy", orderCode: "PO-DECOY" }
    ]
  });
  assert.strictEqual(extractSingleOrderQualityContract(contract, "order-1").orderQuality.orderCode, "PO-FIXTURE-1");
  assert.strictEqual(extractSingleOrderQualityContract(contract, "missing-order"), null);
}
console.log("PASS");

console.log("Test: role gate is exactly Owner/Admin/IT");
for (const role of ["Owner", "Admin", "IT"]) assert.strictEqual(canViewPurchaseOrderQualitySummary(role), true);
for (const role of ["Buyer", "ReadOnly", null, undefined]) assert.strictEqual(canViewPurchaseOrderQualitySummary(role), false);
console.log("PASS");

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const component = await vite.ssrLoadModule("/src/components/PurchaseOrderOperationalSummary.jsx");
  const panel = await vite.ssrLoadModule("/src/components/OrderDetailPanel.jsx");

  console.log("Test: one authorized opening coalesces duplicate effect acquisition into one request");
  {
    let calls = 0;
    const coordinator = component.createPurchaseOrderQualityRequestCoordinator(async ({ orderId }) => {
      calls += 1;
      return makeContract({ orders: [{ ...makeContract().orders[0], orderId }] });
    });
    const first = coordinator.acquire("order-1");
    const second = coordinator.acquire("order-1");
    await Promise.all([first.promise, second.promise]);
    assert.strictEqual(calls, 1);
    first.release();
    second.release();
  }
  console.log("PASS");

  console.log("Test: stale responses cannot overwrite the newly opened order");
  {
    const actions = [];
    const tokenRef = { current: 1 };
    let resolveOld;
    const oldPromise = new Promise((resolve) => { resolveOld = resolve; });
    const freshPromise = Promise.resolve(makeContract({
      orders: [{ ...makeContract().orders[0], orderId: "order-2" }],
      findings: [{ ...makeFinding(), orderId: "order-2" }]
    }));

    const oldLoad = component.loadPurchaseOrderQualityContract({
      orderId: "order-1",
      requestPromise: oldPromise,
      dispatch: (action) => actions.push(action),
      tokenRef,
      myToken: 1
    });
    tokenRef.current = 2;
    await component.loadPurchaseOrderQualityContract({
      orderId: "order-2",
      requestPromise: freshPromise,
      dispatch: (action) => actions.push(action),
      tokenRef,
      myToken: 2
    });
    resolveOld(makeContract());
    await oldLoad;
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].qualityContract.orderQuality.orderId, "order-2");
  }
  console.log("PASS");

  console.log("Test: loading, unavailable, empty and success render explicitly");
  {
    const loadingHtml = renderToStaticMarkup(h(component.PurchaseOrderOperationalSummaryContent, {
      state: { status: "loading", qualityContract: null, error: null },
      businessStatus: "OK"
    }));
    assert.ok(loadingHtml.includes("Caricamento valutazione qualità"));

    const unavailableHtml = renderToStaticMarkup(h(component.PurchaseOrderOperationalSummaryContent, {
      state: { status: "error", qualityContract: null, error: "redacted" },
      businessStatus: "OK"
    }));
    assert.ok(unavailableHtml.includes("Valutazione qualità non disponibile"));
    assert.ok(!unavailableHtml.includes("redacted"));

    const emptyContract = extractSingleOrderQualityContract(makeContract({
      orders: [{ ...makeContract().orders[0], evidenceCoverage: { coveredLines: 0, totalLines: 0 }, dataQualityStatus: "not_evaluated" }],
      findings: [{ ...makeFinding(), type: "SECTION_NOT_EVALUATED", severity: "info", recommendedAction: "Non deve apparire." }]
    }), "order-1");
    const emptyHtml = renderToStaticMarkup(h(component.PurchaseOrderOperationalSummaryContent, {
      state: { status: "loaded", qualityContract: emptyContract, error: null },
      businessStatus: "OK"
    }));
    assert.ok(emptyHtml.includes("Non disponibile"));
    assert.ok(emptyHtml.includes("1 sezione non valutata"));
    assert.ok(!emptyHtml.includes("Non deve apparire."));

    const successHtml = renderToStaticMarkup(h(component.PurchaseOrderOperationalSummaryContent, {
      state: {
        status: "loaded",
        qualityContract: extractSingleOrderQualityContract(makeContract({
          findings: [
            makeFinding({ findingId: "a", severity: "critical" }),
            makeFinding({ findingId: "b", severity: "warning" }),
            makeFinding({ findingId: "c", severity: "warning" }),
            makeFinding({ findingId: "d", severity: "info" })
          ]
        }), "order-1"),
        error: null
      },
      businessStatus: "OVERDUE"
    }));
    assert.ok(successHtml.includes("Sintesi operativa dell&#x27;ordine di acquisto"));
    assert.ok(successHtml.includes("+1 altre"));
    assert.ok(successHtml.includes("1 di 2 righe hanno evidenza collegata"));
  }
  console.log("PASS");

  console.log("Test: Buyer/ReadOnly render no summary and therefore mount no request owner");
  for (const role of ["Buyer", "ReadOnly"]) {
    const html = renderToStaticMarkup(h(component.default, {
      orderId: "order-1",
      businessStatus: "OK",
      userRole: role,
      fetchQualityContract: async () => makeContract()
    }));
    assert.strictEqual(html, "");
  }
  console.log("PASS");

  console.log("Test: visible summary never renders raw finding text, type codes, UUIDs or identifiers");
  {
    const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const rawDescription = `RAW ENGLISH ${uuid}`;
    const rawAction = `RAW ACTION ${uuid}`;
    const qualityContract = extractSingleOrderQualityContract(makeContract({
      findings: [makeFinding({
        findingId: uuid,
        type: "UNAPPROVED_INTERNAL_TYPE",
        description: rawDescription,
        recommendedAction: rawAction
      })]
    }), "order-1");
    const html = renderToStaticMarkup(h(component.PurchaseOrderOperationalSummaryContent, {
      state: { status: "loaded", qualityContract, error: null },
      businessStatus: "OK"
    }));
    assert.ok(!html.includes(uuid));
    assert.ok(!html.includes("UNAPPROVED_INTERNAL_TYPE"));
    assert.ok(!html.includes("RAW ENGLISH"));
    assert.ok(!html.includes("RAW ACTION"));
    assert.ok(html.includes("È presente una segnalazione di qualità dati da verificare."));
  }
  console.log("PASS");

  console.log("Test: Phase 1B banner remains unchanged and is rendered after the new summary");
  {
    const source = await readFile(new URL("../src/components/OrderDetailPanel.jsx", import.meta.url), "utf8");
    const summaryIndex = source.indexOf("<PurchaseOrderOperationalSummary");
    const bannerIndex = source.indexOf("<InvestigationBanner");
    const operationalIndex = source.indexOf("<OrderOperationalView");
    assert.ok(summaryIndex !== -1 && summaryIndex < bannerIndex && summaryIndex < operationalIndex);

    const bannerHtml = renderToStaticMarkup(h(panel.InvestigationBanner, {
      context: {
        findingId: "finding-1",
        type: "LINE_WITHOUT_EVIDENCE",
        orderId: "order-1",
        description: "Riga senza evidenza."
      }
    }));
    assert.ok(bannerHtml.includes("Ordine aperto dal controllo qualità"));
  }
  console.log("PASS");
} finally {
  await vite.close();
}

console.log("Test: App → OrdersView → OrderDetailPanel passes the stable adapter callback and exact session role");
{
  const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const ordersSource = await readFile(new URL("../src/views/OrdersView.jsx", import.meta.url), "utf8");
  const panelSource = await readFile(new URL("../src/components/OrderDetailPanel.jsx", import.meta.url), "utf8");
  assert.ok(appSource.includes("onFetchPilotQualityContract={handleFetchPilotQualityContract}"));
  assert.ok(appSource.includes("currentUserRole={sessionUser?.role}"));
  assert.ok(ordersSource.includes("onFetchPilotQualityContract={onFetchPilotQualityContract}"));
  assert.ok(ordersSource.includes("currentUserRole={currentUserRole}"));
  assert.ok(panelSource.includes("usePurchaseOrderQualityContract({"));
  assert.ok(panelSource.includes("fetchQualityContract: onFetchPilotQualityContract"));
  assert.strictEqual(
    (panelSource.match(/usePurchaseOrderQualityContract\(\{/g) || []).length,
    1,
    "OrderDetailPanel must own exactly one quality-contract request lifecycle"
  );
  assert.ok(panelSource.includes("qualityState={qualityState}"));
}
console.log("PASS");

console.log("Test: adapter passes explicit orderId and signal through the existing authenticated endpoint");
{
  const adapterModule = await import("../src/adapters/apiAdapter.js");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => makeContract() };
  };
  try {
    const signal = new AbortController().signal;
    const adapter = adapterModule.createApiAdapter(undefined, { getAccessToken: async () => "fixture-token" });
    await adapter.getPilotQualityContract({ orderId: "order-1", signal });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, "/api/pilot-quality-contract?orderId=order-1");
    assert.strictEqual(calls[0].options.signal, signal);
    assert.strictEqual(calls[0].options.headers.Authorization, "Bearer fixture-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
console.log("PASS");

assert.deepStrictEqual(Object.keys(DATA_QUALITY_STATUS_LABELS).sort(), [
  "complete",
  "incomplete_evidence",
  "not_evaluated",
  "open_findings",
  "unavailable"
]);

console.log("All Phase 2A purchase-order summary tests passed");
