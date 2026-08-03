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
    case WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE:
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

console.log('  an entirely unknown own data-property key throws (never silently dropped from the output)');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, {
      ...BASE,
      rawDatabaseMessage: 'duplicate key value violates unique constraint "uniq_order_project_links_active"'
    }),
    /Campo non riconosciuto: rawDatabaseMessage/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, {
      ...BASE,
      connectionString: 'postgres://user:pass@host/db'
    }),
    /Campo non riconosciuto: connectionString/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, somethingUnexpected: 'value' }),
    /Campo non riconosciuto: somethingUnexpected/
  );
}

console.log('  a plausible typo of a known field name (e.g. "replayd" instead of "replayed") throws rather than being silently ignored');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayd: true }),
    /Campo non riconosciuto: replayd/
  );
}

console.log('  an unknown key throws regardless of its value: undefined, null, or a valid-looking UUID');
{
  const undefinedValueMetadata = { ...BASE };
  Object.defineProperty(undefinedValueMetadata, 'unknownField', { enumerable: true, value: undefined });
  assert.equal(Object.prototype.hasOwnProperty.call(undefinedValueMetadata, 'unknownField'), true);
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, undefinedValueMetadata),
    /Campo non riconosciuto: unknownField/
  );

  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, unknownField: null }),
    /Campo non riconosciuto: unknownField/
  );

  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, unknownField: UUID_A }),
    /Campo non riconosciuto: unknownField/
  );
}

console.log('  an unknown symbol-keyed own data property throws');
{
  const symbolKey = Symbol('unknownSymbolField');
  const metadata = { ...BASE, [symbolKey]: 'value' };
  assert.equal(Object.getOwnPropertySymbols(metadata).includes(symbolKey), true);
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, metadata),
    /Campo non riconosciuto: Symbol\(unknownSymbolField\)/
  );
}

console.log('  multiple unknown fields present at once still throws (on the first one encountered)');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, {
      ...BASE,
      firstUnknown: 'a',
      secondUnknown: 'b'
    }),
    /Campo non riconosciuto: (firstUnknown|secondUnknown)/
  );
}

console.log('  an unknown field alongside otherwise-valid required fields still throws (validity of known fields does not excuse an unknown one)');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, {
      ...BASE,
      decisionId: UUID_A,
      resultLinkId: UUID_B,
      extraneousField: 'should not be here'
    }),
    /Campo non riconosciuto: extraneousField/
  );
}

console.log('  an unknown key supplied only as an accessor (no data value) is treated as absent, never invokes its getter, and does not throw');
{
  let getterInvoked = false;
  const metadata = { ...BASE };
  Object.defineProperty(metadata, 'unknownAccessorField', {
    enumerable: true,
    get() { getterInvoked = true; return 'from getter'; }
  });
  const result = buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, metadata);
  assert.equal(getterInvoked, false, 'an unknown field\'s accessor getter must never be invoked');
  assert.equal('unknownAccessorField' in result, false);
}

console.log('  Proxy metadata is rejected safely, before the unknown-field scan ever reaches Object.getOwnPropertyNames/Symbols on it');
{
  const counts = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0, has: 0 };
  const hostileProxy = new Proxy({ ...BASE }, {
    getPrototypeOf(t) { counts.getPrototypeOf += 1; return Reflect.getPrototypeOf(t); },
    getOwnPropertyDescriptor(t, key) { counts.getOwnPropertyDescriptor += 1; return Reflect.getOwnPropertyDescriptor(t, key); },
    ownKeys(t) { counts.ownKeys += 1; return Reflect.ownKeys(t); },
    get(t, key) { counts.get += 1; return Reflect.get(t, key); },
    has(t, key) { counts.has += 1; return Reflect.has(t, key); }
  });
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, hostileProxy),
    /oggetto semplice/
  );
  assert.deepEqual(counts, { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0, has: 0 });
}

