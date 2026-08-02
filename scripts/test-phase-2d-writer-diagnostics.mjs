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

console.log('  byte-for-byte exact match against the allow-listed messages: case-sensitive, whitespace-sensitive, never a broad substring match');
{
  const paddedUppercase = extractSafeDiagnostics({ code: '23514', message: `  ${ORDER_MANUAL_PRECEDENCE_MESSAGE.toUpperCase()}  ` });
  assert.equal(paddedUppercase.manualPrecedenceMarker, false, 'case and surrounding whitespace must NOT be normalized away; this is not an exact match');

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

console.log('  toSafeDiagnosticCode is itself safe when called directly with an arbitrary caller-controlled value (not just when pre-sanitized)');

console.log('  (A) ordinary safe own data properties: sqlstate/constraint/manualPrecedenceMarker are retained');
{
  // (A) via a raw driver-shaped object (manualPrecedenceMarker derived from message)
  const raw = { code: '23505', constraint: 'uniq_order_project_links_active' };
  assert.equal(toSafeDiagnosticCode(raw), 'SQLSTATE_23505');
  const rawManual = { code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE };
  assert.equal(toSafeDiagnosticCode(rawManual), 'MANUAL_PRECEDENCE');

  // (A) via an already-sanitized object (manualPrecedenceMarker present directly, no message field)
  const sanitized = extractSafeDiagnostics(rawManual);
  assert.equal('message' in sanitized, false);
  assert.equal(toSafeDiagnosticCode(sanitized), 'MANUAL_PRECEDENCE');
}

console.log('  (B) inherited sqlstate/constraint/manualPrecedenceMarker are ignored');
{
  const proto = { sqlstate: '23505', constraint: 'uniq_order_project_links_active', manualPrecedenceMarker: true };
  const inherited = Object.create(proto);
  assert.equal(toSafeDiagnosticCode(inherited), 'UNKNOWN');
  const extracted = extractSafeDiagnostics(inherited);
  assert.equal(extracted.sqlstate, null);
  assert.equal(extracted.constraint, null);
  assert.equal(extracted.manualPrecedenceMarker, false);
}

console.log('  (C) accessor getters for sqlstate/constraint/manualPrecedenceMarker are never invoked; output stays conservative');
{
  let sqlstateGetterCount = 0;
  let constraintGetterCount = 0;
  let manualMarkerGetterCount = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'sqlstate', { enumerable: true, get() { sqlstateGetterCount += 1; return '23505'; } });
  Object.defineProperty(hostile, 'constraint', { enumerable: true, get() { constraintGetterCount += 1; return 'uniq_order_project_links_active'; } });
  Object.defineProperty(hostile, 'manualPrecedenceMarker', { enumerable: true, get() { manualMarkerGetterCount += 1; return true; } });

  assert.equal(toSafeDiagnosticCode(hostile), 'UNKNOWN');
  const extracted = extractSafeDiagnostics(hostile);
  assert.equal(extracted.sqlstate, null);
  assert.equal(extracted.constraint, null);
  assert.equal(extracted.manualPrecedenceMarker, false);
  assert.equal(sqlstateGetterCount, 0, 'the sqlstate getter must never be invoked');
  assert.equal(constraintGetterCount, 0, 'the constraint getter must never be invoked');
  assert.equal(manualMarkerGetterCount, 0, 'the manualPrecedenceMarker getter must never be invoked');
}

