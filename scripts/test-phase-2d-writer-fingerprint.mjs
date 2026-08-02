import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  computeRequestFingerprint,
  REQUEST_FINGERPRINT_VERSION
} from '../server/lib/projectLinkWriterFingerprint.js';
import { isValidRequestFingerprint } from '../server/lib/projectLinkWriterSafeAccess.js';
import {
  buildAutomaticDecisionCommand,
  buildManualConfirmationCommand,
  SUBJECT_TYPE,
  DECISION_ORIGIN,
  LIFECYCLE_OPERATION
} from '../server/lib/projectLinkWriterCommands.js';

console.log('Phase 2D.1B writer contract: canonical request fingerprint');

const ORG_A = '00000000-0000-4000-8000-000000000001';
const ORG_B = '00000000-0000-4000-8000-000000000002';
const ORDER_A = '10000000-0000-4000-8000-000000000001';
const PROJECT_A = '20000000-0000-4000-8000-000000000001';
const LINE_A = '30000000-0000-4000-8000-000000000001';

function automaticCreateCommand(overrides = {}) {
  return buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext: { organizationId: ORG_A },
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
    subject: {
      subjectType: SUBJECT_TYPE.ORDER,
      subjectId: ORDER_A,
      operationKey: 'op-1',
      requestFingerprint: 'a'.repeat(64),
      intendedProjectId: PROJECT_A,
      ...overrides
    }
  });
}

console.log('  1. deterministic known SHA-256 vector');
{
  const KNOWN_VECTOR = '027d1ecf49cf743481fa4bbd2925185bfbe559552325030a37104db88a274a56';
  const command = automaticCreateCommand();
  const fingerprint = computeRequestFingerprint(command);
  assert.equal(fingerprint, KNOWN_VECTOR);
  assert.equal(REQUEST_FINGERPRINT_VERSION, 1);
}

console.log('  2. exact canonical payload behavior (independently re-derived, not via the module itself)');
{
  const command = automaticCreateCommand();
  const expectedPayload = JSON.stringify({
    version: 1,
    subjectType: SUBJECT_TYPE.ORDER,
    subjectId: ORDER_A,
    lifecycleOperation: LIFECYCLE_OPERATION.CREATE_INITIAL_LINK,
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
    intendedProjectId: PROJECT_A,
    expectedActiveLinkId: null
  });
  const expected = createHashHex(expectedPayload);
  assert.equal(computeRequestFingerprint(command), expected);
}

console.log('  3. same semantic command produces the same fingerprint');
{
  const a = computeRequestFingerprint(automaticCreateCommand());
  const b = computeRequestFingerprint(automaticCreateCommand());
  assert.equal(a, b);
}

console.log('  4. organizationId changes do not change the fingerprint');
{
  const commandOrgA = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext: { organizationId: ORG_A },
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
    subject: {
      subjectType: SUBJECT_TYPE.ORDER,
      subjectId: ORDER_A,
      operationKey: 'op-1',
      requestFingerprint: 'a'.repeat(64),
      intendedProjectId: PROJECT_A
    }
  });
  const commandOrgB = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext: { organizationId: ORG_B },
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
    subject: {
      subjectType: SUBJECT_TYPE.ORDER,
      subjectId: ORDER_A,
      operationKey: 'op-1',
      requestFingerprint: 'a'.repeat(64),
      intendedProjectId: PROJECT_A
    }
  });
  assert.equal(computeRequestFingerprint(commandOrgA), computeRequestFingerprint(commandOrgB));
}

console.log('  5. operationKey changes do not change the fingerprint');
{
  const commandKey1 = automaticCreateCommand({ operationKey: 'op-1' });
  const commandKey2 = automaticCreateCommand({ operationKey: 'op-2-totally-different' });
  assert.equal(computeRequestFingerprint(commandKey1), computeRequestFingerprint(commandKey2));
}

