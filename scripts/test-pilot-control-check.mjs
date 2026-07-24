import assert from 'assert';
import { readFile } from 'fs/promises';
import {
  buildPilotCase,
  runPilotControlCheck,
  collectCandidateSignals,
  selectPilotCandidates,
  buildJsonReport,
  buildMarkdownReport,
  buildCsvReport,
  ratio,
  KNOWN_PILOT_ORDER_CODE,
  ISSUE_CATEGORIES
} from './lib/pilotControlCheck.mjs';

// A realistic getOrderOperationalView()-shaped view object, matching the
// exact contract shape (see docs/product/ORDER_OPERATIONAL_VIEW_CONTRACT.md)
// — used to unit-test buildPilotCase() directly against edge cases the real
// pipeline structurally cannot produce from consistent input (e.g. a
// dangling provenance ref), rather than fighting the real pipeline to
// produce them.
function baseView(overrides = {}) {
  return {
    tenantId: 'org-1',
    orderId: 'order-1',
    orderNumber: 'PO-1',
    summary: { material: 'Cartoncino', quantity: '10', status: 'In attesa', alertLevel: 'ok', daysRemaining: 3 },
    currentObservedSituation: { label: null, severity: 'ok', reasonCodes: [], asOf: null },
    resolvedSupplierOrganization: { legalName: 'ACME Srl' },
    resolvedSupplierContact: null,
    canonicalMaterialLines: [],
    linkedDocuments: [],
    activeCommitments: [],
    supersededCommitments: [],
    activeCommitmentsAvailable: false,
    supersededCommitmentsAvailable: false,
    unresolvedEvidence: [],
    ambiguousEvidence: [],
    unresolvedEvidenceAvailable: false,
    ambiguousEvidenceAvailable: false,
    anomaliesAndAttention: [],
    coverageAndSyncHealth: {
      inboundEmail: { status: 'available', reliability: 1, message: 'ok', limitation: null },
      outboundEmail: { status: 'partial', reliability: 0.5, message: 'ok', limitation: null },
      attachments: { status: 'available', reliability: 1, message: 'ok', limitation: null },
      operationalLinking: { status: 'partial', reliability: 0.8, message: 'ok', limitation: null }
    },
    confidence: null,
    reasonCodes: [],
    evidenceReferences: [],
    safeEvidenceExcerpts: [],
    proposedActions: [],
    ...overrides
  };
}

// A minimal, realistic mock db matching the exact query shapes issued by
// getOrderOperationalView() for one order — same fixture pattern as
// scripts/test-order-operational-view.mjs, reused here to prove the real
// production data-access function is exercised without mutation.
function makeSingleOrderDb({ orderCode = '0013545497', tenantId = 'org-1', orderId = 'order-1' } = {}) {
  const queries = [];
  const db = async (path) => {
    queries.push(path);
    if (path.startsWith('orders?')) {
      return [{
        id: orderId, order_code: orderCode, supplier_name: 'ACME Srl', supplier_id: 'sup-1', supplier_contact_id: null,
        project_code: 'PRJ-1', material: 'Cartoncino', quantity: '10', status: 'In attesa', alert_level: 'warning',
        days_remaining: 3, order_date: '2024-01-01', updated_at: '2024-01-05T10:00:00Z'
      }];
    }
    if (path.startsWith('canonical_operational_lines?')) {
      return [
        { id: 'line-1', entity_kind: 'purchase_order_line', description: 'Item A', item_code: 'A-1', quantity: 10, delivered_quantity: 0, remaining_quantity: 10, unit: 'pcs', required_date: null, due_date: null, status: 'open', confidence: 0.9, needs_review: false, canonical_key: 'CK1', updated_at: '2024-01-06T11:00:00Z' }
      ];
    }
    if (path.startsWith('canonical_line_sources?')) {
      return [{ entity_type: 'purchase_order_line', entity_id: 'line-1', source_email_id: 'se-1', source_document_id: null, source_line_number: 1, observed_values: { description: 'Item A', quantity: 10 } }];
    }
    if (path.startsWith('delivery_notes?')) return [];
    if (path.startsWith('invoices?')) return [];
    if (path.startsWith('documents?')) return [];
    if (path.startsWith('data_source_coverage?')) return [{ source_key: 'inbound_email', label: 'Email in entrata', status: 'available', reliability: 1, message: 'ok', limitation: null }];
    if (path.startsWith('system_health_alerts?')) return [];
    return [];
  };
  return { db, queries, tenantId };
}

