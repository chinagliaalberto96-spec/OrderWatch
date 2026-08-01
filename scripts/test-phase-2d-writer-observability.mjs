import assert from 'node:assert/strict';
import {
  buildWriterObservabilityPayload,
  WRITER_OBSERVABILITY_PAYLOAD_KEYS
} from '../server/lib/projectLinkWriterObservability.js';

console.log('Phase 2D.1B writer contract: observability payload');

const FULL_INPUT = {
  operationKey: 'op-1',
  organizationId: '00000000-0000-4000-8000-000000000001',
  subjectType: 'ORDER',
  subjectId: '10000000-0000-4000-8000-000000000001',
  operationType: 'REPLACE_ACTIVE_LINK',
  observedActiveLinkId: '30000000-0000-4000-8000-000000000001',
  intendedProjectId: '20000000-0000-4000-8000-000000000001',
  decisionOrigin: 'MANUAL_CONFIRMATION',
  attempt: 1,
  outcome: 'SUCCESS_REPLACED',
  decisionId: '40000000-0000-4000-8000-000000000001',
  resultLinkId: '30000000-0000-4000-8000-000000000002',
  safeConstraint: 'uniq_order_project_links_active',
  rereadPerformed: false,
  retryPerformed: false,
  durationMs: 42
};

console.log('  stable, ordered, closed key set');
{
  const payload = buildWriterObservabilityPayload(FULL_INPUT);
  assert.deepEqual(
    Object.keys(payload),
    WRITER_OBSERVABILITY_PAYLOAD_KEYS.filter((key) => FULL_INPUT[key] !== undefined)
  );
  assert.ok(Object.isFrozen(payload));
}

console.log('  undefined and null values are removed, not emitted as null/undefined keys');
{
  const payload = buildWriterObservabilityPayload({
    operationKey: 'op-1',
    organizationId: undefined,
    subjectType: 'ORDER',
    subjectId: '10000000-0000-4000-8000-000000000001',
    attempt: 1,
    sqlstate: null
  });
  assert.equal('organizationId' in payload, false);
  assert.equal('sqlstate' in payload, false);
  assert.equal(payload.operationKey, 'op-1');
}

console.log('  fields outside the allow-list are silently dropped');
{
  const payload = buildWriterObservabilityPayload({
    operationKey: 'op-1',
    unexpectedField: 'should never appear'
  });
  assert.equal('unexpectedField' in payload, false);
}

console.log('  the input container itself must be a plain object');
{
  assert.throws(() => buildWriterObservabilityPayload(['op-1']), /oggetto semplice/);
  assert.throws(() => buildWriterObservabilityPayload(new Error('boom')), /oggetto semplice/);
  assert.throws(() => buildWriterObservabilityPayload(() => {}), /oggetto semplice/);
}

console.log('  a raw Error object passed as a field value is rejected, not stringified');
{
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: 'op-1', safeConstraint: new Error('boom') }),
    /valore non valido/
  );
}

console.log('  a nested object or array passed as a field value is rejected');
{
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: 'op-1', safeConstraint: { nested: true } }),
    /valore non valido/
  );
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: 'op-1', safeConstraint: ['a', 'b'] }),
    /valore non valido/
  );
}

console.log('  a function or symbol passed as a field value is rejected');
{
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: 'op-1', safeConstraint: () => 'x' }),
    /valore non valido/
  );
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: 'op-1', safeConstraint: Symbol('x') }),
    /valore non valido/
  );
}

console.log('  malformed UUID/enum/number fields are rejected by type, not merely stringified');
{
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: 'op-1', subjectId: 'not-a-uuid' }),
    /valore non valido.*subjectId/
  );
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: 'op-1', subjectType: 'ROUTE' }),
    /valore non valido.*subjectType/
  );
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: 'op-1', attempt: -1 }),
    /valore non valido.*attempt/
  );
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: 'op-1', durationMs: -5 }),
    /valore non valido.*durationMs/
  );
}

console.log('  explicitly forbidden keys throw rather than silently drop, forcing caller correction');
{
  for (const forbiddenKey of ['password', 'connectionString', 'serviceRoleKey', 'token', 'accessToken', 'bearerToken', 'rawMessage', 'message', 'detail', 'hint', 'customerEmailBody', 'emailBody', 'error']) {
    assert.throws(
      () => buildWriterObservabilityPayload({ operationKey: 'op-1', [forbiddenKey]: 'x' }),
      /campo non consentito/
    );
  }
}

console.log('  string values that look like secrets/connection strings are rejected even under an allowed key name');
{
  assert.throws(
    () => buildWriterObservabilityPayload({
      operationKey: 'op-1',
      safeConstraint: 'postgres://user:supersecret@db.internal:5432/orderwatch'
    }),
    /valore non valido|sospetto/
  );
  assert.throws(
    () => buildWriterObservabilityPayload({
      operationKey: 'op-1',
      safeConstraint: 'Bearer sometoken1234567890'
    }),
    /valore non valido|sospetto/
  );
}

console.log('  bare JWT-shaped strings under an allowed key are rejected even without a Bearer prefix');
{
  const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  // safeConstraint's type validator would already reject the dots in a JWT,
  // so exercise the secret-pattern path specifically through operationKey,
  // whose type validator only checks length/trim and would otherwise accept it.
  assert.throws(
    () => buildWriterObservabilityPayload({ operationKey: jwtLike }),
    /sospetto/
  );
}

console.log('  numeric/boolean fields pass through untouched');
{
  const payload = buildWriterObservabilityPayload({
    operationKey: 'op-1',
    attempt: 2,
    rereadPerformed: true,
    retryPerformed: false,
    durationMs: 128
  });
  assert.equal(payload.attempt, 2);
  assert.equal(payload.rereadPerformed, true);
  assert.equal(payload.retryPerformed, false);
  assert.equal(payload.durationMs, 128);
}

console.log('  hostile getters on the input object never execute');
{
  let getterInvoked = false;
  const hostile = { operationKey: 'op-1' };
  Object.defineProperty(hostile, 'attempt', {
    enumerable: true,
    get() { getterInvoked = true; return 1; }
  });
  const payload = buildWriterObservabilityPayload(hostile);
  assert.equal(getterInvoked, false);
  assert.equal('attempt' in payload, false);
}

console.log('  payload is stable across repeated calls with the same input');
{
  const first = buildWriterObservabilityPayload(FULL_INPUT);
  const second = buildWriterObservabilityPayload(FULL_INPUT);
  assert.deepEqual(first, second);
}

console.log('PASS: observability payload builder is closed, strictly typed and redacts as required');
