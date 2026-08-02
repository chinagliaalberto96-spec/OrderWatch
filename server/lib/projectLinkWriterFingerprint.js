import { createHash } from "node:crypto";
import { isUuid, isValidRequestFingerprint, readOwnDataProperty } from "./projectLinkWriterSafeAccess.js";
import { SUBJECT_TYPE, DECISION_ORIGIN, LIFECYCLE_OPERATION } from "./projectLinkWriterCommands.js";

/**
 * Bumped only if the included field set or canonical serialization rule
 * ever changes. A fingerprint computed under a different version never
 * collides with one computed under this version for what might otherwise
 * look like the same logical request.
 */
export const REQUEST_FINGERPRINT_VERSION = 1;

function fail(message) {
  throw new Error(message);
}

/**
 * undefined/null both normalize to JSON null; any other value must be a
 * well-formed UUID, lowercased. Never accepts anything else -- an array,
 * object, number, or malformed string all fail closed.
 */
function normalizeOptionalUuid(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (!isUuid(value)) {
    fail(`command.${fieldName} non valido per il calcolo del fingerprint.`);
  }
  return value.toLowerCase();
}

/**
 * Computes the canonical request fingerprint for an already-validated
 * writer command (projectLinkWriterCommands.js). Pure and synchronous: no
 * database access, no I/O, no dependency beyond Node's built-in crypto
 * module.
 *
 * Included fields, in this exact fixed order: version, subjectType,
 * subjectId, lifecycleOperation, decisionOrigin, intendedProjectId,
 * expectedActiveLinkId. organizationId and operationKey are deliberately
 * excluded -- the ledger's own composite unique key
 * (organization_id, operation_key) already scopes/identifies the row, so
 * including either here would be redundant (organizationId can never
 * legitimately differ between two rows sharing the same key) or
 * self-referential (operationKey is what the fingerprint is compared
 * against, not content the fingerprint should describe).
 *
 * Every property is read via readOwnDataProperty, so a hostile getter on
 * the input object can never execute. Fails closed (throws) on any
 * malformed or missing required field rather than silently coercing it.
 */
export function computeRequestFingerprint(command) {
  if (!command || typeof command !== "object") {
    fail("command è obbligatorio per il calcolo del fingerprint.");
  }

  const subjectType = readOwnDataProperty(command, "subjectType");
  const subjectId = readOwnDataProperty(command, "subjectId");
  const lifecycleOperation = readOwnDataProperty(command, "lifecycleOperation");
  const decisionOrigin = readOwnDataProperty(command, "decisionOrigin");
  const intendedProjectId = readOwnDataProperty(command, "intendedProjectId");
  const expectedActiveLinkId = readOwnDataProperty(command, "expectedActiveLinkId");

  if (subjectType !== SUBJECT_TYPE.ORDER && subjectType !== SUBJECT_TYPE.LINE) {
    fail("command.subjectType non valido per il calcolo del fingerprint.");
  }
  if (!isUuid(subjectId)) {
    fail("command.subjectId non valido per il calcolo del fingerprint.");
  }
  if (!Object.values(LIFECYCLE_OPERATION).includes(lifecycleOperation)) {
    fail("command.lifecycleOperation non valido per il calcolo del fingerprint.");
  }
  if (!Object.values(DECISION_ORIGIN).includes(decisionOrigin)) {
    fail("command.decisionOrigin non valido per il calcolo del fingerprint.");
  }

  const payload = {
    version: REQUEST_FINGERPRINT_VERSION,
    subjectType,
    subjectId: subjectId.toLowerCase(),
    lifecycleOperation,
    decisionOrigin,
    intendedProjectId: normalizeOptionalUuid(intendedProjectId, "intendedProjectId"),
    expectedActiveLinkId: normalizeOptionalUuid(expectedActiveLinkId, "expectedActiveLinkId")
  };

  const canonicalJson = JSON.stringify(payload);
  const fingerprint = createHash("sha256").update(canonicalJson, "utf8").digest("hex");

  if (!isValidRequestFingerprint(fingerprint)) {
    fail("Errore interno: il fingerprint calcolato non rispetta il formato atteso.");
  }

  return fingerprint;
}
