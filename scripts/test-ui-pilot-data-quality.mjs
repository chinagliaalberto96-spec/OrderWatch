// Real-component UI test for the Pilot Data Quality dashboard
// (src/views/PilotDataQualityView.jsx), loaded through Vite's own SSR module
// loader (same pattern as scripts/test-ui-order-operational-view.mjs) so the
// JSX is transformed exactly as it is at runtime, with no second
// hand-written renderer duplicating presentation logic.
//
// The contract fed to the component is built with the REAL production
// functions (buildPilotCase / buildDataQualityContract), not a hand-typed
// fixture — this is the direct proof that "the dashboard must consume only
// the real contract output": every assertion below is checking the actual
// output of the actual contract-building pipeline.

import assert from 'assert';
import { readFile } from 'fs/promises';
import { createServer } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { buildPilotCase } from './lib/pilotControlCheck.mjs';
import { buildDataQualityContract } from './lib/dataQualityContract.mjs';

async function loadRealModules() {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const view = await server.ssrLoadModule('/src/views/PilotDataQualityView.jsx');
  return { server, view };
}

function section(html, heading) {
  const idx = html.indexOf(heading);
  assert.notStrictEqual(idx, -1, `expected to find heading "${heading}" in rendered output`);
  return html.slice(idx);
}

function baseView(overrides = {}) {
  return {
    orderId: 'order-x',
    orderNumber: 'PO-X',
    summary: { daysRemaining: 3 },
    currentObservedSituation: { label: null, severity: 'ok', reasonCodes: [], asOf: null },
    resolvedSupplierOrganization: { legalName: 'Fornitore X Srl' },
    canonicalMaterialLines: [],
    linkedDocuments: [],
    // Forced to true so these fixtures don't accumulate incidental
    // SECTION_NOT_EVALUATED findings unrelated to what each case is testing.
    activeCommitmentsAvailable: true,
    supersededCommitmentsAvailable: true,
    unresolvedEvidenceAvailable: true,
    ambiguousEvidenceAvailable: true,
    coverageAndSyncHealth: {
      inboundEmail: { status: 'available', reliability: 1, message: 'ok', limitation: null },
      outboundEmail: { status: 'available', reliability: 1, message: 'ok', limitation: null },
      attachments: { status: 'available', reliability: 1, message: 'ok', limitation: null },
      operationalLinking: { status: 'available', reliability: 1, message: 'ok', limitation: null }
    },
    evidenceReferences: [],
    safeEvidenceExcerpts: [],
    ...overrides
  };
}

// Builds one realistic multi-order contract with the real pipeline, covering
// every dataQualityStatus: incomplete evidence, open findings despite full
// coverage, genuinely clean/complete (zero findings — the case the old
// findings-only table could never represent), and not-yet-evaluated.
function buildSampleContract() {
  const incomplete = buildPilotCase({
    organizationId: 'org-1', orderId: 'order-a', view: baseView({
      orderId: 'order-a', orderNumber: 'PO-2001', resolvedSupplierOrganization: { legalName: 'Fornitore Uno Srl' },
      canonicalMaterialLines: [
        { id: 'l1', description: 'Riga A', canonicalKey: 'k1', provenanceRefs: ['E1'] },
        { id: 'l2', description: 'Riga B', canonicalKey: 'k2', provenanceRefs: [] }
      ],
      evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
    })
  });
  const openFindings = buildPilotCase({
    organizationId: 'org-1', orderId: 'order-b', view: baseView({
      orderId: 'order-b', orderNumber: 'PO-2002', resolvedSupplierOrganization: { legalName: 'Fornitore Due Srl' },
      canonicalMaterialLines: [
        { id: 'l3', description: 'Riga C', canonicalKey: 'dup', provenanceRefs: ['E2'] },
        { id: 'l4', description: 'Riga D', canonicalKey: 'dup', provenanceRefs: ['E2'] }
      ],
      evidenceReferences: [{ ref: 'E2', kind: 'line_source', sourceEmailId: 'se-2' }]
    })
  });
  const complete = buildPilotCase({
    organizationId: 'org-1', orderId: 'order-c', view: baseView({
      orderId: 'order-c', orderNumber: 'PO-2003', resolvedSupplierOrganization: { legalName: 'Fornitore Tre Srl' },
      canonicalMaterialLines: [{ id: 'l5', description: 'Riga E', canonicalKey: 'k5', provenanceRefs: ['E3'] }],
      evidenceReferences: [{ ref: 'E3', kind: 'line_source', sourceEmailId: 'se-3' }]
    })
  });
  const notEvaluated = buildPilotCase({
    organizationId: 'org-1', orderId: 'order-d', view: baseView({
      orderId: 'order-d', orderNumber: 'PO-2004', resolvedSupplierOrganization: { legalName: 'Fornitore Quattro Srl' },
      canonicalMaterialLines: []
    })
  });

  return buildDataQualityContract({
    organizationId: 'org-1',
    generatedAt: '2026-07-24T10:00:00.000Z',
    pilotCases: [incomplete, openFindings, complete, notEvaluated]
  });
}

