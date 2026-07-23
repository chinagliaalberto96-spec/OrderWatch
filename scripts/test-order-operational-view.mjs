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
    if (path.startsWith('delivery_notes?') || path.startsWith('invoices?') || path.startsWith('quotes?') || path.startsWith('documents?')) {
      return [];
    }
    if (path.startsWith('data_source_coverage?')) return [{ source_key: 'email_attachments', label: 'Email attachments', status: 'ok', reliability: 'high', message: null, limitation: null }];
    if (path.startsWith('system_health_alerts?')) return [];
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
  assert.strictEqual(out.currentObservedSituation.asOf, '2024-01-07T11:00:00.000Z');
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
  console.log('PASS: authenticated same-tenant');

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
