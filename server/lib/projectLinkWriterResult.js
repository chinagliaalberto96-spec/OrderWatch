import {
  isPlainMetadataObject,
  readOwnDataProperty,
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
  "safeDiagnosticCode"
]);

/**
 * SUCCESS_ALREADY_CURRENT represents a successful no-op: the caller's
 * intended state already matches the active canonical link, no new decision
 * or link row was created. It must be representable with none of
 * decisionId/priorLinkId/resultLinkId present.
 */
const OUTCOME_RULES = Object.freeze({
  [WRITER_OUTCOME.SUCCESS_CREATED]: {
    required: ["decisionId", "resultLinkId"],
    optional: ["rereadPerformed", "retryPerformed"]
  },
  [WRITER_OUTCOME.SUCCESS_REACTIVATED]: {
    required: ["decisionId", "resultLinkId"],
    optional: ["priorLinkId", "rereadPerformed", "retryPerformed"]
  },
  [WRITER_OUTCOME.SUCCESS_REPLACED]: {
    required: ["decisionId", "resultLinkId", "priorLinkId"],
    optional: ["rereadPerformed", "retryPerformed"]
  },
  [WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED]: {
    required: ["decisionId", "priorLinkId"],
    optional: ["rereadPerformed", "retryPerformed"]
  },
  [WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT]: {
    required: [],
    optional: ["decisionId", "priorLinkId", "resultLinkId", "rereadPerformed", "retryPerformed"]
  },
  [WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE]: {
    required: ["rereadPerformed", "retryPerformed", "safeDiagnosticCode"],
    optional: ["observedActiveLinkId"]
  },
  [WRITER_OUTCOME.CONFLICT_STALE_STATE]: {
    required: ["rereadPerformed", "retryPerformed", "safeDiagnosticCode"],
    optional: ["observedActiveLinkId"]
  },
  [WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE]: {
    required: ["safeDiagnosticCode"],
    optional: ["observedActiveLinkId", "rereadPerformed", "retryPerformed"]
  },
  [WRITER_OUTCOME.INVALID_PARENT_OR_TENANT]: {
    required: ["safeDiagnosticCode"],
    optional: []
  },
  [WRITER_OUTCOME.FORBIDDEN]: {
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
    optional: []
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
  safeDiagnosticCode: (value) => isSafeUpperIdentifier(value)
});

function fail(message) {
  throw new Error(message);
}

/**
 * Builds a closed, strictly validated writer result. Only fields listed in
 * ALL_KNOWN_FIELDS ever survive into the returned object, each must pass
 * its type validator, and metadata is read via readOwnDataProperty so a
 * hostile getter on the input object can never execute.
 */
export function buildWriterResult(outcome, metadata = {}) {
  const rules = OUTCOME_RULES[outcome];
  if (!rules) {
    fail(`Esito non valido: ${String(outcome)}.`);
  }
  if (!isPlainMetadataObject(metadata)) {
    fail("metadata deve essere un oggetto semplice (non array, funzione o istanza di Error).");
  }

  const requiredFields = new Set([...BASE_REQUIRED_FIELDS, ...rules.required]);
  const allowedFields = new Set([...BASE_REQUIRED_FIELDS, ...rules.required, ...rules.optional]);

  const result = { outcome };
  for (const field of ALL_KNOWN_FIELDS) {
    if (!allowedFields.has(field)) continue;

    const value = readOwnDataProperty(metadata, field);
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
    || outcome === WRITER_OUTCOME.CONFLICT_STALE_STATE;
}

export function requiresManualReview(outcome) {
  return outcome === WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE;
}