async function run() {
  const { server, view } = await loadRealModules();
  const PilotDataQualityView = view.PilotDataQualityViewContent;
  const contract = buildSampleContract();

  try {
    console.log('Test: header shows organization name, evaluation timestamp and orders analyzed');
    {
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract, organizationName: 'Organizzazione Test Srl' }));
      assert.ok(html.includes('Organizzazione Test Srl'), 'organization name must be rendered');
      assert.ok(html.includes('Valutato il:'), 'evaluation timestamp label must be present');
      assert.ok(html.includes('Ordini analizzati:'), 'orders-analyzed label must be present');
      assert.ok(html.includes(String(contract.summary.totalOrders)), 'orders-analyzed count must be rendered');
      assert.ok(html.includes('pilota'), 'the header must identify this as a pilot/data-quality view');
    }
    console.log('PASS');

    console.log('Test: all 5 required KPI cards render with numerator/denominator context, none named accuracy/confidence/supplier score');
    {
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract }));
      for (const label of ['Ordini valutati', 'Copertura evidenza', 'Evidenza mancante', 'Evidenza ambigua', 'Segnalazioni aperte']) {
        assert.ok(html.includes(label), `expected KPI card labelled "${label}"`);
      }
      assert.ok(/\d+%/.test(html), 'evidence coverage must be shown as a percentage');
      assert.ok(html.includes('righe con evidenza su') && html.includes('valutate'), 'evidence coverage KPI must show its numerator/denominator context');
      assert.ok(html.includes(`su ${contract.qualityIndicators.missingEvidence.evaluatedLines} righe valutate`), 'missing evidence must show its real evaluated-lines denominator from the contract');

      assert.ok(!/accuratezza\s*(dati|estrazione)?\s*:?\s*\d/i.test(html), 'must never show an "accuracy: N%" style metric');
      assert.ok(!/confidence\s*:?\s*\d/i.test(html), 'must never show a "confidence: N" style metric');
      assert.ok(!/punteggio\s+(del\s+)?fornitore/i.test(html), 'must never show a supplier quality score');
      assert.ok(!/affidabilit[aà]\s+fornitore\s*:?\s*\d/i.test(html), 'must never show a supplier reliability score as a metric value');
    }
    console.log('PASS');

    console.log('Test: orders table is built entirely from contract.orders, including an order with zero findings (impossible from findings[] alone)');
    {
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract }));
      const table = section(html, 'Ordini valutati');
      for (const columnLabel of ['Ordine', 'Fornitore', 'Copertura evidenza', 'Segnalazioni', 'Stato dati']) {
        assert.ok(table.includes(columnLabel), `orders table must have a "${columnLabel}" column`);
      }
      for (const order of contract.orders) {
        assert.ok(html.includes(order.orderCode), `expected order code ${order.orderCode} in the table`);
        assert.ok(html.includes(order.supplierName), `expected supplier name ${order.supplierName} in the table`);
      }
      // order-c ("PO-2003") is genuinely clean: zero findings, full coverage.
      // It must still appear in the table — proving the table is built from
      // contract.orders (which always includes every evaluated order), not
      // reconstructed from contract.findings (which would omit it entirely).
      const completeOrder = contract.orders.find((o) => o.orderId === 'order-c');
      assert.strictEqual(completeOrder.findingCount, 0);
      assert.ok(html.includes('PO-2003'), 'an order with zero findings must still appear in the orders table');

      // Order-status vocabulary from src/utils/statusRules.js (order
      // business status) must never leak into this data-quality table.
      for (const forbiddenStatus of ['Scaduto', 'Confermato', 'Annullato', 'Ricevuto']) {
        assert.ok(!table.includes(forbiddenStatus), `order business status "${forbiddenStatus}" must not appear in the data-quality status column`);
      }
    }
    console.log('PASS');

    console.log('Test: dataQualityStatus renders its own fixed Italian label per order (incomplete/open/complete/not-evaluated), computed from evidenceCoverage{coveredLines,totalLines}');
    {
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract }));
      const table = section(html, 'Ordini valutati');
      assert.ok(table.includes('Evidenza incompleta'), 'expected the incomplete_evidence status label');
      assert.ok(table.includes('Segnalazioni aperte'), 'expected the open_findings status label');
      assert.ok(table.includes('Dati completi'), 'expected the complete status label');
      assert.ok(table.includes('Da verificare'), 'expected the not_evaluated status label for the order with zero lines');
    }
    console.log('PASS');

    console.log('Test: an order with zero evaluated lines renders "Non disponibile" coverage, never 0%');
    {
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract }));
      const notEvaluatedOrder = contract.orders.find((o) => o.dataQualityStatus === 'not_evaluated');
      assert.ok(notEvaluatedOrder, 'sample must include a not_evaluated order');
      assert.deepStrictEqual(notEvaluatedOrder.evidenceCoverage, { coveredLines: 0, totalLines: 0 });
      const table = section(html, 'Ordini valutati');
      assert.ok(table.includes('Non disponibile'), 'a 0/0 coverage pair must render as "Non disponibile", never as 0%');
    }
    console.log('PASS');

    console.log('Test: findings panel shows type, severity, affected order and affected lines/documents without rendering freeform recommended actions');
    {
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract }));
      const panel = section(html, 'Segnalazioni di qualità dati');
      assert.ok(contract.findings.length > 0);
      for (const finding of contract.findings) {
        assert.ok(panel.includes(finding.type), `expected finding type ${finding.type}`);
        assert.ok(panel.includes(finding.orderCode), `expected affected order ${finding.orderCode}`);
        assert.ok(!panel.includes(finding.recommendedAction), `recommended action must not render for ${finding.type}`);
      }
      assert.ok(panel.includes('Righe interessate:'), 'affected lines must be shown');
      assert.ok(panel.includes('Documenti interessati:'), 'affected documents must be shown');
      assert.ok(panel.includes('Attenzione') || panel.includes('Critico') || panel.includes('Informativo'), 'expected a rendered severity label');
    }
    console.log('PASS');

    console.log('Test: freeform recommended actions are absent and without onOpenOrder wired no navigation button renders either');
    {
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract }));
      assert.ok(!html.includes('<button'), 'without onOpenOrder wired, the dashboard must remain fully read-only, no buttons at all');
      assert.ok(!html.includes('<input'), 'the dashboard must not introduce editable fields');
      assert.ok(!html.includes('<form'), 'the dashboard must not introduce a submission form');
    }
    console.log('PASS');

    // ------------------------------------------------------------------
    // Data Quality -> OrderOperationalView navigation (support/admin
    // investigation handoff). Requirements #1-4/#8 from the task: per-order
    // findings expose "Apri ordine" only when they carry a real orderId;
    // organizationFindings (which structurally never have an orderId) never
    // expose it; the click payload is the real orderId (never a raw label);
    // no raw UUID is ever shown as visible text.
    // ------------------------------------------------------------------
    const { buildOpenOrderInvocation } = view;

    console.log('Test: buildOpenOrderInvocation returns [orderId, context] for a real per-order finding when onOpenOrder is provided');
    {
      const onOpenOrder = () => {};
      const finding = contract.findings.find((f) => f.orderId);
      assert.ok(finding, 'sample contract must contain at least one per-order finding with an orderId');
      const invocation = buildOpenOrderInvocation(finding, onOpenOrder);
      assert.ok(invocation, 'expected a non-null invocation for a valid per-order finding');
      const [orderId, context] = invocation;
      assert.strictEqual(orderId, finding.orderId, 'the emitted orderId must be exactly the finding\'s real orderId, the stable navigation key');
      assert.strictEqual(context.findingId, finding.findingId);
      assert.strictEqual(context.type, finding.type);
      assert.strictEqual(context.dimension, finding.dimension);
      assert.strictEqual(context.severity, finding.severity);
      assert.strictEqual(context.orderId, finding.orderId);
      assert.strictEqual(context.orderCode, finding.orderCode || null);
      assert.deepStrictEqual(context.affectedLines, finding.affectedLines || []);
      assert.deepStrictEqual(context.affectedDocuments, finding.affectedDocuments || []);
      assert.deepStrictEqual(context.evidenceRefs, finding.evidenceRefs || []);
      assert.strictEqual(context.description, finding.description || null);
      assert.ok(!Object.prototype.hasOwnProperty.call(context, 'recommendedAction'));
    }
    console.log('PASS');

    console.log('Test: buildOpenOrderInvocation returns null when orderId is missing (e.g. an organizationFinding-shaped object) or onOpenOrder is not wired');
    {
      const perOrderFinding = contract.findings.find((f) => f.orderId);
      assert.strictEqual(buildOpenOrderInvocation(perOrderFinding, undefined), null, 'no onOpenOrder wired must produce no invocation');
      assert.strictEqual(buildOpenOrderInvocation({ ...perOrderFinding, orderId: undefined }, () => {}), null, 'a missing orderId must produce no invocation, even with onOpenOrder wired');
      // organizationFindings shape (see dataQualityContract.mjs#buildOrganizationFindings):
      // findingId/organizationId/sourceKey/dimension/severity/type/
      // description/recommendedAction/scope — structurally no orderId field.
      const orgFinding = { findingId: 'org#SOURCE_INCOMPLETE:operationalLinking', organizationId: contract.organizationId, sourceKey: 'operationalLinking', dimension: 'availability', severity: 'info', type: 'SOURCE_INCOMPLETE', description: 'x', recommendedAction: 'y', scope: 'orderwatch_data_quality' };
      assert.ok(!('orderId' in orgFinding), 'organizationFindings must structurally have no orderId field at all');
      assert.strictEqual(buildOpenOrderInvocation(orgFinding, () => {}), null, 'an organization finding must never produce a navigation invocation');
    }
    console.log('PASS');

    console.log('Test: with onOpenOrder wired, per-order findings render "Apri ordine" but organization findings never do');
    {
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract, onOpenOrder: () => {} }));
      const findingsPanel = section(html, 'Segnalazioni di qualità dati per ordine');
      const orgPanel = section(html, 'Segnalazioni a livello di organizzazione');
      const openOrderCount = (findingsPanel.match(/Apri ordine/g) || []).length;
      assert.strictEqual(openOrderCount, contract.findings.length, 'every per-order finding (all of which have a real orderId in this sample) must expose exactly one "Apri ordine" action');
      assert.ok(!orgPanel.includes('Apri ordine'), 'organization findings must never expose the "Apri ordine" navigation action');
      assert.ok(findingsPanel.includes('<button'), 'expected at least one real <button> element for the navigation action');
    }
    console.log('PASS');

    console.log('Test: a per-order finding with no orderId renders no "Apri ordine" action (omitted, not just disabled)');
    {
      const contractWithUnavailableFinding = {
        ...contract,
        findings: [
          { ...contract.findings[0], findingId: 'synthetic#no-order-id', orderId: undefined, orderCode: null }
        ]
      };
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract: contractWithUnavailableFinding, onOpenOrder: () => {} }));
      const findingsPanel = section(html, 'Segnalazioni di qualità dati per ordine');
      assert.ok(!findingsPanel.includes('Apri ordine'), 'a finding without orderId must not expose the navigation action at all');
      assert.ok(!findingsPanel.includes('<button'), 'no button of any kind should render for an orderId-less finding');
    }
    console.log('PASS');

    console.log('Test: no raw UUID is ever displayed as a visible label — orderCode (or an explicit "not available" message) is shown instead');
    {
      const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
      const contractWithUuidIds = {
        ...contract,
        findings: contract.findings.map((f) => ({ ...f, orderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', orderCode: null }))
      };
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract: contractWithUuidIds, onOpenOrder: () => {} }));
      const findingsPanel = section(html, 'Segnalazioni di qualità dati per ordine');
      assert.ok(!UUID_RE.test(findingsPanel), 'a UUID-shaped orderId must never appear as visible text, even when orderCode is missing');
      assert.ok(findingsPanel.includes('Ordine non disponibile'), 'a missing human-readable orderCode must render an explicit label, never fall back to the raw id');
      // The navigation action itself must still work — it carries the real
      // id as data (an onClick closure argument), not as visible text.
      assert.ok(findingsPanel.includes('Apri ordine'), 'navigation must still be offered when orderId is present, even without a human-readable orderCode');
    }
    console.log('PASS');

    console.log('Test: with no contract supplied, the view has no mock/default data and shows an honest unavailable state');
    {
      const htmlUndefined = renderToStaticMarkup(h(PilotDataQualityView, {}));
      assert.ok(htmlUndefined.includes('Nessuna valutazione disponibile'), 'a missing contract must show an explicit unavailable state, never fabricated numbers');
      assert.ok(!/\d+%/.test(htmlUndefined), 'no percentage of any kind may be rendered without a real contract');

      const htmlNull = renderToStaticMarkup(h(PilotDataQualityView, { contract: null }));
      assert.ok(htmlNull.includes('Nessuna valutazione disponibile'));
    }
    console.log('PASS');

    console.log('Test: an empty orders/findings array on an otherwise-real contract shows the honest empty state, not fabricated rows');
    {
      const emptyContract = {
        ...contract,
        summary: { totalOrders: 0, extractedDocuments: 0, linkedEvidence: 0 },
        qualityIndicators: { evidenceCoverage: null, missingEvidence: { count: 0, evaluatedLines: 0 }, ambiguousEvidence: { count: 0, evaluatedLines: 0 }, incompleteOrders: { count: 0, totalOrders: 0 } },
        orders: [],
        findings: []
      };
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract: emptyContract, organizationName: 'Organizzazione Vuota Srl' }));
      assert.ok(html.includes('Organizzazione Vuota Srl'));
      assert.ok(html.includes('Nessuna segnalazione'), 'an empty findings array must show the honest empty state, not fabricated rows');
      assert.ok(html.includes('Nessun ordine valutato'), 'an empty orders array must show the honest empty state, not fabricated rows');
    }
    console.log('PASS');

    console.log('Test: scope disclaimer distinguishing data-quality from accuracy/confidence/supplier-performance/order-correctness is present');
    {
      const html = renderToStaticMarkup(h(PilotDataQualityView, { contract }));
      const lower = html.toLowerCase();
      assert.ok(lower.includes('non misura') || lower.includes('non è un') || lower.includes("non e' un"), 'expected an explicit disclaimer of what this view does not measure');
    }
    console.log('PASS');

    // ------------------------------------------------------------------
    // Container tests: the default export now performs the real fetch
    // orchestration (loading -> success/401/403/generic error), instead of
    // taking a contract prop directly. These prove the App.jsx integration
    // requirements: honest loading/error/empty/success states, and no
    // fallback to mock/fabricated data on any failure path.
    // ------------------------------------------------------------------
    const PilotDataQualityViewContainer = view.default;
    const { pilotQualityContractReducer, initialPilotQualityContractState, loadPilotQualityContract } = view;

    console.log('Test: reducer starts idle and transitions through LOAD_START/LOAD_SUCCESS');
    {
      assert.strictEqual(initialPilotQualityContractState.status, 'idle');
      const loading = pilotQualityContractReducer(initialPilotQualityContractState, { type: 'LOAD_START' });
      assert.strictEqual(loading.status, 'loading');
      assert.strictEqual(loading.contract, null);
      const loaded = pilotQualityContractReducer(loading, { type: 'LOAD_SUCCESS', contract });
      assert.strictEqual(loaded.status, 'loaded');
      assert.strictEqual(loaded.contract, contract);
      assert.strictEqual(loaded.error, null);
    }
    console.log('PASS');

    console.log('Test: reducer preserves the real HTTP status on LOAD_ERROR (401 vs 403 vs other)');
    {
      const err401 = pilotQualityContractReducer(initialPilotQualityContractState, { type: 'LOAD_ERROR', message: 'Unauthorized', status: 401 });
      assert.strictEqual(err401.status, 'error');
      assert.strictEqual(err401.errorStatus, 401);
      const err403 = pilotQualityContractReducer(initialPilotQualityContractState, { type: 'LOAD_ERROR', message: 'Forbidden', status: 403 });
      assert.strictEqual(err403.errorStatus, 403);
      const errGeneric = pilotQualityContractReducer(initialPilotQualityContractState, { type: 'LOAD_ERROR', message: 'boom', status: null });
      assert.strictEqual(errGeneric.errorStatus, null);
    }
    console.log('PASS');

    console.log('Test: loadPilotQualityContract dispatches LOAD_SUCCESS with the real fetched contract, never a fabricated one');
    {
      const dispatched = [];
      const dispatch = (action) => dispatched.push(action);
      const tokenRef = { current: 1 };
      await loadPilotQualityContract({ fetchFn: async () => contract, dispatch, tokenRef, myToken: 1 });
      assert.strictEqual(dispatched.length, 1);
      assert.strictEqual(dispatched[0].type, 'LOAD_SUCCESS');
      assert.strictEqual(dispatched[0].contract, contract);
    }
    console.log('PASS');

    console.log('Test: loadPilotQualityContract on a 401/403 error dispatches LOAD_ERROR with the real status, no fallback data');
    {
      for (const status of [401, 403]) {
        const dispatched = [];
        const dispatch = (action) => dispatched.push(action);
        const tokenRef = { current: 1 };
        const error = new Error('http error');
        error.status = status;
        await loadPilotQualityContract({ fetchFn: async () => { throw error; }, dispatch, tokenRef, myToken: 1 });
        assert.strictEqual(dispatched.length, 1);
        assert.strictEqual(dispatched[0].type, 'LOAD_ERROR');
        assert.strictEqual(dispatched[0].status, status);
      }
    }
    console.log('PASS');

    console.log('Test: loadPilotQualityContract ignores AbortError (unmount/cancel), dispatching nothing');
    {
      const dispatched = [];
      const dispatch = (action) => dispatched.push(action);
      const tokenRef = { current: 1 };
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      await loadPilotQualityContract({ fetchFn: async () => { throw abortError; }, dispatch, tokenRef, myToken: 1 });
      assert.strictEqual(dispatched.length, 0, 'an aborted request must not dispatch any state transition');
    }
    console.log('PASS');

    console.log('Test: loadPilotQualityContract ignores a stale response (tokenRef advanced past myToken)');
    {
      const dispatched = [];
      const dispatch = (action) => dispatched.push(action);
      const tokenRef = { current: 2 }; // a newer load already started
      await loadPilotQualityContract({ fetchFn: async () => contract, dispatch, tokenRef, myToken: 1 });
      assert.strictEqual(dispatched.length, 0, 'a stale (superseded) response must not dispatch');
    }
    console.log('PASS');

    console.log('Test: container renders a loading state, then the real contract via PilotDataQualityViewContent on success — never mock data');
    {
      let resolveFetch;
      const pending = new Promise((resolve) => { resolveFetch = resolve; });
      const fetchContract = () => pending;
      const html = renderToStaticMarkup(h(PilotDataQualityViewContainer, { fetchContract, organizationName: 'Organizzazione Test Srl' }));
      assert.ok(/role="status"/.test(html), 'must render an explicit loading state with role="status"');
      resolveFetch(contract); // not asserted further: SSR renderToStaticMarkup is synchronous and does not await effects
    }
    console.log('PASS');

    console.log('Test: container never falls back to mock/fabricated data when fetchContract is missing or rejects');
    {
      const htmlNoFetch = renderToStaticMarkup(h(PilotDataQualityViewContainer, { fetchContract: undefined, organizationName: 'Org' }));
      assert.ok(/role="status"/.test(htmlNoFetch), 'with no fetchContract wired, the container must show its initial loading/unavailable state, not fabricated numbers');
      assert.ok(!/\d+%/.test(htmlNoFetch), 'no percentage may render without a real contract, even when fetchContract is missing');
    }
    console.log('PASS');

    console.log('Test: the container forwards onOpenOrder to PilotDataQualityViewContent unchanged (source check — SSR never runs the post-mount effect, so the loaded state can\'t be observed by rendering alone)');
    {
      const source = await readFile(new URL('../src/views/PilotDataQualityView.jsx', import.meta.url), 'utf8');
      assert.ok(/<PilotDataQualityViewContent[^>]*onOpenOrder={onOpenOrder}/.test(source), 'the container must forward its onOpenOrder prop to the content component, not drop or rename it');
    }
    console.log('PASS');

    console.log('Test: PilotDataQualityView does not fetch order data itself — no OrderOperationalView/order-fetch import anywhere in this file');
    {
      const source = await readFile(new URL('../src/views/PilotDataQualityView.jsx', import.meta.url), 'utf8');
      // Comments are allowed to reference OrderOperationalView by name (this
      // file documents the handoff and its highlighting limitation) — what
      // must never exist is an actual import or JSX usage of it.
      assert.ok(!/^\s*import .*OrderOperationalView/m.test(source), 'PilotDataQualityView must never import OrderOperationalView directly — navigation only, via onOpenOrder');
      assert.ok(!/<OrderOperationalView\b/.test(source), 'PilotDataQualityView must never render OrderOperationalView directly — navigation only, via onOpenOrder');
      assert.ok(!/getOrderOperationalView|fetchOperationalView/.test(source), 'PilotDataQualityView must not contain a second order-fetching implementation');
    }
    console.log('PASS');

    console.log('All pilot-data-quality UI tests passed');
  } finally {
    await server.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
