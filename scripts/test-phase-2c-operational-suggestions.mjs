import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  PURCHASE_ORDER_ACTION_CODES,
  PURCHASE_ORDER_SUGGESTIONS_INITIAL_LIMIT,
  buildPurchaseOrderOperationalSuggestions
} from "../src/utils/purchaseOrderOperationalSuggestions.js";

const REFERENCE_DATE = new Date("2026-07-28T10:00:00.000Z");

function line(id, overrides = {}) {
  return {
    id,
    description: `Riga ${id}`,
    dueDate: null,
    requiredDate: null,
    remainingQuantity: 1,
    ...overrides
  };
}

function fixture(lines = []) {
  return {
    orderId: "order-internal-secret",
    canonicalMaterialLines: lines
  };
}

function build(businessStatus, lines = [], overrides = {}) {
  return buildPurchaseOrderOperationalSuggestions({
    data: { ...fixture(lines), ...overrides },
    businessStatus,
    referenceDate: REFERENCE_DATE
  });
}

console.log("Test: closed order-level taxonomy is exact and mutually exclusive");
{
  const cases = [
    ["TO_VERIFY", PURCHASE_ORDER_ACTION_CODES.VERIFY_ORDER_STATUS, "Verifica ordine", "Priorità operativa"],
    ["OVERDUE", PURCHASE_ORDER_ACTION_CODES.ATTENTION_OVERDUE, "Ordine in ritardo", "Priorità operativa"],
    ["CRITICAL", PURCHASE_ORDER_ACTION_CODES.ATTENTION_APPROACHING_DEADLINE, "Ordine in scadenza", "Da verificare"]
  ];
  for (const [status, code, title, priorityLabel] of cases) {
    const actions = build(status);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].actionCode, code);
    assert.equal(actions[0].title, title);
    assert.equal(actions[0].priorityLabel, priorityLabel);
    assert.equal(actions[0].domain, "operational");
    assert.equal(actions[0].targetLevel, "order");
  }
  assert.deepEqual(build("CLOSED"), []);
  assert.deepEqual(build("UNKNOWN"), []);
}
console.log("PASS");

console.log("Test: dueDate and requiredDate independently create one expired-line action");
{
  for (const dateField of ["dueDate", "requiredDate"]) {
    const actions = build("OK", [line(`line-${dateField}`, { [dateField]: "2026-07-28" })]);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].actionCode, PURCHASE_ORDER_ACTION_CODES.VERIFY_EXPIRED_LINE_COMMITMENT);
    assert.deepEqual(actions[0].commitmentDetails.map((detail) => detail.field), [dateField]);
  }
}
console.log("PASS");

console.log("Test: two expired commitments produce one line action and neither is authoritative");
{
  const actions = build("WARNING", [line("line-both", {
    dueDate: "2026-07-27",
    requiredDate: "2026-07-28"
  })]);
  assert.equal(actions.length, 1);
  assert.deepEqual(
    actions[0].commitmentDetails.map(({ field, label }) => [field, label]),
    [["dueDate", "Data prevista"], ["requiredDate", "Richiesta entro"]]
  );
  assert.ok(!actions[0].commitmentDetails.some((detail) => "authoritative" in detail));
}
console.log("PASS");

console.log("Test: future and invalid dates fail closed");
{
  assert.deepEqual(build("OK", [line("future", { dueDate: "2026-07-29" })]), []);
  assert.deepEqual(build("OK", [line("invalid", { dueDate: "not-a-date" })]), []);
  assert.deepEqual(build("OK", [line("missing")]), []);
}
console.log("PASS");

console.log("Test: remaining quantity accepts only positive numbers or validated numeric strings");
{
  const accepted = [1, 1.5, "1", " 1.5 ", "1e2"];
  for (const [index, value] of accepted.entries()) {
    const actions = build("OK", [
      line(`accepted-${index}`, { dueDate: "2026-07-27", remainingQuantity: value })
    ]);
    assert.equal(
      actions.length,
      1,
      `must accept ${typeof value === "string" ? JSON.stringify(value) : String(value)}`
    );
    assert.equal(
      actions[0].actionCode,
      PURCHASE_ORDER_ACTION_CODES.VERIFY_EXPIRED_LINE_COMMITMENT
    );
  }

  const rejected = [
    undefined,
    null,
    "",
    " ",
    true,
    false,
    [1],
    ["1"],
    [],
    {},
    () => 1,
    1n,
    Symbol("quantity"),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -1,
    "abc",
    "0x10",
    "Infinity"
  ];
  for (const [index, value] of rejected.entries()) {
    assert.doesNotThrow(() => {
      assert.deepEqual(
        build("OK", [
          line(`rejected-${index}`, { dueDate: "2026-07-27", remainingQuantity: value })
        ]),
        [],
        `must fail closed for rejected value at index ${index}`
      );
    });
  }
}
console.log("PASS");

