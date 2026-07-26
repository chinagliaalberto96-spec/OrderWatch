import assert from 'assert';
import { readFile } from 'fs/promises';
import { buildPilotCase, ISSUE_CATEGORIES } from './lib/pilotControlCheck.mjs';
import { buildDataQualityContract, KNOWN_SEVERITIES, KNOWN_DIMENSIONS, CATEGORY_META, FINDING_SCOPE, metaFor, ORDER_STATUS, KNOWN_ORDER_STATUSES, ORG_WIDE_CATEGORIES } from './lib/dataQualityContract.mjs';

function baseView(overrides = {}) {
  return {
    orderId: 'order-1',
    orderNumber: 'PO-1',
    summary: { daysRemaining: 3 },
    currentObservedSituation: { label: null, severity: 'ok', reasonCodes: [], asOf: null },
    resolvedSupplierOrganization: { legalName: 'ACME Srl' },
    canonicalMaterialLines: [],
    linkedDocuments: [],
    activeCommitmentsAvailable: false,
    supersededCommitmentsAvailable: false,
    unresolvedEvidenceAvailable: false,
    ambiguousEvidenceAvailable: false,
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

async function run() {
  console.log('Test: metrics are deterministic given the same pilotCases');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [
          { id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] },
          { id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: [] }
        ],
        linkedDocuments: [{ id: 'd1', kind: 'delivery_note', number: 'DDT-1' }],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const contractA = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    const contractB = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    assert.strictEqual(JSON.stringify(contractA), JSON.stringify(contractB), 'building the contract twice from the same input must be byte-identical');

    // Determinism must also survive a JSON round-trip of the input (proves
    // no hidden non-serializable state/order dependency).
    const contractC = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: JSON.parse(JSON.stringify([pc])) });
    assert.strictEqual(JSON.stringify(contractA), JSON.stringify(contractC));

    // Finding IDs must also be stable/deterministic across identical rebuilds.
    assert.deepStrictEqual(contractA.findings.map((f) => f.findingId), contractB.findings.map((f) => f.findingId));
  }
  console.log('PASS');

  console.log('Test: no unsupported assumptions are introduced (no confidence/accuracy/health score, fixed severity/dimension vocabulary only)');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: [] }],
        summary: { daysRemaining: -5 }
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    // Check object KEYS only (not prose): the scope.doesNotMeasure disclaimer
    // legitimately contains the word "confidence" to say it does NOT exist —
    // what must never exist is an actual field carrying such a value.
    const forbiddenKeyPattern = /^(confidence|accuracy|score|health(score)?)$/i;
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === 'object') {
        for (const key of Object.keys(node)) {
          assert.ok(!forbiddenKeyPattern.test(key), `contract must never expose a field named "${key}"`);
          walk(node[key]);
        }
      }
    };
    walk(contract);
    for (const finding of contract.findings) {
      assert.ok(KNOWN_SEVERITIES.includes(finding.severity), `severity "${finding.severity}" must come from the fixed vocabulary`);
      assert.ok(KNOWN_DIMENSIONS.includes(finding.dimension), `dimension "${finding.dimension}" must come from the fixed vocabulary`);
      assert.ok(Object.prototype.hasOwnProperty.call(CATEGORY_META, finding.type), `finding type "${finding.type}" must be one of the fixed issue categories`);
      assert.strictEqual(finding.recommendedAction, CATEGORY_META[finding.type].recommendedAction, 'recommendedAction must come only from the fixed per-category lookup, never improvised per finding');
      assert.strictEqual(finding.scope, 'orderwatch_data_quality');
    }
    // Ratios must still follow the same null-safe rule as the underlying metrics.
    assert.ok(contract.qualityIndicators.evidenceCoverage === null || typeof contract.qualityIndicators.evidenceCoverage === 'number');
  }
  console.log('PASS');

  console.log('Test: findings carry the full required contract shape (findingId, organizationId, orderCode, supplierName, affectedDocuments, scope)');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: [] }],
        linkedDocuments: [{ id: 'd1', kind: 'quote', number: 'Q-1' }] // outside the deterministic-link kind set on purpose
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-77', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    assert.ok(contract.findings.length > 0);
    const requiredKeys = ['findingId', 'organizationId', 'orderId', 'orderCode', 'supplierName', 'dimension', 'severity', 'type', 'affectedLines', 'affectedDocuments', 'evidenceRefs', 'description', 'recommendedAction', 'scope'];
    for (const finding of contract.findings) {
      for (const key of requiredKeys) assert.ok(Object.prototype.hasOwnProperty.call(finding, key), `finding is missing required field "${key}"`);
      assert.strictEqual(finding.organizationId, 'org-77');
      assert.strictEqual(finding.orderCode, 'PO-1');
      assert.strictEqual(finding.supplierName, 'ACME Srl');
      assert.strictEqual(finding.scope, FINDING_SCOPE);
      assert.ok(typeof finding.findingId === 'string' && finding.findingId.length > 0);
    }
    // The DOCUMENT_LINK_UNPROVEN finding must carry the actual affected
    // document id — previously computed by pilotControlCheck.mjs but
    // silently dropped before reaching the contract; now forwarded.
    const docFinding = contract.findings.find((f) => f.type === 'DOCUMENT_LINK_UNPROVEN');
    assert.ok(docFinding, 'expected a DOCUMENT_LINK_UNPROVEN finding for the quote-kind document');
    assert.deepStrictEqual(docFinding.affectedDocuments, [{ id: 'd1', kind: 'quote', number: 'Q-1' }], 'affectedDocuments must be a human-readable summary, not a bare id');

    // Finding ids must be unique within one order even when several issues
    // of the same category occur (e.g. multiple unavailable coverage keys).
    const ids = contract.findings.map((f) => f.findingId);
    assert.strictEqual(new Set(ids).size, ids.length, 'findingId must be unique per finding');
  }
  console.log('PASS');

  console.log('Test: organization-level source availability is separated from order-level metrics and is never counted per order');
  {
    const orderA = buildPilotCase({ organizationId: 'org-1', orderId: 'order-a', view: baseView({ orderId: 'order-a', orderNumber: 'PO-A', canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] }], evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }] }) });
    const orderB = buildPilotCase({ organizationId: 'org-1', orderId: 'order-b', view: baseView({ orderId: 'order-b', orderNumber: 'PO-B', canonicalMaterialLines: [{ id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: ['E2'] }], evidenceReferences: [{ ref: 'E2', kind: 'line_source', sourceEmailId: 'se-2' }] }) });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [orderA, orderB] });

    assert.ok(!Object.prototype.hasOwnProperty.call(contract.summary, 'emailsAvailable'));
    assert.ok(!Object.prototype.hasOwnProperty.call(contract.qualityIndicators, 'sourceCoverageComplete'));
    assert.deepStrictEqual(contract.organizationSources, { emailsAvailable: true, attachmentsAvailable: true, sourceCoverageComplete: true });

    // Both orders are individually complete (each has full evidence coverage
    // and no unproven document links) — organization-wide facts must not
    // turn either of them "incomplete".
    assert.strictEqual(contract.qualityIndicators.incompleteOrders.count, 0);
    assert.strictEqual(contract.qualityIndicators.incompleteOrders.totalOrders, 2);
  }
  console.log('PASS');

  console.log('Test: an organization-wide unavailable source does not inflate incompleteOrders');
  {
    const unavailableCoverage = {
      inboundEmail: { status: 'available', reliability: 1, message: 'ok', limitation: null },
      outboundEmail: { status: 'unavailable', reliability: 0, message: 'off', limitation: null }, // org-wide, deliberate config
      attachments: { status: 'available', reliability: 1, message: 'ok', limitation: null },
      operationalLinking: { status: 'available', reliability: 1, message: 'ok', limitation: null }
    };
    const cleanOrder = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        coverageAndSyncHealth: unavailableCoverage,
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] }],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [cleanOrder] });
    assert.strictEqual(contract.organizationSources.sourceCoverageComplete, false, 'the org-wide gap must still be visible in organizationSources');
    assert.strictEqual(contract.qualityIndicators.incompleteOrders.count, 0, 'a fully-linked order must not be marked incomplete just because an org-wide source is off');
  }
  console.log('PASS');

  console.log('Test: missing evidence is correctly detected, with its evaluation denominator');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [
          { id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] },
          { id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: [] }
        ],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    assert.deepStrictEqual(contract.qualityIndicators.missingEvidence, { count: 1, evaluatedLines: 2 });
    const finding = contract.findings.find((f) => f.type === 'LINE_WITHOUT_EVIDENCE');
    assert.ok(finding, 'expected a LINE_WITHOUT_EVIDENCE finding');
    assert.deepStrictEqual(finding.affectedLines, [{ id: 'l2', description: 'B', itemCode: null }], 'affectedLines must be a human-readable summary, not a bare id');
    assert.deepStrictEqual(finding.affectedDocuments, []);
    assert.strictEqual(finding.dimension, 'traceability');
    assert.strictEqual(finding.orderId, 'order-1');
  }
  console.log('PASS');

  console.log('Test: ambiguous data is correctly detected, with its evaluation denominator');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1', 'E2'] }],
        evidenceReferences: [
          { ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' },
          { ref: 'E2', kind: 'line_source', sourceEmailId: 'se-2' }
        ],
        safeEvidenceExcerpts: [
          { ref: 'E1', excerpt: JSON.stringify({ quantity: 10 }) },
          { ref: 'E2', excerpt: JSON.stringify({ quantity: 12 }) }
        ]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    assert.deepStrictEqual(contract.qualityIndicators.ambiguousEvidence, { count: 1, evaluatedLines: 1 });
    const finding = contract.findings.find((f) => f.type === 'QUANTITY_CONFLICT');
    assert.ok(finding);
    assert.strictEqual(finding.dimension, 'missingOrAmbiguous');
    assert.deepStrictEqual(finding.affectedLines, [{ id: 'l1', description: 'A', itemCode: null }]);
    assert.deepStrictEqual(finding.evidenceRefs, ['E1', 'E2']);
  }
  console.log('PASS');

  console.log('Test: an order with no structural issues is not counted as incomplete, and ratios reflect genuinely clean data');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] }],
        linkedDocuments: [{ id: 'd1', kind: 'delivery_note', number: 'DDT-1' }],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    assert.strictEqual(contract.qualityIndicators.incompleteOrders.count, 0);
    assert.strictEqual(contract.qualityIndicators.evidenceCoverage, 1);
    assert.strictEqual(contract.systemIntegrityChecks.documentTraceability, 1);
    assert.deepStrictEqual(contract.systemIntegrityChecks.documentLinkInvariantViolations, { count: 0, evaluatedDocuments: 1 });
    assert.strictEqual(contract.summary.totalOrders, 1);
    assert.strictEqual(contract.summary.linkedEvidence, 1);
    assert.strictEqual(contract.summary.extractedDocuments, 1);
  }
  console.log('PASS');

  console.log('Test: documentTraceability lives under systemIntegrityChecks, not qualityIndicators');
  {
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view: baseView() });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    assert.ok(!Object.prototype.hasOwnProperty.call(contract.qualityIndicators, 'documentTraceability'), 'documentTraceability must not live in qualityIndicators anymore');
    assert.ok(Object.prototype.hasOwnProperty.call(contract.systemIntegrityChecks, 'documentTraceability'));
  }
  console.log('PASS');

  console.log('Test: empty denominators in the aggregate contract yield null, never 0/100%');
  {
    const pc = buildPilotCase({ organizationId: 'org-1', orderId: 'order-1', view: baseView({ canonicalMaterialLines: [], linkedDocuments: [] }) });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    assert.strictEqual(contract.qualityIndicators.evidenceCoverage, null);
    assert.strictEqual(contract.systemIntegrityChecks.documentTraceability, null);
    assert.strictEqual(contract.qualityIndicators.missingEvidence.evaluatedLines, 0);
  }
  console.log('PASS');

  console.log('Test: an order that could not be loaded (orderAvailable:false) is excluded from ratios but still produces an ORDER_LINK_MISSING finding');
  {
    const notFound = buildPilotCase({ organizationId: 'org-1', orderId: 'order-x', view: null, error: 'Order not found under this organization.' });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [notFound] });
    assert.strictEqual(contract.summary.totalOrders, 1);
    assert.strictEqual(contract.summary.extractedDocuments, 0, 'an unavailable order must not contribute to sums as if it had zero (excluded, not zeroed-in)');
    assert.deepStrictEqual(contract.organizationSources, { emailsAvailable: null, attachmentsAvailable: null, sourceCoverageComplete: null }, 'no available pilotCase means org-wide coverage is undetermined, not falsely false');
    const finding = contract.findings.find((f) => f.type === 'ORDER_LINK_MISSING');
    assert.ok(finding);
    assert.strictEqual(finding.severity, 'critical');
    assert.strictEqual(finding.scope, FINDING_SCOPE);
  }
  console.log('PASS');

  console.log('Regression: an issue category with no CATEGORY_META mapping throws, never silently defaults to a low severity');
  {
    assert.throws(() => metaFor('SOME_FUTURE_CATEGORY_NOBODY_MAPPED_YET'), /No CATEGORY_META mapping/);

    // Same guarantee end-to-end through buildDataQualityContract(), using a
    // pilotCase-shaped object with a deliberately unmapped issue category —
    // this must throw loudly during contract generation, not render as "info".
    const pcWithUnknownCategory = {
      pilotCaseId: 'pcc-order-1', organizationId: 'org-1', orderId: 'order-1', orderCode: 'PO-1', supplier: 'ACME Srl',
      coverage: { orderAvailable: true, canonicalLineCount: 0, linesWithEvidence: 0, linkedDocumentCount: 0 },
      internalConsistency: {},
      traceability: { linesWithoutProvenance: 0, documentsWithoutDeterministicOrderLink: 0 },
      systemLimitations: { sourceCoverageComplete: true },
      issues: [{ category: 'NOT_A_REAL_CATEGORY', message: 'unmapped', orderCode: 'PO-1', lineIds: [], evidenceRefs: [] }]
    };
    assert.throws(
      () => buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pcWithUnknownCategory] }),
      /No CATEGORY_META mapping defined for issue category "NOT_A_REAL_CATEGORY"/
    );
  }
  console.log('PASS');

  console.log('Regression: every ISSUE_CATEGORIES entry has a matching CATEGORY_META mapping (prevents a future silent gap)');
  {
    for (const category of Object.values(ISSUE_CATEGORIES)) {
      assert.ok(Object.prototype.hasOwnProperty.call(CATEGORY_META, category), `ISSUE_CATEGORIES.${category} has no CATEGORY_META mapping`);
      assert.doesNotThrow(() => metaFor(category));
    }
    // And CATEGORY_META must not carry any *extra* keys beyond the real categories.
    const realCategories = new Set(Object.values(ISSUE_CATEGORIES));
    for (const key of Object.keys(CATEGORY_META)) {
      assert.ok(realCategories.has(key), `CATEGORY_META has an entry "${key}" that is not a real ISSUE_CATEGORIES value`);
    }
  }
  console.log('PASS');

  console.log('Test: v2.1.0/v2.2.0/v2.3.0 additions are additive at the top level — every field introduced by an earlier version is still present');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] }],
        linkedDocuments: [{ id: 'd1', kind: 'delivery_note', number: 'DDT-1' }],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    for (const key of ['contractVersion', 'generatedAt', 'organizationId', 'scope', 'organizationSources', 'summary', 'qualityIndicators', 'systemIntegrityChecks', 'orders', 'findings']) {
      assert.ok(Object.prototype.hasOwnProperty.call(contract, key), `pre-existing top-level field "${key}" must still be present`);
    }
    assert.ok(Object.prototype.hasOwnProperty.call(contract, 'organizationFindings'), 'the new v2.2.0 "organizationFindings" field must be present');
    assert.strictEqual(contract.contractVersion, '2.3.0');
  }
  console.log('PASS');

  console.log('Test: each evaluated order exposes orderId, orderCode, supplierName, evidenceCoverage{coveredLines,totalLines}, findingCount, findingsSummary, dataQualityStatus');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [
          { id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] },
          { id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: [] }
        ],
        linkedDocuments: [{ id: 'd1', kind: 'delivery_note', number: 'DDT-1' }],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    assert.strictEqual(contract.orders.length, 1);
    const order = contract.orders[0];
    for (const key of ['orderId', 'orderCode', 'supplierName', 'evidenceCoverage', 'findingCount', 'findingsSummary', 'dataQualityStatus']) {
      assert.ok(Object.prototype.hasOwnProperty.call(order, key), `order is missing required field "${key}"`);
    }
    assert.strictEqual(order.orderId, 'order-1');
    assert.strictEqual(order.orderCode, 'PO-1');
    assert.strictEqual(order.supplierName, 'ACME Srl');
    assert.deepStrictEqual(order.evidenceCoverage, { coveredLines: 1, totalLines: 2 });
    // 1 LINE_WITHOUT_EVIDENCE + 4 SECTION_NOT_EVALUATED (the baseView()
    // fixture's four *Available:false sections) = 5 findings for this order.
    assert.strictEqual(order.findingCount, 5);
    assert.deepStrictEqual(order.findingsSummary, { critical: 0, warning: 1, info: 4 });
    assert.strictEqual(order.dataQualityStatus, ORDER_STATUS.INCOMPLETE_EVIDENCE);
    assert.ok(KNOWN_ORDER_STATUSES.includes(order.dataQualityStatus));

    // findingsSummary must always agree with the top-level findings for the
    // same order — no separate counting logic that could drift.
    const ownFindings = contract.findings.filter((f) => f.orderId === order.orderId);
    assert.strictEqual(ownFindings.length, order.findingCount);
    const recomputedSummary = { critical: 0, warning: 0, info: 0 };
    for (const f of ownFindings) recomputedSummary[f.severity] += 1;
    assert.deepStrictEqual(recomputedSummary, order.findingsSummary);
  }
  console.log('PASS');

  console.log('Test: dataQualityStatus covers all 5 structural states correctly (unavailable, not_evaluated, incomplete_evidence, open_findings, complete)');
  {
    const unavailable = buildPilotCase({ organizationId: 'org-1', orderId: 'order-x', view: null, error: 'Order not found under this organization.' });
    const notEvaluated = buildPilotCase({ organizationId: 'org-1', orderId: 'order-ne', view: baseView({ orderId: 'order-ne', orderNumber: 'PO-NE', canonicalMaterialLines: [] }) });
    const incomplete = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-ie', view: baseView({
        orderId: 'order-ie', orderNumber: 'PO-IE',
        canonicalMaterialLines: [
          { id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] },
          { id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: [] }
        ],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    // unresolvedEvidenceAvailable/ambiguousEvidenceAvailable/activeCommitmentsAvailable/
    // supersededCommitmentsAvailable are forced to true here (unlike baseView()'s
    // default false) so these two cases are isolated to exactly the signal
    // each is meant to test (duplicate lines / genuinely clean data), with no
    // incidental SECTION_NOT_EVALUATED findings muddying findingCount.
    const evaluatedSections = { unresolvedEvidenceAvailable: true, ambiguousEvidenceAvailable: true, activeCommitmentsAvailable: true, supersededCommitmentsAvailable: true };
    const openFindings = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-of', view: baseView({
        orderId: 'order-of', orderNumber: 'PO-OF', ...evaluatedSections,
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] }, { id: 'l2', description: 'B', canonicalKey: 'k1', provenanceRefs: ['E1'] }],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const complete = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-c', view: baseView({
        orderId: 'order-c', orderNumber: 'PO-C', ...evaluatedSections,
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] }],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });

    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [unavailable, notEvaluated, incomplete, openFindings, complete] });
    const byId = Object.fromEntries(contract.orders.map((o) => [o.orderId, o]));

    assert.strictEqual(byId['order-x'].dataQualityStatus, ORDER_STATUS.UNAVAILABLE);
    assert.deepStrictEqual(byId['order-x'].evidenceCoverage, { coveredLines: 0, totalLines: 0 });

    assert.strictEqual(byId['order-ne'].dataQualityStatus, ORDER_STATUS.NOT_EVALUATED);
    assert.deepStrictEqual(byId['order-ne'].evidenceCoverage, { coveredLines: 0, totalLines: 0 });

    assert.strictEqual(byId['order-ie'].dataQualityStatus, ORDER_STATUS.INCOMPLETE_EVIDENCE);

    // Two lines sharing the same canonicalKey => a DUPLICATE_LINE finding
    // even though both have evidence — full coverage, but findingCount > 0.
    assert.strictEqual(byId['order-of'].dataQualityStatus, ORDER_STATUS.OPEN_FINDINGS);
    assert.deepStrictEqual(byId['order-of'].evidenceCoverage, { coveredLines: 2, totalLines: 2 });
    assert.ok(byId['order-of'].findingCount > 0);

    assert.strictEqual(byId['order-c'].dataQualityStatus, ORDER_STATUS.COMPLETE);
    assert.strictEqual(byId['order-c'].findingCount, 0);
    assert.deepStrictEqual(byId['order-c'].findingsSummary, { critical: 0, warning: 0, info: 0 });
  }
  console.log('PASS');

  console.log('Regression: duplicate pilotCases are deduplicated by orderId before orders/findings are built');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-dup', view: baseView({
        orderId: 'order-dup', orderNumber: 'PO-DUP',
        canonicalMaterialLines: [
          { id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] },
          { id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: [] }
        ],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc, JSON.parse(JSON.stringify(pc))] });
    assert.strictEqual(contract.summary.totalOrders, 1, 'duplicate pilotCases must not inflate the evaluated order count');
    assert.strictEqual(contract.orders.length, 1, 'contract.orders must contain unique orderId values');
    assert.deepStrictEqual(contract.orders.map((o) => o.orderId), ['order-dup']);
    const findingIds = contract.findings.map((f) => f.findingId);
    assert.strictEqual(new Set(findingIds).size, findingIds.length, 'deduped contract must not emit duplicate findingId values');
    assert.strictEqual(contract.findings.filter((f) => f.orderId === 'order-dup' && f.type === 'LINE_WITHOUT_EVIDENCE').length, 1, 'duplicate candidates must not inflate per-order finding counts');
  }
  console.log('PASS');

  console.log('Regression: SECTION_NOT_EVALUATED-only orders are not_evaluated, not open_findings or complete');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-section-only', view: baseView({
        orderId: 'order-section-only', orderNumber: 'PO-SECTION',
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] }],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
        // baseView intentionally leaves the 4 *Available flags false.
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });
    const order = contract.orders[0];
    assert.ok(contract.findings.length > 0, 'SECTION_NOT_EVALUATED findings must remain visible');
    assert.ok(contract.findings.every((f) => f.type === 'SECTION_NOT_EVALUATED'), 'this fixture must contain only not-evaluated section findings');
    assert.strictEqual(order.findingCount, contract.findings.length);
    assert.strictEqual(order.dataQualityStatus, ORDER_STATUS.NOT_EVALUATED, 'unavailable sections alone mean the assessment is not evaluated');
    assert.notStrictEqual(order.dataQualityStatus, ORDER_STATUS.COMPLETE, 'complete must not be fabricated when required sections are unavailable');
    assert.notStrictEqual(order.dataQualityStatus, ORDER_STATUS.OPEN_FINDINGS, 'SECTION_NOT_EVALUATED alone must not imply an order-specific open problem');
  }
  console.log('PASS');

  console.log('Regression: genuine evidence gaps and conflicts still produce incomplete_evidence/open_findings');
  {
    const evaluatedSections = { unresolvedEvidenceAvailable: true, ambiguousEvidenceAvailable: true, activeCommitmentsAvailable: true, supersededCommitmentsAvailable: true };
    const incomplete = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-real-gap', view: baseView({
        orderId: 'order-real-gap', orderNumber: 'PO-GAP', ...evaluatedSections,
        canonicalMaterialLines: [
          { id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] },
          { id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: [] }
        ],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const conflict = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-real-conflict', view: baseView({
        orderId: 'order-real-conflict', orderNumber: 'PO-CONFLICT', ...evaluatedSections,
        canonicalMaterialLines: [{ id: 'l3', description: 'C', canonicalKey: 'k3', provenanceRefs: ['E1', 'E2'] }],
        evidenceReferences: [
          { ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' },
          { ref: 'E2', kind: 'line_source', sourceEmailId: 'se-2' }
        ],
        safeEvidenceExcerpts: [
          { ref: 'E1', excerpt: JSON.stringify({ quantity: 10 }) },
          { ref: 'E2', excerpt: JSON.stringify({ quantity: 12 }) }
        ]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [incomplete, conflict] });
    const byId = Object.fromEntries(contract.orders.map((o) => [o.orderId, o]));
    assert.strictEqual(byId['order-real-gap'].dataQualityStatus, ORDER_STATUS.INCOMPLETE_EVIDENCE);
    assert.strictEqual(byId['order-real-conflict'].dataQualityStatus, ORDER_STATUS.OPEN_FINDINGS);
  }
  console.log('PASS');

  console.log('Test: v2.2.0 — organization-wide SOURCE_* findings are deduplicated into organizationFindings, never repeated per order in findings[]');
  {
    const unavailableCoverage = {
      inboundEmail: { status: 'available', reliability: 1, message: 'ok', limitation: null },
      outboundEmail: { status: 'unavailable', reliability: 0, message: 'off', limitation: null }, // org-wide, deliberate config
      attachments: { status: 'available', reliability: 1, message: 'ok', limitation: null },
      operationalLinking: { status: 'partial', reliability: 0.5, message: 'partial', limitation: null }
    };
    // unresolvedEvidenceAvailable/etc forced true so these two orders are
    // isolated to exactly the org-wide-coverage signal being tested, with no
    // incidental per-order SECTION_NOT_EVALUATED findings muddying findingCount.
    const evaluatedSections = { unresolvedEvidenceAvailable: true, ambiguousEvidenceAvailable: true, activeCommitmentsAvailable: true, supersededCommitmentsAvailable: true };
    const orderA = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-a', view: baseView({
        orderId: 'order-a', orderNumber: 'PO-A', coverageAndSyncHealth: unavailableCoverage, ...evaluatedSections,
        canonicalMaterialLines: [{ id: 'l1', description: 'A', canonicalKey: 'k1', provenanceRefs: ['E1'] }],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const orderB = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-b', view: baseView({
        orderId: 'order-b', orderNumber: 'PO-B', coverageAndSyncHealth: unavailableCoverage, ...evaluatedSections,
        canonicalMaterialLines: [{ id: 'l2', description: 'B', canonicalKey: 'k2', provenanceRefs: ['E2'] }],
        evidenceReferences: [{ ref: 'E2', kind: 'line_source', sourceEmailId: 'se-2' }]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [orderA, orderB] });

    // Same org-wide fact (outboundEmail unavailable, operationalLinking
    // partial) across 2 orders must appear exactly ONCE each in
    // organizationFindings — not twice, not once per order.
    assert.strictEqual(contract.organizationFindings.length, 2, `expected exactly 2 deduplicated organization findings, got ${contract.organizationFindings.length}`);
    const byType = Object.fromEntries(contract.organizationFindings.map((f) => [f.type, f]));
    assert.ok(byType.SOURCE_UNWATCHED);
    assert.strictEqual(byType.SOURCE_UNWATCHED.sourceKey, 'outboundEmail');
    assert.ok(byType.SOURCE_INCOMPLETE);
    assert.strictEqual(byType.SOURCE_INCOMPLETE.sourceKey, 'operationalLinking');

    // Organization findings are not about any one order: no orderId/
    // orderCode/supplierName/affectedLines/affectedDocuments/evidenceRefs.
    for (const f of contract.organizationFindings) {
      assert.ok(!('orderId' in f), 'an organization finding must not be attributed to a specific order');
      assert.ok(!('orderCode' in f));
      assert.ok(!('supplierName' in f));
      assert.strictEqual(f.organizationId, 'org-1');
      assert.strictEqual(f.scope, FINDING_SCOPE);
      assert.ok(ORG_WIDE_CATEGORIES.has(f.type));
    }

    // The SAME org-wide categories must be completely absent from the
    // per-order findings[] — that is the whole point of the fix.
    assert.ok(!contract.findings.some((f) => ORG_WIDE_CATEGORIES.has(f.type)), 'organization-wide categories must never appear in per-order findings[]');

    // Consequence: an order whose only issues were org-wide coverage gaps,
    // and which is otherwise fully linked, now correctly reads as
    // "complete" — not "open_findings" for a fact that was never about it.
    const orderARow = contract.orders.find((o) => o.orderId === 'order-a');
    assert.strictEqual(orderARow.findingCount, 0, 'org-wide coverage gaps must not count toward this order\'s own findingCount');
    assert.strictEqual(orderARow.dataQualityStatus, ORDER_STATUS.COMPLETE);
  }
  console.log('PASS');

  console.log('Test: v2.2.0 — coverage-related findings carry a structured sourceKey/sectionKey, not prose-only');
  {
    const pc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [], // triggers the "no canonical lines" SECTION_NOT_EVALUATED
        coverageAndSyncHealth: {
          inboundEmail: { status: 'available', reliability: 1, message: 'ok', limitation: null },
          outboundEmail: { status: 'unavailable', reliability: 0, message: 'off', limitation: null },
          attachments: { status: 'available', reliability: 1, message: 'ok', limitation: null },
          operationalLinking: { status: 'available', reliability: 1, message: 'ok', limitation: null }
        }
        // unresolvedEvidenceAvailable/etc default to false in baseView() —
        // exercises the per-order SECTION_NOT_EVALUATED sectionKey too.
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [pc] });

    const orgSourceFinding = contract.organizationFindings.find((f) => f.type === 'SOURCE_UNWATCHED');
    assert.ok(orgSourceFinding);
    assert.strictEqual(orgSourceFinding.sourceKey, 'outboundEmail', 'the affected source must be structured, not only named in prose');

    const sectionFindings = contract.findings.filter((f) => f.type === 'SECTION_NOT_EVALUATED');
    assert.ok(sectionFindings.length >= 5, 'expected the canonicalLines section plus the 4 unavailable-sections findings');
    const sectionKeys = sectionFindings.map((f) => f.sectionKey).sort();
    assert.deepStrictEqual(sectionKeys, ['activeCommitments', 'ambiguousEvidence', 'canonicalLines', 'supersededCommitments', 'unresolvedEvidence']);
  }
  console.log('PASS');

  console.log('Test: v2.2.0 — OPERATIONAL_STATE_UNEXPLAINED recommendedAction is written for a support operator, not a product/engineering decision');
  {
    const action = CATEGORY_META[ISSUE_CATEGORIES.OPERATIONAL_STATE_UNEXPLAINED].recommendedAction;
    assert.ok(/check|verify/i.test(action), 'the action must tell a support operator what to check');
    assert.ok(!/decide whether/i.test(action), 'the action must no longer read as a product/engineering decision prompt');
  }
  console.log('PASS');

  console.log('Test: v2.2.0 — DUPLICATE_LINE and DANGLING_PROVENANCE also carry human-readable line summaries');
  {
    const dupPc = buildPilotCase({
      organizationId: 'org-1', orderId: 'order-1', view: baseView({
        canonicalMaterialLines: [
          { id: 'l1', description: 'Profilato A', itemCode: 'AL-1', canonicalKey: 'dup', provenanceRefs: ['E1'] },
          { id: 'l2', description: 'Profilato A bis', itemCode: 'AL-2', canonicalKey: 'dup', provenanceRefs: ['E1'] }
        ],
        evidenceReferences: [{ ref: 'E1', kind: 'line_source', sourceEmailId: 'se-1' }]
      })
    });
    const contract = buildDataQualityContract({ organizationId: 'org-1', generatedAt: '2026-01-01T00:00:00.000Z', pilotCases: [dupPc] });
    const dupFinding = contract.findings.find((f) => f.type === 'DUPLICATE_LINE');
    assert.ok(dupFinding);
    assert.deepStrictEqual(dupFinding.affectedLines.sort((a, b) => a.id.localeCompare(b.id)), [
      { id: 'l1', description: 'Profilato A', itemCode: 'AL-1' },
      { id: 'l2', description: 'Profilato A bis', itemCode: 'AL-2' }
    ]);
  }
  console.log('PASS');

  console.log('Test: no production routes are modified or referenced by the new contract module');
  {
    const contractSource = await readFile(new URL('./lib/dataQualityContract.mjs', import.meta.url), 'utf8');
    assert.ok(!contractSource.includes('server/routes'), 'dataQualityContract.mjs must not import any production route');
    assert.ok(!contractSource.includes('supabaseRequest'), 'dataQualityContract.mjs must perform no database I/O at all — it is a pure function of already-computed pilotCases');
    assert.ok(!/method:\s*["'](POST|PATCH|PUT|DELETE)["']/.test(contractSource));

    for (const routeFile of ['server/routes/order-operational-view.js', 'api/app.js']) {
      const routeSource = await readFile(new URL(`../${routeFile}`, import.meta.url), 'utf8');
      assert.ok(!routeSource.includes('dataQualityContract'), `${routeFile} must not reference the new pilot-only contract module`);
      assert.ok(!routeSource.includes('pilotControlCheck'), `${routeFile} must not reference the pilot-only CLI module`);
    }
  }
  console.log('PASS');

  console.log('All data-quality-contract tests passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
