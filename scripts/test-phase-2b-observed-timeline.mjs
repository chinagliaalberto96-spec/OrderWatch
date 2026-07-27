import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import {
  OBSERVED_TIMELINE_INITIAL_LIMIT,
  buildObservedPurchaseOrderTimeline
} from '../src/utils/observedPurchaseOrderTimeline.js';

function documentRow(id, overrides = {}) {
  return {
    id,
    kind: 'document',
    number: 'Documento sintetico',
    receivedAt: '2026-07-20T08:00:00.000Z',
    sourceEmailId: `email-${id}`,
    sourceDocumentId: null,
    ...overrides
  };
}

function evidence(ref, kind, id, overrides = {}) {
  return { ref, kind, id, entityId: null, sourceEmailId: null, sourceDocumentId: null, sourceLineNumber: null, ...overrides };
}

function baseFixture() {
  const linkedDocuments = [
    documentRow('internal-doc-a', {
      number: 'Bolla citata solo come testo',
      receivedAt: '2026-07-25T08:30:00.000Z',
      sourceEmailId: 'shared-email'
    }),
    documentRow('internal-doc-b', {
      receivedAt: '2026-07-24T08:30:00.000Z',
      sourceEmailId: 'shared-email'
    }),
    documentRow('internal-doc-c', {
      receivedAt: '2026-07-23T08:30:00.000Z',
      sourceEmailId: 'email-c'
    }),
    documentRow('internal-ddt', {
      kind: 'delivery_note',
      number: 'DDT-FIXTURE',
      receivedAt: '2026-07-22',
      sourceEmailId: 'email-ddt',
      sourceDocumentId: 'internal-raw-ddt'
    }),
    documentRow('internal-invoice', {
      kind: 'invoice',
      number: 'INV-FIXTURE',
      receivedAt: null,
      sourceEmailId: 'email-invoice',
      sourceDocumentId: 'internal-raw-invoice'
    }),
    documentRow('internal-no-evidence', {
      receivedAt: '2026-07-21T08:30:00.000Z',
      sourceEmailId: 'email-no-evidence'
    }),
    documentRow('internal-doc-d', { receivedAt: '2026-07-20T07:00:00.000Z' }),
    documentRow('internal-doc-e', { receivedAt: '2026-07-19T07:00:00.000Z' }),
    documentRow('internal-doc-f', { receivedAt: '2026-07-18T07:00:00.000Z' })
  ];
  const evidenceReferences = [
    evidence('E1', 'document', 'internal-doc-a', { sourceEmailId: 'shared-email' }),
    evidence('E2', 'document', 'internal-doc-b', { sourceEmailId: 'shared-email' }),
    evidence('E3', 'document', 'internal-doc-c', { sourceEmailId: 'email-c' }),
    evidence('E4', 'line_source', null, {
      entityId: 'line-direct',
      sourceEmailId: 'email-c',
      sourceDocumentId: 'internal-doc-c',
      sourceLineNumber: 2
    }),
    evidence('E5', 'line_source', null, {
      entityId: 'line-direct',
      sourceEmailId: 'email-c',
      sourceDocumentId: 'internal-doc-c',
      sourceLineNumber: 3
    }),
    evidence('E6', 'delivery_note', 'internal-ddt', {
      sourceEmailId: 'email-ddt',
      sourceDocumentId: 'internal-raw-ddt'
    }),
    evidence('E7', 'line_source', null, {
      entityId: 'line-email-fallback',
      sourceEmailId: 'email-ddt',
      sourceDocumentId: 'unresolved-raw-document',
      sourceLineNumber: 1
    }),
    evidence('E8', 'invoice', 'internal-invoice', {
      sourceEmailId: 'email-invoice',
      sourceDocumentId: 'internal-raw-invoice'
    }),
    evidence('E9', 'line_source', null, {
      entityId: 'line-ambiguous',
      sourceEmailId: 'shared-email',
      sourceLineNumber: 1
    }),
    evidence('E10', 'document', 'internal-doc-d', { sourceEmailId: 'email-internal-doc-d' }),
    evidence('E11', 'document', 'internal-doc-e', { sourceEmailId: 'email-internal-doc-e' }),
    evidence('E12', 'document', 'internal-doc-f', { sourceEmailId: 'email-internal-doc-f' }),
    evidence('E13', 'document', 'internal-doc-c', { sourceEmailId: 'email-c' })
  ];
  const canonicalMaterialLines = [
    {
      id: 'line-direct',
      description: 'Linea collegata al documento esatto',
      dueDate: '2026-08-02',
      requiredDate: null,
      provenanceRefs: ['E4', 'E5', 'E4']
    },
    {
      id: 'line-email-fallback',
      description: 'Linea collegata tramite email univoca',
      dueDate: null,
      requiredDate: '2026-08-03',
      provenanceRefs: ['E7']
    },
    {
      id: 'line-ambiguous',
      description: 'Testo uguale a Fonte internal-doc-a',
      provenanceRefs: ['E9']
    }
  ];

  return {
    summary: { dueDate: '2026-08-01', requiredDate: null },
    linkedDocuments,
    evidenceReferences,
    canonicalMaterialLines,
    safeEvidenceExcerpts: [{
      ref: 'E4',
      excerpt: '{"due_date":"2099-01-01","required_date":"2099-02-01"}'
    }]
  };
}