console.log("Test: overdue suppresses every qualifying line action");
{
  const actions = build("OVERDUE", [
    line("expired-a", { dueDate: "2026-07-20" }),
    line("expired-b", { requiredDate: "2026-07-21" })
  ]);
  assert.deepEqual(actions.map((action) => action.actionCode), [
    PURCHASE_ORDER_ACTION_CODES.ATTENTION_OVERDUE
  ]);
}
console.log("PASS");

console.log("Test: non-overdue statuses retain distinct, one-per-line actions with exact keys");
{
  const actions = build("TO_VERIFY", [
    line("line-b", { dueDate: "2026-07-20" }),
    line("line-a", { dueDate: "2026-07-21", requiredDate: "2026-07-22" })
  ]);
  assert.equal(actions.length, 3);
  assert.equal(actions[0].actionCode, PURCHASE_ORDER_ACTION_CODES.VERIFY_ORDER_STATUS);
  assert.deepEqual(actions.slice(1).map((action) => action.lineId), ["line-a", "line-b"]);
  assert.equal(
    actions[1].internalKey,
    "order-internal-secret:VERIFY_EXPIRED_LINE_COMMITMENT:line-a"
  );
  assert.equal(new Set(actions.map((action) => action.internalKey)).size, actions.length);
}
console.log("PASS");

