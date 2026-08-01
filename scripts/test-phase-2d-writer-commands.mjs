import assert from 'node:assert/strict';
import {
  SUBJECT_TYPE,
  DECISION_ORIGIN,
  COMMAND_TYPE,
  LIFECYCLE_OPERATION,
  buildManualConfirmationCommand,
  buildAutomaticDecisionCommand,
  isAutomaticDecisionOrigin
} from '../server/lib/projectLinkWriterCommands.js';
import * as commandsModule from '../server/lib/projectLinkWriterCommands.js';

console.log('Phase 2D.1B writer contract: command shapes');

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const SUBJECT_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const ACTIVE_LINK_ID = '30000000-0000-4000-8000-000000000001';
const FINGERPRINT = 'a'.repeat(64);

const serverContext = { organizationId: ORG_ID };

function baseSubject(overrides = {}) {
  return {
    subjectType: SUBJECT_TYPE.ORDER,
    subjectId: SUBJECT_ID,
    operationKey: 'op-1',
    requestFingerprint: FINGERPRINT,
    intendedProjectId: PROJECT_ID,
    ...overrides
  };
}

console.log('  no exported generic primitive constructor exists');
{
  assert.equal('buildProjectLinkCommand' in commandsModule, false);
  assert.equal('assembleCommand' in commandsModule, false);
}

console.log('  buildAutomaticDecisionCommand: CREATE_INITIAL_LINK shape');
{
  const command = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext,
    subject: baseSubject(),
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
  });
  assert.equal(command.type, COMMAND_TYPE.APPLY_AUTOMATIC_PROJECT_DECISION);
  assert.equal(command.lifecycleOperation, LIFECYCLE_OPERATION.CREATE_INITIAL_LINK);
  assert.equal(command.organizationId, ORG_ID);
  assert.equal(command.expectedActiveLinkId, null);
  assert.equal(command.requestFingerprint, FINGERPRINT);
  assert.equal(command.decisionOrigin, DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED);
  assert.ok(Object.isFrozen(command));
}

console.log('  expectedActiveLinkId required/forbidden rules per lifecycle operation');
{
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject({ expectedActiveLinkId: ACTIVE_LINK_ID }),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /expectedActiveLinkId non è ammesso/
  );

  const replaced = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.REPLACE_ACTIVE_LINK, {
    serverContext,
    subject: baseSubject({ expectedActiveLinkId: ACTIVE_LINK_ID }),
    decisionOrigin: DECISION_ORIGIN.EXACT_TRUSTED_REFERENCE
  });
  assert.equal(replaced.expectedActiveLinkId, ACTIVE_LINK_ID);

  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.REPLACE_ACTIVE_LINK, {
      serverContext,
      subject: baseSubject(),
      decisionOrigin: DECISION_ORIGIN.EXACT_TRUSTED_REFERENCE
    }),
    /expectedActiveLinkId è obbligatorio/
  );

  const ended = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.TERMINALLY_END_ACTIVE_LINK, {
    serverContext,
    subject: { ...baseSubject(), intendedProjectId: undefined, expectedActiveLinkId: ACTIVE_LINK_ID },
    decisionOrigin: DECISION_ORIGIN.IMPORTED_HISTORICAL
  });
  assert.equal(ended.intendedProjectId, null);

  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.TERMINALLY_END_ACTIVE_LINK, {
      serverContext,
      subject: baseSubject({ expectedActiveLinkId: ACTIVE_LINK_ID }),
      decisionOrigin: DECISION_ORIGIN.IMPORTED_HISTORICAL
    }),
    /intendedProjectId non è ammesso/
  );
}

console.log('  organization context must come from the server, never from caller input');
{
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext: { organizationId: 'not-a-uuid' },
      subject: baseSubject(),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /organizationId non valido/
  );
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext: undefined,
      subject: baseSubject(),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /organizationId non valido/
  );
  const command = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext,
    subject: { ...baseSubject(), organizationId: '99999999-0000-4000-8000-000000000099' },
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
  });
  assert.equal(command.organizationId, ORG_ID);
}

console.log('  invalid subject shapes are rejected');
{
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject({ subjectType: 'ROUTE' }),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /subjectType non valido/
  );
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject({ subjectId: 'not-a-uuid' }),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /subjectId non valido/
  );
}