console.log('  (D) a Proxy with throwing/counting traps for get, getPrototypeOf, getOwnPropertyDescriptor, ownKeys, has: all trap counts remain zero, no exception escapes, conservative result returned');
{
  function buildInstrumentedProxy(target = { sqlstate: '23505', constraint: 'uniq_order_project_links_active', manualPrecedenceMarker: true }) {
    const counts = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 };
    const proxy = new Proxy(target, {
      getPrototypeOf(_t) { counts.getPrototypeOf += 1; throw new Error('getPrototypeOf trap fired'); },
      getOwnPropertyDescriptor(_t, _key) { counts.getOwnPropertyDescriptor += 1; throw new Error('getOwnPropertyDescriptor trap fired'); },
      get(_t, _key) { counts.get += 1; throw new Error('get trap fired'); },
      ownKeys(_t) { counts.ownKeys += 1; throw new Error('ownKeys trap fired'); },
      has(_t, _key) { counts.has += 1; throw new Error('has trap fired'); }
    });
    return { proxy, counts };
  }

  const { proxy, counts } = buildInstrumentedProxy();
  let extracted;
  let code;
  assert.doesNotThrow(() => { extracted = extractSafeDiagnostics(proxy); });
  assert.doesNotThrow(() => { code = toSafeDiagnosticCode(proxy); });
  assert.equal(extracted.sqlstate, null);
  assert.equal(extracted.constraint, null);
  assert.equal(extracted.manualPrecedenceMarker, false);
  assert.equal(code, 'UNKNOWN');
  assert.deepEqual(counts, { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 });
}

console.log('  (E) a revoked Proxy is handled safely with no exception escaping, returning the conservative safe result');
{
  const { proxy: revocable, revoke } = Proxy.revocable({ sqlstate: '23505' }, {});
  revoke();
  let extracted;
  let code;
  assert.doesNotThrow(() => { extracted = extractSafeDiagnostics(revocable); });
  assert.doesNotThrow(() => { code = toSafeDiagnosticCode(revocable); });
  assert.equal(extracted.sqlstate, null);
  assert.equal(extracted.manualPrecedenceMarker, false);
  assert.equal(code, 'UNKNOWN');
}

console.log('  (F) already-sanitized diagnostics remain accepted; the code is unchanged');
{
  const sanitizedClaim = extractSafeDiagnostics({ code: '23505', constraint: 'uniq_project_link_operations_org_key' });
  assert.equal(toSafeDiagnosticCode(sanitizedClaim), 'SQLSTATE_23505');
  assert.deepEqual(extractSafeDiagnostics(sanitizedClaim), sanitizedClaim, 'extractSafeDiagnostics must be idempotent on its own output');

  const sanitizedManual = extractSafeDiagnostics({ code: '23514', message: LINE_MANUAL_PRECEDENCE_MESSAGE });
  assert.equal(toSafeDiagnosticCode(sanitizedManual), 'MANUAL_PRECEDENCE');
  assert.deepEqual(extractSafeDiagnostics(sanitizedManual), sanitizedManual, 'extractSafeDiagnostics must be idempotent on its own output, including manualPrecedenceMarker');
}

console.log('Gate 2D.1B.2A correction: manualPrecedenceMarker trust boundary -- an ordinary object can never assert the marker itself, only extractSafeDiagnostics-produced objects retain it');

console.log('  1. raw exact order-precedence message derives marker=true');
{
  const diagnostics = extractSafeDiagnostics({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE });
  assert.equal(diagnostics.manualPrecedenceMarker, true);
}

console.log('  2. raw exact line-precedence message derives marker=true');
{
  const diagnostics = extractSafeDiagnostics({ code: '23514', message: LINE_MANUAL_PRECEDENCE_MESSAGE });
  assert.equal(diagnostics.manualPrecedenceMarker, true);
}

console.log('  3. an arbitrary object with an own manualPrecedenceMarker=true and no message is ignored');
{
  const hostile = { sqlstate: '23514', manualPrecedenceMarker: true };
  const diagnostics = extractSafeDiagnostics(hostile);
  assert.equal(diagnostics.manualPrecedenceMarker, false, 'an ordinary object must never assert the marker itself');
  assert.equal(toSafeDiagnosticCode(hostile), 'SQLSTATE_23514');
}

console.log('  4. sqlstate=23514 + own marker=true remains unmarked');
{
  const diagnostics = extractSafeDiagnostics({ code: '23514', manualPrecedenceMarker: true });
  assert.equal(diagnostics.manualPrecedenceMarker, false);
}