console.log('  a known field prohibited by the selected outcome is rejected outright, never silently dropped');
{
  // resultLinkId is a known field (ALL_KNOWN_FIELDS), but it is not part of
  // SUCCESS_TERMINALLY_ENDED's required/optional set at all -- supplying it
  // must throw, not be silently absorbed the way a genuinely unknown field
  // (see the "unlisted/unsafe fields" test above) is.
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED, {
      ...BASE,
      decisionId: UUID_A,
      priorLinkId: UUID_C,
      resultLinkId: UUID_B
    }),
    /Il campo resultLinkId non è ammesso/
  );

  // A second, independent known-but-prohibited field on a different
  // outcome, proving the fix is generic and not special-cased to one field
  // or one outcome: observedActiveLinkId is valid for CONFLICT_STALE_STATE
  // but not for SUCCESS_CREATED.
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_CREATED, {
      ...BASE,
      decisionId: UUID_A,
      resultLinkId: UUID_B,
      observedActiveLinkId: UUID_C
    }),
    /Il campo observedActiveLinkId non è ammesso/
  );

  // Permitted optional metadata remains accepted for the outcomes that
  // actually authorize it -- the fix does not turn allowed optional fields
  // into errors.
  const allowed = buildWriterResult(WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED, {
    ...BASE,
    decisionId: UUID_A,
    priorLinkId: UUID_C,
    rereadPerformed: true
  });
  assert.equal(allowed.rereadPerformed, true);
  const allowedObserved = buildWriterResult(WRITER_OUTCOME.CONFLICT_STALE_STATE, {
    ...BASE,
    rereadPerformed: true,
    retryPerformed: false,
    safeDiagnosticCode: 'SQLSTATE_55000',
    observedActiveLinkId: UUID_C
  });
  assert.equal(allowedObserved.observedActiveLinkId, UUID_C);
}

