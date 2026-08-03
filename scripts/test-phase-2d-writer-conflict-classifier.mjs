import assert from 'node:assert/strict';
import { WRITER_OUTCOME } from '../server/lib/projectLinkWriterResult.js';
import { extractSafeDiagnostics } from '../server/lib/projectLinkWriterDiagnostics.js';
import {
  classifySqlError,
  RETRY_POLICY,
  LOG_SEVERITY,
  OPERATION_PHASE
} from '../server/lib/projectLinkWriterConflictClassifier.js';

console.log('Phase 2D.1B writer contract: conflict classifier');

const ORDER_MANUAL_PRECEDENCE_MESSAGE = 'order project-link manual precedence violation';
const LEDGER_CLAIM_KEY_CONSTRAINT = 'uniq_project_link_operations_org_key';
const ORDER_ACTIVE_LINK_CONSTRAINT = 'uniq_order_project_links_active';
const LINE_ACTIVE_LINK_CONSTRAINT = 'uniq_line_project_links_active';

function classifyRaw(errorLike, extra = {}) {
  return classifySqlError({ diagnostics: extractSafeDiagnostics(errorLike), ...extra });
}

console.log('  1. 23505 + uniq_project_link_operations_org_key + CLAIM: claim-key conflict, reread+idempotency lookup required');
{
  const policy = classifyRaw(
    { code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT },
    { operationPhase: OPERATION_PHASE.CLAIM }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE);
  assert.equal(policy.rereadRequired, true);
  assert.equal(policy.idempotencyLookupRequired, true);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
  assert.equal(policy.safeDiagnosticCode, 'SQLSTATE_23505');
  assert.equal(policy.retryPolicy.maxTotalAttempts, 1);
  assert.equal(policy.retryPolicy.maxRetries, 0);
}