console.log('  5. own marker=true plus an unrelated message remains unmarked');
{
  const diagnostics = extractSafeDiagnostics({
    code: '23514',
    message: 'new row for relation "order_project_links" violates check constraint "order_project_links_state_check"',
    manualPrecedenceMarker: true
  });
  assert.equal(diagnostics.manualPrecedenceMarker, false);
}

console.log('  6. own marker=true plus a near-match message (substring/case/whitespace variant) remains unmarked -- forgery cannot compensate, and a non-exact message never derives the marker either');
{
  const substring = extractSafeDiagnostics({
    code: '23514',
    message: `something else mentions ${ORDER_MANUAL_PRECEDENCE_MESSAGE} in passing`,
    manualPrecedenceMarker: true
  });
  assert.equal(substring.manualPrecedenceMarker, false, 'a substring occurrence must not match, and the forged marker must not compensate');

  const caseWhitespaceVariant = extractSafeDiagnostics({
    code: '23514',
    message: `  ${ORDER_MANUAL_PRECEDENCE_MESSAGE.toUpperCase()}  `,
    manualPrecedenceMarker: true
  });
  assert.equal(caseWhitespaceVariant.manualPrecedenceMarker, false, 'case/whitespace variants are not exact matches, and the forged marker must not compensate either');
}

console.log('  7. a safe diagnostics object returned by extractSafeDiagnostics preserves its marker when normalized again (trusted round-trip)');
{
  const sanitized = extractSafeDiagnostics({ code: '23514', message: LINE_MANUAL_PRECEDENCE_MESSAGE });
  assert.equal(sanitized.manualPrecedenceMarker, true);
  const renormalized = extractSafeDiagnostics(sanitized);
  assert.equal(renormalized, sanitized, 'a genuinely trusted object must be returned as-is, by identity');
  assert.equal(renormalized.manualPrecedenceMarker, true);
}

console.log('  8. a shallow clone of that safe object does not preserve trusted provenance');
{
  const sanitized = extractSafeDiagnostics({ code: '23514', message: LINE_MANUAL_PRECEDENCE_MESSAGE });
  const clone = Object.assign({}, sanitized);
  assert.notEqual(clone, sanitized, 'sanity check: the clone must be a different object identity');
  const reprocessed = extractSafeDiagnostics(clone);
  assert.equal(reprocessed.manualPrecedenceMarker, false, 'a clone is untrusted input; without the original exact message it must not retain the marker');
}

console.log('  9. a spread copy does not preserve trusted provenance');
{
  const sanitized = extractSafeDiagnostics({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE });
  const spread = { ...sanitized };
  assert.notEqual(spread, sanitized);
  const reprocessed = extractSafeDiagnostics(spread);
  assert.equal(reprocessed.manualPrecedenceMarker, false, 'a spread copy is untrusted input; the sanitized shape carries no message to re-derive the marker from');
}

console.log('  10. the caller cannot obtain or mutate the private trust registry');
{
  const moduleExports = await import('../server/lib/projectLinkWriterDiagnostics.js');
  assert.equal('trustedSafeDiagnostics' in moduleExports, false, 'the provenance registry must not be exported');
  const sanitized = extractSafeDiagnostics({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE });
  const keys = Object.keys(sanitized).concat(Object.getOwnPropertySymbols(sanitized).map(String));
  assert.equal(keys.some((k) => /trust/i.test(k)), false, 'no trust-related property leaks onto the result object itself');
}

console.log('  11. frozen result behavior remains unchanged, for both raw and trusted round-trip results');
{
  const raw = extractSafeDiagnostics({ code: '23505', constraint: 'uniq_order_project_links_active' });
  assert.ok(Object.isFrozen(raw));
  const roundTripped = extractSafeDiagnostics(raw);
  assert.ok(Object.isFrozen(roundTripped));
}

