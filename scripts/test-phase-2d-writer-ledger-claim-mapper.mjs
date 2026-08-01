import assert from 'node:assert/strict';
import {
  LIFECYCLE_OPERATION,
  DECISION_ORIGIN,
  COMMAND_TYPE,
  buildManualConfirmationCommand,
  buildAutomaticDecisionCommand
} from '../server/lib/projectLinkWriterCommands.js';
import { mapCommandToLedgerClaim } from '../server/lib/projectLinkWriterLedgerClaimMapper.js';

console.log('Phase 2D.1B writer contract: pure ledger-claim mapper');

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const SUBJECT_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const ACTIVE_LINK_ID = '30000000-0000-4000-8000-000000000001';
const FINGERPRINT = 'a'.repeat(64);
const serverContext = { organizationId: ORG_ID };

function baseSubject(overrides = {}) {
  return {
    subjectType: 'ORDER',
    subjectId: SUBJECT_ID,
    operationKey: 'op-1',
    requestFingerprint: FINGERPRINT,
    intendedProjectId: PROJECT_ID,
    ...overrides
  };
}

console.log('  maps a wrapper (automatic) primitive command to the exact ledger claim shape');
{
  const command = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext,
    subject: baseSubject(),
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
  });
  const claim = mapCommandToLedgerClaim(command);
  assert.deepEqual(claim, {
    organizationId: ORG_ID,
    operationKey: 'op-1',
    requestFingerprint: FINGERPRINT,
    subjectType: 'ORDER',
    subjectId: SUBJECT_ID,
    operationType: COMMAND_TYPE.APPLY_AUTOMATIC_PROJECT_DECISION,
    lifecycleOperation: LIFECYCLE_OPERATION.CREATE_INITIAL_LINK,
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
    intendedProjectId: PROJECT_ID,
    expectedActiveLinkId: null
  });
  assert.ok(Object.isFrozen(claim));
}

console.log('  maps a manual-confirmation command, including a terminal-end shape with no intended project');
{
  const command = buildManualConfirmationCommand(LIFECYCLE_OPERATION.TERMINALLY_END_ACTIVE_LINK, {
    serverContext,
    subject: { ...baseSubject(), intendedProjectId: undefined, expectedActiveLinkId: ACTIVE_LINK_ID }
  });
  const claim = mapCommandToLedgerClaim(command);
  assert.equal(claim.operationType, COMMAND_TYPE.CONFIRM_PROJECT_MANUALLY);
  assert.equal(claim.decisionOrigin, DECISION_ORIGIN.MANUAL_CONFIRMATION);
  assert.equal(claim.lifecycleOperation, LIFECYCLE_OPERATION.TERMINALLY_END_ACTIVE_LINK);
  assert.equal(claim.intendedProjectId, null);
  assert.equal(claim.expectedActiveLinkId, ACTIVE_LINK_ID);
}

console.log('  maps a replace command with an expected active link');
{
  const command = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.REPLACE_ACTIVE_LINK, {
    serverContext,
    subject: baseSubject({ expectedActiveLinkId: ACTIVE_LINK_ID }),
    decisionOrigin: DECISION_ORIGIN.EXACT_TRUSTED_REFERENCE
  });
  const claim = mapCommandToLedgerClaim(command);
  assert.equal(claim.expectedActiveLinkId, ACTIVE_LINK_ID);
  assert.equal(claim.lifecycleOperation, LIFECYCLE_OPERATION.REPLACE_ACTIVE_LINK);
}

console.log('  never reads organizationId from anywhere but command.organizationId');
{
  const command = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext,
    subject: baseSubject(),
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
  });
  const tampered = { ...command, subject: { organizationId: 'attacker-supplied' } };
  const claim = mapCommandToLedgerClaim(tampered);
  assert.equal(claim.organizationId, ORG_ID);
}

console.log('  rejects a malformed or incomplete command defensively, even though the command builder already validated it');
{
  const command = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext,
    subject: baseSubject(),
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
  });

  assert.throws(() => mapCommandToLedgerClaim(null), /command è obbligatorio/);
  assert.throws(
    () => mapCommandToLedgerClaim({ ...command, organizationId: 'not-a-uuid' }),
    /command.organizationId non valido/
  );
  assert.throws(
    () => mapCommandToLedgerClaim({ ...command, requestFingerprint: 'too-short' }),
    /command.requestFingerprint non valido/
  );
  assert.throws(
    () => mapCommandToLedgerClaim({ ...command, operationKey: '' }),
    /command.operationKey non valido/
  );
  assert.throws(
    () => mapCommandToLedgerClaim({ ...command, subjectType: 'ROUTE' }),
    /command.subjectType non valido/
  );
  assert.throws(
    () => mapCommandToLedgerClaim({ ...command, type: 'CREATE_INITIAL_LINK' }),
    /command.type non valido/
  );
  assert.throws(
    () => mapCommandToLedgerClaim({ ...command, lifecycleOperation: 'BOGUS' }),
    /command.lifecycleOperation non valido/
  );
  assert.throws(
    () => mapCommandToLedgerClaim({ ...command, decisionOrigin: 'BOGUS' }),
    /command.decisionOrigin non valido/
  );
  assert.throws(
    () => mapCommandToLedgerClaim({ ...command, intendedProjectId: 'not-a-uuid' }),
    /command.intendedProjectId non valido/
  );
}

console.log('PASS: ledger-claim mapper produces the exact tenant-safe, deterministic claim shape');