console.log('  2. same ledger constraint with an inconsistent phase (CANONICAL_MUTATION): not silently classified as a known race');
{
  const policy = classifyRaw(
    { code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT },
    { operationPhase: OPERATION_PHASE.CANONICAL_MUTATION }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
}

console.log('  3. same ledger constraint with a missing phase: not silently classified as a known race');
{
  const policy = classifyRaw({ code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
}

console.log('  4. 23505 + uniq_order_project_links_active + CANONICAL_MUTATION: stale canonical-link race, not an idempotency conflict');
{
  const policy = classifyRaw(
    { code: '23505', constraint: ORDER_ACTIVE_LINK_CONSTRAINT },
    { operationPhase: OPERATION_PHASE.CANONICAL_MUTATION }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.CONFLICT_STALE_STATE);
  assert.equal(policy.rereadRequired, true);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
  assert.deepEqual(policy.retryPolicy, RETRY_POLICY.SQLSTATE_55000);
}

console.log('  5. 23505 + uniq_line_project_links_active + CANONICAL_MUTATION: same treatment as the ORDER active-link constraint');
{
  const policy = classifyRaw(
    { code: '23505', constraint: LINE_ACTIVE_LINK_CONSTRAINT },
    { operationPhase: OPERATION_PHASE.CANONICAL_MUTATION }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.CONFLICT_STALE_STATE);
  assert.equal(policy.rereadRequired, true);
  assert.equal(policy.blindRetryAllowed, false);
}

console.log('  6. active-link index with an inconsistent phase (CLAIM): not silently classified as a known race');
{
  const policy = classifyRaw(
    { code: '23505', constraint: ORDER_ACTIVE_LINK_CONSTRAINT },
    { operationPhase: OPERATION_PHASE.CLAIM }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
}

console.log('  7. unknown 23505 constraint: internal failure, never a known race');
{
  const policy = classifyRaw(
    { code: '23505', constraint: 'some_other_unique_constraint' },
    { operationPhase: OPERATION_PHASE.CLAIM }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
}

console.log('  8. missing 23505 constraint entirely: internal failure, never a known race');
{
  const policy = classifyRaw({ code: '23505' }, { operationPhase: OPERATION_PHASE.CLAIM });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
}

console.log('  9. 55000: stale-state conflict, reread required, no blind retry -- unchanged');
{
  const policy = classifyRaw({ code: '55000', message: 'closed order_project_links are immutable' });
  assert.equal(policy.classification, WRITER_OUTCOME.CONFLICT_STALE_STATE);
  assert.equal(policy.rereadRequired, true);
  assert.equal(policy.blindRetryAllowed, false);
  assert.deepEqual(policy.retryPolicy, RETRY_POLICY.SQLSTATE_55000);
}

console.log('  10. ambiguous commit still requires idempotency lookup and never implies a direct ledger write');
{
  const policy = classifySqlError({
    diagnostics: extractSafeDiagnostics({ code: '08006' }),
    ambiguousCommit: true
  });
  assert.equal(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT);
  assert.equal(policy.idempotencyLookupRequired, true);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
  assert.deepEqual(policy.retryPolicy, RETRY_POLICY.AMBIGUOUS_COMMIT);
  // Documentation-level guarantee: the policy's own note must describe this
  // as requiring a lookup, and must not describe writing an AMBIGUOUS
  // ledger status.
  assert.match(policy.retryPolicy.note, /idempotency lookup/i);
  assert.match(policy.retryPolicy.note, /never authorizes writing.*AMBIGUOUS/is);
}

console.log('  the classifier uses diagnostics.constraint, not a duplicate top-level constraint argument');
{
  const withDiagnosticsConstraint = classifySqlError({
    diagnostics: { sqlstate: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT },
    operationPhase: OPERATION_PHASE.CLAIM
  });
  assert.equal(withDiagnosticsConstraint.classification, WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE);

  // A stray top-level "constraint" argument (not inside diagnostics) must
  // have no effect at all -- the function signature does not declare it,
  // so it is simply ignored, and classification must still fall through to
  // the unknown-constraint fallback since diagnostics.constraint is absent.
  const withStrayTopLevelArg = classifySqlError({
    diagnostics: { sqlstate: '23505' },
    constraint: LEDGER_CLAIM_KEY_CONSTRAINT,
    operationPhase: OPERATION_PHASE.CLAIM
  });
  assert.equal(withStrayTopLevelArg.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  23514 manual precedence (exact migration message): blocked, manual review required, never retried');
{
  const policy = classifyRaw({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE });
  assert.equal(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.equal(policy.manualReviewRequired, true);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
  assert.equal(policy.retryPolicy.maxTotalAttempts, 1);
  assert.equal(policy.retryPolicy.maxRetries, 0);
  assert.equal(policy.safeDiagnosticCode, 'MANUAL_PRECEDENCE');
}

console.log('  23514 unrelated (e.g. state-check violation): internal failure, not misclassified as precedence');
{
  const policy = classifyRaw({ code: '23514', constraint: 'order_project_links_state_check' });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(policy.manualReviewRequired, false);
}

console.log('  23503 + CLAIM: invalid parent/tenant reference -- the claim insert itself was rejected before any operation row exists');
{
  const policy = classifyRaw(
    { code: '23503', constraint: 'fk_order_project_links_project_tenant' },
    { operationPhase: OPERATION_PHASE.CLAIM }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
  assert.equal(policy.blindRetryAllowed, false);
}

console.log('  23503 + CANONICAL_MUTATION: internal failure, never mislabeled as a parent/tenant rejection (a claimed row already exists at this phase)');
{
  const policy = classifyRaw(
    { code: '23503', constraint: 'fk_order_project_links_project_tenant' },
    { operationPhase: OPERATION_PHASE.CANONICAL_MUTATION }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.notEqual(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
  assert.equal(policy.blindRetryAllowed, false);
}

console.log('  23503 + TERMINAL_UPDATE: internal failure, never mislabeled as a parent/tenant rejection');
{
  const policy = classifyRaw(
    { code: '23503', constraint: 'fk_order_project_links_project_tenant' },
    { operationPhase: OPERATION_PHASE.TERMINAL_UPDATE }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.notEqual(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
}

console.log('  23503 + missing operationPhase: fails closed to internal failure, never assumed to be CLAIM');
{
  const policy = classifyRaw({ code: '23503', constraint: 'fk_order_project_links_project_tenant' });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.notEqual(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
}

console.log('  23503 + malformed/unrecognized operationPhase: fails closed to internal failure');
{
  const policy = classifyRaw(
    { code: '23503', constraint: 'fk_order_project_links_project_tenant' },
    { operationPhase: 'NOT_A_REAL_PHASE' }
  );
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.notEqual(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
}

console.log('  23503 + an inherited operationPhase value cannot affect classification');
{
  const proto = { operationPhase: OPERATION_PHASE.CLAIM };
  const optionsWithInheritedPhase = Object.create(proto);
  optionsWithInheritedPhase.diagnostics = { code: '23503', constraint: 'fk_order_project_links_project_tenant' };
  const policy = classifySqlError(optionsWithInheritedPhase);
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.notEqual(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
}

console.log('  23503 + accessor-backed diagnostics: getter never invoked, fails closed to internal failure');
{
  let sqlstateGetterCount = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'sqlstate', { enumerable: true, get() { sqlstateGetterCount += 1; return '23503'; } });
  const policy = classifySqlError({ diagnostics: hostile, operationPhase: OPERATION_PHASE.CLAIM });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(sqlstateGetterCount, 0, 'the sqlstate getter must never be invoked');
}

console.log('  23503 + Proxy diagnostics: no trap invoked, fails closed to internal failure');
{
  const counts = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 };
  const proxy = new Proxy({ sqlstate: '23503', constraint: 'fk_order_project_links_project_tenant' }, {
    getPrototypeOf(_t) { counts.getPrototypeOf += 1; throw new Error('trap fired'); },
    getOwnPropertyDescriptor(_t, _k) { counts.getOwnPropertyDescriptor += 1; throw new Error('trap fired'); },
    get(_t, _k) { counts.get += 1; throw new Error('trap fired'); },
    ownKeys(_t) { counts.ownKeys += 1; throw new Error('trap fired'); },
    has(_t, _k) { counts.has += 1; throw new Error('trap fired'); }
  });
  let policy;
  assert.doesNotThrow(() => { policy = classifySqlError({ diagnostics: proxy, operationPhase: OPERATION_PHASE.CLAIM }); });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.deepEqual(counts, { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 });
}

console.log('  42501: forbidden');
{
  const policy = classifyRaw({ code: '42501' });
  assert.equal(policy.classification, WRITER_OUTCOME.FORBIDDEN);
}

console.log('  40001 and 40P01: retryable full-transaction failure');
{
  const serialization = classifyRaw({ code: '40001' });
  assert.equal(serialization.classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);
  assert.equal(serialization.fullTransactionRetryAllowed, true);
  assert.equal(serialization.retryPolicy.maxTotalAttempts, 3);
  assert.equal(serialization.retryPolicy.maxRetries, 2);

  const deadlock = classifyRaw({ code: '40P01' });
  assert.equal(deadlock.classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);
  assert.equal(deadlock.retryPolicy.maxTotalAttempts, 3);
}

console.log('  55P03: bounded retryable contention, dedicated policy key');
{
  const policy = classifyRaw({ code: '55P03' });
  assert.equal(policy.classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);
  assert.equal(policy.fullTransactionRetryAllowed, true);
  assert.equal(policy.retryPolicy.maxTotalAttempts, 2);
  assert.deepEqual(policy.retryPolicy, RETRY_POLICY.SQLSTATE_55P03);
}

console.log('  57014 has its own dedicated policy, distinct from SQLSTATE_55P03');
{
  assert.notEqual(RETRY_POLICY.SQLSTATE_57014, RETRY_POLICY.SQLSTATE_55P03);
  assert.ok('SQLSTATE_57014' in RETRY_POLICY);
}

console.log('  57014 defaults to ambiguous commit unless commitInFlight is explicitly false');
{
  const unknownTiming = classifyRaw({ code: '57014' });
  assert.equal(unknownTiming.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT);
  assert.equal(unknownTiming.idempotencyLookupRequired, true);
  assert.equal(unknownTiming.blindRetryAllowed, false);
  assert.deepEqual(unknownTiming.retryPolicy, RETRY_POLICY.AMBIGUOUS_COMMIT);

  const duringCommit = classifyRaw({ code: '57014' }, { commitInFlight: true });
  assert.equal(duringCommit.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT);
  assert.deepEqual(duringCommit.retryPolicy, RETRY_POLICY.AMBIGUOUS_COMMIT);

  const beforeCommit = classifyRaw({ code: '57014' }, { commitInFlight: false });
  assert.equal(beforeCommit.classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);
  assert.equal(beforeCommit.fullTransactionRetryAllowed, true);
  assert.deepEqual(beforeCommit.retryPolicy, RETRY_POLICY.SQLSTATE_57014);
  assert.notDeepEqual(beforeCommit.retryPolicy, RETRY_POLICY.SQLSTATE_55P03);
}

console.log('  explicit ambiguousCommit flag always wins, regardless of sqlstate');
{
  const policy = classifySqlError({
    diagnostics: extractSafeDiagnostics({ code: '08006' }),
    ambiguousCommit: true
  });
  assert.equal(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT);
  assert.equal(policy.idempotencyLookupRequired, true);
  assert.equal(policy.retryPolicy.requiresIdempotencyLookup, true);
}

console.log('  unknown/unmapped sqlstate defaults to internal failure, never silently retryable');
{
  const policy = classifyRaw({ code: '99999' });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
}

console.log('  log severities are populated and sensible');
{
  assert.equal(classifyRaw({ code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, { operationPhase: OPERATION_PHASE.CLAIM }).logSeverity, LOG_SEVERITY.WARN);
  assert.equal(classifyRaw({ code: '42501' }).logSeverity, LOG_SEVERITY.ERROR);
}

console.log('  OPERATION_PHASE is a closed, frozen enum');
{
  assert.deepEqual(Object.keys(OPERATION_PHASE).sort(), ['CANONICAL_MUTATION', 'CLAIM', 'TERMINAL_UPDATE']);
  assert.ok(Object.isFrozen(OPERATION_PHASE));
}

console.log('  RETRY_POLICY table exposes explicit maxTotalAttempts/maxRetries and is not mutable');
{
  assert.equal(RETRY_POLICY.SQLSTATE_23505.maxTotalAttempts, 1);
  assert.equal(RETRY_POLICY.SQLSTATE_23505.maxRetries, 0);
  assert.equal(RETRY_POLICY.SQLSTATE_55000.maxTotalAttempts, 1);
  assert.equal(RETRY_POLICY.MANUAL_PRECEDENCE_23514.maxTotalAttempts, 1);
  assert.equal(RETRY_POLICY.AMBIGUOUS_COMMIT.maxTotalAttempts, 1);
  assert.equal(RETRY_POLICY.SQLSTATE_40001.maxTotalAttempts, 3);
  assert.equal(RETRY_POLICY.SQLSTATE_40001.maxRetries, 2);
  assert.equal(RETRY_POLICY.SQLSTATE_40P01.maxTotalAttempts, 3);
  assert.equal(RETRY_POLICY.SQLSTATE_55P03.maxTotalAttempts, 2);
  assert.equal(RETRY_POLICY.SQLSTATE_57014.maxTotalAttempts, 2);
  assert.equal(RETRY_POLICY.PRE_BEGIN_TRANSPORT_FAILURE.maxTotalAttempts, 3);
  assert.ok(Object.isFrozen(RETRY_POLICY));
  assert.throws(() => { RETRY_POLICY.SQLSTATE_23505.maxTotalAttempts = 99; }, TypeError);
}

console.log('  no retry loop is executed by this module — only metadata is ever returned');
{
  const first = classifyRaw({ code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, { operationPhase: OPERATION_PHASE.CLAIM });
  const second = classifyRaw({ code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, { operationPhase: OPERATION_PHASE.CLAIM });
  assert.deepEqual(first, second);
}

console.log('Gate 2D.1B.2A correction: classifySqlError normalizes diagnostics internally and is safe without requiring the caller to invoke extractSafeDiagnostics first');

console.log('  1. raw ordinary own-data diagnostics (sqlstate/constraint passed directly, not pre-sanitized): recognized claim race');
{
  const policy = classifySqlError({
    diagnostics: { sqlstate: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT },
    operationPhase: OPERATION_PHASE.CLAIM
  });
  assert.equal(policy.classification, WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE);
  assert.equal(policy.rereadRequired, true);
  assert.equal(policy.idempotencyLookupRequired, true);
  assert.equal(policy.safeDiagnosticCode, 'SQLSTATE_23505');
}

console.log('  2. equivalent already-sanitized diagnostics produce the exact same classification as the raw case above');
{
  const rawPolicy = classifySqlError({
    diagnostics: { sqlstate: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT },
    operationPhase: OPERATION_PHASE.CLAIM
  });
  const sanitizedPolicy = classifySqlError({
    diagnostics: extractSafeDiagnostics({ code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }),
    operationPhase: OPERATION_PHASE.CLAIM
  });
  assert.deepEqual(rawPolicy, sanitizedPolicy);
}

console.log('  3. inherited sqlstate is ignored: conservative INTERNAL_FAILURE');
{
  const proto = { sqlstate: '23505' };
  const hostile = Object.create(proto);
  hostile.constraint = LEDGER_CLAIM_KEY_CONSTRAINT;
  const policy = classifySqlError({ diagnostics: hostile, operationPhase: OPERATION_PHASE.CLAIM });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  4. inherited constraint is ignored: conservative INTERNAL_FAILURE');
{
  const proto = { constraint: LEDGER_CLAIM_KEY_CONSTRAINT };
  const hostile = Object.create(proto);
  hostile.sqlstate = '23505';
  const policy = classifySqlError({ diagnostics: hostile, operationPhase: OPERATION_PHASE.CLAIM });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  5. accessor-backed sqlstate: getter never invoked, INTERNAL_FAILURE');
{
  let getterCount = 0;
  const hostile = { constraint: LEDGER_CLAIM_KEY_CONSTRAINT };
  Object.defineProperty(hostile, 'sqlstate', { enumerable: true, get() { getterCount += 1; return '23505'; } });
  const policy = classifySqlError({ diagnostics: hostile, operationPhase: OPERATION_PHASE.CLAIM });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(getterCount, 0, 'the sqlstate getter must never be invoked');
}

console.log('  6. accessor-backed constraint: getter never invoked, INTERNAL_FAILURE');
{
  let getterCount = 0;
  const hostile = { sqlstate: '23505' };
  Object.defineProperty(hostile, 'constraint', { enumerable: true, get() { getterCount += 1; return LEDGER_CLAIM_KEY_CONSTRAINT; } });
  const policy = classifySqlError({ diagnostics: hostile, operationPhase: OPERATION_PHASE.CLAIM });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(getterCount, 0, 'the constraint getter must never be invoked');
}

console.log('  7. accessor-backed manualPrecedenceMarker: getter never invoked, never classified as manual-precedence conflict');
{
  let getterCount = 0;
  const hostile = { sqlstate: '23514' };
  Object.defineProperty(hostile, 'manualPrecedenceMarker', { enumerable: true, get() { getterCount += 1; return true; } });
  const policy = classifySqlError({ diagnostics: hostile });
  assert.notEqual(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(getterCount, 0, 'the manualPrecedenceMarker getter must never be invoked');
}

console.log('  8. a Proxy diagnostics object with throwing/counting traps: all trap counts zero, no exception escapes, INTERNAL_FAILURE');
{
  function buildInstrumentedProxy(target = { sqlstate: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT, manualPrecedenceMarker: true }) {
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
  let policy;
  assert.doesNotThrow(() => { policy = classifySqlError({ diagnostics: proxy, operationPhase: OPERATION_PHASE.CLAIM }); });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.deepEqual(counts, { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 });
}

console.log('  9. a revoked Proxy diagnostics object: no exception escapes, INTERNAL_FAILURE');
{
  const { proxy: revocable, revoke } = Proxy.revocable({ sqlstate: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, {});
  revoke();
  let policy;
  assert.doesNotThrow(() => { policy = classifySqlError({ diagnostics: revocable, operationPhase: OPERATION_PHASE.CLAIM }); });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  10. a duplicate top-level constraint argument still cannot override the internally sanitized diagnostics (hostile diagnostics.constraint variant)');
{
  let getterCount = 0;
  const hostileDiagnostics = { sqlstate: '23505' };
  Object.defineProperty(hostileDiagnostics, 'constraint', { enumerable: true, get() { getterCount += 1; return LEDGER_CLAIM_KEY_CONSTRAINT; } });
  const policy = classifySqlError({
    diagnostics: hostileDiagnostics,
    constraint: LEDGER_CLAIM_KEY_CONSTRAINT,
    operationPhase: OPERATION_PHASE.CLAIM
  });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(getterCount, 0);
}

console.log('  11. known 23505 cases remain correct after internal normalization (both active-link constraints, both raw and sanitized)');
{
  for (const constraint of [ORDER_ACTIVE_LINK_CONSTRAINT, LINE_ACTIVE_LINK_CONSTRAINT]) {
    const rawPolicy = classifySqlError({
      diagnostics: { sqlstate: '23505', constraint },
      operationPhase: OPERATION_PHASE.CANONICAL_MUTATION
    });
    assert.equal(rawPolicy.classification, WRITER_OUTCOME.CONFLICT_STALE_STATE);
    const sanitizedPolicy = classifyRaw({ code: '23505', constraint }, { operationPhase: OPERATION_PHASE.CANONICAL_MUTATION });
    assert.deepEqual(rawPolicy, sanitizedPolicy);
  }
}

console.log('  12. existing 55000, 23514, transaction and ambiguous-commit tests remain unchanged and passing (see the full suite above)');
{
  assert.equal(classifyRaw({ code: '55000' }).classification, WRITER_OUTCOME.CONFLICT_STALE_STATE);
  assert.equal(classifyRaw({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE }).classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.equal(classifyRaw({ code: '40001' }).classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);
  assert.equal(
    classifySqlError({ diagnostics: extractSafeDiagnostics({ code: '08006' }), ambiguousCommit: true }).classification,
    WRITER_OUTCOME.AMBIGUOUS_COMMIT
  );
}

console.log('PASS: classifySqlError is internally safe against unsanitized, inherited, accessor-backed and Proxy-backed diagnostics');

console.log('Gate 2D.1B.2A correction: manualPrecedenceMarker trust boundary in the classifier');

console.log('  A. raw {sqlstate: "23514", manualPrecedenceMarker: true} does not classify as BLOCKED_MANUAL_PRECEDENCE');
{
  const policy = classifySqlError({ diagnostics: { sqlstate: '23514', manualPrecedenceMarker: true } });
  assert.notEqual(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  B. raw sqlstate 23514 with an unrelated message and marker=true does not classify as manual precedence');
{
  const policy = classifySqlError({
    diagnostics: {
      sqlstate: '23514',
      message: 'new row for relation "order_project_links" violates check constraint "order_project_links_state_check"',
      manualPrecedenceMarker: true
    }
  });
  assert.notEqual(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
}

console.log('  C. raw sqlstate 23514 with the exact approved message does classify as BLOCKED_MANUAL_PRECEDENCE');
{
  const policy = classifySqlError({ diagnostics: { code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE } });
  assert.equal(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.equal(policy.safeDiagnosticCode, 'MANUAL_PRECEDENCE');
}

console.log('  D. a genuine safe diagnostics object produced by extractSafeDiagnostics classifies equivalently');
{
  const genuine = extractSafeDiagnostics({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE });
  const policy = classifySqlError({ diagnostics: genuine });
  assert.equal(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
}

console.log('  E. a shallow clone of the safe object does not retain marker trust without the original exact raw message');
{
  const genuine = extractSafeDiagnostics({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE });
  const clone = Object.assign({}, genuine);
  const policy = classifySqlError({ diagnostics: clone });
  assert.notEqual(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  F. existing 23505, 55000, transaction and ambiguous-commit behavior remains unchanged');
{
  assert.equal(
    classifyRaw({ code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, { operationPhase: OPERATION_PHASE.CLAIM }).classification,
    WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE
  );
  assert.equal(classifyRaw({ code: '55000' }).classification, WRITER_OUTCOME.CONFLICT_STALE_STATE);
  assert.equal(classifyRaw({ code: '40001' }).classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);
  assert.equal(
    classifySqlError({ diagnostics: extractSafeDiagnostics({ code: '08006' }), ambiguousCommit: true }).classification,
    WRITER_OUTCOME.AMBIGUOUS_COMMIT
  );
}

console.log('PASS: manualPrecedenceMarker trust boundary holds in the classifier');

console.log('Gate 2D.1B.2A correction: manualPrecedenceMarker byte-for-byte exact equality in the classifier');

console.log('  A. exact order message + sqlstate 23514: BLOCKED_MANUAL_PRECEDENCE');
{
  const policy = classifySqlError({ diagnostics: { code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE } });
  assert.equal(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.equal(policy.manualReviewRequired, true);
  assert.equal(policy.safeDiagnosticCode, 'MANUAL_PRECEDENCE');
}

console.log('  B. exact line message + sqlstate 23514: BLOCKED_MANUAL_PRECEDENCE');
{
  const LINE_MANUAL_PRECEDENCE_MESSAGE = 'line project-link manual precedence violation';
  const policy = classifySqlError({ diagnostics: { code: '23514', message: LINE_MANUAL_PRECEDENCE_MESSAGE } });
  assert.equal(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.equal(policy.manualReviewRequired, true);
  assert.equal(policy.safeDiagnosticCode, 'MANUAL_PRECEDENCE');
}

console.log('  C. every case/whitespace variant + sqlstate 23514: INTERNAL_FAILURE, manualReviewRequired not enabled, no manual-precedence code');
{
  const variants = [
    ' ' + ORDER_MANUAL_PRECEDENCE_MESSAGE,
    ORDER_MANUAL_PRECEDENCE_MESSAGE + ' ',
    ORDER_MANUAL_PRECEDENCE_MESSAGE.toUpperCase(),
    '\n' + ORDER_MANUAL_PRECEDENCE_MESSAGE,
    ORDER_MANUAL_PRECEDENCE_MESSAGE + '\t',
    'Order Project-Link Manual Precedence Violation'
  ];
  for (const message of variants) {
    const policy = classifySqlError({ diagnostics: { code: '23514', message } });
    assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE, `variant ${JSON.stringify(message)} must not classify as manual precedence`);
    assert.equal(policy.manualReviewRequired, false, `variant ${JSON.stringify(message)} must not require manual review through the manual-precedence path`);
    assert.notEqual(policy.safeDiagnosticCode, 'MANUAL_PRECEDENCE');
  }
}

console.log('  D. forged {sqlstate: "23514", manualPrecedenceMarker: true}: INTERNAL_FAILURE');
{
  const policy = classifySqlError({ diagnostics: { sqlstate: '23514', manualPrecedenceMarker: true } });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(policy.manualReviewRequired, false);
}

console.log('  E. genuine trusted safe diagnostics derived from an exact message: BLOCKED_MANUAL_PRECEDENCE');
{
  const genuine = extractSafeDiagnostics({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE });
  const policy = classifySqlError({ diagnostics: genuine });
  assert.equal(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
}

console.log('  F. clone/spread of that sanitized object without the raw exact message: INTERNAL_FAILURE');
{
  const genuine = extractSafeDiagnostics({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE });
  const clone = Object.assign({}, genuine);
  const spread = { ...genuine };
  assert.equal(classifySqlError({ diagnostics: clone }).classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(classifySqlError({ diagnostics: spread }).classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  existing 23505 constraint-aware, 55000, transaction, ambiguous-commit and no-blind-retry behavior remains unchanged');
{
  for (const constraint of [ORDER_ACTIVE_LINK_CONSTRAINT, LINE_ACTIVE_LINK_CONSTRAINT]) {
    const policy = classifyRaw({ code: '23505', constraint }, { operationPhase: OPERATION_PHASE.CANONICAL_MUTATION });
    assert.equal(policy.classification, WRITER_OUTCOME.CONFLICT_STALE_STATE);
    assert.equal(policy.blindRetryAllowed, false);
  }
  assert.equal(classifyRaw({ code: '55000' }).blindRetryAllowed, false);
  assert.equal(classifyRaw({ code: '40001' }).classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);
  assert.equal(
    classifySqlError({ diagnostics: extractSafeDiagnostics({ code: '08006' }), ambiguousCommit: true }).classification,
    WRITER_OUTCOME.AMBIGUOUS_COMMIT
  );
}

console.log('PASS: manualPrecedenceMarker byte-for-byte exact equality holds in the classifier');

console.log('Gate 2D.1B.2A correction: the complete top-level options trust boundary -- diagnostics, operationPhase, ambiguousCommit and commitInFlight are all read via readOwnDataProperty, never by destructuring or direct property access on options itself');

function buildInstrumentedOptionsProxy(target) {
  const counts = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 };
  const proxy = new Proxy(target, {
    getPrototypeOf(_t) { counts.getPrototypeOf += 1; throw new Error('getPrototypeOf trap fired'); },
    getOwnPropertyDescriptor(_t, _k) { counts.getOwnPropertyDescriptor += 1; throw new Error('getOwnPropertyDescriptor trap fired'); },
    get(_t, _k) { counts.get += 1; throw new Error('get trap fired'); },
    ownKeys(_t) { counts.ownKeys += 1; throw new Error('ownKeys trap fired'); },
    has(_t, _k) { counts.has += 1; throw new Error('has trap fired'); }
  });
  return { proxy, counts };
}
const ZERO_TRAP_COUNTS = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 };

console.log('  1. a combined hostile Proxy passed as the entire options argument: every trap count remains zero, no exception escapes, conservative classification returned');
{
  const { proxy, counts } = buildInstrumentedOptionsProxy({
    diagnostics: { code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE },
    operationPhase: OPERATION_PHASE.CLAIM,
    ambiguousCommit: true,
    commitInFlight: true
  });
  let policy;
  assert.doesNotThrow(() => { policy = classifySqlError(proxy); });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.notEqual(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT);
  assert.notEqual(policy.classification, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.deepEqual(counts, ZERO_TRAP_COUNTS);
}

console.log('  2. a Proxy whose only trap is one of the five, one at a time: each is individually proven never invoked when passed as the whole options argument -- Proxy-ness itself (via the trap-free util.types.isProxy check) makes every field unavailable, regardless of which single trap is instrumented, so the conservative default is returned, not a "correctly read through" classification');
{
  for (const trapName of ['getPrototypeOf', 'getOwnPropertyDescriptor', 'get', 'ownKeys', 'has']) {
    let trapCount = 0;
    const soloTrapProxy = new Proxy(
      { diagnostics: { code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, operationPhase: OPERATION_PHASE.CLAIM },
      { [trapName](..._args) { trapCount += 1; throw new Error(`${trapName} trap fired`); } }
    );
    let policy;
    assert.doesNotThrow(() => { policy = classifySqlError(soloTrapProxy); });
    assert.equal(trapCount, 0, `the ${trapName} trap must never be invoked merely by passing a Proxy as options`);
    assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE, `a Proxy options container must always fall back to the conservative default, even with only a ${trapName} trap defined`);
  }
}

console.log('  3. a revoked Proxy passed as the whole options argument: no exception escapes, conservative classification returned');
{
  const { proxy: revocable, revoke } = Proxy.revocable(
    { diagnostics: { code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, operationPhase: OPERATION_PHASE.CLAIM },
    {}
  );
  revoke();
  let policy;
  assert.doesNotThrow(() => { policy = classifySqlError(revocable); });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  4. a Proxy whose get trap would return forged diagnostics/operationPhase=CLAIM/ambiguousCommit=true/commitInFlight=true: none of those forged values may affect classification');
{
  const target = {};
  const proxy = new Proxy(target, {
    get(_t, key) {
      if (key === 'diagnostics') return { code: '23503' };
      if (key === 'operationPhase') return OPERATION_PHASE.CLAIM;
      if (key === 'ambiguousCommit') return true;
      if (key === 'commitInFlight') return true;
      return undefined;
    }
  });
  let policy;
  assert.doesNotThrow(() => { policy = classifySqlError(proxy); });
  // Genuinely unavailable diagnostics (Proxy get trap never invoked) -> sqlstate null -> default branch.
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.notEqual(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
  assert.notEqual(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT);
}

console.log('  5. an own accessor-only property for each of the four fields individually: getter counter remains zero, field treated as unavailable, conservative/default classification');
{
  let getterCount = 0;
  {
    getterCount = 0;
    const hostile = { operationPhase: OPERATION_PHASE.CLAIM };
    Object.defineProperty(hostile, 'diagnostics', { enumerable: true, get() { getterCount += 1; return { code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }; } });
    const policy = classifySqlError(hostile);
    assert.equal(getterCount, 0, 'the diagnostics getter must never be invoked');
    assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE, 'unavailable diagnostics must fall back to the conservative default');
  }
  {
    getterCount = 0;
    const hostile = { diagnostics: { code: '23503' } };
    Object.defineProperty(hostile, 'operationPhase', { enumerable: true, get() { getterCount += 1; return OPERATION_PHASE.CLAIM; } });
    const policy = classifySqlError(hostile);
    assert.equal(getterCount, 0, 'the operationPhase getter must never be invoked');
    assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE, 'unavailable operationPhase must fail closed, never assumed to be CLAIM');
  }
  {
    getterCount = 0;
    const hostile = { diagnostics: { code: '08006' } };
    Object.defineProperty(hostile, 'ambiguousCommit', { enumerable: true, get() { getterCount += 1; return true; } });
    const policy = classifySqlError(hostile);
    assert.equal(getterCount, 0, 'the ambiguousCommit getter must never be invoked');
    assert.notEqual(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT, 'unavailable ambiguousCommit must default to false');
  }
  {
    getterCount = 0;
    const hostile = { diagnostics: { code: '57014' } };
    Object.defineProperty(hostile, 'commitInFlight', { enumerable: true, get() { getterCount += 1; return false; } });
    const policy = classifySqlError(hostile);
    assert.equal(getterCount, 0, 'the commitInFlight getter must never be invoked');
    assert.equal(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT, 'unavailable commitInFlight must default to null, never treated as proven false');
  }
}

console.log('  6. one combined object with accessor-only properties for all four fields at once: all four getter counters remain zero');
{
  const counts = { diagnostics: 0, operationPhase: 0, ambiguousCommit: 0, commitInFlight: 0 };
  const hostile = {};
  Object.defineProperty(hostile, 'diagnostics', { enumerable: true, get() { counts.diagnostics += 1; return { code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }; } });
  Object.defineProperty(hostile, 'operationPhase', { enumerable: true, get() { counts.operationPhase += 1; return OPERATION_PHASE.CLAIM; } });
  Object.defineProperty(hostile, 'ambiguousCommit', { enumerable: true, get() { counts.ambiguousCommit += 1; return true; } });
  Object.defineProperty(hostile, 'commitInFlight', { enumerable: true, get() { counts.commitInFlight += 1; return true; } });
  const policy = classifySqlError(hostile);
  assert.deepEqual(counts, { diagnostics: 0, operationPhase: 0, ambiguousCommit: 0, commitInFlight: 0 });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  7. setter-only properties for all four fields: treated as unavailable, no exception, conservative classification');
{
  const hostile = {};
  for (const field of ['diagnostics', 'operationPhase', 'ambiguousCommit', 'commitInFlight']) {
    Object.defineProperty(hostile, field, { enumerable: true, set() {} });
  }
  let policy;
  assert.doesNotThrow(() => { policy = classifySqlError(hostile); });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  8. inherited (prototype-chain) values for all four fields at once: ignored, conservative classification, no exception');
{
  const proto = {
    diagnostics: { code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT },
    operationPhase: OPERATION_PHASE.CLAIM,
    ambiguousCommit: true,
    commitInFlight: true
  };
  const inherited = Object.create(proto);
  const policy = classifySqlError(inherited);
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.notEqual(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT);
}

console.log('  9. every non-object/invalid options container is handled safely, fails closed, no exception: null, undefined, string, number, boolean, symbol, array, function, ordinary object, null-prototype object');
{
  for (const invalidOptions of [null, undefined, 'options', 42, true, Symbol('options'), [], () => {}]) {
    let policy;
    assert.doesNotThrow(() => { policy = classifySqlError(invalidOptions); }, `options=${String(invalidOptions)} must not throw`);
    assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
  }
  // ordinary plain object and null-prototype object with genuinely safe own
  // data properties must remain fully functional (established behavior
  // preserved, not merely "doesn't throw").
  assert.equal(
    classifySqlError({ diagnostics: { code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, operationPhase: OPERATION_PHASE.CLAIM }).classification,
    WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE
  );
  const nullProtoOptions = Object.create(null);
  nullProtoOptions.diagnostics = { code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT };
  nullProtoOptions.operationPhase = OPERATION_PHASE.CLAIM;
  assert.equal(classifySqlError(nullProtoOptions).classification, WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE);
}

console.log('  10. operationPhase value-shape matrix: lowercase, mixed-case and whitespace variants of CLAIM all fail closed, never accepted as CLAIM');
{
  for (const malformedPhase of ['claim', 'Claim', ' CLAIM', 'CLAIM ', 'CLAIM\n']) {
    const policy = classifySqlError({ diagnostics: { code: '23503' }, operationPhase: malformedPhase });
    assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE, `operationPhase=${JSON.stringify(malformedPhase)} must not be accepted as CLAIM`);
  }
}

console.log('  ordinary-object regression: the safety correction changes no legitimate classification');
{
  // 23503 phase matrix, re-verified against the corrected top-level reads.
  assert.equal(
    classifySqlError({ diagnostics: { code: '23503' }, operationPhase: OPERATION_PHASE.CLAIM }).classification,
    WRITER_OUTCOME.INVALID_PARENT_OR_TENANT
  );
  assert.equal(
    classifySqlError({ diagnostics: { code: '23503' }, operationPhase: OPERATION_PHASE.CANONICAL_MUTATION }).classification,
    WRITER_OUTCOME.INTERNAL_FAILURE
  );
  assert.equal(
    classifySqlError({ diagnostics: { code: '23503' }, operationPhase: OPERATION_PHASE.TERMINAL_UPDATE }).classification,
    WRITER_OUTCOME.INTERNAL_FAILURE
  );

  // known 23505 + correct phase.
  assert.equal(
    classifyRaw({ code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, { operationPhase: OPERATION_PHASE.CLAIM }).classification,
    WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE
  );

  // exact manual-precedence classification.
  assert.equal(
    classifyRaw({ code: '23514', message: ORDER_MANUAL_PRECEDENCE_MESSAGE }).classification,
    WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE
  );

  // ambiguousCommit behavior.
  assert.equal(
    classifySqlError({ diagnostics: extractSafeDiagnostics({ code: '08006' }), ambiguousCommit: true }).classification,
    WRITER_OUTCOME.AMBIGUOUS_COMMIT
  );

  // commitInFlight behavior.
  assert.equal(
    classifyRaw({ code: '57014' }, { commitInFlight: false }).classification,
    WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE
  );
  assert.equal(
    classifyRaw({ code: '57014' }).classification,
    WRITER_OUTCOME.AMBIGUOUS_COMMIT
  );

  // retryable transaction behavior.
  assert.equal(classifyRaw({ code: '40001' }).classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);

  // no-blind-retry behavior: unchanged retry-policy metadata for the
  // no-retry classes.
  assert.equal(
    classifyRaw({ code: '23505', constraint: LEDGER_CLAIM_KEY_CONSTRAINT }, { operationPhase: OPERATION_PHASE.CLAIM }).blindRetryAllowed,
    false
  );
  assert.equal(classifyRaw({ code: '55000' }).blindRetryAllowed, false);
}

console.log('Gate 2D.1B.2A correction: the outer options container itself must be a plain metadata object (Object.prototype or null-prototype) -- non-plain containers with valid-looking own data properties must never influence classification');

function attachForgedFields(container) {
  container.diagnostics = { code: '23503' };
  container.operationPhase = OPERATION_PHASE.CLAIM;
  container.ambiguousCommit = true;
  container.commitInFlight = false;
  return container;
}

function assertForgedContainerIsInert(container, label) {
  let policy;
  assert.doesNotThrow(() => { policy = classifySqlError(container); }, `${label} must not throw`);
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE, `${label}: forged fields must not affect classification`);
  assert.notEqual(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT, `${label}: forged operationPhase=CLAIM must not produce INVALID_PARENT_OR_TENANT`);
  assert.notEqual(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT, `${label}: forged ambiguousCommit=true must not produce AMBIGUOUS_COMMIT`);
}

console.log('  1. an array carrying valid-looking own data properties (diagnostics 23503, operationPhase CLAIM, ambiguousCommit true, commitInFlight false): none of the forged values affects classification, result is conservative');
{
  const forgedArray = attachForgedFields([]);
  assertForgedContainerIsInert(forgedArray, 'forged array');
}

console.log('  2. a custom class instance carrying the same forged own data properties: rejected as a non-plain container');
{
  class WriterOptionsLike {}
  const instance = attachForgedFields(new WriterOptionsLike());
  assertForgedContainerIsInert(instance, 'forged class instance');
}

console.log('  3. a Date instance carrying the same forged own data properties: rejected as a non-plain container');
{
  const forgedDate = attachForgedFields(new Date());
  assertForgedContainerIsInert(forgedDate, 'forged Date');
}

console.log('  4. a Map instance carrying the same forged own data properties: rejected as a non-plain container');
{
  const forgedMap = attachForgedFields(new Map());
  assertForgedContainerIsInert(forgedMap, 'forged Map');
}

console.log('  5. a Set instance carrying the same forged own data properties: rejected as a non-plain container');
{
  const forgedSet = attachForgedFields(new Set());
  assertForgedContainerIsInert(forgedSet, 'forged Set');
}

console.log('  6. a RegExp instance carrying the same forged own data properties: rejected as a non-plain container');
{
  const forgedRegExp = attachForgedFields(/x/);
  assertForgedContainerIsInert(forgedRegExp, 'forged RegExp');
}

console.log('  7. an Error instance carrying the same forged own data properties: rejected as a non-plain container');
{
  const forgedError = attachForgedFields(new Error('not real options'));
  assertForgedContainerIsInert(forgedError, 'forged Error');
}

console.log('  8. a typed array carrying the same forged own data properties (where the type permits named properties): rejected as a non-plain container');
{
  const forgedTypedArray = attachForgedFields(new Uint8Array(4));
  assertForgedContainerIsInert(forgedTypedArray, 'forged Uint8Array');
}

console.log('  9. no getter or trap executes while rejecting a forged non-plain container: accessor-backed forged fields on a class instance');
{
  class WriterOptionsLike {}
  const instance = new WriterOptionsLike();
  const counts = { diagnostics: 0, operationPhase: 0, ambiguousCommit: 0, commitInFlight: 0 };
  Object.defineProperty(instance, 'diagnostics', { enumerable: true, get() { counts.diagnostics += 1; return { code: '23503' }; } });
  Object.defineProperty(instance, 'operationPhase', { enumerable: true, get() { counts.operationPhase += 1; return OPERATION_PHASE.CLAIM; } });
  Object.defineProperty(instance, 'ambiguousCommit', { enumerable: true, get() { counts.ambiguousCommit += 1; return true; } });
  Object.defineProperty(instance, 'commitInFlight', { enumerable: true, get() { counts.commitInFlight += 1; return false; } });
  const policy = classifySqlError(instance);
  assert.deepEqual(counts, { diagnostics: 0, operationPhase: 0, ambiguousCommit: 0, commitInFlight: 0 });
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('  10. ambiguousCommit from a rejected container is independently, unconditionally gated (checked before the sqlstate switch) -- a forged array with ONLY ambiguousCommit=true set must never classify as AMBIGUOUS_COMMIT');
{
  const forgedAmbiguousOnly = attachAmbiguousCommitOnly([]);
  const policy = classifySqlError(forgedAmbiguousOnly);
  assert.notEqual(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT);
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}
function attachAmbiguousCommitOnly(container) {
  container.ambiguousCommit = true;
  return container;
}

console.log('  11. operationPhase and commitInFlight from a rejected container are structurally inert even in isolation: both are consulted only inside sqlstate-specific branches, and sqlstate resolution depends on the SAME safeOptions gate as diagnostics -- a rejected container can never smuggle a matching diagnostics through that gate, so its forged operationPhase/commitInFlight can never reach a branch that would consult them');
{
  // A non-plain container carrying ONLY operationPhase: diagnostics is
  // necessarily unavailable too (same gate), so sqlstate is null and the
  // default branch fires -- operationPhase is provably never reached.
  const forgedPhaseOnly = [];
  forgedPhaseOnly.operationPhase = OPERATION_PHASE.CLAIM;
  assert.equal(classifySqlError(forgedPhaseOnly).classification, WRITER_OUTCOME.INTERNAL_FAILURE);

  // Same reasoning for commitInFlight, which is only consulted inside
  // case "57014" -- unreachable without a matching, equally-gated sqlstate.
  const forgedCommitInFlightOnly = [];
  forgedCommitInFlightOnly.commitInFlight = false;
  const policy = classifySqlError(forgedCommitInFlightOnly);
  assert.notEqual(policy.classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);
  assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
}

console.log('Gate 2D.1B.2A correction: both accepted plain-container forms remain fully functional -- {} and Object.create(null)');

for (const [label, makeContainer] of [
  ['{} ordinary object', () => ({})],
  ['Object.create(null)', () => Object.create(null)]
]) {
  console.log(`  ${label}: own-data diagnostics and CLAIM accepted; full phase/ambiguousCommit/commitInFlight behavior unchanged`);
  {
    const claimContainer = makeContainer();
    claimContainer.diagnostics = { code: '23503' };
    claimContainer.operationPhase = OPERATION_PHASE.CLAIM;
    assert.equal(classifySqlError(claimContainer).classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT, `${label}: 23503 + CLAIM`);

    const canonicalContainer = makeContainer();
    canonicalContainer.diagnostics = { code: '23503' };
    canonicalContainer.operationPhase = OPERATION_PHASE.CANONICAL_MUTATION;
    assert.equal(classifySqlError(canonicalContainer).classification, WRITER_OUTCOME.INTERNAL_FAILURE, `${label}: 23503 + CANONICAL_MUTATION`);

    const terminalContainer = makeContainer();
    terminalContainer.diagnostics = { code: '23503' };
    terminalContainer.operationPhase = OPERATION_PHASE.TERMINAL_UPDATE;
    assert.equal(classifySqlError(terminalContainer).classification, WRITER_OUTCOME.INTERNAL_FAILURE, `${label}: 23503 + TERMINAL_UPDATE`);

    const ambiguousContainer = makeContainer();
    ambiguousContainer.diagnostics = { code: '08006' };
    ambiguousContainer.ambiguousCommit = true;
    assert.equal(classifySqlError(ambiguousContainer).classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT, `${label}: ambiguousCommit=true`);

    const commitInFlightFalseContainer = makeContainer();
    commitInFlightFalseContainer.diagnostics = { code: '57014' };
    commitInFlightFalseContainer.commitInFlight = false;
    assert.equal(classifySqlError(commitInFlightFalseContainer).classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE, `${label}: commitInFlight=false`);

    const commitInFlightAbsentContainer = makeContainer();
    commitInFlightAbsentContainer.diagnostics = { code: '57014' };
    assert.equal(classifySqlError(commitInFlightAbsentContainer).classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT, `${label}: commitInFlight absent defaults to ambiguous`);
  }
}

console.log('Gate 2D.1B.2A correction: prototype-inspection failure on the top-level options container fails closed to INTERNAL_FAILURE and restores global state');
{
  const originalGetPrototypeOf = Object.getPrototypeOf;
  const sentinelOptions = {
    diagnostics: { code: '23503' },
    operationPhase: OPERATION_PHASE.CLAIM,
    ambiguousCommit: true,
    commitInFlight: false
  };
  let policy;

  try {
    Object.getPrototypeOf = (value) => {
      if (value === sentinelOptions) {
        throw new Error('forced options prototype-inspection failure');
      }
      return originalGetPrototypeOf(value);
    };

    assert.doesNotThrow(() => {
      policy = classifySqlError(sentinelOptions);
    });
    assert.equal(policy.classification, WRITER_OUTCOME.INTERNAL_FAILURE);
    assert.notEqual(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
    assert.notEqual(policy.classification, WRITER_OUTCOME.AMBIGUOUS_COMMIT);
    assert.notEqual(policy.classification, WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE);
  } finally {
    Object.getPrototypeOf = originalGetPrototypeOf;
  }

  assert.equal(Object.getPrototypeOf, originalGetPrototypeOf, 'the exact original Object.getPrototypeOf reference must be restored after classifier integration coverage');
  assert.equal(
    classifySqlError({ diagnostics: { code: '23503' }, operationPhase: OPERATION_PHASE.CLAIM }).classification,
    WRITER_OUTCOME.INVALID_PARENT_OR_TENANT,
    'ordinary-object CLAIM classification must remain intact after restoration'
  );
}

console.log('PASS: the complete top-level options trust boundary holds -- no caller-controlled getter or Proxy trap executes before fail-closed validation');

console.log('PASS: conflict classifier policy metadata is correct and side-effect free');