console.log('  operationKey: empty, over the 255-char SQL limit, and containing external whitespace are rejected');
{
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject({ operationKey: '' }),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /operationKey non valido/
  );
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject({ operationKey: 'x'.repeat(256) }),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /operationKey non valido/
  );
  const maxLength = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext,
    subject: baseSubject({ operationKey: 'x'.repeat(255) }),
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
  });
  assert.equal(maxLength.operationKey.length, 255);
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject({ operationKey: '  op-1  ' }),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /operationKey non valido/
  );
}

console.log('  requestFingerprint: absent, malformed, wrong length and uppercase are rejected (matches ledger CHECK exactly)');
{
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: { ...baseSubject(), requestFingerprint: undefined },
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /requestFingerprint non valido/
  );
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject({ requestFingerprint: 'not-hex' }),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /requestFingerprint non valido/
  );
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject({ requestFingerprint: 'a'.repeat(63) }),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /requestFingerprint non valido/
  );
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject({ requestFingerprint: 'A'.repeat(64) }),
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    }),
    /requestFingerprint non valido/
  );
  const command = buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext,
    subject: baseSubject({ requestFingerprint: FINGERPRINT }),
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
  });
  assert.equal(command.requestFingerprint, FINGERPRINT);
}

console.log('  MANUAL_CONFIRMATION cannot be produced through the automatic wrapper, even if supplied');
{
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject(),
      decisionOrigin: DECISION_ORIGIN.MANUAL_CONFIRMATION
    }),
    /MANUAL_CONFIRMATION non è ammesso/
  );
  assert.throws(
    () => buildAutomaticDecisionCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
      serverContext,
      subject: baseSubject(),
      decisionOrigin: 'BOGUS'
    }),
    /decisionOrigin automatico non valido/
  );
}

console.log('  buildManualConfirmationCommand always forces MANUAL_CONFIRMATION and cannot be overridden');
{
  const command = buildManualConfirmationCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext,
    subject: baseSubject()
  });
  assert.equal(command.decisionOrigin, DECISION_ORIGIN.MANUAL_CONFIRMATION);
  assert.equal(command.type, COMMAND_TYPE.CONFIRM_PROJECT_MANUALLY);
  assert.equal(command.lifecycleOperation, LIFECYCLE_OPERATION.CREATE_INITIAL_LINK);

  // buildManualConfirmationCommand has no decisionOrigin parameter at all --
  // any attempt to pass one is simply ignored, it is never read.
  const attemptedOverride = buildManualConfirmationCommand(LIFECYCLE_OPERATION.CREATE_INITIAL_LINK, {
    serverContext,
    subject: baseSubject(),
    decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
  });
  assert.equal(attemptedOverride.decisionOrigin, DECISION_ORIGIN.MANUAL_CONFIRMATION);
}

console.log('  every command carries an explicit lifecycleOperation, no writer-side coalescing required');
{
  for (const lifecycleOperation of Object.values(LIFECYCLE_OPERATION)) {
    const subject = lifecycleOperation === LIFECYCLE_OPERATION.TERMINALLY_END_ACTIVE_LINK
      ? { ...baseSubject(), intendedProjectId: undefined, expectedActiveLinkId: ACTIVE_LINK_ID }
      : [LIFECYCLE_OPERATION.REPLACE_ACTIVE_LINK].includes(lifecycleOperation)
        ? baseSubject({ expectedActiveLinkId: ACTIVE_LINK_ID })
        : baseSubject();
    const manual = buildManualConfirmationCommand(lifecycleOperation, { serverContext, subject });
    assert.equal(manual.lifecycleOperation, lifecycleOperation);
    const automatic = buildAutomaticDecisionCommand(lifecycleOperation, {
      serverContext,
      subject,
      decisionOrigin: DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED
    });
    assert.equal(automatic.lifecycleOperation, lifecycleOperation);
  }
}

console.log('  isAutomaticDecisionOrigin classifies exactly the three non-manual origins');
{
  assert.equal(isAutomaticDecisionOrigin(DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED), true);
  assert.equal(isAutomaticDecisionOrigin(DECISION_ORIGIN.EXACT_TRUSTED_REFERENCE), true);
  assert.equal(isAutomaticDecisionOrigin(DECISION_ORIGIN.IMPORTED_HISTORICAL), true);
  assert.equal(isAutomaticDecisionOrigin(DECISION_ORIGIN.MANUAL_CONFIRMATION), false);
  assert.equal(isAutomaticDecisionOrigin('GARBAGE'), false);
}

console.log('PASS: writer command contract is validated and trust boundaries hold');
