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

console.log('  CONFLICT_STALE_STATE (canonical 23505/55000): the atomic writer rolls the claim back together with the canonical mutation attempt -- TRANSACTION_ROLLED_BACK, never a durably-retained CLAIMED row');
{
  const result = buildWriterResult(WRITER_OUTCOME.CONFLICT_STALE_STATE, {
    ...BASE,
    rereadPerformed: true,
    retryPerformed: false,
    safeDiagnosticCode: 'SQLSTATE_55000'
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.TRANSACTION_ROLLED_BACK);
  assert.notEqual(ledgerState.ledgerAction, LEDGER_ACTION.RETAIN_CLAIMED);
  assert.equal(ledgerState.status, null);
  assert.equal(ledgerState.finalOutcome, null);
}

console.log('  CONFLICT_CONCURRENT_CHANGE: same TRANSACTION_ROLLED_BACK treatment -- the ledger-key claim and any attempted canonical mutation are rolled back together, no durable CLAIMED row survives');
{
  const result = buildWriterResult(WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE, {
    ...BASE,
    rereadPerformed: true,
    retryPerformed: true,
    safeDiagnosticCode: 'SQLSTATE_23505'
  });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.TRANSACTION_ROLLED_BACK);
  assert.notEqual(ledgerState.ledgerAction, LEDGER_ACTION.RETAIN_CLAIMED);
  assert.equal(ledgerState.status, null);
  assert.equal(ledgerState.finalOutcome, null);
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

console.log('  INTERNAL_FAILURE (the one non-manual-precedence failure that always occurs post-claim) maps to FAILED with UNKNOWN fallback when no safe code is available');
{
  const result = buildWriterResult(WRITER_OUTCOME.INTERNAL_FAILURE, { ...BASE, safeDiagnosticCode: 'SQLSTATE_23503' });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.PERSIST_TERMINAL);
  assert.equal(ledgerState.status, 'FAILED');
  assert.equal(ledgerState.finalOutcome, WRITER_OUTCOME.INTERNAL_FAILURE);
  assert.equal(ledgerState.lastErrorClass, 'SQLSTATE_23503');
}

console.log('  INVALID_PARENT_OR_TENANT maps to NO_LEDGER_WRITE -- the claim insert itself can be rejected (SQLSTATE 23503) before any operation row exists');
{
  const result = buildWriterResult(WRITER_OUTCOME.INVALID_PARENT_OR_TENANT, { ...BASE, safeDiagnosticCode: 'SQLSTATE_23503' });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.NO_LEDGER_WRITE);
  assert.notEqual(ledgerState.ledgerAction, LEDGER_ACTION.PERSIST_TERMINAL);
  assert.equal(ledgerState.status, null);
  assert.equal(ledgerState.finalOutcome, WRITER_OUTCOME.INVALID_PARENT_OR_TENANT);
  assert.equal(ledgerState.decisionId, null);
  assert.equal(ledgerState.priorLinkId, null);
  assert.equal(ledgerState.resultLinkId, null);
}

console.log('  FORBIDDEN maps to NO_LEDGER_WRITE -- SQLSTATE 42501 can occur before the claim insert succeeds, with no privilege basis to terminalize a row that was never created');
{
  const result = buildWriterResult(WRITER_OUTCOME.FORBIDDEN, { ...BASE, safeDiagnosticCode: 'SQLSTATE_42501' });
  const ledgerState = mapResultToLedgerState(result);
  assert.equal(ledgerState.ledgerAction, LEDGER_ACTION.NO_LEDGER_WRITE);
  assert.notEqual(ledgerState.ledgerAction, LEDGER_ACTION.PERSIST_TERMINAL);
  assert.equal(ledgerState.status, null);
  assert.equal(ledgerState.finalOutcome, WRITER_OUTCOME.FORBIDDEN);
  assert.equal(ledgerState.decisionId, null);
  assert.equal(ledgerState.priorLinkId, null);
  assert.equal(ledgerState.resultLinkId, null);
}

