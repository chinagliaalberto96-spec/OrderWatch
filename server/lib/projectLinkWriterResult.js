import { types } from "node:util";
import {
  isPlainMetadataObject,
  isUuid,
  isValidOperationKey,
  isSafeUpperIdentifier,
  isBoundedPositiveInteger
} from "./projectLinkWriterSafeAccess.js";
import { SUBJECT_TYPE } from "./projectLinkWriterCommands.js";

export const WRITER_OUTCOME = Object.freeze({
  SUCCESS_CREATED: "SUCCESS_CREATED",
  SUCCESS_REACTIVATED: "SUCCESS_REACTIVATED",
  SUCCESS_REPLACED: "SUCCESS_REPLACED",
  SUCCESS_TERMINALLY_ENDED: "SUCCESS_TERMINALLY_ENDED",
  SUCCESS_ALREADY_CURRENT: "SUCCESS_ALREADY_CURRENT",
  CONFLICT_CONCURRENT_CHANGE: "CONFLICT_CONCURRENT_CHANGE",
  CONFLICT_STALE_STATE: "CONFLICT_STALE_STATE",
  CONFLICT_IDEMPOTENCY_KEY_REUSE: "CONFLICT_IDEMPOTENCY_KEY_REUSE",
  BLOCKED_MANUAL_PRECEDENCE: "BLOCKED_MANUAL_PRECEDENCE",
  INVALID_PARENT_OR_TENANT: "INVALID_PARENT_OR_TENANT",
  FORBIDDEN: "FORBIDDEN",
  RETRYABLE_TRANSACTION_FAILURE: "RETRYABLE_TRANSACTION_FAILURE",
  AMBIGUOUS_COMMIT: "AMBIGUOUS_COMMIT",
  INTERNAL_FAILURE: "INTERNAL_FAILURE"
});

const BASE_REQUIRED_FIELDS = Object.freeze(["operationKey", "subjectType", "subjectId", "attempt"]);

const ALL_KNOWN_FIELDS = Object.freeze([
  "operationKey",
  "subjectType",
  "subjectId",
  "attempt",
  "observedActiveLinkId",
  "decisionId",
  "priorLinkId",
  "resultLinkId",
  "rereadPerformed",
  "retryPerformed",
  "safeDiagnosticCode",
  "replayed"
]);

const ALL_KNOWN_FIELD_NAMES = new Set(ALL_KNOWN_FIELDS);

/**
 * SUCCESS_ALREADY_CURRENT represents a successful no-op: the caller's
 * intended state already matches the active canonical link, no new decision
 * or link row was created. It must be representable with none of
 * decisionId/priorLinkId/resultLinkId present.
 */