async function run() {
  console.log('Test: empty denominators produce null, not misleading percentages');
  {
    assert.strictEqual(ratio(0, 0), null);
    assert.strictEqual(ratio(5, 0), null);
    assert.strictEqual(ratio(0, 5), 0);
    assert.strictEqual(ratio(5, 5), 1);

    const view = baseView({ canonicalMaterialLines: [], linkedDocuments: [] });
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view });
    assert.strictEqual(pc.coverage.evidenceCoverageRatio, null, 'zero canonical lines must yield null, never 0');
    assert.strictEqual(pc.traceability.documentTraceabilityRatio, null, 'zero linked documents must yield null, never 0 or 100%');
    assert.ok(pc.issues.some((i) => i.category === ISSUE_CATEGORIES.SECTION_NOT_EVALUATED));
  }
  console.log('PASS');

  console.log('Test: lines without evidence are counted');
  {
    const view = baseView({
      canonicalMaterialLines: [
        { id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] },
        { id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: [] }
      ],
      evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }],
      safeEvidenceExcerpts: [{ ref: 'E1', excerpt: null }]
    });
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view });
    assert.strictEqual(pc.coverage.canonicalLineCount, 2);
    assert.strictEqual(pc.coverage.linesWithEvidence, 1);
    assert.strictEqual(pc.traceability.linesWithoutProvenance, 1);
    assert.strictEqual(pc.coverage.evidenceCoverageRatio, 0.5);
    assert.ok(pc.issues.some((i) => i.category === ISSUE_CATEGORIES.LINE_WITHOUT_EVIDENCE));
  }
  console.log('PASS');

  console.log('Test: dangling references are detected');
  {
    const view = baseView({
      canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1', 'E99'] }],
      evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
    });
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view });
    assert.strictEqual(pc.internalConsistency.duplicateEvidenceReferences, 0);
    assert.strictEqual(pc.traceability.danglingProvenanceRefs, 1, 'E99 does not resolve in evidenceReferences and must be counted as dangling');
    assert.ok(pc.issues.some((i) => i.category === ISSUE_CATEGORIES.DANGLING_PROVENANCE && i.message.includes('E99')));
  }
  console.log('PASS');

  console.log('Test: multiple lines sharing one evidence source remain distinct');
  {
    const view = baseView({
      canonicalMaterialLines: [
        { id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1', 'E2'] },
        { id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: ['E1', 'E3'] }
      ],
      evidenceReferences: [
        { ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }, // shared source
        { ref: 'E2', kind: 'line_source', sourceEmailId: 'se-1' },
        { ref: 'E3', kind: 'line_source', sourceEmailId: 'se-1' }
      ]
    });
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view });
    assert.strictEqual(pc.coverage.linesWithEvidence, 2, 'both lines must independently count as having evidence');
    assert.strictEqual(pc.traceability.linesWithoutProvenance, 0);
    assert.strictEqual(pc.traceability.danglingProvenanceRefs, 0);
  }
  console.log('PASS');

  console.log('Test: unavailable and evaluated-empty remain different');
  {
    const unavailable = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view: baseView({ unresolvedEvidence: [], unresolvedEvidenceAvailable: false }) });
    const evaluatedEmpty = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view: baseView({ unresolvedEvidence: [], unresolvedEvidenceAvailable: true }) });
    assert.ok(unavailable.coverage.unavailableSections.includes('unresolvedEvidence'));
    assert.strictEqual(unavailable.traceability.unresolvedDataAvailable, false);
    assert.ok(unavailable.issues.some((i) => i.category === ISSUE_CATEGORIES.SECTION_NOT_EVALUATED));

    assert.ok(!evaluatedEmpty.coverage.unavailableSections.includes('unresolvedEvidence'), 'evaluated-empty must not be reported as unavailable');
    assert.strictEqual(evaluatedEmpty.traceability.unresolvedDataAvailable, true);
    assert.ok(!evaluatedEmpty.issues.some((i) => i.category === ISSUE_CATEGORIES.SECTION_NOT_EVALUATED && i.message.includes('unresolvedEvidence')));
  }
  console.log('PASS');

  console.log('Test: quantity/date conflicts are detected only from explicitly observed disagreeing values');
  {
    const view = baseView({
      canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1', 'E2'] }],
      evidenceReferences: [
        { ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' },
        { ref: 'E2', kind: 'line_source', sourceEmailId: 'se-2' }
      ],
      safeEvidenceExcerpts: [
        { ref: 'E1', excerpt: JSON.stringify({ quantity: 10, due_date: '2026-07-18' }) },
        { ref: 'E2', excerpt: JSON.stringify({ quantity: 12, due_date: '2026-07-18' }) }
      ]
    });
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view });
    assert.strictEqual(pc.internalConsistency.quantityConflicts, 1);
    assert.strictEqual(pc.internalConsistency.dateConflicts, 0, 'identical due_date across sources must not be flagged as a conflict');
    assert.ok(pc.issues.some((i) => i.category === ISSUE_CATEGORIES.QUANTITY_CONFLICT));
  }
  console.log('PASS');

  console.log('Test: an overdue order with the unvalidated "ok" placeholder is flagged as OPERATIONAL_STATE_UNEXPLAINED');
  {
    const view = baseView({ summary: { daysRemaining: -5 }, currentObservedSituation: { label: null, severity: 'ok', reasonCodes: [], asOf: null } });
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view });
    assert.strictEqual(pc.internalConsistency.contradictoryOrderStateSignals, 1);
    assert.ok(pc.issues.some((i) => i.category === ISSUE_CATEGORIES.OPERATIONAL_STATE_UNEXPLAINED));

    const genuinelyEvaluated = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view: baseView({ summary: { daysRemaining: -5 }, currentObservedSituation: { label: 'Ritardo confermato', severity: 'critical', reasonCodes: ['order_overdue'], asOf: null } }) });
    assert.strictEqual(genuinelyEvaluated.internalConsistency.contradictoryOrderStateSignals, 0, 'a genuinely computed severity must not be flagged as contradictory');
  }
  console.log('PASS');

  console.log('Test: manual verdict fields remain null and are never auto-populated');
  {
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view: baseView() });
    assert.strictEqual(pc.manualReview.reviewerVerdict, null);
    assert.strictEqual(pc.manualReview.buyerCanDecideWithoutExternalSearch, null);
    assert.strictEqual(pc.manualReview.reviewerNotes, '');
    const notFound = buildPilotCase({ organizationId: 'org-1', orderId: 'order-x', view: null, error: 'not found' });
    assert.strictEqual(notFound.manualReview.reviewerVerdict, null);
  }
  console.log('PASS');

  console.log('Test: missing organizationId fails closed (no database call at all)');
  {
    let called = false;
    const reqDb = async () => { called = true; return []; };
    let thrown = null;
    try {
      await runPilotControlCheck({ organizationId: '', orderId: 'order-1', reqDb });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, 'must throw when organizationId is missing');
    assert.ok(thrown.failedClosed, 'must be explicitly marked as a fail-closed error');
    assert.strictEqual(called, false, 'no database request may be issued before organizationId is validated');
  }
  console.log('PASS');

  console.log('Test: tenant filter is applied to every query issued');
  {
    const { db, queries } = makeSingleOrderDb({ tenantId: 'org-1' });
    await runPilotControlCheck({ organizationId: 'org-1', orderId: 'order-1', reqDb: db });
    assert.ok(queries.length > 0, 'expected at least one query to have been issued');
    for (const q of queries) {
      assert.ok(q.includes('organization_id=eq.org-1'), `query must be tenant-scoped: ${q}`);
    }
  }
  console.log('PASS');

  console.log('Test: no write method can be issued (source-level + runtime)');
  {
    for (const file of ['scripts/lib/pilotControlCheck.mjs', 'scripts/run-pilot-control-check.mjs']) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.ok(!/method:\s*["'](POST|PATCH|PUT|DELETE)["']/.test(source), `${file} must remain fully read-only`);
    }
    const calls = [];
    const reqDb = async (path, options = {}) => { calls.push({ path, method: options.method || 'GET' }); return []; };
    const { db } = makeSingleOrderDb();
    const wrapped = async (path, options) => { calls.push({ path, method: (options && options.method) || 'GET' }); return db(path, options); };
    await runPilotControlCheck({ organizationId: 'org-1', orderId: 'order-1', reqDb: wrapped });
    assert.ok(calls.length > 0);
    assert.ok(calls.every((c) => c.method === 'GET'), 'every issued request must be a GET');
    void reqDb;
  }
  console.log('PASS');

  console.log('Test: no secret or raw credential appears in output');
  {
    process.env.SUPABASE_SERVICE_KEY = 'sb-secret-test-key-should-never-leak';
    const { db } = makeSingleOrderDb();
    const report = await runPilotControlCheck({ organizationId: 'org-1', orderId: 'order-1', reqDb: db });
    const serialized = JSON.stringify(report) + buildMarkdownReport(report) + buildCsvReport(report.pilotCases);
    assert.ok(!serialized.includes('sb-secret-test-key-should-never-leak'));
    assert.ok(!serialized.toLowerCase().includes('authorization'));
    assert.ok(!serialized.toLowerCase().includes('apikey'));
    for (const file of ['scripts/lib/pilotControlCheck.mjs', 'scripts/run-pilot-control-check.mjs']) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.ok(!source.includes('SUPABASE_SERVICE_KEY'), `${file} must never reference the service key directly — it must go through supabaseRequest()`);
    }
  }
  console.log('PASS');

  console.log('Test: the known pilot case (0013545497) can be processed without mutation');
  {
    const { db, queries } = makeSingleOrderDb({ orderCode: KNOWN_PILOT_ORDER_CODE, orderId: 'order-known' });
    const report = await runPilotControlCheck({ organizationId: 'org-1', orderId: 'order-known', reqDb: db });
    assert.strictEqual(report.pilotCases.length, 1);
    const pc = report.pilotCases[0];
    assert.strictEqual(pc.orderCode, KNOWN_PILOT_ORDER_CODE);
    assert.strictEqual(pc.coverage.orderAvailable, true);
    assert.strictEqual(pc.manualReview.reviewerVerdict, null);
    assert.ok(!queries.some((q) => /\?.*method=/i.test(q)), 'sanity: no method leaked into a query string');
  }
  console.log('PASS');

  console.log('Test: selection is deterministic given the same candidate signals');
  {
    const candidates = [
      { id: 'a', orderCode: 'A', lineCount: 5, linesWithEvidence: 5, evidenceRatio: 1, needsReviewLines: 0, overdueOrAttention: false, incompleteOrUnresolved: false },
      { id: 'b', orderCode: 'B', lineCount: 3, linesWithEvidence: 0, evidenceRatio: 0, needsReviewLines: 2, overdueOrAttention: true, incompleteOrUnresolved: true },
      { id: 'c', orderCode: 'C', lineCount: 6, linesWithEvidence: 6, evidenceRatio: 1, needsReviewLines: 0, overdueOrAttention: false, incompleteOrUnresolved: false }
    ];
    const first = selectPilotCandidates(candidates, { limit: 3, knownOrderCode: null });
    const second = selectPilotCandidates(candidates, { limit: 3, knownOrderCode: null });
    assert.deepStrictEqual(first, second, 'selecting from the same candidates twice must produce identical results');
  }
  console.log('PASS');

  console.log('Test: ten-case strata are respected when eligible candidates exist');
  {
    // Each candidate is built to qualify for exactly ONE stratum's filter, so
    // no candidate is accidentally eligible for (and consumed by) more than
    // one stratum's pool before its intended stratum is evaluated.
    function candidate(id, over) {
      return { id, orderCode: `ORD-${id}`, lineCount: 1, linesWithEvidence: 1, evidenceRatio: 0.5, needsReviewLines: 0, overdueOrAttention: false, incompleteOrUnresolved: false, ...over };
    }
    const candidates = [
      // 2 distinct high-evidence only (evidenceRatio>=0.8, lineCount<2 so not also multi-line)
      candidate('he1', { evidenceRatio: 1, lineCount: 1, linesWithEvidence: 1 }),
      candidate('he2', { evidenceRatio: 0.9, lineCount: 1, linesWithEvidence: 1 }),
      // 2 distinct low-evidence only (evidenceRatio<=0.3, lineCount<2)
      candidate('le1', { evidenceRatio: 0, lineCount: 1, linesWithEvidence: 0 }),
      candidate('le2', { evidenceRatio: 0.1, lineCount: 1, linesWithEvidence: 0 }),
      // 2 distinct multi-line only (lineCount>=2, evidenceRatio kept mid-range so it's neither high nor low)
      candidate('ml1', { lineCount: 9, linesWithEvidence: 5, evidenceRatio: 0.5 }),
      candidate('ml2', { lineCount: 7, linesWithEvidence: 4, evidenceRatio: 0.5 }),
      // 2 distinct overdue/attention only (lineCount<2, mid evidenceRatio, not incomplete)
      candidate('oa1', { overdueOrAttention: true, needsReviewLines: 3, lineCount: 1 }),
      candidate('oa2', { overdueOrAttention: true, needsReviewLines: 1, lineCount: 1 }),
      // 2 distinct incomplete/unresolved only (lineCount<2, mid evidenceRatio, not overdue)
      candidate('iu1', { incompleteOrUnresolved: true, needsReviewLines: 2, lineCount: 1, linesWithEvidence: 1 }),
      candidate('iu2', { incompleteOrUnresolved: true, needsReviewLines: 1, lineCount: 1, linesWithEvidence: 1 })
    ];
    const { selections, deficits } = selectPilotCandidates(candidates, { limit: 10, knownOrderCode: null });
    assert.strictEqual(selections.length, 10);
    assert.strictEqual(deficits.length, 0, 'no deficit expected when every stratum has 2 eligible candidates');
    const byStratum = new Map();
    for (const s of selections) byStratum.set(s.stratum, (byStratum.get(s.stratum) || 0) + 1);
    for (const count of byStratum.values()) assert.strictEqual(count, 2, 'each stratum must contribute exactly 2 when eligible candidates exist');
    const ids = selections.map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'the same order must not fill multiple slots when enough distinct candidates exist');
  }
  console.log('PASS');

  console.log('Test: the known pilot order is selected as the first slot when present among candidates');
  {
    const candidates = [
      { id: 'known-id', orderCode: KNOWN_PILOT_ORDER_CODE, lineCount: 1, linesWithEvidence: 1, evidenceRatio: 1, needsReviewLines: 0, overdueOrAttention: false, incompleteOrUnresolved: false },
      { id: 'other-1', orderCode: 'OTHER-1', lineCount: 1, linesWithEvidence: 1, evidenceRatio: 1, needsReviewLines: 0, overdueOrAttention: false, incompleteOrUnresolved: false }
    ];
    const { selections } = selectPilotCandidates(candidates, { limit: 2 });
    assert.strictEqual(selections[0].orderCode, KNOWN_PILOT_ORDER_CODE);
    assert.strictEqual(selections[0].stratum, 'known_pilot_case');
    assert.ok(selections[0].reason.includes('Known pilot case'));
  }
  console.log('PASS');

  console.log('Test: candidate selection queries are tenant-scoped (collectCandidateSignals)');
  {
    const queries = [];
    const reqDb = async (path) => {
      queries.push(path);
      if (path.startsWith('orders?')) return [{ id: 'o1', order_code: 'X', status: 'In attesa', alert_level: 'ok', days_remaining: 3 }];
      if (path.startsWith('canonical_operational_lines?')) return [];
      if (path.startsWith('canonical_line_sources?')) return [];
      return [];
    };
    await collectCandidateSignals({ organizationId: 'org-42', reqDb });
    assert.ok(queries.length >= 3);
    for (const q of queries) assert.ok(q.includes('organization_id=eq.org-42'), `candidate signal query must be tenant-scoped: ${q}`);
  }
  console.log('PASS');

  console.log('Test: generated JSON, Markdown and CSV are deterministic given the same input');
  {
    const view = baseView({
      canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] }],
      evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }],
      safeEvidenceExcerpts: [{ ref: 'E1', excerpt: JSON.stringify({ description: 'A', quantity: 10 }) }]
    });
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', selectionReason: 'test', view });
    const report = buildJsonReport({ organizationId: 'org-1', limit: 1, pilotCases: [pc], deficits: [], generatedAt: '2026-01-01T00:00:00.000Z' });

    const json1 = JSON.stringify(report);
    const json2 = JSON.stringify(buildJsonReport({ organizationId: 'org-1', limit: 1, pilotCases: [pc], deficits: [], generatedAt: '2026-01-01T00:00:00.000Z' }));
    assert.strictEqual(json1, json2);

    const md1 = buildMarkdownReport(report);
    const md2 = buildMarkdownReport(JSON.parse(JSON.stringify(report)));
    assert.strictEqual(md1, md2);

    const csv1 = buildCsvReport(report.pilotCases);
    const csv2 = buildCsvReport(JSON.parse(JSON.stringify(report.pilotCases)));
    assert.strictEqual(csv1, csv2);

    assert.ok(!md1.includes('{"description"'), 'markdown report must never embed raw JSON excerpts');
    assert.ok(csv1.split('\n')[0].includes('pilotCaseId'), 'CSV must have a header row');
  }
  console.log('PASS');

  console.log('All pilot-control-check tests passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