console.log('  a known field prohibited for the selected outcome, supplied only as an accessor (no data value), is treated as absent and never invokes its getter');
{
  let getterInvoked = false;
  const metadata = {
    ...BASE,
    decisionId: UUID_A,
    priorLinkId: UUID_C
  };
  Object.defineProperty(metadata, 'resultLinkId', {
    enumerable: true,
    get() { getterInvoked = true; return UUID_B; }
  });
  const result = buildWriterResult(WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED, metadata);
  assert.equal(getterInvoked, false, 'a prohibited field\'s accessor getter must never be invoked');
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

console.log('  CONFLICT_IDEMPOTENCY_KEY_REUSE: constructs, is a conflict outcome, not a success, no automatic retry implied');
{
  const result = buildWriterResult(WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE, {
    ...BASE,
    safeDiagnosticCode: 'SQLSTATE_23505'
  });
  assert.equal(result.outcome, WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE);
  assert.equal(isConflictOutcome(WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE), true);
  assert.equal(isSuccessOutcome(WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE), false);
  assert.equal(requiresManualReview(WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE), false);
}

console.log('  CONFLICT_IDEMPOTENCY_KEY_REUSE: prohibited decision/link metadata construction throws, independently per field, per value shape, and combined');
{
  const CIKR = WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE;
  const validBase = { ...BASE, safeDiagnosticCode: 'SQLSTATE_23505' };

  for (const field of ['decisionId', 'priorLinkId', 'resultLinkId']) {
    // Supplied as a valid-looking UUID.
    assert.throws(
      () => buildWriterResult(CIKR, { ...validBase, [field]: UUID_A }),
      new RegExp(`Il campo ${field} non è ammesso`),
      `${field} as a UUID must throw for CONFLICT_IDEMPOTENCY_KEY_REUSE`
    );

    // Supplied as an explicit null.
    assert.throws(
      () => buildWriterResult(CIKR, { ...validBase, [field]: null }),
      new RegExp(`Il campo ${field} non è ammesso`),
      `${field} as null must throw for CONFLICT_IDEMPOTENCY_KEY_REUSE`
    );

    // Supplied as an own property whose value is undefined -- distinct from
    // the property being entirely absent.
    const withOwnUndefined = { ...validBase };
    Object.defineProperty(withOwnUndefined, field, { enumerable: true, value: undefined });
    assert.equal(Object.prototype.hasOwnProperty.call(withOwnUndefined, field), true);
    assert.throws(
      () => buildWriterResult(CIKR, withOwnUndefined),
      new RegExp(`Il campo ${field} non è ammesso`),
      `own ${field}=undefined must throw for CONFLICT_IDEMPOTENCY_KEY_REUSE`
    );
  }

  // All three supplied together.
  assert.throws(
    () => buildWriterResult(CIKR, { ...validBase, decisionId: UUID_A, priorLinkId: UUID_C, resultLinkId: UUID_B }),
    /Il campo (decisionId|priorLinkId|resultLinkId) non è ammesso/
  );

  // Confirm the outcome still constructs cleanly without any of them.
  const clean = buildWriterResult(CIKR, validBase);
  assert.equal(clean.outcome, CIKR);
  assert.equal('decisionId' in clean, false);
  assert.equal('priorLinkId' in clean, false);
  assert.equal('resultLinkId' in clean, false);
}

// The exact outcomes that accept `replayed` at all -- i.e. every outcome
// whose OUTCOME_RULES entry in server/lib/projectLinkWriterResult.js lists
// "replayed" among its optional fields. Each entry carries the minimum
// extra metadata that outcome otherwise requires, so every case below can
// be exercised for every eligible outcome, not just one representative.
//
// INVALID_PARENT_OR_TENANT and FORBIDDEN are deliberately NOT in this list:
// both can occur before the operation-ledger claim row itself exists
// (SQLSTATE 23503 from the reference-validation trigger; SQLSTATE 42501
// from a missing INSERT privilege), so neither can ever have been durably
// persisted as a terminal row -- see the "derived from the actual outcome
// rules" test immediately below, and the dedicated rejection tests further
// down, which prove this by BEHAVIOR (calling buildWriterResult), not just
// by this list's own membership.
const REPLAY_ELIGIBLE_CASES = [
  [WRITER_OUTCOME.SUCCESS_CREATED, { decisionId: UUID_A, resultLinkId: UUID_B }],
  [WRITER_OUTCOME.SUCCESS_REACTIVATED, { decisionId: UUID_A, resultLinkId: UUID_B }],
  [WRITER_OUTCOME.SUCCESS_REPLACED, { decisionId: UUID_A, resultLinkId: UUID_B, priorLinkId: UUID_C }],
  [WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED, { decisionId: UUID_A, priorLinkId: UUID_C }],
  [WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, {}],
  [WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE, { safeDiagnosticCode: 'MANUAL_PRECEDENCE' }],
  [WRITER_OUTCOME.INTERNAL_FAILURE, { safeDiagnosticCode: 'UNKNOWN' }]
];

// Minimum extra metadata required to successfully build EVERY declared
// WRITER_OUTCOME, used only to derive replay-eligibility behaviorally below
// -- independent of, and not trusting, REPLAY_ELIGIBLE_CASES above.
const MINIMUM_METADATA_BY_OUTCOME = {
  [WRITER_OUTCOME.SUCCESS_CREATED]: { decisionId: UUID_A, resultLinkId: UUID_B },
  [WRITER_OUTCOME.SUCCESS_REACTIVATED]: { decisionId: UUID_A, resultLinkId: UUID_B },
  [WRITER_OUTCOME.SUCCESS_REPLACED]: { decisionId: UUID_A, resultLinkId: UUID_B, priorLinkId: UUID_C },
  [WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED]: { decisionId: UUID_A, priorLinkId: UUID_C },
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

console.log('  the replay-eligible outcome set, derived behaviorally from the actual outcome rules (not merely counted), is exactly the five SUCCESS_* outcomes, BLOCKED_MANUAL_PRECEDENCE and INTERNAL_FAILURE');
{
  const expectedEligible = new Set([
    WRITER_OUTCOME.SUCCESS_CREATED,
    WRITER_OUTCOME.SUCCESS_REACTIVATED,
    WRITER_OUTCOME.SUCCESS_REPLACED,
    WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED,
    WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT,
    WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE,
    WRITER_OUTCOME.INTERNAL_FAILURE
  ]);
  const derivedEligible = new Set();
  for (const outcome of Object.values(WRITER_OUTCOME)) {
    const extra = MINIMUM_METADATA_BY_OUTCOME[outcome];
    let accepted = true;
    try {
      buildWriterResult(outcome, { ...BASE, ...extra, replayed: true });
    } catch {
      accepted = false;
    }
    if (accepted) derivedEligible.add(outcome);
  }
  assert.deepEqual(
    [...derivedEligible].sort(),
    [...expectedEligible].sort(),
    'the behaviorally-derived replay-eligible set must match exactly the five SUCCESS_* outcomes plus BLOCKED_MANUAL_PRECEDENCE and INTERNAL_FAILURE -- no more, no fewer'
  );
  assert.equal(derivedEligible.has(WRITER_OUTCOME.INVALID_PARENT_OR_TENANT), false, 'INVALID_PARENT_OR_TENANT must not be replay-eligible');
  assert.equal(derivedEligible.has(WRITER_OUTCOME.FORBIDDEN), false, 'FORBIDDEN must not be replay-eligible');
}

console.log('  absent replayed is accepted (no own property at all): valid, and the field is simply not present in the result');
{
  for (const [outcome, extra] of REPLAY_ELIGIBLE_CASES) {
    const result = buildWriterResult(outcome, { ...BASE, ...extra });
    assert.equal('replayed' in result, false, `absent replayed must be valid and omitted for ${outcome}`);
  }
}

console.log('  replayed=true is accepted for every replay-eligible outcome');
{
  for (const [outcome, extra] of REPLAY_ELIGIBLE_CASES) {
    const result = buildWriterResult(outcome, { ...BASE, ...extra, replayed: true });
    assert.equal(result.replayed, true, `replayed=true must be accepted for ${outcome}`);
  }
}

console.log('  replayed=false is accepted for every replay-eligible outcome, and is present (not omitted) in the result');
{
  for (const [outcome, extra] of REPLAY_ELIGIBLE_CASES) {
    const result = buildWriterResult(outcome, { ...BASE, ...extra, replayed: false });
    assert.equal('replayed' in result, true, `replayed=false must survive as an own property for ${outcome}`);
    assert.equal(result.replayed, false, `replayed=false must be accepted for ${outcome}`);
  }
}

console.log('  replayed=null is rejected for every replay-eligible outcome (never normalized to absent)');
{
  for (const [outcome, extra] of REPLAY_ELIGIBLE_CASES) {
    assert.throws(
      () => buildWriterResult(outcome, { ...BASE, ...extra, replayed: null }),
      /Valore non valido.*replayed/,
      `replayed=null must be rejected for ${outcome}`
    );
  }
}

console.log('  an own replayed=undefined property is rejected (distinct from the property being entirely absent)');
{
  for (const [outcome, extra] of REPLAY_ELIGIBLE_CASES) {
    const metadata = { ...BASE, ...extra };
    Object.defineProperty(metadata, 'replayed', { enumerable: true, value: undefined });
    assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'replayed'), true);
    assert.throws(
      () => buildWriterResult(outcome, metadata),
      /Valore non valido.*replayed/,
      `own replayed=undefined must be rejected for ${outcome}`
    );
  }
}

