import assert from "assert";
import { readFile } from "fs/promises";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });

function finding(type, findingId, overrides = {}) {
  return {
    findingId,
    type,
    severity: "critical",
    description: "TESTO LIBERO DA NON MOSTRARE",
    recommendedAction: "AZIONE LIBERA DA NON MOSTRARE",
    affectedLines: [],
    affectedDocuments: [],
    evidenceRefs: [],
    ...overrides
  };
}

function qualityState(findings = [], organizationFindings = []) {
  return {
    status: "loaded",
    qualityContract: {
      findings,
      organizationFindings
    },
    error: null
  };
}

function operationalData(overrides = {}) {
  return {
    evidenceReferences: [
      { ref: "E1", kind: "document" },
      { ref: "E2", kind: "email" },
      { ref: "E10", kind: "document" }
    ],
    canonicalMaterialLines: [
      { id: "line-a", description: "Carta", itemCode: "C-1" },
      { id: "line-b", description: "Inchiostro", itemCode: "I-2" }
    ],
    linkedDocuments: [
      { id: "doc-a", kind: "invoice", number: "F-1" },
      { id: "doc-b", kind: "delivery_note", number: "D-2" }
    ],
    ...overrides
  };
}

try {
  const utility = await vite.ssrLoadModule("/src/utils/purchaseOrderDiagnosticSuggestions.js");
  const component = await vite.ssrLoadModule("/src/components/PurchaseOrderOperationalSuggestions.jsx");
  const hook = await vite.ssrLoadModule("/src/hooks/usePurchaseOrderQualityContract.js");
  const focus = await vite.ssrLoadModule("/src/utils/dataQualityInvestigation.js");

  const expectedTaxonomy = {
    ORDER_LINK_MISSING: [
      "REVIEW_ORDER_LINK_MISSING",
      "OPERATIONAL_PRIORITY",
      "Verifica collegamento ordine",
      "L'ordine collegato alla segnalazione non risulta disponibile nell'organizzazione corrente."
    ],
    DANGLING_PROVENANCE: [
      "REVIEW_DANGLING_PROVENANCE",
      "OPERATIONAL_PRIORITY",
      "Verifica riferimento evidenza",
      "Un riferimento di provenienza non può essere collegato all'evidenza attesa."
    ],
    DOCUMENT_LINK_UNPROVEN: [
      "REVIEW_DOCUMENT_LINK",
      "OPERATIONAL_PRIORITY",
      "Verifica collegamento documenti",
      "Il collegamento tra uno o più documenti e l'ordine non è confermato in modo deterministico."
    ],
    OPERATIONAL_STATE_UNEXPLAINED: [
      "REVIEW_OPERATIONAL_STATE_UNEXPLAINED",
      "OPERATIONAL_PRIORITY",
      "Verifica stato operativo non spiegato",
      "Lo stato operativo corrente non è completamente spiegato dai dati disponibili."
    ],
    LINE_WITHOUT_EVIDENCE: [
      "REVIEW_LINE_WITHOUT_EVIDENCE",
      "TO_REVIEW",
      "Verifica righe senza evidenza",
      "Una o più righe non hanno una fonte di evidenza collegata."
    ],
    QUANTITY_CONFLICT: [
      "REVIEW_QUANTITY_CONFLICT",
      "TO_REVIEW",
      "Verifica quantità in conflitto",
      "Le fonti disponibili riportano quantità differenti per una o più righe."
    ],
    DATE_CONFLICT: [
      "REVIEW_DATE_CONFLICT",
      "TO_REVIEW",
      "Verifica date in conflitto",
      "Le date disponibili non risultano coerenti tra loro."
    ],
    DUPLICATE_LINE: [
      "REVIEW_DUPLICATE_LINE",
      "TO_REVIEW",
      "Verifica possibili righe duplicate",
      "Una o più righe potrebbero rappresentare lo stesso elemento e richiedono una verifica."
    ]
  };

  console.log("Test: all eight finding types use the exact closed taxonomy and ignore severity");
  for (const [type, expected] of Object.entries(expectedTaxonomy)) {
    const [action] = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState([finding(type, `opaque-${type}`, { severity: "info" })]),
      operationalData: operationalData()
    });
    assert.ok(action, type);
    assert.deepStrictEqual(
      [action.actionCode, action.priorityCode, action.title, action.reason],
      expected,
      type
    );
    assert.equal(action.domain, "diagnostic");
  }
  console.log("PASS");

  console.log("Test: invalid finding identities fail closed without throwing or fallback keys");
  {
    const invalidIds = [
      undefined,
      null,
      "",
      " ",
      " leading",
      "trailing ",
      12,
      true,
      [],
      {},
      () => {},
      Symbol("finding"),
      1n
    ];
    for (const invalidId of invalidIds) {
      assert.doesNotThrow(() => {
        const actions = utility.buildPurchaseOrderDiagnosticSuggestions({
          qualityState: qualityState([finding("DATE_CONFLICT", invalidId)]),
          operationalData: operationalData()
        });
        assert.deepStrictEqual(actions, []);
      });
    }
    const opaque = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState([finding("DATE_CONFLICT", "opaque::id/accepted")]),
      operationalData: operationalData()
    });
    assert.equal(opaque[0].internalKey, "opaque::id/accepted");
  }
  console.log("PASS");

  console.log("Test: excluded and organization-wide findings never become order actions");
  {
    for (const type of [
      "SECTION_NOT_EVALUATED",
      "SOURCE_UNAVAILABLE",
      "SOURCE_UNWATCHED",
      "SOURCE_INCOMPLETE",
      "UNKNOWN_FINDING"
    ]) {
      assert.deepStrictEqual(
        utility.buildPurchaseOrderDiagnosticSuggestions({
          qualityState: qualityState([finding(type, `finding-${type}`)]),
          operationalData: operationalData()
        }),
        []
      );
    }
    assert.deepStrictEqual(
      utility.buildPurchaseOrderDiagnosticSuggestions({
        qualityState: qualityState([], [finding("DATE_CONFLICT", "organization-only")]),
        operationalData: operationalData()
      }),
      []
    );
  }
  console.log("PASS");

  console.log("Test: one finding stays one action and exact targets are normalized deterministically");
  {
    const sourceFinding = finding("QUANTITY_CONFLICT", "finding-targets", {
      affectedLines: [
        { id: "line-b", description: "Inchiostro", itemCode: "I-2" },
        { id: "line-a", description: "Carta", itemCode: "C-1" },
        { id: "line-a", description: "Duplicato da ignorare", itemCode: "X" },
        { description: "Senza ID" }
      ],
      affectedDocuments: [
        { id: "doc-b", kind: "delivery_note", number: "D-2" },
        { id: "doc-a", kind: "invoice", number: "F-1" },
        { id: "doc-a", kind: "duplicate", number: "X" }
      ],
      evidenceRefs: ["E10", "E2", "E1", "E2", " stale"]
    });
    const [action] = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState([sourceFinding]),
      operationalData: operationalData()
    });
    assert.equal(action.targetLevel, "mixed");
    assert.deepStrictEqual(action.affectedLines.map((line) => line.id), ["line-a", "line-b"]);
    assert.deepStrictEqual(action.affectedDocuments.map((document) => document.id), ["doc-a", "doc-b"]);
    assert.deepStrictEqual(action.resolvedEvidenceRefs, ["E1", "E2", "E10"]);
    assert.deepStrictEqual(action.primaryNavigationTarget, { type: "evidence", ref: "E1" });
  }
  console.log("PASS");

  console.log("Test: primary navigation uses exact evidence, then exact line, then exact document");
  {
    const cases = [
      {
        finding: finding("DATE_CONFLICT", "nav-evidence", {
          affectedLines: [{ id: "line-b", description: "Inchiostro" }],
          affectedDocuments: [{ id: "doc-b", kind: "delivery_note" }],
          evidenceRefs: ["E2"]
        }),
        expected: { type: "evidence", ref: "E2" }
      },
      {
        finding: finding("DATE_CONFLICT", "nav-line", {
          affectedLines: [{ id: "line-b", description: "Inchiostro" }],
          affectedDocuments: [{ id: "doc-b", kind: "delivery_note" }],
          evidenceRefs: ["STALE"]
        }),
        expected: { type: "line", id: "line-b" }
      },
      {
        finding: finding("DATE_CONFLICT", "nav-document", {
          affectedDocuments: [{ id: "doc-b", kind: "delivery_note" }]
        }),
        expected: { type: "document", id: "doc-b" }
      },
      {
        finding: finding("DATE_CONFLICT", "nav-none", {
          affectedLines: [{ id: "line-similar", description: "Carta" }],
          affectedDocuments: [{ id: "doc-similar", number: "F-1" }]
        }),
        expected: null
      }
    ];
    for (const entry of cases) {
      const [action] = utility.buildPurchaseOrderDiagnosticSuggestions({
        qualityState: qualityState([entry.finding]),
        operationalData: operationalData()
      });
      assert.deepStrictEqual(action.primaryNavigationTarget, entry.expected);
    }
  }
  console.log("PASS");

  console.log("Test: stale evidence handling is exact and never redirects");
  {
    const [partial] = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState([finding("DANGLING_PROVENANCE", "partial", {
        evidenceRefs: ["STALE", "E2"]
      })]),
      operationalData: operationalData()
    });
    assert.deepStrictEqual(partial.resolvedEvidenceRefs, ["E2"]);
    assert.equal(partial.unavailableEvidenceNote, null);

    const [stale] = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState([finding("DANGLING_PROVENANCE", "all-stale", {
        evidenceRefs: ["STALE"]
      })]),
      operationalData: operationalData()
    });
    assert.deepStrictEqual(stale.resolvedEvidenceRefs, []);
    assert.equal(stale.unavailableEvidenceNote, "Collegamento all'evidenza non disponibile.");

    const [absent] = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState([finding("DANGLING_PROVENANCE", "absent")]),
      operationalData: operationalData()
    });
    assert.equal(absent.unavailableEvidenceNote, null);
  }
  console.log("PASS");

  console.log("Test: different findings remain separate and sorting ignores source order and severity");
  {
    const findings = [
      finding("DUPLICATE_LINE", "z-none", { severity: "critical" }),
      finding("LINE_WITHOUT_EVIDENCE", "b-line", {
        severity: "info",
        affectedLines: [{ id: "line-b", description: "Inchiostro" }]
      }),
      finding("ORDER_LINK_MISSING", "z-order", { severity: "info" }),
      finding("DANGLING_PROVENANCE", "a-none", { severity: "critical" }),
      finding("LINE_WITHOUT_EVIDENCE", "a-line", {
        severity: "critical",
        affectedLines: [{ id: "line-a", description: "Carta" }]
      })
    ];
    const forward = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState(findings),
      operationalData: operationalData()
    });
    const reverse = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState([...findings].reverse()),
      operationalData: operationalData()
    });
    assert.equal(forward.length, 5);
    assert.deepStrictEqual(
      forward.map((action) => action.internalKey),
      ["z-order", "a-none", "a-line", "b-line", "z-none"]
    );
    assert.deepStrictEqual(
      forward.map((action) => action.internalKey),
      reverse.map((action) => action.internalKey)
    );
    assert.equal(
      forward.find((action) => action.internalKey === "z-order")?.primaryNavigationTarget,
      null,
      "order-level findings without exact evidence, line or document targets must not navigate"
    );
  }
  console.log("PASS");

  console.log("Test: exact existing focus helpers reject similar IDs");
  {
    assert.equal(focus.isExactIdFocused({ id: "line-a" }, ["line-a"]), true);
    assert.equal(focus.isExactIdFocused({ id: "line-a" }, ["line"]), false);
    assert.equal(focus.isExactIdFocused({ id: "doc-a" }, ["doc-a"]), true);
    assert.equal(focus.isExactIdFocused({ id: "doc-a" }, ["doc"]), false);
  }
  console.log("PASS");

  const diagnosticActions = utility.buildPurchaseOrderDiagnosticSuggestions({
    qualityState: qualityState([
      finding("ORDER_LINK_MISSING", "internal-finding-1"),
      finding("DANGLING_PROVENANCE", "internal-finding-2", { evidenceRefs: ["E1"] }),
      finding("LINE_WITHOUT_EVIDENCE", "internal-finding-3", {
        affectedLines: [{ id: "line-a", description: "Carta" }]
      }),
      finding("DOCUMENT_LINK_UNPROVEN", "internal-finding-4", {
        affectedDocuments: [{ id: "doc-a", kind: "invoice", number: "F-1" }]
      }),
      finding("DATE_CONFLICT", "internal-finding-5")
    ]),
    operationalData: operationalData()
  });
  const operationalActions = Array.from({ length: 5 }, (_, index) => ({
    actionCode: `OP-${index}`,
    internalKey: `op-${index}`,
    title: `Operativa ${index + 1}`,
    reason: "Motivo operativo",
    priorityCode: "TO_REVIEW",
    priorityLabel: "Da verificare",
    targetLevel: "order",
    commitmentDetails: []
  }));

  console.log("Test: UI has independent caps, expansion and exact role/state behavior");
  {
    const collapsed = renderToStaticMarkup(h(component.PurchaseOrderOperationalSuggestionsContent, {
      operationalActions,
      diagnosticActions,
      diagnosticState: "loaded",
      showDiagnostic: true
    }));
    assert.ok(collapsed.includes("Operative"));
    assert.ok(collapsed.includes("Qualità dati"));
    assert.ok(collapsed.includes("+2 altre azioni"));
    assert.equal((collapsed.match(/\+2 altre azioni/g) || []).length, 2);
    assert.ok(!collapsed.includes("Operativa 5"));
    assert.ok(!collapsed.includes("Verifica date in conflitto"));

    const diagnosticExpanded = renderToStaticMarkup(h(component.PurchaseOrderOperationalSuggestionsContent, {
      operationalActions,
      diagnosticActions,
      diagnosticState: "loaded",
      showDiagnostic: true,
      diagnosticExpanded: true
    }));
    assert.ok(diagnosticExpanded.includes("Verifica date in conflitto"));
    assert.ok(!diagnosticExpanded.includes("Operativa 5"));

    const operationalExpanded = renderToStaticMarkup(h(component.PurchaseOrderOperationalSuggestionsContent, {
      operationalActions,
      diagnosticActions,
      diagnosticState: "loaded",
      showDiagnostic: true,
      operationalExpanded: true
    }));
    assert.ok(operationalExpanded.includes("Operativa 5"));
    assert.ok(!operationalExpanded.includes("Verifica date in conflitto"));

    const loading = renderToStaticMarkup(h(component.PurchaseOrderOperationalSuggestionsContent, {
      operationalActions: operationalActions.slice(0, 1),
      diagnosticActions: [],
      diagnosticState: "loading",
      showDiagnostic: true
    }));
    assert.ok(loading.includes("Operativa 1"));
    assert.ok(loading.includes("Caricamento valutazione qualità..."));
    assert.ok(!loading.includes("Nessuna azione suggerita per questo ordine."));

    const unavailable = renderToStaticMarkup(h(component.PurchaseOrderOperationalSuggestionsContent, {
      operationalActions: operationalActions.slice(0, 1),
      diagnosticActions: [],
      diagnosticState: "error",
      showDiagnostic: true
    }));
    assert.ok(unavailable.includes("Operativa 1"));
    assert.ok(unavailable.includes("La valutazione qualità non è disponibile per questo ordine."));

    const emptyDiagnostic = renderToStaticMarkup(h(component.PurchaseOrderOperationalSuggestionsContent, {
      operationalActions: operationalActions.slice(0, 1),
      diagnosticActions: [],
      diagnosticState: "loaded",
      showDiagnostic: true
    }));
    assert.ok(emptyDiagnostic.includes("Operativa 1"));
    assert.ok(emptyDiagnostic.includes("Nessuna segnalazione di qualità dati per questo ordine."));

    const overallEmpty = renderToStaticMarkup(h(component.PurchaseOrderOperationalSuggestionsContent, {
      operationalActions: [],
      diagnosticActions: [],
      diagnosticState: "hidden",
      showDiagnostic: false
    }));
    assert.ok(overallEmpty.includes("Nessuna azione suggerita per questo ordine."));
  }
  console.log("PASS");

  console.log("Test: primary and additional evidence links are exact and not duplicated");
  {
    const [action] = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState([finding("DANGLING_PROVENANCE", "evidence-links", {
        evidenceRefs: ["E10", "E2", "E1"]
      })]),
      operationalData: operationalData()
    });
    const html = renderToStaticMarkup(h(component.PurchaseOrderOperationalSuggestionsContent, {
      diagnosticActions: [action],
      diagnosticState: "loaded",
      showDiagnostic: true
    }));
    for (const ref of ["E1", "E2", "E10"]) {
      assert.equal(
        (html.match(new RegExp(`#evidence-${ref}(?=")`, "g")) || []).length,
        1,
        `${ref} must have one exact navigation link`
      );
    }
    assert.ok(html.includes("Vai all&#x27;evidenza"));
    assert.ok(html.includes("Evidenza aggiuntiva"));
  }
  console.log("PASS");

  console.log("Test: UI never renders internal IDs, raw UUIDs, descriptions or recommended actions");
  {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const actions = utility.buildPurchaseOrderDiagnosticSuggestions({
      qualityState: qualityState([finding("LINE_WITHOUT_EVIDENCE", uuid, {
        description: `NON MOSTRARE ${uuid}`,
        recommendedAction: `NON ESEGUIRE ${uuid}`,
        affectedLines: [{ id: uuid, description: `Carta ${uuid}`, itemCode: "SAFE-1" }],
        affectedDocuments: [{ id: "doc-secret", kind: "invoice", number: `F-${uuid}` }],
        evidenceRefs: ["STALE"]
      })]),
      operationalData: operationalData({
        canonicalMaterialLines: [{ id: uuid }],
        linkedDocuments: [{ id: "doc-secret" }]
      })
    });
    const html = renderToStaticMarkup(h(component.PurchaseOrderOperationalSuggestionsContent, {
      diagnosticActions: actions,
      diagnosticState: "loaded",
      showDiagnostic: true
    }));
    assert.ok(!html.includes(uuid));
    assert.ok(!html.includes("doc-secret"));
    assert.ok(!html.includes("NON MOSTRARE"));
    assert.ok(!html.includes("NON ESEGUIRE"));
    assert.ok(html.includes("Collegamento all&#x27;evidenza non disponibile."));
  }
  console.log("PASS");

  console.log("Test: authorized roles expose diagnostics; Buyer/ReadOnly expose none");
  {
    for (const role of ["Owner", "Admin", "IT"]) {
      const html = renderToStaticMarkup(h(component.default, {
        data: operationalData(),
        businessStatus: "CLOSED",
        referenceDate: "2026-07-28",
        qualityState: qualityState([finding("DATE_CONFLICT", `finding-${role}`)]),
        userRole: role
      }));
      assert.ok(html.includes("Qualità dati"));
      assert.ok(html.includes("Verifica date in conflitto"));
      assert.ok(!html.includes("Operative"));
    }
    for (const role of ["Buyer", "ReadOnly"]) {
      const html = renderToStaticMarkup(h(component.default, {
        data: operationalData(),
        businessStatus: "CLOSED",
        referenceDate: "2026-07-28",
        qualityState: qualityState([finding("DATE_CONFLICT", `finding-${role}`)]),
        userRole: role
      }));
      assert.ok(!html.includes("Qualità dati"));
      assert.ok(!html.includes("Verifica date in conflitto"));
    }
  }
  console.log("PASS");

  console.log("Test: request eligibility fails closed before the network effect");
  {
    const fetchQualityContract = async () => ({});
    for (const userRole of ["Owner", "Admin", "IT"]) {
      assert.equal(hook.canLoadPurchaseOrderQualityContract({
        orderId: "order-one",
        userRole,
        fetchQualityContract
      }), true);
    }
    for (const userRole of ["Buyer", "ReadOnly", null, undefined]) {
      assert.equal(hook.canLoadPurchaseOrderQualityContract({
        orderId: "order-one",
        userRole,
        fetchQualityContract
      }), false);
    }
    assert.equal(hook.canLoadPurchaseOrderQualityContract({
      orderId: "",
      userRole: "Owner",
      fetchQualityContract
    }), false);
    assert.equal(hook.canLoadPurchaseOrderQualityContract({
      orderId: "order-one",
      userRole: "Owner",
      fetchQualityContract: null
    }), false);
  }
  console.log("PASS");

  console.log("Test: shared request coordinator coalesces and aborts cleanly");
  {
    let calls = 0;
    let signal;
    const coordinator = hook.createPurchaseOrderQualityRequestCoordinator(({ signal: requestSignal }) => {
      calls += 1;
      signal = requestSignal;
      return new Promise(() => {});
    });
    const first = coordinator.acquire("order-one");
    const second = coordinator.acquire("order-one");
    assert.equal(calls, 0, "request starts in the deterministic promise microtask");
    await Promise.resolve();
    assert.equal(calls, 1);
    first.release();
    assert.equal(signal.aborted, false);
    second.release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(signal.aborted, true);
  }
  console.log("PASS");

  console.log("Test: stale response token protects the selected order");
  {
    const actions = [];
    const tokenRef = { current: 2 };
    await hook.loadPurchaseOrderQualityContract({
      orderId: "old-order",
      requestPromise: Promise.resolve({ orders: [{ orderId: "old-order" }], findings: [] }),
      dispatch: (action) => actions.push(action),
      tokenRef,
      myToken: 1
    });
    assert.deepStrictEqual(actions, []);
  }
  console.log("PASS");

  console.log("Test: OrderDetailPanel owns one shared lifecycle and passes the same state to both consumers");
  {
    const source = await readFile(
      new URL("../src/components/OrderDetailPanel.jsx", import.meta.url),
      "utf8"
    );
    assert.equal((source.match(/usePurchaseOrderQualityContract\(\{/g) || []).length, 1);
    assert.equal((source.match(/qualityState=\{qualityState\}/g) || []).length, 2);
  }
  console.log("PASS");
} finally {
  await vite.close();
}

console.log("All Phase 2C.1B diagnostic-suggestions tests passed.");