const OUTCOME_RULES = Object.freeze({
  [WRITER_OUTCOME.SUCCESS_CREATED]: {
    required: ["decisionId", "resultLinkId"],
    optional: ["rereadPerformed", "retryPerformed", "replayed"]
  },
  [WRITER_OUTCOME.SUCCESS_REACTIVATED]: {
    required: ["decisionId", "resultLinkId"],
    optional: ["priorLinkId", "rereadPerformed", "retryPerformed", "replayed"]
  },
  [WRITER_OUTCOME.SUCCESS_REPLACED]: {
    required: ["decisionId", "resultLinkId", "priorLinkId"],
    optional: ["rereadPerformed", "retryPerformed", "replayed"]
  },
  [WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED]: {
    required: ["decisionId", "priorLinkId"],
    optional: ["rereadPerformed", "retryPerformed", "replayed"]
  },
  [WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT]: {
    required: [],
    optional: ["decisionId", "priorLinkId", "resultLinkId", "rereadPerformed", "retryPerformed", "replayed"]
  },
  [WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE]: {
    required: ["rereadPerformed", "retryPerformed", "safeDiagnosticCode"],
    optional: ["observedActiveLinkId"]
  },
  [WRITER_OUTCOME.CONFLICT_STALE_STATE]: {
    required: ["rereadPerformed", "retryPerformed", "safeDiagnosticCode"],
    optional: ["observedActiveLinkId"]
  },
  [WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE]: {
    required: ["safeDiagnosticCode"],
    optional: []
  },
  [WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE]: {
    required: ["safeDiagnosticCode"],
    optional: ["observedActiveLinkId", "rereadPerformed", "retryPerformed", "replayed"]
  },
  [WRITER_OUTCOME.INVALID_PARENT_OR_TENANT]: {
    // replayed is deliberately NOT listed here: the future atomic writer's
    // operation-ledger reference-validation trigger can reject the initial
    // CLAIMED insert itself (SQLSTATE 23503) before any operation row
    // exists to persist a terminal FAILED status against -- see
    // projectLinkWriterResultLedgerMapper.js's NO_LEDGER_WRITE mapping for
    // this outcome. An outcome that can never be durably persisted as a
    // terminal row can never legitimately be "replayed" from one either.
    required: ["safeDiagnosticCode"],
    optional: []
  },
  [WRITER_OUTCOME.FORBIDDEN]: {
    // replayed is deliberately NOT listed here, for the same reason as
    // INVALID_PARENT_OR_TENANT above: SQLSTATE 42501 can occur before the
    // claim insert itself succeeds (the caller lacked INSERT privilege on
    // project_link_operations), leaving no row to persist a terminal status
    // against -- see the mapper's NO_LEDGER_WRITE mapping for this outcome.
    required: ["safeDiagnosticCode"],
    optional: []
  },
  [WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE]: {
    required: ["safeDiagnosticCode"],
    optional: ["retryPerformed"]
  },
  [WRITER_OUTCOME.AMBIGUOUS_COMMIT]: {
    required: ["safeDiagnosticCode"],
    optional: ["observedActiveLinkId"]
  },
  [WRITER_OUTCOME.INTERNAL_FAILURE]: {
    required: ["safeDiagnosticCode"],
    optional: ["replayed"]
  }
});

/**
 * Per-field type/shape validators. Presence alone is never sufficient --
 * every included value must pass its validator or the whole build fails.
 * None of these accept arrays, plain objects, functions or symbols, since
 * none of them match `typeof value === "string"/"number"/"boolean"`.
 */
const FIELD_VALIDATORS = Object.freeze({
  operationKey: (value) => isValidOperationKey(value),
  subjectType: (value) => value === SUBJECT_TYPE.ORDER || value === SUBJECT_TYPE.LINE,
  subjectId: (value) => isUuid(value),
  attempt: (value) => isBoundedPositiveInteger(value),
  observedActiveLinkId: (value) => isUuid(value),
  decisionId: (value) => isUuid(value),
  priorLinkId: (value) => isUuid(value),
  resultLinkId: (value) => isUuid(value),
  rereadPerformed: (value) => typeof value === "boolean",
  retryPerformed: (value) => typeof value === "boolean",
  safeDiagnosticCode: (value) => isSafeUpperIdentifier(value),
  replayed: (value) => typeof value === "boolean"
});

function fail(message) {
  throw new Error(message);
}

/**
 * Same Proxy-detection discipline as projectLinkWriterSafeAccess.js: a
 * Proxy (revoked or not) is detected via Node's built-in, trap-free
 * util.types.isProxy *before* any reflective operation is attempted on the
 * value -- never via a try/catch around Object.getOwnPropertyDescriptor
 * alone, since that call's own trap already executes (with any side
 * effect) before it could throw. Fails closed (treats the value as a
 * Proxy) if detection itself throws.
 */
function isProxyLike(value) {
  try {
    return types.isProxy(value);
  } catch {
    return true;
  }
}