console.log('  string values for replayed are rejected');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: 'true' }),
    /Valore non valido.*replayed/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: 'false' }),
    /Valore non valido.*replayed/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: '' }),
    /Valore non valido.*replayed/
  );
}

console.log('  numeric values for replayed are rejected');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: 0 }),
    /Valore non valido.*replayed/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: 1 }),
    /Valore non valido.*replayed/
  );
}

console.log('  array and object values for replayed are rejected');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: [] }),
    /Valore non valido.*replayed/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: [true] }),
    /Valore non valido.*replayed/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: {} }),
    /Valore non valido.*replayed/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: { valueOf: () => true } }),
    /Valore non valido.*replayed/
  );
}

console.log('  function and symbol values for replayed are rejected');
{
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: () => true }),
    /Valore non valido.*replayed/
  );
  assert.throws(
    () => buildWriterResult(WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, { ...BASE, replayed: Symbol('replayed') }),
    /Valore non valido.*replayed/
  );
}

console.log('  replayed (true or false) is rejected for non-replay-eligible outcomes: recovery, conflict, retryable-transaction, invalid-parent-or-tenant and forbidden outcomes');
{
  const nonEligibleCases = [
    [WRITER_OUTCOME.AMBIGUOUS_COMMIT, { safeDiagnosticCode: 'SQLSTATE_57014' }],
    [WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE, { rereadPerformed: true, retryPerformed: false, safeDiagnosticCode: 'SQLSTATE_23505' }],
    [WRITER_OUTCOME.CONFLICT_STALE_STATE, { rereadPerformed: true, retryPerformed: false, safeDiagnosticCode: 'SQLSTATE_55000' }],
    [WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE, { safeDiagnosticCode: 'SQLSTATE_23505' }],
    [WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE, { safeDiagnosticCode: 'SQLSTATE_40001' }],
    [WRITER_OUTCOME.INVALID_PARENT_OR_TENANT, { safeDiagnosticCode: 'SQLSTATE_23503' }],
    [WRITER_OUTCOME.FORBIDDEN, { safeDiagnosticCode: 'SQLSTATE_42501' }]
  ];
  for (const [outcome, extra] of nonEligibleCases) {
    assert.throws(
      () => buildWriterResult(outcome, { ...BASE, ...extra, replayed: true }),
      /replayed non è ammesso/,
      `replayed=true must be rejected for ${outcome}`
    );
    // Even replayed=false must be rejected for these outcomes -- the field
    // itself is not part of their contract, not merely its true value.
    assert.throws(
      () => buildWriterResult(outcome, { ...BASE, ...extra, replayed: false }),
      /replayed non è ammesso/,
      `replayed=false must be rejected for ${outcome}`
    );
  }
}