console.log('  6. uppercase/lowercase UUID differences do not change the fingerprint (lettered fixtures, not numeric-only)');
{
  // Deliberately using UUIDs whose hex letters (a-f) actually differ in
  // case between the two forms -- ORDER_A/PROJECT_A/LINE_A above are
  // numeric-only (0-9), so .toUpperCase() on them is a no-op and would let
  // this test pass even with lowercase normalization completely removed
  // from the implementation. These fixtures are chosen so that cannot
  // happen.
  const LOWER_SUBJECT_ID = 'aabbccdd-eeff-4011-8fed-cba987654321';
  const LOWER_INTENDED_PROJECT_ID = 'facefeed-babe-4022-9dec-123456abcdef';
  const LOWER_EXPECTED_ACTIVE_LINK_ID = 'deadbeef-cafe-4033-8bad-f00dfeedface';

  const UPPER_SUBJECT_ID = LOWER_SUBJECT_ID.toUpperCase();
  const UPPER_INTENDED_PROJECT_ID = LOWER_INTENDED_PROJECT_ID.toUpperCase();
  const UPPER_EXPECTED_ACTIVE_LINK_ID = LOWER_EXPECTED_ACTIVE_LINK_ID.toUpperCase();

  // Explicit precondition: prove the lowercase and uppercase fixtures are
  // actually visibly different strings before relying on them to prove
  // anything about normalization.
  assert.notEqual(LOWER_SUBJECT_ID, UPPER_SUBJECT_ID, 'subjectId fixture must contain a-f letters whose case actually differs');
  assert.notEqual(LOWER_INTENDED_PROJECT_ID, UPPER_INTENDED_PROJECT_ID, 'intendedProjectId fixture must contain a-f letters whose case actually differs');
  assert.notEqual(LOWER_EXPECTED_ACTIVE_LINK_ID, UPPER_EXPECTED_ACTIVE_LINK_ID, 'expectedActiveLinkId fixture must contain a-f letters whose case actually differs');
  assert.equal(LOWER_SUBJECT_ID.toLowerCase(), LOWER_SUBJECT_ID);
  assert.equal(LOWER_INTENDED_PROJECT_ID.toLowerCase(), LOWER_INTENDED_PROJECT_ID);
  assert.equal(LOWER_EXPECTED_ACTIVE_LINK_ID.toLowerCase(), LOWER_EXPECTED_ACTIVE_LINK_ID);

  // REPLACE_ACTIVE_LINK exercises all three lettered UUID fields at once
  // (subjectId, intendedProjectId, expectedActiveLinkId).
  function replaceCommandWith({ subjectId, intendedProjectId, expectedActiveLinkId }) {
    return buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.REPLACE_ACTIVE_LINK, {
      serverContext: { organizationId: ORG_A },
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
      subject: {
        subjectType: SUBJECT_TYPE.ORDER,
        subjectId,
        operationKey: 'op-1',
        requestFingerprint: 'a'.repeat(64),
        intendedProjectId,
        expectedActiveLinkId
      }
    });
  }

  const lowerCommand = replaceCommandWith({
    subjectId: LOWER_SUBJECT_ID,
    intendedProjectId: LOWER_INTENDED_PROJECT_ID,
    expectedActiveLinkId: LOWER_EXPECTED_ACTIVE_LINK_ID
  });
  const upperCommand = replaceCommandWith({
    subjectId: UPPER_SUBJECT_ID,
    intendedProjectId: UPPER_INTENDED_PROJECT_ID,
    expectedActiveLinkId: UPPER_EXPECTED_ACTIVE_LINK_ID
  });

  assert.equal(
    computeRequestFingerprint(lowerCommand),
    computeRequestFingerprint(upperCommand),
    'commands differing only in UUID letter case must produce the same fingerprint'
  );
}

console.log('  7. null and absent optional IDs normalize identically');
{
  const terminate = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.TERMINALLY_END_ACTIVE_LINK, {
    serverContext: { organizationId: ORG_A },
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
    subject: {
      subjectType: SUBJECT_TYPE.ORDER,
      subjectId: ORDER_A,
      operationKey: 'op-1',
      requestFingerprint: 'a'.repeat(64),
      expectedActiveLinkId: LINE_A
    }
  });
  // intendedProjectId is normalized to null by the command builder itself
  // for TERMINALLY_END_ACTIVE_LINK -- confirm the fingerprint module treats
  // that null identically to an absent property on a hand-built object.
  const fromCommand = computeRequestFingerprint(terminate);
  const handBuilt = computeRequestFingerprint({
    subjectType: SUBJECT_TYPE.ORDER,
    subjectId: ORDER_A,
    lifecycleOperation: LIFECYCLE_OPERATION.TERMINALLY_END_ACTIVE_LINK,
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
    expectedActiveLinkId: LINE_A
    // intendedProjectId entirely absent, not even null
  });
  assert.equal(fromCommand, handBuilt);
}