console.log('  no final WRITER_OUTCOME maps to RETAIN_CLAIMED after this correction');
{
  const minimumMetadataByOutcome = {
    [WRITER_OUTCOME.SUCCESS_CREATED]: { decisionId: DECISION_ID, resultLinkId: RESULT_LINK_ID },
    [WRITER_OUTCOME.SUCCESS_REACTIVATED]: { decisionId: DECISION_ID, resultLinkId: RESULT_LINK_ID },
    [WRITER_OUTCOME.SUCCESS_REPLACED]: { decisionId: DECISION_ID, resultLinkId: RESULT_LINK_ID, priorLinkId: PRIOR_LINK_ID },
    [WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED]: { decisionId: DECISION_ID, priorLinkId: PRIOR_LINK_ID },
    [WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT]: {},
    [WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE]: { rereadPerformed: true, retryPerformed: false, safeDiagnosticCode: 'SQLSTATE_23505' },
    [WRITER_OUTCOME.CONFLICT_STALE_STATE]: { rereadPerformed: true, retryPerformed: false, safeDiagnosticCode: 'SQLSTATE_55000' },
    [WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE]: { safeDiagnosticCode: 'SQLSTATE_23505' },
    [WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE]: { safeDiagnosticCode: 'MANUAL_PRECEDENCE' },
    [WRITER_OUTCOME.INVALID_PARENT_OR_TENANT]: { safeDiagnosticCode: 'SQLSTATE_23503' },
    [WRITER_OUTCOME.FORBIDDEN]: { safeDiagnosticCode: 'SQLSTATE_42501' },
    [WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE]: { safeDiagnosticCode: 'SQLSTATE_40001' },
    [WRITER_OUTCOME.AMBIGUOUS_COMMIT]: { safeDiagnosticCode: 'SQLSTATE_57014' },
    [WRITER_OUTCOME.INTERNAL_FAILURE]: { safeDiagnosticCode: 'UNKNOWN' }
  };
  let checked = 0;
  for (const outcome of Object.values(WRITER_OUTCOME)) {
    const extra = minimumMetadataByOutcome[outcome];
    assert.ok(extra !== undefined, `every WRITER_OUTCOME must be covered by this test's minimum-metadata table: ${outcome}`);
    const result = buildWriterResult(outcome, { ...BASE, ...extra });
    const ledgerState = mapResultToLedgerState(result);
    assert.notEqual(ledgerState.ledgerAction, LEDGER_ACTION.RETAIN_CLAIMED, `${outcome} must not map to RETAIN_CLAIMED`);
    checked += 1;
  }
  assert.equal(checked, Object.values(WRITER_OUTCOME).length, 'every declared WRITER_OUTCOME must have been exercised');
}

console.log('  NO_LEDGER_WRITE and TRANSACTION_ROLLED_BACK results never carry a non-null status or any field that could be mistaken for ledger-write authorization');
{
  const noWriteAndRolledBackCases = [
    [WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE, { safeDiagnosticCode: 'SQLSTATE_23505' }],
    [WRITER_OUTCOME.INVALID_PARENT_OR_TENANT, { safeDiagnosticCode: 'SQLSTATE_23503' }],
    [WRITER_OUTCOME.FORBIDDEN, { safeDiagnosticCode: 'SQLSTATE_42501' }],
    [WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE, { rereadPerformed: true, retryPerformed: true, safeDiagnosticCode: 'SQLSTATE_23505' }],
    [WRITER_OUTCOME.CONFLICT_STALE_STATE, { rereadPerformed: true, retryPerformed: false, safeDiagnosticCode: 'SQLSTATE_55000' }],
    [WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE, { safeDiagnosticCode: 'SQLSTATE_40001' }]
  ];
  for (const [outcome, extra] of noWriteAndRolledBackCases) {
    const result = buildWriterResult(outcome, { ...BASE, ...extra });
    const ledgerState = mapResultToLedgerState(result);
    assert.ok(
      ledgerState.ledgerAction === LEDGER_ACTION.NO_LEDGER_WRITE || ledgerState.ledgerAction === LEDGER_ACTION.TRANSACTION_ROLLED_BACK,
      `${outcome} must map to NO_LEDGER_WRITE or TRANSACTION_ROLLED_BACK`
    );
    assert.equal(ledgerState.status, null, `${outcome}: status must be null, never authorizing a write`);
    assert.equal(ledgerState.decisionId, null, `${outcome}: decisionId must be null`);
    assert.equal(ledgerState.priorLinkId, null, `${outcome}: priorLinkId must be null`);
    assert.equal(ledgerState.resultLinkId, null, `${outcome}: resultLinkId must be null`);
    assert.equal(ledgerState.lastErrorClass, null, `${outcome}: lastErrorClass must be null`);
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