console.log('  INVALID_PARENT_OR_TENANT and FORBIDDEN reject replayed for every supplied value shape, since no terminal row can physically exist for either outcome to be replayed from');
{
  const correctedOutcomeCases = [
    [WRITER_OUTCOME.INVALID_PARENT_OR_TENANT, { safeDiagnosticCode: 'SQLSTATE_23503' }],
    [WRITER_OUTCOME.FORBIDDEN, { safeDiagnosticCode: 'SQLSTATE_42501' }]
  ];
  const replayedValueShapes = [
    ['true', true],
    ['false', false],
    ['null', null],
    ['string', 'true'],
    ['number', 1],
    ['array', []],
    ['object', {}],
    ['function', () => true],
    ['symbol', Symbol('replayed')]
  ];
  for (const [outcome, extra] of correctedOutcomeCases) {
    for (const [label, value] of replayedValueShapes) {
      assert.throws(
        () => buildWriterResult(outcome, { ...BASE, ...extra, replayed: value }),
        /replayed non è ammesso/,
        `replayed=${label} must be rejected for ${outcome}`
      );
    }
    // own replayed=undefined (a genuine own property, distinct from
    // entirely absent) must also be rejected, exactly like every other
    // prohibited-field value shape.
    const withOwnUndefined = { ...BASE, ...extra };
    Object.defineProperty(withOwnUndefined, 'replayed', { enumerable: true, value: undefined });
    assert.throws(
      () => buildWriterResult(outcome, withOwnUndefined),
      /replayed non è ammesso/,
      `own replayed=undefined must be rejected for ${outcome}`
    );
    // absent replayed remains valid (the outcome itself is still buildable
    // without it -- only its presence is prohibited).
    assert.doesNotThrow(() => buildWriterResult(outcome, { ...BASE, ...extra }));
  }
}

console.log('  hostile getter for replayed is never invoked, whether the outcome is eligible or not');
{
  for (const [outcome, extra] of [
    [WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT, {}],
    [WRITER_OUTCOME.AMBIGUOUS_COMMIT, { safeDiagnosticCode: 'SQLSTATE_57014' }],
    [WRITER_OUTCOME.INVALID_PARENT_OR_TENANT, { safeDiagnosticCode: 'SQLSTATE_23503' }],
    [WRITER_OUTCOME.FORBIDDEN, { safeDiagnosticCode: 'SQLSTATE_42501' }]
  ]) {
    let getterInvoked = false;
    const hostile = { ...BASE, ...extra };
    Object.defineProperty(hostile, 'replayed', {
      enumerable: true,
      get() { getterInvoked = true; return true; }
    });
    // An accessor property is treated as absent by readOwnPropertyPresence
    // (its descriptor has no "value" key), so this never throws and never
    // invokes the getter -- for either an eligible or a non-eligible
    // outcome.
    const result = buildWriterResult(outcome, hostile);
    assert.equal(getterInvoked, false, `the hostile getter must never be invoked for ${outcome}`);
    assert.equal('replayed' in result, false, `an accessor-only replayed must be treated as absent for ${outcome}`);
  }
}

console.log('PASS: writer result model is closed, strictly typed and correctly validated');