console.log("Test: ordering is deterministic by priority, target, stable ids and action code");
{
  const first = build("CRITICAL", [
    line("line-z", { dueDate: "2026-07-20" }),
    line("line-a", { dueDate: "2026-07-20" })
  ]);
  const second = build("CRITICAL", [
    line("line-z", { dueDate: "2026-07-20" }),
    line("line-a", { dueDate: "2026-07-20" })
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((action) => action.targetLevel), ["order", "line", "line"]);
  assert.deepEqual(first.slice(1).map((action) => action.lineId), ["line-a", "line-z"]);
}
console.log("PASS");

console.log("Test: absent stable order or line identities fail closed");
{
  assert.deepEqual(buildPurchaseOrderOperationalSuggestions({
    data: fixture([line("line-a", { dueDate: "2026-07-20" })]),
    businessStatus: "OK",
    referenceDate: REFERENCE_DATE
  }).filter((action) => !action.internalKey), []);
  assert.deepEqual(build("OK", [line("", { dueDate: "2026-07-20" })]), []);
  assert.deepEqual(build("OK", [line(null, { dueDate: "2026-07-20" })]), []);
  assert.deepEqual(build("OK", [line("line-a", { dueDate: "2026-07-20" })], { orderId: null }), []);
}
console.log("PASS");

console.log("Test: no diagnostic or forbidden action code can be generated");
{
  const codes = new Set([
    ...build("TO_VERIFY", [line("line-a", { dueDate: "2026-07-20" })]),
    ...build("OVERDUE"),
    ...build("CRITICAL")
  ].map((action) => action.actionCode));
  assert.deepEqual([...codes].sort(), [
    "ATTENTION_APPROACHING_DEADLINE",
    "ATTENTION_OVERDUE",
    "VERIFY_EXPIRED_LINE_COMMITMENT",
    "VERIFY_ORDER_STATUS"
  ]);
  assert.ok(!codes.has("VERIFY_COMMITMENT_WITHOUT_OBSERVATION"));
  assert.ok(!codes.has("REVIEW_DATA_QUALITY_FINDING"));
  assert.ok(!codes.has("CONTACT_SUPPLIER"));
}
console.log("PASS");

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const {
    default: PurchaseOrderOperationalSuggestions,
    PurchaseOrderOperationalSuggestionsContent
  } = await vite.ssrLoadModule("/src/components/PurchaseOrderOperationalSuggestions.jsx");

  const manyActions = build("OK", [
    line("line-1", { dueDate: "2026-07-20", description: "Materiale uno" }),
    line("line-2", { dueDate: "2026-07-20", description: "Materiale due" }),
    line("line-3", { dueDate: "2026-07-20", description: "Materiale tre" }),
    line("line-4", { dueDate: "2026-07-20", description: "Materiale quattro" }),
    line("line-5", { dueDate: "2026-07-20", description: "Materiale cinque" })
  ]);

  console.log("Test: UI caps the initial list at three and shows the exact remaining count");
  {
    assert.equal(PURCHASE_ORDER_SUGGESTIONS_INITIAL_LIMIT, 3);
    const html = renderToStaticMarkup(h(PurchaseOrderOperationalSuggestionsContent, {
      actions: manyActions,
      expanded: false
    }));
    assert.ok(html.includes("Azioni suggerite"));
    assert.ok(html.includes("Materiale uno"));
    assert.ok(html.includes("Materiale tre"));
    assert.ok(!html.includes("Materiale quattro"));
    assert.ok(html.includes("+2 altre azioni"));
  }
  console.log("PASS");

  console.log("Test: expanded presentation shows every action without performing a request");
  {
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount += 1;
      throw new Error("unexpected request");
    };
    try {
      const html = renderToStaticMarkup(h(PurchaseOrderOperationalSuggestionsContent, {
        actions: manyActions,
        expanded: true
      }));
      assert.ok(html.includes("Materiale cinque"));
      assert.ok(html.includes("Mostra meno"));
      assert.equal(fetchCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
  console.log("PASS");

  console.log("Test: empty state is explicit");
  {
    const html = renderToStaticMarkup(h(PurchaseOrderOperationalSuggestionsContent, {
      actions: []
    }));
    assert.ok(html.includes("Nessuna azione suggerita per questo ordine."));
  }
  console.log("PASS");

  console.log("Test: visible UI renders dates and descriptions but never internal identities");
  {
    const data = fixture([line("550e8400-e29b-41d4-a716-446655440000", {
      dueDate: "2026-07-20",
      requiredDate: "2026-07-21",
      description: "Cartoncino sintetico"
    })]);
    const html = renderToStaticMarkup(h(PurchaseOrderOperationalSuggestions, {
      data,
      businessStatus: "OK",
      referenceDate: REFERENCE_DATE
    }));
    assert.ok(html.includes("Cartoncino sintetico"));
    assert.ok(html.includes("Data prevista"));
    assert.ok(html.includes("Richiesta entro"));
    assert.ok(!html.includes("order-internal-secret"));
    assert.ok(!html.includes("550e8400-e29b-41d4-a716-446655440000"));
  }
  console.log("PASS");

  console.log("Test: all five order-view roles receive identical read-only output");
  {
    const data = fixture([line("line-role", { dueDate: "2026-07-20" })]);
    const outputs = ["Owner", "Admin", "IT", "Buyer", "ReadOnly"].map((userRole) =>
      renderToStaticMarkup(h(PurchaseOrderOperationalSuggestions, {
        data,
        businessStatus: "OK",
        referenceDate: REFERENCE_DATE,
        userRole
      }))
    );
    assert.ok(outputs.every((html) => html === outputs[0]));
    assert.ok(!/Completa|Assegna|Posticipa|Contatta fornitore|Crea task/.test(outputs[0]));
  }
  console.log("PASS");
} finally {
  await vite.close();
}

console.log("Test: Phase 2C.1A adds no adapter, request, quality-contract or persistence dependency");
{
  const componentSource = await readFile(
    new URL("../src/components/PurchaseOrderOperationalSuggestions.jsx", import.meta.url),
    "utf8"
  );
  const utilitySource = await readFile(
    new URL("../src/utils/purchaseOrderOperationalSuggestions.js", import.meta.url),
    "utf8"
  );
  const operationalViewSource = await readFile(
    new URL("../src/components/OrderOperationalView.jsx", import.meta.url),
    "utf8"
  );
  const detailPanelSource = await readFile(
    new URL("../src/components/OrderDetailPanel.jsx", import.meta.url),
    "utf8"
  );
  const addedSource = `${componentSource}\n${utilitySource}`;

  assert.ok(!/\bfetch\s*\(|apiAdapter|pilot-quality-contract|supabase|operational_actions|operationalQueue/i.test(addedSource));
  assert.equal((operationalViewSource.match(/<PurchaseOrderOperationalSuggestions/g) || []).length, 1);
  assert.equal(
    (detailPanelSource.match(/<OrderOperationalView[\s\S]*?businessStatus=\{status\}/g) || []).length,
    1
  );
}
console.log("PASS");

console.log("All Phase 2C.1A operational-suggestions tests passed.");