/**
 * Like readOwnDataProperty, but also reports whether the key exists as an
 * own *data* property at all -- distinguishing "the property is genuinely
 * absent" from "the property exists with value undefined" (e.g. an object
 * literal `{ replayed: undefined }`), which readOwnDataProperty's return
 * value alone cannot distinguish (both read back as `undefined`). An own
 * accessor/getter property is deliberately treated as absent here too --
 * exactly like readOwnDataProperty, its getter is never invoked and never
 * counts as "present" -- so a hostile getter can neither execute nor be
 * used to smuggle a value past this check. A Proxy `source` is likewise
 * treated as absent, with no reflective operation ever attempted on it.
 */
function readOwnPropertyPresence(source, key) {
  if (source === null || typeof source !== "object") {
    return { present: false, value: undefined };
  }
  if (isProxyLike(source)) {
    return { present: false, value: undefined };
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(source, key);
  } catch {
    return { present: false, value: undefined };
  }
  if (!descriptor || !("value" in descriptor)) {
    return { present: false, value: undefined };
  }
  return { present: true, value: descriptor.value };
}

/**
 * Enumerates metadata's own *data* property keys (string and symbol) and
 * fails if any of them is not in ALL_KNOWN_FIELD_NAMES -- the closed
 * vocabulary this contract promises. Called only after the caller has
 * already confirmed `metadata` is not a Proxy (isPlainMetadataObject), but
 * re-checks Proxy-ness itself immediately beforehand anyway so this
 * function's own safety does not depend on being called in a particular
 * order relative to that check -- Object.getOwnPropertyNames/
 * Object.getOwnPropertySymbols must never be reached for a Proxy.
 *
 * An own *accessor* property (a getter, with or without a setter) is
 * deliberately NOT inspected for vocabulary membership and never has its
 * getter invoked -- consistent with this module's existing convention of
 * treating an accessor-only property as unavailable/absent rather than a
 * value to validate. Object.getOwnPropertyDescriptor never triggers a
 * getter, so this distinction is made safely, without ever running
 * caller-supplied code.
 *
 * A symbol-keyed own data property is always rejected: ALL_KNOWN_FIELDS
 * contains only string keys, and this contract does not currently permit
 * any symbol-keyed field.
 */
function assertNoUnknownOwnDataProperties(metadata) {
  if (isProxyLike(metadata)) {
    fail("metadata deve essere un oggetto semplice (non array, funzione o istanza di Error).");
  }

  const ownKeys = [...Object.getOwnPropertyNames(metadata), ...Object.getOwnPropertySymbols(metadata)];
  for (const key of ownKeys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(metadata, key);
    } catch {
      continue; // treat as unavailable, exactly like readOwnPropertyPresence does elsewhere
    }
    if (!descriptor || !("value" in descriptor)) continue; // accessor-only -- never inspected further, getter never invoked

    if (typeof key === "symbol" || !ALL_KNOWN_FIELD_NAMES.has(key)) {
      fail(`Campo non riconosciuto: ${String(key)}.`);
    }
  }
}

