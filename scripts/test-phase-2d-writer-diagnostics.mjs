import assert from 'node:assert/strict';
import { extractSafeDiagnostics, toSafeDiagnosticCode } from '../server/lib/projectLinkWriterDiagnostics.js';

console.log('Phase 2D.1B writer contract: safe diagnostic extraction');

// Exact strings from supabase/migrations/20260730210335_enforce_manual_project_link_precedence.sql
// (assert_order_project_link_manual_precedence / assert_line_project_link_manual_precedence).
// Both RAISE EXCEPTION statements set only `USING ERRCODE = '23514'` -- neither sets
// `USING CONSTRAINT = ...` -- so real PostgreSQL will NOT populate `constraint` for
// this error. Detection must work from the message alone.
const ORDER_MANUAL_PRECEDENCE_MESSAGE = 'order project-link manual precedence violation';
const LINE_MANUAL_PRECEDENCE_MESSAGE = 'line project-link manual precedence violation';

console.log('  extracts only allow-listed structural fields');
{
  const diagnostics = extractSafeDiagnostics({
    code: '23505',
    constraint: 'uniq_order_project_links_active',
    table: 'order_project_links',
    schema: 'public',
    routine: '_bt_check_unique',
    message: 'duplicate key value violates unique constraint "uniq_order_project_links_active"',
    detail: 'Key (organization_id, order_id)=(...) already exists.',
    hint: 'some hint',
    stack: 'Error: ...'
  });
  assert.equal(diagnostics.sqlstate, '23505');
  assert.equal(diagnostics.constraint, 'uniq_order_project_links_active');
  assert.equal(diagnostics.table, 'order_project_links');
  assert.equal(diagnostics.schema, 'public');
  assert.equal(diagnostics.routine, '_bt_check_unique');
  assert.equal('message' in diagnostics, false);
  assert.equal('detail' in diagnostics, false);
  assert.equal('hint' in diagnostics, false);
  assert.equal('stack' in diagnostics, false);
}

console.log('  handles missing/null/non-object input safely');
{
  for (const input of [null, undefined, 'a string', 42]) {
    const diagnostics = extractSafeDiagnostics(input);
    assert.equal(diagnostics.sqlstate, null);
    assert.equal(diagnostics.manualPrecedenceMarker, false);
  }
}

console.log('  rejects malformed sqlstate/identifier values instead of leaking them');
{
  const diagnostics = extractSafeDiagnostics({
    code: 'not-a-real-sqlstate',
    constraint: 'DROP TABLE orders; --',
    table: 'ok_table_name'
  });
  assert.equal(diagnostics.sqlstate, null);
  assert.equal(diagnostics.constraint, null);
  assert.equal(diagnostics.table, 'ok_table_name');
}

console.log('  recognizes the exact order-level manual-precedence message from the real migration, with no constraint field present');
{
  const diagnostics = extractSafeDiagnostics({
    code: '23514',
    message: ORDER_MANUAL_PRECEDENCE_MESSAGE
  });
  assert.equal(diagnostics.constraint, null, 'the migration never sets USING CONSTRAINT, so this must be null');
  assert.equal(diagnostics.manualPrecedenceMarker, true);
  assert.equal(toSafeDiagnosticCode(diagnostics), 'MANUAL_PRECEDENCE');
}

console.log('  recognizes the exact line-level manual-precedence message from the real migration, with no constraint field present');
{
  const diagnostics = extractSafeDiagnostics({
    code: '23514',
    message: LINE_MANUAL_PRECEDENCE_MESSAGE
  });
  assert.equal(diagnostics.constraint, null);
  assert.equal(diagnostics.manualPrecedenceMarker, true);
  assert.equal(toSafeDiagnosticCode(diagnostics), 'MANUAL_PRECEDENCE');
}

console.log('  case/whitespace-insensitive match against the exact allow-listed messages, never a broad substring match');
{
  const exactUppercase = extractSafeDiagnostics({ code: '23514', message: `  ${ORDER_MANUAL_PRECEDENCE_MESSAGE.toUpperCase()}  ` });
  assert.equal(exactUppercase.manualPrecedenceMarker, true);

  const notAnExactMatch = extractSafeDiagnostics({
    code: '23514',
    message: `something else mentions ${ORDER_MANUAL_PRECEDENCE_MESSAGE} in passing`
  });
  assert.equal(notAnExactMatch.manualPrecedenceMarker, false, 'a substring occurrence must not match; only an exact message equals');
}

console.log('  a constraint name matching the trigger name alone, without the exact message, is NOT sufficient (no constraint-based detection remains)');
{
  const diagnostics = extractSafeDiagnostics({
    code: '23514',
    constraint: 'trg_order_project_links_manual_precedence'
  });
  assert.equal(diagnostics.manualPrecedenceMarker, false);
}

console.log('  does not classify an unrelated 23514 as manual precedence');
{
  const diagnostics = extractSafeDiagnostics({
    code: '23514',
    constraint: 'order_project_links_state_check',
    message: 'new row for relation "order_project_links" violates check constraint "order_project_links_state_check"'
  });
  assert.equal(diagnostics.manualPrecedenceMarker, false);
  assert.equal(toSafeDiagnosticCode(diagnostics), 'SQLSTATE_23514');
}

console.log('  hostile getters on the error-like input never execute');
{
  let getterInvoked = false;
  const hostile = { code: '23514' };
  Object.defineProperty(hostile, 'message', {
    enumerable: true,
    get() { getterInvoked = true; return ORDER_MANUAL_PRECEDENCE_MESSAGE; }
  });
  const diagnostics = extractSafeDiagnostics(hostile);
  assert.equal(getterInvoked, false, 'the hostile message getter must never be invoked');
  assert.equal(diagnostics.manualPrecedenceMarker, false);
}

console.log('  a Proxy whose trap throws is tolerated, not propagated');
{
  const hostileProxy = new Proxy({ code: '23505' }, {
    getOwnPropertyDescriptor() {
      throw new Error('hostile trap');
    }
  });
  assert.doesNotThrow(() => extractSafeDiagnostics(hostileProxy));
}

console.log('  toSafeDiagnosticCode never emits raw text');
{
  assert.equal(
    toSafeDiagnosticCode(extractSafeDiagnostics({ code: '23503' })),
    'SQLSTATE_23503'
  );
  assert.equal(toSafeDiagnosticCode(null), 'UNKNOWN');
  assert.equal(toSafeDiagnosticCode(extractSafeDiagnostics({})), 'UNKNOWN');
}

console.log('PASS: safe diagnostic extraction redacts and narrowly matches as required');
