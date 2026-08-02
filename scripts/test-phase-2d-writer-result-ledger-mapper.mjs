import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WRITER_OUTCOME, buildWriterResult } from '../server/lib/projectLinkWriterResult.js';
import {
  mapResultToLedgerState,
  LEDGER_ACTION,
  CANONICAL_ERROR_CLASS
} from '../server/lib/projectLinkWriterResultLedgerMapper.js';

console.log('Phase 2D.1B writer contract: pure result-to-ledger mapper');

const BASE = {
  operationKey: 'op-1',
  subjectType: 'ORDER',
  subjectId: '10000000-0000-4000-8000-000000000001',
  attempt: 1
};
const DECISION_ID = '40000000-0000-4000-8000-000000000001';
const PRIOR_LINK_ID = '30000000-0000-4000-8000-000000000001';
const RESULT_LINK_ID = '30000000-0000-4000-8000-000000000002';

console.log('  successful mutation outcomes: COMPLETED, finalOutcome mirrors the outcome, no lastErrorClass');
{
  const result = buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, {
    ...BASE,
    decisionId: DECISION_ID,
    resultLinkId: RESULT_LINK_ID
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.PERSIST_TERMINAL);
  assert.equal(ledgerState.status, 'COMPLETED');
  assert.equal(ledgerState.finalOutcome, WRITER_OUTCOME.SUCCESS_CREATED);
  assert.equal(ledgerState.lastErrorClass, null);
  assert.equal(ledgerState.decisionId, DECISION_ID);
  assert.equal(ledgerState.resultLinkId, RESULT_LINK_ID);
  assert.ok(Object.isFrozen(ledgerState));
}

console.log('  SUCCESS_ALREADY_CURRENT: COMPLETED, decision/prior/result IDs may all be absent');
{
  const result = buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.PERSIST_TERMINAL);
  assert.equal(ledgerState.status, 'COMPLETED');
  assert.equal(ledgerState.finalOutcome, WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT);
  assert.equal(ledgerState.lastErrorClass, null);
  assert.equal(ledgerState.decisionId, null);
  assert.equal(ledgerState.priorLinkId, null);
  assert.equal(ledgerState.resultLinkId, null);
}

console.log('  AMBIGUOUS_COMMIT: RECOVER_BY_LOOKUP, no ledger status, no terminal mutation, never a database AMBIGUOUS write');
{
  const result = buildWriterResult(WRITER_OUTCOME.AMBIGUOUS_COMMIT, {
    ...BASE,
    safeDiagnosticCode: 'SQLSTATE_57014'
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.RECOVER_BY_LOOKUP);
  assert.equal(ledgerState.status, null);
  assert.equal(ledgerState.finalOutcome, null);
  assert.equal(ledgerState.lastErrorClass, null);
  assert.notEqual(ledgerState.status, 'AMBIGUOUS');
}

console.log('  no export named PERSIST_AMBIGUOUS remains on LEDGER_ACTION');
{
  assert.equal('PERSIST_AMBIGUOUS' in LEDGER_ACTION, false);
  assert.deepEqual(
    Object.keys(LEDGER_ACTION).sort(),
    ['NO_LEDGER_WRITE', 'PERSIST_TERMINAL', 'RECOVER_BY_LOOKUP', 'RETAIN_CLAIMED', 'TRANSACTION_ROLLED_BACK']
  );
}

console.log('  CONFLICT_IDEMPOTENCY_KEY_REUSE: NO_LEDGER_WRITE, no ledger status, no terminal mutation, no retry action');
{
  const result = buildWriterResult(WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE, {
    ...BASE,
    safeDiagnosticCode: 'SQLSTATE_23505'
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.NO_LEDGER_WRITE);
  assert.equal(ledgerState.status, null);
  assert.equal(ledgerState.finalOutcome, WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE);
  assert.notEqual(ledgerState.ledgerAction, LEDGER_ACTION.RETAIN_CLAIMED);
}

console.log('  every replayed terminal result maps to NO_LEDGER_WRITE, regardless of the original outcome');
{
  const replayedCases = [
    [WRITER_OUTCOME.SUCCESS_CREATED, { decisionId: DECISION_ID, resultLinkId: RESULT_LINK_ID }],
    [WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, {}],
    [WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE, { safeDiagnosticCode: 'MANUAL_PRECEDENCE' }],
    [WRITER_OUTCOME.INTERNAL_FAILURE, { safeDiagnosticCode: 'SQLSTATE_23503' }]
  ];
  for (const [outcome, extra] of replayedCases) {
    const result = buildWriterResult(outcome, { ...BASE, ...extra, replayed: true });
    const ledgerState = mapResultToLedgerState(result);
    assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.NO_LEDGER_WRITE, `replayed ${outcome} must map to NO_LEDGER_WRITE`);
    assert.equal(ledgerState.status, null);
    assert.equal(ledgerState.finalOutcome, outcome);
  }
}

console.log('  the same non-replayed result still maps to its original PERSIST_TERMINAL action');
{
  const result = buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, {
    ...BASE,
    decisionId: DECISION_ID,
    resultLinkId: RESULT_LINK_ID
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.PERSIST_TERMINAL);
  assert.equal(ledgerState.status, 'COMPLETED');
  assert.equal(ledgerState.finalOutcome, WRITER_OUTCOME.SUCCESS_CREATED);
}

console.log('  replayed handling takes precedence over normal outcome mapping (defensive: checked ahead of the switch)');
{
  // Constructed by hand (bypassing buildWriterResult's own outcome-eligibility
  // guard) specifically to prove mapResultToLedgerState's own precedence,
  // independent of the upstream contract that would normally prevent this
  // combination from ever being built.
  const handRolled = { outcome: WRITER_OUTCOME.CONFLICT_STALE_STATE, replayed: true, ...BASE };
  const ledgerState = mapResultToLedgerState(handRolled);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.NO_LEDGER_WRITE);
  assert.notEqual(ledgerState.ledgerAction, LEDGER_ACTION.RETAIN_CLAIMED);
}