console.log('  12. getter/Proxy protections remain unchanged with the provenance check in place');
{
  let getterInvoked = false;
  const hostile = { code: '23514', manualPrecedenceMarker: true };
  Object.defineProperty(hostile, 'message', {
    enumerable: true,
    get() { getterInvoked = true; return ORDER_MANUAL_PRECEDENCE_MESSAGE; }
  });
  const diagnostics = extractSafeDiagnostics(hostile);
  assert.equal(getterInvoked, false, 'the hostile message getter must never be invoked');
  assert.equal(diagnostics.manualPrecedenceMarker, false);

  const hostileProxy = new Proxy({ code: '23514', manualPrecedenceMarker: true }, {
    getOwnPropertyDescriptor() { throw new Error('hostile trap'); }
  });
  assert.doesNotThrow(() => extractSafeDiagnostics(hostileProxy));
  assert.equal(extractSafeDiagnostics(hostileProxy).manualPrecedenceMarker, false);
}

console.log('Gate 2D.1B.2A correction: manualPrecedenceMarker requires byte-for-byte exact equality -- no trim, no case-folding, no substring matching');

console.log('  1. exact order message: marker=true');
{
  assert.equal(extractSafeDiagnostics({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE }).manualPrecedenceMarker, true);
}

console.log('  2. exact line message: marker=true');
{
  assert.equal(extractSafeDiagnostics({ code: '23514', message: LINE_MANUAL_PRECEDENCE_MESSAGE }).manualPrecedenceMarker, true);
}

const EXACT_MATCH_REJECTION_CASES = [
  ['3. leading ASCII space', ' ' + ORDER_MANUAL_PRECEDENCE_MESSAGE],
  ['4. trailing ASCII space', ORDER_MANUAL_PRECEDENCE_MESSAGE + ' '],
  ['5. leading and trailing spaces', ' ' + ORDER_MANUAL_PRECEDENCE_MESSAGE + ' '],
  ['6. uppercase', ORDER_MANUAL_PRECEDENCE_MESSAGE.toUpperCase()],
  ['7. mixed-case variant', 'Order Project-Link Manual Precedence Violation'],
  ['8. newline before', '\n' + ORDER_MANUAL_PRECEDENCE_MESSAGE],
  ['9. newline after', ORDER_MANUAL_PRECEDENCE_MESSAGE + '\n'],
  ['10. carriage return before', '\r' + ORDER_MANUAL_PRECEDENCE_MESSAGE],
  ['11. carriage return after', ORDER_MANUAL_PRECEDENCE_MESSAGE + '\r'],
  ['12. tab before', '\t' + ORDER_MANUAL_PRECEDENCE_MESSAGE],
  ['13. tab after', ORDER_MANUAL_PRECEDENCE_MESSAGE + '\t'],
  ['14. non-breaking space before', ' ' + ORDER_MANUAL_PRECEDENCE_MESSAGE],
  ['15. non-breaking space after', ORDER_MANUAL_PRECEDENCE_MESSAGE + ' '],
  ['16. prefix text', 'x' + ORDER_MANUAL_PRECEDENCE_MESSAGE],
  ['17. suffix text', ORDER_MANUAL_PRECEDENCE_MESSAGE + 'x'],
  ['18. embedded approved message', `something else mentions ${ORDER_MANUAL_PRECEDENCE_MESSAGE} in passing`],
  ['19. altered ASCII hyphen (project_link instead of project-link)', ORDER_MANUAL_PRECEDENCE_MESSAGE.replace('-', '_')],
  ['20. Unicode dash look-alike (U+2010)', ORDER_MANUAL_PRECEDENCE_MESSAGE.replace('-', '‐')]
];

for (const [label, message] of EXACT_MATCH_REJECTION_CASES) {
  console.log(`  ${label}: marker=false`);
  const diagnostics = extractSafeDiagnostics({ code: '23514', message });
  assert.equal(diagnostics.manualPrecedenceMarker, false, `"${label}" must not derive the marker -- only byte-for-byte exact equality may`);
}