console.log('Test: one event is retained per exact linked-document row, including shared-email documents');
{
  const model = buildObservedPurchaseOrderTimeline(baseFixture());
  assert.equal(model.observedEvents.length, 7);
  assert.equal(model.undatedEvents.length, 1);
  assert.equal(new Set(model.observedEvents.map((event) => event.documentId)).size, 7);
  assert.ok(model.observedEvents.some((event) => event.documentId === 'internal-doc-a'));
  assert.ok(model.observedEvents.some((event) => event.documentId === 'internal-doc-b'));
}
console.log('PASS');

console.log('Test: exact native evidence is mandatory and invalid dates move to the undated block');
{
  const model = buildObservedPurchaseOrderTimeline(baseFixture());
  assert.ok(!model.observedEvents.some((event) => event.documentId === 'internal-no-evidence'));
  assert.deepEqual(model.undatedEvents.map((event) => event.documentId), ['internal-invoice']);
  assert.equal(model.undatedEvents[0].primaryEvidenceRef, 'E8');
}
console.log('PASS');

console.log('Test: line association uses exact raw-document identity, then only an unambiguous email fallback');
{
  const model = buildObservedPurchaseOrderTimeline(baseFixture());
  const direct = model.observedEvents.find((event) => event.documentId === 'internal-doc-c');
  const fallback = model.observedEvents.find((event) => event.documentId === 'internal-ddt');
  const sharedA = model.observedEvents.find((event) => event.documentId === 'internal-doc-a');
  const sharedB = model.observedEvents.find((event) => event.documentId === 'internal-doc-b');

  assert.deepEqual(direct.associatedLines.map((line) => line.id), ['line-direct']);
  assert.deepEqual(direct.secondaryEvidenceRefs, ['E4', 'E5', 'E13']);
  assert.deepEqual(fallback.associatedLines.map((line) => line.id), ['line-email-fallback']);
  assert.deepEqual(sharedA.associatedLines, []);
  assert.deepEqual(sharedB.associatedLines, []);
}
console.log('PASS');

console.log('Test: literal document number never changes the structured document kind or date kind');
{
  const event = buildObservedPurchaseOrderTimeline(baseFixture()).observedEvents
    .find((row) => row.documentId === 'internal-doc-a');
  assert.equal(event.documentNumber, 'Bolla citata solo come testo');
  assert.equal(event.documentKind, 'document');
  assert.equal(event.dateKind, 'timestamp');
}
console.log('PASS');

console.log('Test: observed ordering and expansion limit are deterministic');
{
  const first = buildObservedPurchaseOrderTimeline(baseFixture());
  const second = buildObservedPurchaseOrderTimeline(baseFixture());
  assert.deepEqual(first, second);
  assert.equal(OBSERVED_TIMELINE_INITIAL_LIMIT, 5);
  assert.deepEqual(
    first.observedEvents.slice(0, 3).map((event) => event.documentId),
    ['internal-doc-a', 'internal-doc-b', 'internal-doc-c']
  );
}
console.log('PASS');

