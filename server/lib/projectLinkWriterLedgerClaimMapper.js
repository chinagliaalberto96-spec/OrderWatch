import { isUuid, isValidOperationKey, isValidRequestFingerprint } from "./projectLinkWriterSafeAccess.js";
import { COMMAND_TYPE, LIFECYCLE_OPERATION, DECISION_ORIGIN, SUBJECT_TYPE } from "./projectLinkWriterCommands.js";

function fail(message) {
  throw new Error(message);
}

/**
 * Converts an already-validated writer command (projectLinkWriterCommands.js)
 * into the logical shape of a project_link_operations ledger claim row
 * (supabase/migrations/20260731102910_canonical_project_link_operation_ledger.sql).
 *
 * Field mapping (camelCase command field -> snake_case ledger column):
 *   organizationId        -> organization_id
 *   operationKey          -> operation_key
 *   requestFingerprint    -> request_fingerprint
 *   subjectType           -> subject_type
 *   subjectId             -> subject_id
 *   type                  -> operation_type
 *   lifecycleOperation    -> lifecycle_operation
 *   decisionOrigin        -> decision_origin
 *   intendedProjectId     -> intended_project_id
 *   expectedActiveLinkId  -> expected_active_link_id
 *
 * organizationId is read only from command.organizationId, which itself can
 * only ever have originated from serverContext in
 * projectLinkWriterCommands.js -- this function never reads organization
 * identity from any subject/decision-shaped field. lifecycleOperation is
 * taken as-is from the command, which already normalizes it deterministically
 * for every command shape.
 *
 * Contains no SQL, no Supabase import, and performs no database write --
 * only the plain-object claim shape a future writer would bind as INSERT
 * parameters.
 */
export function mapCommandToLedgerClaim(command) {
  if (!command || typeof command !== "object") {
    fail("command è obbligatorio.");
  }

  const {
    organizationId,
    operationKey,
    requestFingerprint,
    subjectType,
    subjectId,
    type,
    lifecycleOperation,
    decisionOrigin,
    intendedProjectId,
    expectedActiveLinkId
  } = command;

  if (!isUuid(organizationId)) fail("command.organizationId non valido.");
  if (!isValidOperationKey(operationKey)) fail("command.operationKey non valido.");
  if (!isValidRequestFingerprint(requestFingerprint)) fail("command.requestFingerprint non valido.");
  if (subjectType !== SUBJECT_TYPE.ORDER && subjectType !== SUBJECT_TYPE.LINE) {
    fail("command.subjectType non valido.");
  }
  if (!isUuid(subjectId)) fail("command.subjectId non valido.");
  if (type !== COMMAND_TYPE.CONFIRM_PROJECT_MANUALLY && type !== COMMAND_TYPE.APPLY_AUTOMATIC_PROJECT_DECISION) {
    fail("command.type non valido.");
  }
  if (!Object.values(LIFECYCLE_OPERATION).includes(lifecycleOperation)) {
    fail("command.lifecycleOperation non valido.");
  }
  if (!Object.values(DECISION_ORIGIN).includes(decisionOrigin)) {
    fail("command.decisionOrigin non valido.");
  }
  if (intendedProjectId !== null && intendedProjectId !== undefined && !isUuid(intendedProjectId)) {
    fail("command.intendedProjectId non valido.");
  }
  if (expectedActiveLinkId !== null && expectedActiveLinkId !== undefined && !isUuid(expectedActiveLinkId)) {
    fail("command.expectedActiveLinkId non valido.");
  }

  return Object.freeze({
    organizationId,
    operationKey,
    requestFingerprint,
    subjectType,
    subjectId,
    operationType: type,
    lifecycleOperation,
    decisionOrigin,
    intendedProjectId: intendedProjectId ?? null,
    expectedActiveLinkId: expectedActiveLinkId ?? null
  });
}