console.log('  21. empty string message: marker=false');
{
  assert.equal(extractSafeDiagnostics({ code: '23514', message: '' }).manualPrecedenceMarker, false);
}

console.log('  22. null message: marker=false');
{
  assert.equal(extractSafeDiagnostics({ code: '23514', message: null }).manualPrecedenceMarker, false);
}

console.log('  23. undefined message (absent): marker=false');
{
  assert.equal(extractSafeDiagnostics({ code: '23514' }).manualPrecedenceMarker, false);
}

console.log('  24. inherited message: marker=false, ignored entirely');
{
  const proto = { message: ORDER_MANUAL_PRECEDENCE_MESSAGE };
  const obj = Object.create(proto);
  obj.code = '23514';
  assert.equal(extractSafeDiagnostics(obj).manualPrecedenceMarker, false);
}

console.log('  25. accessor-backed message: getter never invoked, marker=false');
{
  let getterInvoked = false;
  const obj = { code: '23514' };
  Object.defineProperty(obj, 'message', { enumerable: true, get() { getterInvoked = true; return ORDER_MANUAL_PRECEDENCE_MESSAGE; } });
  const diagnostics = extractSafeDiagnostics(obj);
  assert.equal(getterInvoked, false, 'the message getter must never be invoked');
  assert.equal(diagnostics.manualPrecedenceMarker, false);
}

console.log('  26. Proxy-backed message: no trap invoked, marker=false');
{
  const counts = { getOwnPropertyDescriptor: 0, get: 0, getPrototypeOf: 0, ownKeys: 0, has: 0 };
  const target = { code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE };
  const proxy = new Proxy(target, {
    getOwnPropertyDescriptor(_t, _k) { counts.getOwnPropertyDescriptor += 1; throw new Error('trap fired'); },
    get(_t, _k) { counts.get += 1; throw new Error('trap fired'); },
    getPrototypeOf(_t) { counts.getPrototypeOf += 1; throw new Error('trap fired'); },
    ownKeys(_t) { counts.ownKeys += 1; throw new Error('trap fired'); },
    has(_t, _k) { counts.has += 1; throw new Error('trap fired'); }
  });
  let diagnostics;
  assert.doesNotThrow(() => { diagnostics = extractSafeDiagnostics(proxy); });
  assert.equal(diagnostics.manualPrecedenceMarker, false);
  assert.deepEqual(counts, { getOwnPropertyDescriptor: 0, get: 0, getPrototypeOf: 0, ownKeys: 0, has: 0 });
}

console.log('  toSafeDiagnosticCode returns MANUAL_PRECEDENCE only for exact messages or a genuine trusted object derived from one');
{
  assert.equal(toSafeDiagnosticCode({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE }), 'MANUAL_PRECEDENCE');
  assert.equal(toSafeDiagnosticCode({ code: '23514', message: LINE_MANUAL_PRECEDENCE_MESSAGE }), 'MANUAL_PRECEDENCE');
  assert.equal(toSafeDiagnosticCode({ code: '23514', message: `  ${ORDER_MANUAL_PRECEDENCE_MESSAGE.toUpperCase()}  ` }), 'SQLSTATE_23514');
  assert.equal(toSafeDiagnosticCode({ sqlstate: '23514', manualPrecedenceMarker: true }), 'SQLSTATE_23514');

  const genuine = extractSafeDiagnostics({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE });
  assert.equal(toSafeDiagnosticCode(genuine), 'MANUAL_PRECEDENCE');
  const clone = { ...genuine };
  assert.equal(toSafeDiagnosticCode(clone), 'SQLSTATE_23514', 'a clone of a genuine trusted object loses provenance and must not report MANUAL_PRECEDENCE');
}

console.log('PASS: manualPrecedenceMarker requires byte-for-byte exact equality');

console.log('PASS: safe diagnostic extraction redacts and narrowly matches as required');
