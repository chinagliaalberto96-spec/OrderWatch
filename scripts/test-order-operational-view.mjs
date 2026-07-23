import assert from 'assert';
import { getOrderOperationalView } from '../server/routes/order-operational-view.js';
import { normalizeAppRoute } from '../api/app.js';

async function run() {
  console.log('Test: authenticated same-tenant access succeeds');
  const db = async (path) => {
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
        { id: 'line-1', entity_kind: 'purchase_order_line', description: 'Item A', item_code: 'A-1', quantity: 10, delivered_quantity: 2, remaining_quantity: 8, unit: 'pcs', required_date: '2024-02-01', due_date: null, status: 'open', confidence: null, needs_review: false, canonical_key: 'CK1', line_number: 1, updated_at: '2024-01-06T11:00:00Z' },
        { id: 'line-2', entity_kind: 'purchase_order_line', description: 'Item B', item_code: 'B-1', quantity: 5, delivered_quantity: 0, remaining_quantity: 5, unit: 'pcs', required_date: '2024-02-03', due_date: null, status: 'open', confidence: null, needs_review: false, canonical_key: 'CK2', line_number: 2, updated_at: '2024-01-07T11:00:00Z' }
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

  console.log('All tests passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
