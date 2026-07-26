import assert from "assert";
import { readFile } from "fs/promises";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  buildInvestigationBannerModel,
  isExactIdFocused,
  normalizeFindingContext,
  normalizeFocusIds,
  resolveExistingEvidenceRefs
} from "../src/utils/dataQualityInvestigation.js";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/data-quality-investigation-cases.json", import.meta.url), "utf8")
);

assert.strictEqual(fixture.synthetic, true, "the validation matrix must be explicitly synthetic");
assert.strictEqual(fixture.cases.length, 8, "the required eight scenarios must be present");

console.log("Test: fixture contexts normalize deterministically and organization findings cannot create order context");
for (const testCase of fixture.cases) {
  const context = normalizeFindingContext(testCase.finding);
  assert.strictEqual(Boolean(context), testCase.expected.banner, testCase.caseId);
  assert.deepStrictEqual(normalizeFocusIds(context?.affectedLines), testCase.expected.lineFocusIds, testCase.caseId);
  assert.deepStrictEqual(normalizeFocusIds(context?.affectedDocuments), testCase.expected.documentFocusIds, testCase.caseId);
  assert.deepStrictEqual(context?.evidenceRefs || [], testCase.expected.evidenceFocusRefs, testCase.caseId);
}
console.log("PASS");

console.log("Test: banner language is factual and deterministic");
{
  const missing = buildInvestigationBannerModel(fixture.cases.find((entry) => entry.caseId === "missing-evidence").finding);
  assert.ok(missing.cannotConfirm.includes("non può essere verificato rispetto a una fonte"));
  assert.ok(!missing.cannotConfirm.toLowerCase().includes("ordine è errato"));

  const quantity = buildInvestigationBannerModel(fixture.cases.find((entry) => entry.caseId === "quantity-conflict").finding);
  assert.ok(quantity.cannotConfirm.includes("non determina quale valore sia corretto"));
  assert.ok(!/\b(10|20|30)\b/.test(quantity.cannotConfirm), "the deterministic template must not select a winning quantity");

  const date = buildInvestigationBannerModel(fixture.cases.find((entry) => entry.caseId === "date-conflict").finding);
  assert.ok(date.cannotConfirm.includes("non determina quale data sia corretta"));

  const section = buildInvestigationBannerModel(fixture.cases.find((entry) => entry.caseId === "section-not-evaluated").finding);
  assert.ok(section.cannotConfirm.includes("non è stata eseguita"));
  assert.ok(section.cannotConfirm.includes("non conferma che l'ordine sia completo o corretto"));
}
console.log("PASS");

console.log("Test: line/document focus and evidence matching require exact stable identifiers");
{
  assert.strictEqual(isExactIdFocused({ id: "line-fixture-a", description: "same" }, ["line-fixture-a"]), true);
  assert.strictEqual(isExactIdFocused({ id: "line-fixture-b", description: "same" }, ["line-fixture-a"]), false);
  assert.strictEqual(isExactIdFocused({ id: "document-fixture-a" }, ["document-fixture-a"]), true);
  assert.strictEqual(isExactIdFocused({ id: "document-fixture-b" }, ["document-fixture-a"]), false);
  assert.deepStrictEqual(
    resolveExistingEvidenceRefs(
      ["E-FIXTURE-1", "E-STALE", "E-FIXTURE-1"],
      [{ ref: "E-FIXTURE-1" }, { ref: "E-FIXTURE-2" }]
    ),
    ["E-FIXTURE-1"]
  );
}
console.log("PASS");

console.log("Test: rendered banner exposes no raw UUID and normal navigation has no banner");
{
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  try {
    const panel = await server.ssrLoadModule("/src/components/OrderDetailPanel.jsx");
    const finding = {
      ...fixture.cases.find((entry) => entry.caseId === "missing-evidence").finding,
      findingId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      orderId: "11111111-2222-4333-8444-555555555555",
      affectedLines: [{ id: "66666666-7777-4888-8999-000000000000", description: "Riga sintetica", itemCode: null }],
      description: "Controllare 77777777-8888-4999-8aaa-bbbbbbbbbbbb.",
      recommendedAction: "Non mostrare cccccccc-dddd-4eee-8fff-000000000000."
    };
    const bannerHtml = renderToStaticMarkup(h(panel.InvestigationBanner, { context: finding }));
    assert.ok(bannerHtml.includes("Ordine aperto dal controllo qualità"));
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(bannerHtml));
    const normalHtml = renderToStaticMarkup(h(panel.InvestigationBanner, { context: null }));
    assert.strictEqual(normalHtml, "");
  } finally {
    await server.close();
  }
}
console.log("PASS");

console.log("All Data Quality investigation tests passed");