/**
 * Builds a closed, strictly validated writer result. Only fields listed in
 * ALL_KNOWN_FIELDS ever survive into the returned object, each must pass
 * its type validator, and metadata is read via readOwnPropertyPresence so a
 * hostile getter on the input object can never execute.
 *
 * Every own data-property key on `metadata` must belong to ALL_KNOWN_FIELDS
 * at all -- an entirely unknown key (a typo such as "replayd", or any other
 * unrecognized field) throws, rather than being silently ignored.
 *
 * A known field supplied as an own data property but not permitted by the
 * selected outcome's OUTCOME_RULES entry is rejected outright -- regardless
 * of its value (a UUID, null, an own undefined, or anything else) -- never
 * silently dropped the way an unknown/unlisted field previously was.
 * Silently dropping a *known* field would risk a caller believing a
 * prohibited fact (e.g. a decisionId on an outcome that must never carry
 * one) was accepted when it was not. This check is presence-based
 * (own-property existence), not value-based, precisely so a prohibited
 * field cannot be smuggled through as null/undefined to dodge it -- the
 * same reasoning "replayed" already required is now applied uniformly to
 * every known field, which also makes "replayed"'s own outcome-eligibility
 * a simple consequence of this general rule (an outcome allows replayed if
 * and only if OUTCOME_RULES lists it), rather than a separately maintained
 * list.
 *
 * The replay-eligible outcomes are therefore exactly those whose
 * OUTCOME_RULES entry lists "replayed" as required or optional -- which, as
 * of this module's current rules, is the five SUCCESS_* outcomes,
 * BLOCKED_MANUAL_PRECEDENCE, and INTERNAL_FAILURE: outcomes that are always
 * physically achievable as a durably-persisted terminal row (see
 * projectLinkWriterResultLedgerMapper.js's PERSIST_TERMINAL mapping for all
 * of them). INVALID_PARENT_OR_TENANT and FORBIDDEN are excluded from that
 * set -- both can occur before the operation-ledger claim row itself exists
 * (SQLSTATE 23503 from the reference-validation trigger; SQLSTATE 42501
 * from a missing INSERT privilege), so neither can ever have been durably
 * persisted as a terminal row in the first place, and therefore neither can
 * ever legitimately be "replayed" from one.
 */
export function buildWriterResult(outcome, metadata = {}) {
  const rules = OUTCOME_RULES[outcome];
  if (!rules) {
    fail(`Esito non valido: ${String(outcome)}.`);
  }
  if (!isPlainMetadataObject(metadata)) {
    fail("metadata deve essere un oggetto semplice (non array, funzione o istanza di Error).");
  }
  assertNoUnknownOwnDataProperties(metadata);

  const requiredFields = new Set([...BASE_REQUIRED_FIELDS, ...rules.required]);
  const allowedFields = new Set([...BASE_REQUIRED_FIELDS, ...rules.required, ...rules.optional]);

  const result = { outcome };

  for (const field of ALL_KNOWN_FIELDS) {
    const presence = readOwnPropertyPresence(metadata, field);

    if (presence.present && !allowedFields.has(field)) {
      fail(`Il campo ${field} non è ammesso per l'esito ${outcome}.`);
    }
    if (!allowedFields.has(field)) continue;

    if (field === "replayed") {
      // Stricter than every other allowed field: "replayed" has exactly
      // three legal states -- absent, true, false. Presence with any
      // non-boolean value (including null or an own undefined) is a
      // validation error here, never renormalized to "absent" the way a
      // null/undefined value for another allowed field is below.
      if (presence.present) {
        if (typeof presence.value !== "boolean") {
          fail(`Valore non valido per il campo replayed in ${outcome}.`);
        }
        result.replayed = presence.value;
      }
      continue;
    }

    // Every other allowed field: an own null/undefined value continues to
    // be treated as "not supplied" for required-field purposes -- this
    // pre-existing convention is unchanged; only the *prohibited-field*
    // check above is new behavior.
    const value = presence.present ? presence.value : undefined;
    const isPresent = value !== undefined && value !== null;

    if (!isPresent) {
      if (requiredFields.has(field)) {
        fail(`Campo obbligatorio mancante per ${outcome}: ${field}.`);
      }
      continue;
    }

    const validator = FIELD_VALIDATORS[field];
    if (!validator(value)) {
      fail(`Valore non valido per il campo ${field} in ${outcome}.`);
    }
    result[field] = value;
  }

  return Object.freeze(result);
}

export function isSuccessOutcome(outcome) {
  return outcome.startsWith("SUCCESS_");
}

export function isConflictOutcome(outcome) {
  return outcome === WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE
    || outcome === WRITER_OUTCOME.CONFLICT_STALE_STATE
    || outcome === WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE;
}

export function requiresManualReview(outcome) {
  return outcome === WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE;
}
