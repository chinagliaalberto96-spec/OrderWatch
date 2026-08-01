import { redactSensitiveText } from "./_securityRedaction.js";
import {
  isPlainMetadataObject,
  readOwnDataProperty,
  isUuid,
  isValidOperationKey,
  isSafeLowerIdentifier,
  isValidSqlstate,
  isBoundedPositiveInteger,
  isBoundedNonNegativeNumber
} from "./projectLinkWriterSafeAccess.js";
import { SUBJECT_TYPE, DECISION_ORIGIN, COMMAND_TYPE, LIFECYCLE_OPERATION } from "./projectLinkWriterCommands.js";
import { WRITER_OUTCOME } from "./projectLinkWriterResult.js";

const OPERATION_TYPE_VALUES = new Set([
  ...Object.values(COMMAND_TYPE),
  ...Object.values(LIFECYCLE_OPERATION)
]);

const NEVER_LOG_KEYS = Object.freeze([
  "password",
  "connectionString",
  "connection_string",
  "serviceRoleKey",
  "service_role_key",
  "token",
  "accessToken",
  "bearerToken",
  "rawMessage",
  "message",
  "detail",
  "hint",
  "customerEmailBody",
  "emailBody",
  "payload",
  "error"
]);

/** Bare JWT-shaped strings (header.payload.signature) with no "Bearer " prefix. */
const JWT_LIKE_PATTERN = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

function looksLikeSecret(value) {
  if (JWT_LIKE_PATTERN.test(value.trim())) return true;
  const redacted = redactSensitiveText(value, value);
  return redacted !== value;
}

/**
 * Exact type/shape validator per allowed field. Every value must satisfy
 * `typeof value === "string" | "number" | "boolean"` through these checks
 * -- nested objects, arrays, functions, symbols, Error instances and raw
 * database error objects can never pass any of them.
 */
const FIELD_VALIDATORS = Object.freeze({
  operationKey: (value) => isValidOperationKey(value),
  organizationId: (value) => isUuid(value),
  subjectType: (value) => value === SUBJECT_TYPE.ORDER || value === SUBJECT_TYPE.LINE,
  subjectId: (value) => isUuid(value),
  operationType: (value) => typeof value === "string" && OPERATION_TYPE_VALUES.has(value),
  observedActiveLinkId: (value) => isUuid(value),
  intendedProjectId: (value) => isUuid(value),
  decisionOrigin: (value) => typeof value === "string" && Object.values(DECISION_ORIGIN).includes(value),
  attempt: (value) => isBoundedPositiveInteger(value),
  outcome: (value) => typeof value === "string" && Object.values(WRITER_OUTCOME).includes(value),
  decisionId: (value) => isUuid(value),
  resultLinkId: (value) => isUuid(value),
  sqlstate: (value) => isValidSqlstate(value),
  safeConstraint: (value) => isSafeLowerIdentifier(value),
  rereadPerformed: (value) => typeof value === "boolean",
  retryPerformed: (value) => typeof value === "boolean",
  durationMs: (value) => isBoundedNonNegativeNumber(value)
});

/** Stable, ordered key list -- only these keys are ever emitted. */
const PAYLOAD_KEYS = Object.freeze(Object.keys(FIELD_VALIDATORS));

function fail(message) {
  throw new Error(message);
}

/**
 * Builds a pure, strictly validated, stable structured-log payload for a
 * single writer attempt. Every field is type/shape-validated before being
 * emitted -- an invalid value is rejected outright, never stringified or
 * silently transformed. Not wired to any logging transport.
 */
export function buildWriterObservabilityPayload(input = {}) {
  if (!isPlainMetadataObject(input)) {
    fail("buildWriterObservabilityPayload: l'input deve essere un oggetto semplice.");
  }

  for (const forbiddenKey of NEVER_LOG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, forbiddenKey)) {
      fail(`buildWriterObservabilityPayload: campo non consentito nel payload di osservabilità: ${forbiddenKey}.`);
    }
  }

  const payload = {};
  for (const key of PAYLOAD_KEYS) {
    const value = readOwnDataProperty(input, key);
    if (value === undefined || value === null) continue;

    const validator = FIELD_VALIDATORS[key];
    if (!validator(value)) {
      fail(`buildWriterObservabilityPayload: valore non valido per il campo: ${key}.`);
    }

    if (typeof value === "string" && looksLikeSecret(value)) {
      fail(`buildWriterObservabilityPayload: valore sospetto rifiutato per il campo: ${key}.`);
    }

    payload[key] = value;
  }

  return Object.freeze(payload);
}

export { PAYLOAD_KEYS as WRITER_OBSERVABILITY_PAYLOAD_KEYS };