console.log('  8. changing each included semantic field changes the fingerprint');
{
  const base = automaticCreateCommand();
  const baseFingerprint = computeRequestFingerprint(base);

  const differentSubjectType = { ...base, subjectType: SUBJECT_TYPE.LINE, subjectId: LINE_A };
  assert.notEqual(computeRequestFingerprint(differentSubjectType), baseFingerprint);

  const differentSubjectId = { ...base, subjectId: '10000000-0000-4000-8000-000000000099' };
  assert.notEqual(computeRequestFingerprint(differentSubjectId), baseFingerprint);

  const replaceCommand = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.REPLACE_ACTIVE_LINK, {
    serverContext: { organizationId: ORG_A },
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
    subject: {
      subjectType: SUBJECT_TYPE.ORDER,
      subjectId: ORDER_A,
      operationKey: 'op-1',
      requestFingerprint: 'a'.repeat(64),
      intendedProjectId: PROJECT_A,
      expectedActiveLinkId: LINE_A
    }
  });
  assert.notEqual(computeRequestFingerprint(replaceCommand), baseFingerprint);

  const differentOrigin = { ...base, decisionOrigin: DECISION_ORIGIN.EXACT_TRUSTED_REFERENCE };
  assert.notEqual(computeRequestFingerprint(differentOrigin), baseFingerprint);

  const differentIntendedProject = { ...base, intendedProjectId: '20000000-0000-4000-8000-000000000099' };
  assert.notEqual(computeRequestFingerprint(differentIntendedProject), baseFingerprint);

  assert.notEqual(computeRequestFingerprint(replaceCommand), computeRequestFingerprint(automaticCreateCommand()));
}

console.log('  9. unrelated extra fields do not change the fingerprint');
{
  const base = automaticCreateCommand();
  const withExtra = {
    ...base,
    organizationId: ORG_B,
    operationKey: 'something-else',
    requestFingerprint: 'b'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z',
    somethingUnexpected: { nested: true }
  };
  assert.equal(computeRequestFingerprint(withExtra), computeRequestFingerprint(base));
}

console.log('  10. output is lowercase, 64 hex characters, and passes isValidRequestFingerprint');
{
  const fingerprint = computeRequestFingerprint(automaticCreateCommand());
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint, fingerprint.toLowerCase());
  assert.equal(isValidRequestFingerprint(fingerprint), true);
}

console.log('  11. malformed command is rejected');
{
  assert.throws(() => computeRequestFingerprint(null), /command è obbligatorio/);
  assert.throws(() => computeRequestFingerprint('not-an-object'), /command è obbligatorio/);
  assert.throws(() => computeRequestFingerprint({}), /subjectType non valido/);
  assert.throws(
    () => computeRequestFingerprint({ ...automaticCreateCommand(), subjectType: 'NOT_A_TYPE' }),
    /subjectType non valido/
  );
  assert.throws(
    () => computeRequestFingerprint({ ...automaticCreateCommand(), subjectId: 'not-a-uuid' }),
    /subjectId non valido/
  );
  assert.throws(
    () => computeRequestFingerprint({ ...automaticCreateCommand(), lifecycleOperation: 'NOT_REAL' }),
    /lifecycleOperation non valido/
  );
  assert.throws(
    () => computeRequestFingerprint({ ...automaticCreateCommand(), decisionOrigin: 'NOT_REAL' }),
    /decisionOrigin non valido/
  );
  assert.throws(
    () => computeRequestFingerprint({ ...automaticCreateCommand(), intendedProjectId: 'not-a-uuid' }),
    /intendedProjectId non valido/
  );
  assert.throws(
    () => computeRequestFingerprint({ ...automaticCreateCommand(), expectedActiveLinkId: ['array'] }),
    /expectedActiveLinkId non valido/
  );
}

console.log('  12. hostile getters are never invoked');
{
  let getterInvoked = false;
  const base = automaticCreateCommand();
  const hostile = { ...base };
  Object.defineProperty(hostile, 'subjectId', {
    enumerable: true,
    get() { getterInvoked = true; return base.subjectId; }
  });
  assert.throws(() => computeRequestFingerprint(hostile), /subjectId non valido/);
  assert.equal(getterInvoked, false, 'the hostile getter must never be invoked');
}

console.log('  13. buildManualConfirmationCommand produces a fingerprintable command too');
{
  const manual = buildManualConfirmationCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext: { organizationId: ORG_A },
    subject: {
      subjectType: SUBJECT_TYPE.ORDER,
      subjectId: ORDER_A,
      operationKey: 'op-manual',
      requestFingerprint: 'a'.repeat(64),
      intendedProjectId: PROJECT_A
    }
  });
  const fingerprint = computeRequestFingerprint(manual);
  assert.equal(isValidRequestFingerprint(fingerprint), true);
  assert.notEqual(fingerprint, computeRequestFingerprint(automaticCreateCommand()));
}

console.log('PASS: canonical request fingerprint is deterministic, closed and hostile-getter-safe');

// Local helper only for test 2's independent re-derivation, not imported
// from the module under test.
function createHashHex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