console.log('Test: commitments remain separate, preserve their level, and ignore excerpt dates');
{
  const model = buildObservedPurchaseOrderTimeline(baseFixture());
  assert.deepEqual(
    model.commitments.map((row) => [row.level, row.field, row.value]),
    [
      ['order', 'dueDate', '2026-08-01'],
      ['line', 'dueDate', '2026-08-02'],
      ['line', 'requiredDate', '2026-08-03']
    ]
  );
  assert.ok(!JSON.stringify(model.commitments).includes('2099-'));
  assert.ok(model.commitments.every((row) => !('completed' in row) && !('evidenceRef' in row)));
}
console.log('PASS');

console.log('Test: empty data produces an explicit empty model');
{
  const model = buildObservedPurchaseOrderTimeline({});
  assert.equal(model.hasContent, false);
  assert.deepEqual(model.observedEvents, []);
  assert.deepEqual(model.undatedEvents, []);
  assert.deepEqual(model.commitments, []);
}
console.log('PASS');

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: ObservedPurchaseOrderTimeline } = await vite.ssrLoadModule('/src/components/ObservedPurchaseOrderTimeline.jsx');

  console.log('Test: UI renders exact evidence anchors, explicit precision, undated observations and deterministic expansion');
  {
    const html = renderToStaticMarkup(h(ObservedPurchaseOrderTimeline, { data: baseFixture() }));
    assert.ok(html.includes('Cronologia osservata dell&#x27;ordine'));
    assert.ok(html.includes('Osservato da OrderWatch il'));
    assert.ok(html.includes('Data del documento:'));
    assert.ok(html.includes('Eventi senza data verificabile'));
    assert.ok(html.includes('Data non verificabile'));
    assert.ok(html.includes('+2 altri eventi'));
    assert.ok(html.includes('href="#evidence-E3"'));
    assert.ok(html.includes('href="#evidence-E4"'));
    assert.ok(html.includes('Date attese e richieste'));
    assert.ok(html.includes('Sono impegni registrati, non eventi già avvenuti.'));
  }
  console.log('PASS');

  console.log('Test: UI never renders internal document, email, line or source identifiers');
  {
    const html = renderToStaticMarkup(h(ObservedPurchaseOrderTimeline, { data: baseFixture() }));
    for (const secretIdentity of [
      'internal-doc-a',
      'internal-doc-b',
      'internal-doc-c',
      'internal-ddt',
      'internal-invoice',
      'shared-email',
      'line-direct',
      'unresolved-raw-document'
    ]) {
      assert.ok(!html.includes(secretIdentity), `must not expose ${secretIdentity}`);
    }
  }
  console.log('PASS');

  console.log('Test: empty UI is explicit and does not render blank chronology');
  {
    const html = renderToStaticMarkup(h(ObservedPurchaseOrderTimeline, { data: {} }));
    assert.ok(html.includes('Nessun evento osservato per questo ordine.'));
  }
  console.log('PASS');
} finally {
  await vite.close();
}

console.log('Test: Phase 2B.1 adds no request, endpoint, adapter or database access');
{
  const componentSource = await readFile(
    new URL('../src/components/ObservedPurchaseOrderTimeline.jsx', import.meta.url),
    'utf8'
  );
  const utilitySource = await readFile(
    new URL('../src/utils/observedPurchaseOrderTimeline.js', import.meta.url),
    'utf8'
  );
  const operationalViewSource = await readFile(
    new URL('../src/components/OrderOperationalView.jsx', import.meta.url),
    'utf8'
  );
  const addedSource = `${componentSource}\n${utilitySource}`;
  assert.ok(!/\bfetch\s*\(|apiAdapter|getOrderOperationalView|supabase|imap|smtp/i.test(addedSource));
  assert.equal((operationalViewSource.match(/<ObservedPurchaseOrderTimeline data=\{d\} \/>/g) || []).length, 1);
}
console.log('PASS');

console.log('All Phase 2B.1 observed-timeline tests passed.');
