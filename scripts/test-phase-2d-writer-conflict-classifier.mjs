import assert from 'node:assert/strict';
import { WRITER_OUTCOME } from '../server/lib/projectLinkWriterResult.js';
import { extractSafeDiagnostics } from '../server/lib/projectLinkWriterDiagnostics.js';
import { classifySqlError, RETRY_POLICY, LOG_SEVERITY } from '../server/lib/projectLinkWriterConflictClassifier.js';

console.log('Phase 2D.1B writer contract: conflict classifier');

const ORDER_MANUAL_PRECEDENCE_MESSAGE = 'order project-link manual precedence violation';

function classifyRaw(errorLike, extra = {}) {
  return classifySqlError({ diagnostics: extractSafeDiagnostics(errorLike), ...extra });
}

console.log('  23505: concurrent conflict, reread required, no blind retry');
{
  const policy = classifyRaw({ code: '23505', constraint: 'uniq_order_project_links_active' });
  assert.equal(policy.classification, WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE);
  assert.equal(policy.rereadRequired, true);
  assert.equal(policy.blindRetryAllowed, false);
  assert.equal(policy.fullTransactionRetryAllowed, false);
  assert.equal(policy.safeDiagnosticCode, 'SQLSTATE_23505');
  assert.equal(policy.retryPolicy.maxTotalAttempts, 1);
  assert.equal(policy.retryPolicy.maxRetries, 0);
}

console.log('  55000: stale-state conflict, reread required, no blind retry');
{
  const policy = classifyRaw({ code: '55000', message: 'closed order_project_links are immutable' });
  assert.equal(policy.classification, WRITER_OUTCOME.CONFLICT_STALE_STATE);
  assert.equal(policy.rereadRequired, true);
  assert.equal(policy.blindRetryAllowed, false);
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

console.log('  23503: invalid parent/tenant reference');
{
  const policy = classifyRaw({ code: '23503', constraint: 'fk_order_project_links_project_tenant' });
  assert.equal(policy.classification, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
  assert.equal(policy.blindRetryAllowed, false);
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
  assert.equal(classifyRaw({ code: '23505' }).logSeverity, LOG_SEVERITY.WARN);
  assert.equal(classifyRaw({ code: '42501' }).logSeverity, LOG_SEVERITY.ERROR);
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
  const first = classifyRaw({ code: '23505' });
  const second = classifyRaw({ code: '23505' });
  assert.deepEqual(first, second);
}

console.log('PASS: conflict classifier policy metadata is correct and side-effect free');