console.log('  manual-precedence failure: terminal FAILED, lastErrorClass = MANUAL_PRECEDENCE, no decision/result IDs');
{
  const result = buildWriterResult(WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE, {
    ...BASE,
    observedActiveLinkId: PRIOR_LINK_ID,
    safeDiagnosticCode: 'MANUAL_PRECEDENCE'
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.PERSIST_TERMINAL);
  assert.equal(ledgerState.status, 'FAILED');
  assert.equal(ledgerState.finalOutcome, WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE);
  assert.equal(ledgerState.lastErrorClass, CANONICAL_ERROR_CLASS.MANUAL_PRECEDENCE);
  assert.equal(ledgerState.decisionId, null);
  assert.equal(ledgerState.resultLinkId, null);
}

console.log('  SQLSTATE_55000 (stale state) is NOT terminally persisted -- the claim stays CLAIMED for a retry');
{
  const result = buildWriterResult(WRITER_OUTCOME.CONFLICT_STALE_STATE, {
    ...BASE,
    rereadPerformed: true,
    retryPerformed: false,
    safeDiagnosticCode: 'SQLSTATE_55000'
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.RETAIN_CLAIMED);
  assert.equal(ledgerState.status, null);
  assert.equal(ledgerState.finalOutcome, null);
}

console.log('  CONFLICT_CONCURRENT_CHANGE is also left CLAIMED for a retry, never immediately FAILED');
{
  const result = buildWriterResult(WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE, {
    ...BASE,
    rereadPerformed: true,
    retryPerformed: true,
    safeDiagnosticCode: 'SQLSTATE_23505'
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.RETAIN_CLAIMED);
}

console.log('  retryable transaction outcome: nothing to persist, the whole transaction including the claim rolled back');
{
  const result = buildWriterResult(WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE, {
    ...BASE,
    safeDiagnosticCode: 'SQLSTATE_40001'
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.TRANSACTION_ROLLED_BACK);
  assert.equal(ledgerState.status, null);
}

console.log('  definitive non-manual-precedence failures map to FAILED with UNKNOWN fallback when no safe code is available');
{
  for (const outcome of [
    WRITER_OUTCOME.INVALID_PARENT_OR_TENANT,
    WRITER_OUTCOME.FORBIDDEN,
    WRITER_OUTCOME.INTERNAL_FAILURE
  ]) {
    const result = buildWriterResult(outcome, { ...BASE, safeDiagnosticCode: 'SQLSTATE_23503' });
    const ledgerState = mapResultToLedgerState(result);
    assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.PERSIST_TERMINAL);
    assert.equal(ledgerState.status, 'FAILED');
    assert.equal(ledgerState.finalOutcome, outcome);
    assert.equal(ledgerState.lastErrorClass, 'SQLSTATE_23503');
  }
}

console.log('  the canonical last_error_class vocabulary never includes hand-written semantic labels such as STALE_ACTIVE_LINK');
{
  const withHandWrittenLabel = buildWriterResult(WRITER_OUTCOME.INTERNAL_FAILURE, {
    ...BASE,
    safeDiagnosticCode: 'STALE_ACTIVE_LINK'
  });
  const ledgerState = mapResultToLedgerState(withHandWrittenLabel);
  assert.notEqual(ledgerState.lastErrorClass, 'STALE_ACTIVE_LINK');
  assert.equal(ledgerState.lastErrorClass, CANONICAL_ERROR_CLASS.UNKNOWN);
}

console.log('  the recovery invariant is documented: a no-row lookup right after a lost response does not by itself prove rollback');
{
  const moduleSource = readFileSync(
    fileURLToPath(new URL('../server/lib/projectLinkWriterResultLedgerMapper.js', import.meta.url)),
    'utf8'
  );
  assert.match(moduleSource, /RECOVERY INVARIANT/);
  assert.match(moduleSource, /may still genuinely be in\s*\* flight/);
  assert.match(moduleSource, /bounded polling/);
  assert.match(moduleSource, /idempotently re-invoking/);
  assert.match(moduleSource, /uniq_project_link_operations_org_key/);
}

console.log('  rejects a malformed result and an unhandled outcome');
{
  assert.throws(() => mapResultToLedgerState(null), /result è obbligatorio/);
  assert.throws(
    () => mapResultToLedgerState({ outcome: 'NOT_A_REAL_OUTCOME' }),
    /Esito non gestito/
  );
}

console.log('PASS: result-to-ledger mapper correctly distinguishes terminal, retained and ambiguous persistence');
