import assert from 'node:assert/strict';
import {
  WRITER_OUTCOME,
  buildWriterResult,
  isSuccessOutcome,
  isConflictOutcome,
  requiresManualReview
} from '../server/lib/projectLinkWriterResult.js';

console.log('Phase 2D.1B writer contract: result model');

const BASE = {
  operationKey: 'op-1',
  subjectType: 'ORDER',
  subjectId: '10000000-0000-4000-8000-000000000001',
  attempt: 1
};
const UUID_A = '30000000-0000-4000-8000-000000000001';
const UUID_B = '30000000-0000-4000-8000-000000000002';
const UUID_C = '30000000-0000-4000-8000-000000000003';

console.log('  every declared outcome type builds successfully with its required metadata');
for (const outcome of Object.values(WRITER_OUTCOME)) {
  const metadata = { ...BASE };
  switch (outcome) {
    case WRITER_OUTCOME.SUCCESS_CREATED:
    case WRITER_OUTCOME.SUCCESS_REACTIVATED:
      metadata.decisionId = UUID_A;
      metadata.resultLinkId = UUID_B;
      break;
    case WRITER_OUTCOME.SUCCESS_REPLACED:
      metadata.decisionId = UUID_A;
      metadata.resultLinkId = UUID_B;
      metadata.priorLinkId = UUID_C;
      break;
    case WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED:
      metadata.decisionId = UUID_A;
      metadata.priorLinkId = UUID_C;
      break;
    case WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT:
      // Intentionally no result identifiers -- see the dedicated no-op test below.
      break;
    case WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE:
    case WRITER_OUTCOME.CONFLICT_STALE_STATE:
      metadata.rereadPerformed = true;
      metadata.retryPerformed = false;
      metadata.safeDiagnosticCode = 'SQLSTATE_23505';
      break;
    default:
      metadata.safeDiagnosticCode = 'SOME_CODE';
  }
  const result = buildWriterResult(outcome, metadata);
  assert.equal(result.outcome, outcome);
  assert.ok(Object.isFrozen(result));
}

console.log('  BLOCKER FIX: SUCCESS_ALREADY_CURRENT is valid without decisionId, priorLinkId or resultLinkId');
{
  const result = buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE });
  assert.equal(result.outcome, WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT);
  assert.equal('decisionId' in result, false);
  assert.equal('priorLinkId' in result, false);
  assert.equal('resultLinkId' in result, false);

  // Still valid if some/all of those identifiers happen to be known.
  const withResult = buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, {
    ...BASE,
    resultLinkId: UUID_A
  });
  assert.equal(withResult.resultLinkId, UUID_A);
}

console.log('  missing required fields are rejected');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, { ...BASE }),
    /Campo obbligatorio mancante.*decisionId/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE, { ...BASE, safeDiagnosticCode: 'X' }),
    /Campo obbligatorio mancante.*rereadPerformed/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, { subjectType: 'ORDER' }),
    /Campo obbligatorio mancante/
  );
}

console.log('  unknown outcomes are rejected');
{
  assert.throws(() => buildWriterResult('NOT_A_REAL_OUTCOME', BASE), /Esito non valido/);
}

console.log('  the metadata container itself must be a plain object');
{
  assert.throws(() => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, [BASE]), /oggetto semplice/);
  assert.throws(() => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, new Error('x')), /oggetto semplice/);
  assert.throws(() => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, () => {}), /oggetto semplice/);
}

console.log('  malformed field values are rejected by type, not merely by presence');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, { ...BASE, decisionId: 'not-a-uuid', resultLinkId: UUID_A }),
    /Valore non valido.*decisionId/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, { ...BASE, decisionId: UUID_A, resultLinkId: [UUID_A] }),
    /Valore non valido.*resultLinkId/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, { ...BASE, decisionId: { id: UUID_A }, resultLinkId: UUID_A }),
    /Valore non valido.*decisionId/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, { ...BASE, decisionId: () => UUID_A, resultLinkId: UUID_A }),
    /Valore non valido.*decisionId/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, { ...BASE, decisionId: Symbol('x'), resultLinkId: UUID_A }),
    /Valore non valido.*decisionId/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, { ...BASE, attempt: 1.5, decisionId: UUID_A, resultLinkId: UUID_A }),
    /Valore non valido.*attempt/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, { ...BASE, attempt: -1, decisionId: UUID_A, resultLinkId: UUID_A }),
    /Valore non valido.*attempt/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE, {
      ...BASE, rereadPerformed: 'yes', retryPerformed: false, safeDiagnosticCode: 'X'
    }),
    /Valore non valido.*rereadPerformed/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.INTERNAL_FAILURE, { ...BASE, safeDiagnosticCode: 'not-uppercase' }),
    /Valore non valido.*safeDiagnosticCode/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.INTERNAL_FAILURE, { ...BASE, safeDiagnosticCode: 'x'.repeat(200) }),
    /Valore non valido.*safeDiagnosticCode/
  );
}

console.log('  hostile getters on the metadata object never execute');
{
  let getterInvoked = false;
  const hostile = { ...BASE };
  Object.defineProperty(hostile, 'decisionId', {
    enumerable: true,
    get() { getterInvoked = true; return UUID_A; }
  });
  Object.defineProperty(hostile, 'resultLinkId', { enumerable: true, value: UUID_B });
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, hostile),
    /Campo obbligatorio mancante.*decisionId/
  );
  assert.equal(getterInvoked, false, 'the hostile getter must never be invoked');
}

console.log('  unlisted/unsafe fields never survive into the built result');
{
  const result = buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, {
    ...BASE,
    rawDatabaseMessage: 'duplicate key value violates unique constraint "uniq_order_project_links_active"',
    connectionString: 'postgres://user:pass@host/db',
    somethingUnexpected: 'value'
  });
  assert.equal('rawDatabaseMessage' in result, false);
  assert.equal('connectionString' in result, false);
  assert.equal('somethingUnexpected' in result, false);
}

console.log('  fields not applicable to a given outcome are dropped even if supplied');
{
  const result = buildWriterResult(WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED, {
    ...BASE,
    decisionId: UUID_A,
    priorLinkId: UUID_C,
    resultLinkId: UUID_B
  });
  assert.equal('resultLinkId' in result, false);
}

console.log('  classification helpers');
{
  assert.equal(isSuccessOutcome(WRITER_OUTCOME.SUCCESS_CREATED), true);
  assert.equal(isSuccessOutcome(WRITER_OUTCOME.CONFLICT_STALE_STATE), false);
  assert.equal(isConflictOutcome(WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE), true);
  assert.equal(isConflictOutcome(WRITER_OUTCOME.CONFLICT_STALE_STATE), true);
  assert.equal(isConflictOutcome(WRITER_OUTCOME.SUCCESS_CREATED), false);
  assert.equal(requiresManualReview(WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE), true);
  assert.equal(requiresManualReview(WRITER_OUTCOME.CONFLICT_STALE_STATE), false);
}

console.log('PASS: writer result model is closed, strictly typed and correctly validated');
