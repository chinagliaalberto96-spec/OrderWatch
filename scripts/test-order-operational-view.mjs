import assert from 'assert';
import { getOrderOperationalView, toSafeErrorResponse } from '../server/routes/order-operational-view.js';
import { normalizeAppRoute } from '../api/app.js';
import { readFile } from 'fs/promises';

// The exact, live-verified column set for the canonical_operational_lines
// VIEW (checked against information_schema.columns — it has no line_number;
// that column only exists on the underlying per-kind tables it's built from).
const REAL_CANONICAL_OPERATIONAL_LINES_COLUMNS = new Set([
  'id', 'organization_id', 'entity_kind', 'parent_id', 'project_id', 'project_code',
  'order_id', 'order_code', 'quote_id', 'delivery_note_id', 'supplier_id', 'supplier_name',
  'customer_name', 'source_type', 'source_email_id', 'source_document_id', 'item_code',
  'description', 'quantity', 'delivered_quantity', 'remaining_quantity', 'unit',
  'required_date', 'due_date', 'status', 'confidence', 'needs_review', 'canonical_key',
  'identity_key', 'created_at', 'updated_at'
]);

async function run() {
  console.log('Test: authenticated same-tenant access succeeds');
  const queries = [];
  const db = async (path) => {
    queries.push(path);
    // naive router by path start
    if (path.startsWith('orders?')) {
      return [{
        id: 'order-1',
        order_code: 'PO-1',
        supplier_name: 'ACME Srl',
        supplier_id: 'sup-1',
        supplier_contact_id: null,
        project_code: 'PRJ-1',
        material: 'Cartoncino',
        quantity: '10 pcs',
        status: 'open',
        alert_level: 'warning',
        days_remaining: 3,
        order_date: '2024-01-01',
        updated_at: '2024-01-05T10:00:00Z'
      }];
    }
    if (path.startsWith('canonical_operational_lines?')) {
      return [
        { id: 'line-1', entity_kind: 'purchase_order_line', description: 'Item A', item_code: 'A-1', quantity: 10, delivered_quantity: 2, remaining_quantity: 8, unit: 'pcs', required_date: '2024-02-01', due_date: null, status: 'open', confidence: null, needs_review: false, canonical_key: 'CK1', updated_at: '2024-01-06T11:00:00Z' },
        { id: 'line-2', entity_kind: 'purchase_order_line', description: 'Item B', item_code: 'B-1', quantity: 5, delivered_quantity: 0, remaining_quantity: 5, unit: 'pcs', required_date: '2024-02-03', due_date: null, status: 'open', confidence: null, needs_review: false, canonical_key: 'CK2', updated_at: '2024-01-07T11:00:00Z' }
      ];
    }
    if (path.startsWith('canonical_line_sources?')) {
      return [
        {
          entity_type: 'purchase_order_line',
          entity_id: 'line-1',
          source_email_id: 'se-1',
          source_document_id: null,
          source_line_number: 1,
          observed_values: {
            description: 'Item A',
            quantity: 10,
            token: 'should-not-leak',
            path: '/tmp/private',
            nested: { unsafe: true }
          }
        },
        {
          entity_type: 'purchase_order_line',
          entity_id: 'line-2',
          source_email_id: 'se-1',
          source_document_id: null,
          source_line_number: 2,
          observed_values: { description: 'Item B', quantity: 5 }
        }
      ];
    }
    // Fixtures use the REAL raw column names (no aliases) — this is exactly
    // what PostgREST returns once the query no longer uses "column as alias".
    if (path.startsWith('delivery_notes?')) {
      return [{ id: 'ddt-1', ddt_number: 'DDT-2024-001', status: 'confirmed', delivery_date: '2024-01-10', confidence: 0.9, needs_review: false, source_email_id: 'se-2', source_document_id: null, updated_at: '2024-01-10T09:00:00Z' }];
    }
    if (path.startsWith('invoices?')) {
      return [{ id: 'inv-1', invoice_number: 'FT-2024-055', status: 'matched', invoice_date: '2024-01-15', confidence: 0.95, needs_review: false, source_email_id: 'se-3', source_document_id: null, updated_at: '2024-01-15T09:00:00Z' }];
    }
    // quotes is intentionally not queried at all (see order-operational-view.js
    // §5 comment): quotes has no order_id, and no other column deterministically
    // ties a quote to one specific order — verified live and via
    // supplier-orders.js#markQuoteConverted (writes a free-text note, not a
    // foreign key). If the route ever queries 'quotes?' again this mock falls
    // through to the catch-all `return []` below, and the assertion after
    // run() below explicitly fails the test.
    if (path.startsWith('documents?')) {
      // documents has no status/source_document_id/updated_at columns at all
      // (verified live) — omitted here on purpose, not just unselected.
      return [{ id: 'doc-1', document_type: 'DDT', name: 'ddt-scan.pdf', received_at: '2024-01-11T08:00:00Z', confidence: 0.7, needs_review: false, source_email_id: 'se-5', created_at: '2024-01-11T08:00:00Z' }];
    }
    if (path.startsWith('data_source_coverage?')) return [{ source_key: 'email_attachments', label: 'Email attachments', status: 'ok', reliability: 'high', message: null, limitation: null }];
    if (path.startsWith('system_health_alerts?')) {
      // system_health_alerts (view) has no "id" column — only alert_key. One
      // alert matches this order via metadata.orderId, one does not (must be
      // excluded), proving both the id-substitution and the match discipline.
      return [
        { alert_key: 'operational-linking-coverage', severity: 'warning', title: 'Tracciabilita da completare', message: 'msg', target_view: 'settings', metadata: { linked_count: 41, total_count: 56 } },
        { alert_key: 'order-test-match', severity: 'critical', title: 'Match test', message: 'msg', target_view: 'orders', metadata: { orderId: 'order-1' } }
      ];
    }
    return [];
  };

  const out = await getOrderOperationalView('org-1', 'order-1', { supabaseRequestOverride: db });

  // deterministic: call twice
  const out2 = await getOrderOperationalView('org-1', 'order-1', { supabaseRequestOverride: db });
  assert.deepStrictEqual(out, out2, 'Responses must be deterministic for same inputs');

  // coverage mapping check
  assert.ok(out.coverageAndSyncHealth);
  assert.ok(out.coverageAndSyncHealth.attachments, 'Attachments coverage should be present (email_attachments fallback)');
  assert.strictEqual(normalizeAppRoute(['orders', 'order-operational-view']), 'orders');

  assert.strictEqual(out.orderId, 'order-1');
  assert.strictEqual(out.summary.material, 'Cartoncino');
  assert.strictEqual(out.summary.quantity, '10 pcs');
  assert.strictEqual(out.summary.alertLevel, 'warning');
  assert.strictEqual(out.summary.daysRemaining, 3);
  assert.strictEqual(out.currentObservedSituation.asOf, '2024-01-15T09:00:00.000Z');
  assert.ok(Array.isArray(out.canonicalMaterialLines));
  assert.strictEqual(out.canonicalMaterialLines.length, 2);
  assert.ok(Array.isArray(out.evidenceReferences));
  // unresolved/ambiguous commitments truthful unavailable representation
  assert.ok(Array.isArray(out.unresolvedEvidence));
  assert.ok(Array.isArray(out.ambiguousEvidence));
  assert.ok(Array.isArray(out.activeCommitments));
  assert.strictEqual(out.unresolvedEvidenceAvailable, false);
  assert.strictEqual(out.ambiguousEvidenceAvailable, false);
  assert.strictEqual(out.activeCommitmentsAvailable, false);
  // canonical line provenance refs
  const [line1, line2] = out.canonicalMaterialLines;
  assert.ok(Array.isArray(line1.provenanceRefs));
  assert.ok(Array.isArray(line2.provenanceRefs));
  assert.strictEqual(line1.provenanceRefs.length, 1);
  assert.strictEqual(line2.provenanceRefs.length, 1);
  assert.notStrictEqual(line1.provenanceRefs[0], line2.provenanceRefs[0], 'same email with two source lines must produce distinct evidence refs');
  assert.ok(out.evidenceReferences.every((ref) => ref.entityId || ref.kind !== 'line_source'));
  // safeEvidenceExcerpts must be size-limited and JSON primitives only
  for (const e of out.safeEvidenceExcerpts) {
    if (e.excerpt) {
      assert.strictEqual(typeof e.excerpt, 'string');
      const parsed = JSON.parse(e.excerpt);
      assert(!('token' in parsed));
      assert(!('path' in parsed));
      assert(!('nested' in parsed));
      // ensure top-level values are primitives
      for (const v of Object.values(parsed)) {
        assert.ok(['string','number','boolean','object'].includes(typeof v));
      }
    }
  }
  // linkedDocuments: real raw columns correctly mapped to the contracted shape
  // (delivery_note + invoice + document only — quote is never queried, see below)
  assert.strictEqual(out.linkedDocuments.length, 3);
  const ddt = out.linkedDocuments.find((d) => d.kind === 'delivery_note');
  assert.strictEqual(ddt.number, 'DDT-2024-001', 'delivery_note.number must come from the real ddt_number column');
  assert.strictEqual(ddt.receivedAt, '2024-01-10', 'delivery_note.receivedAt must come from the real delivery_date column');
  const invoice = out.linkedDocuments.find((d) => d.kind === 'invoice');
  assert.strictEqual(invoice.number, 'FT-2024-055', 'invoice.number must come from the real invoice_number column');
  assert.strictEqual(invoice.receivedAt, '2024-01-15', 'invoice.receivedAt must come from the real invoice_date column');
  assert.ok(!out.linkedDocuments.some((d) => d.kind === 'quote'), 'quote must never appear in linkedDocuments: no proven order-specific relationship exists');
  const doc = out.linkedDocuments.find((d) => d.kind === 'DDT' && d.number === 'ddt-scan.pdf');
  assert.ok(doc, 'generic document must map document_type -> kind and name -> number');
  assert.strictEqual(doc.receivedAt, '2024-01-11T08:00:00Z', 'document.receivedAt must come from the real received_at column, not created_at');

  // anomaliesAndAttention: system_health_alerts has no "id" column, so the
  // output id must come from alert_key; only the metadata-matching alert
  // (orderId === this order) may appear, never the non-matching coverage one.
  assert.strictEqual(out.anomaliesAndAttention.length, 1);
  assert.strictEqual(out.anomaliesAndAttention[0].id, 'order-test-match', 'anomaly id must be substituted from alert_key, not a nonexistent "id" column');
  assert.strictEqual(out.anomaliesAndAttention[0].alertKey, 'order-test-match');
  assert.ok(!out.anomaliesAndAttention.some((a) => a.alertKey === 'operational-linking-coverage'), 'an alert with no order-matching metadata must not be attached to this order');

  console.log('PASS: authenticated same-tenant');

  console.log('Test: quotes table is never queried (no proven order-specific relationship)');
  {
    assert.ok(!queries.some((q) => q.startsWith('quotes?')), 'quotes must never be queried by this route: quotes has no order_id and no other column deterministically ties it to one order');
  }
  console.log('PASS');

  console.log('Test: system_health_alerts query never selects the nonexistent "id" column');
  {
    const healthQuery = queries.find((q) => q.startsWith('system_health_alerts?'));
    assert.ok(healthQuery, 'expected a system_health_alerts query to have been issued');
    const selectMatch = healthQuery.match(/select=([^&]+)/);
    assert.ok(selectMatch, 'expected a select= clause for system_health_alerts');
    const selectedColumns = selectMatch[1].split(',');
    assert.ok(!selectedColumns.includes('id'), `system_health_alerts has no "id" column: ${healthQuery}`);
    assert.ok(selectedColumns.includes('alert_key'), `system_health_alerts select must include alert_key: ${healthQuery}`);
  }
  console.log('PASS');

  console.log('Test: no query in this route uses SQL-style "column as alias" syntax');
  {
    for (const q of queries) {
      assert.ok(!/ as /i.test(decodeURIComponent(q)), `query must not use SQL alias syntax: ${q}`);
    }
    // The route source itself must not contain the pattern either, beyond comments.
    const source = await readFile(new URL('../server/routes/order-operational-view.js', import.meta.url), 'utf8');
    const codeLines = source.split('\n').filter((line) => !line.trim().startsWith('//'));
    for (const line of codeLines) {
      assert.ok(!/select=[^`]* as /i.test(line), `select= clause must not use "as" aliasing: ${line}`);
    }
  }
  console.log('PASS');

  console.log('Test: delivery_notes/invoices/documents queries use only real, verified columns');
  {
    // quotes deliberately excluded: it is never queried by this route (see
    // the "quotes table is never queried" test above) because quotes has no
    // order_id (or any other column) that deterministically ties it to one
    // order — verified live against information_schema.columns.
    const REAL_COLUMNS = {
      delivery_notes: new Set(['id', 'ddt_number', 'supplier_id', 'supplier_name', 'order_id', 'order_code', 'project_id', 'project_code', 'delivery_date', 'received_date', 'status', 'confidence', 'needs_review', 'source_email_id', 'source_document_id', 'notes', 'created_at', 'updated_at', 'organization_id', 'confirmed_at', 'confirmed_by', 'contact_id']),
      invoices: new Set(['id', 'invoice_number', 'invoice_type', 'supplier_id', 'supplier_name', 'supplier_vat', 'customer_name', 'order_id', 'order_code', 'project_id', 'project_code', 'invoice_date', 'due_date', 'total_amount', 'currency', 'sdi_identifier', 'xml_payload_hash', 'status', 'confidence', 'needs_review', 'source_email_id', 'source_document_id', 'notes', 'created_at', 'updated_at', 'organization_id', 'contact_id', 'canonical_key', 'match_status', 'match_method', 'match_confidence', 'match_candidates']),
      documents: new Set(['id', 'name', 'type', 'supplier_id', 'supplier_name', 'order_id', 'linked_order_code', 'confidence', 'received_at', 'source_email_id', 'created_at', 'filename', 'document_type', 'file_hash', 'extracted_text_hash', 'needs_review', 'metadata', 'organization_id', 'contact_id', 'channel'])
    };
    for (const [table, realColumns] of Object.entries(REAL_COLUMNS)) {
      const q = queries.find((query) => query.startsWith(`${table}?`));
      assert.ok(q, `expected a ${table} query`);
      assert.ok(q.includes(`organization_id=eq.`), `${table} query must be tenant-scoped: ${q}`);
      assert.ok(q.includes(`order_id=eq.`), `${table} query must be filtered by order: ${q}`);
      const selectMatch = q.match(/select=([^&]+)/);
      assert.ok(selectMatch, `expected a select= clause for ${table}`);
      for (const col of selectMatch[1].split(',')) {
        assert.ok(realColumns.has(col), `selected column "${col}" does not exist on ${table}: ${q}`);
      }
    }
  }
  console.log('PASS');

  console.log('Test: canonical_operational_lines query requests only real columns, never line_number');
  {
    const linesQuery = queries.find((q) => q.startsWith('canonical_operational_lines?'));
    assert.ok(linesQuery, 'expected a canonical_operational_lines query to have been issued');
    assert.ok(!linesQuery.includes('line_number'), `query must not reference the nonexistent line_number column: ${linesQuery}`);
    const selectMatch = linesQuery.match(/select=([^&]+)/);
    assert.ok(selectMatch, 'expected a select= clause');
    const selectedColumns = selectMatch[1].split(',');
    for (const col of selectedColumns) {
      assert.ok(REAL_CANONICAL_OPERATIONAL_LINES_COLUMNS.has(col), `selected column "${col}" does not exist on canonical_operational_lines`);
    }
    // Ordering must use real, existing columns only (no line_number-based order).
    const orderMatch = linesQuery.match(/order=([^&]+)/);
    assert.ok(orderMatch, 'expected an order= clause for deterministic line ordering');
    for (const term of orderMatch[1].split(',')) {
      const col = term.split('.')[0];
      assert.ok(REAL_CANONICAL_OPERATIONAL_LINES_COLUMNS.has(col), `order-by column "${col}" does not exist on canonical_operational_lines`);
    }
  }
  console.log('PASS');

  console.log('Test: source_line_number is requested only from canonical_line_sources, never from canonical_operational_lines');
  {
    const linesQuery = queries.find((q) => q.startsWith('canonical_operational_lines?'));
    const sourcesQuery = queries.find((q) => q.startsWith('canonical_line_sources?'));
    assert.ok(!linesQuery.includes('source_line_number'), 'canonical_operational_lines has no source_line_number column');
    assert.ok(sourcesQuery && sourcesQuery.includes('source_line_number'), 'canonical_line_sources is the real source of line-position ordering');
  }
  console.log('PASS');

  console.log('Test: cross-tenant access yields not-found');
  const db2 = async (path) => {
    // simulate orgFilter removes rows
    if (path.startsWith('orders?')) return [];
    return [];
  };
  let thrown = false;
  try {
    await getOrderOperationalView('org-1', 'order-X', { supabaseRequestOverride: db2 });
  } catch (e) {
    thrown = true;
    assert.strictEqual(e.statusCode, 404);
    console.log('PASS: cross-tenant results in 404');
  }
  if (!thrown) throw new Error('Expected 404 for cross-tenant');

  console.log('Test: sensitive fields absent');
  const outStr = JSON.stringify(out);
  assert(!outStr.includes('encrypted_password'));
  console.log('PASS: encrypted_password not in response');

  console.log('Test: an unexpected raw Supabase/PostgreSQL error becomes a sanitized generic response');
  {
    // This is the exact shape of error lib/_supabaseRest.js throws for a
    // failed PostgREST request: no statusCode, and a message carrying the
    // raw SQL error code, column/table names and JSON body verbatim.
    const rawSupabaseError = new Error(
      'Supabase request failed: 400 {"code":"42703","message":"column canonical_operational_lines.line_number does not exist","hint":null,"details":null}'
    );
    const { status, body } = toSafeErrorResponse(rawSupabaseError);
    assert.strictEqual(status, 500);
    assert.deepStrictEqual(body, { error: 'Impossibile caricare la vista operativa' });
    const serialized = JSON.stringify(body);
    for (const forbidden of ['42703', 'line_number', 'canonical_operational_lines', 'does not exist', 'Supabase request failed', 'hint', 'details']) {
      assert.ok(!serialized.includes(forbidden), `sanitized response must not contain "${forbidden}": ${serialized}`);
    }
  }
  console.log('PASS');

  console.log('Test: a genuinely thrown 404 stays a clean, already-safe 404 (not swallowed into 500)');
  {
    const notFound = new Error('Order not found');
    notFound.statusCode = 404;
    const { status, body } = toSafeErrorResponse(notFound);
    assert.strictEqual(status, 404);
    assert.deepStrictEqual(body, { error: 'Order not found' });
  }
  console.log('PASS');

  console.log('Test: a 401-classified error is not downgraded/hidden by the sanitizer');
  {
    // authorizeApiRequest itself returns 401 before getOrderOperationalView is
    // ever called (verified below by source order), but toSafeErrorResponse
    // must not coerce a genuine 401 into 500 if one were ever thrown here.
    const unauthorized = new Error('Sessione mancante. Accedi nuovamente.');
    unauthorized.statusCode = 401;
    const { status } = toSafeErrorResponse(unauthorized);
    assert.strictEqual(status, 401);
  }
  console.log('PASS');

  console.log('Test: authentication happens before any database access (source order)');
  {
    const source = await readFile(new URL('../server/routes/order-operational-view.js', import.meta.url), 'utf8');
    const authIdx = source.indexOf('authorizeApiRequest(request, response');
    const tryIdx = source.indexOf('try {', authIdx);
    assert.ok(authIdx !== -1 && tryIdx !== -1 && authIdx < tryIdx, 'authorizeApiRequest must run before the try block that calls getOrderOperationalView');
  }
  console.log('PASS');

  console.log('Test: no write method is introduced');
  {
    const source = await readFile(new URL('../server/routes/order-operational-view.js', import.meta.url), 'utf8');
    assert.ok(!/method:\s*["'](POST|PATCH|PUT|DELETE)["']/.test(source), 'order-operational-view.js must remain fully read-only');
    assert.ok(!source.includes("request.method !== \"GET\"") || source.includes('405'), 'non-GET methods must still be rejected, not silently allowed');
  }
  console.log('PASS');

  console.log('All tests passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
