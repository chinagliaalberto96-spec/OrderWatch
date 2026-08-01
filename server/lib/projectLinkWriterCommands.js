import { isUuid, isValidOperationKey, isValidRequestFingerprint } from "./projectLinkWriterSafeAccess.js";

export const SUBJECT_TYPE = Object.freeze({
  ORDER: "ORDER",
  LINE: "LINE"
});

export const DECISION_ORIGIN = Object.freeze({
  SOURCE_NATIVE_STRUCTURED: "SOURCE_NATIVE_STRUCTURED",
  EXACT_TRUSTED_REFERENCE: "EXACT_TRUSTED_REFERENCE",
  MANUAL_CONFIRMATION: "MANUAL_CONFIRMATION",
  IMPORTED_HISTORICAL: "IMPORTED_HISTORICAL"
});

const AUTOMATIC_DECISION_ORIGINS = Object.freeze([
  DECISION_ORIGIN.SOURCE_NATIVE_STRUCTURED,
  DECISION_ORIGIN.EXACT_TRUSTED_REFERENCE,
  DECISION_ORIGIN.IMPORTED_HISTORICAL
]);

/**
 * The two trust-boundary-safe command types a caller may ever construct.
 * There is intentionally no exported constructor that returns a "raw"
 * primitive command carrying an arbitrary decisionOrigin -- every command
 * this module can produce is either an audited manual confirmation or a
 * validated automatic decision. lifecycleOperation (below) records which of
 * the four canonical mutations the command represents.
 */
export const COMMAND_TYPE = Object.freeze({
  CONFIRM_PROJECT_MANUALLY: "CONFIRM_PROJECT_MANUALLY",
  APPLY_AUTOMATIC_PROJECT_DECISION: "APPLY_AUTOMATIC_PROJECT_DECISION"
});

/** Matches project_link_operations.lifecycle_operation exactly (ledger migration). */
export const LIFECYCLE_OPERATION = Object.freeze({
  CREATE_INITIAL_LINK: "CREATE_INITIAL_LINK",
  REPLACE_ACTIVE_LINK: "REPLACE_ACTIVE_LINK",
  TERMINALLY_END_ACTIVE_LINK: "TERMINALLY_END_ACTIVE_LINK",
  REACTIVATE_LINK: "REACTIVATE_LINK"
});

const REQUIRES_INTENDED_PROJECT = Object.freeze([
  LIFECYCLE_OPERATION.CREATE_INITIAL_LINK,
  LIFECYCLE_OPERATION.REPLACE_ACTIVE_LINK,
  LIFECYCLE_OPERATION.REACTIVATE_LINK
]);

const FORBIDS_INTENDED_PROJECT = Object.freeze([
  LIFECYCLE_OPERATION.TERMINALLY_END_ACTIVE_LINK
]);

const REQUIRES_EXPECTED_ACTIVE_LINK = Object.freeze([
  LIFECYCLE_OPERATION.REPLACE_ACTIVE_LINK,
  LIFECYCLE_OPERATION.TERMINALLY_END_ACTIVE_LINK
]);

const FORBIDS_EXPECTED_ACTIVE_LINK = Object.freeze([
  LIFECYCLE_OPERATION.CREATE_INITIAL_LINK,
  LIFECYCLE_OPERATION.REACTIVATE_LINK
]);

function fail(message) {
  throw new Error(message);
}

/**
 * organizationId must always originate from server-resolved auth context
 * (e.g. the authenticated session/membership), never from request-body
 * input. Nothing in `subject` is ever consulted for organization identity.
 */
function requireServerContext(serverContext) {
  const organizationId = serverContext?.organizationId;
  if (!isUuid(organizationId)) {
    fail("serverContext.organizationId non valido: deve provenire dal contesto server.");
  }
  return organizationId;
}

function requireSubject(subject) {
  if (!subject || typeof subject !== "object") {
    fail("subject è obbligatorio.");
  }
  const { subjectType, subjectId, operationKey, requestFingerprint } = subject;

  if (subjectType !== SUBJECT_TYPE.ORDER && subjectType !== SUBJECT_TYPE.LINE) {
    fail("subjectType non valido: deve essere ORDER o LINE.");
  }
  if (!isUuid(subjectId)) {
    fail("subjectId non valido: deve essere un UUID.");
  }
  if (!isValidOperationKey(operationKey)) {
    fail("operationKey non valido: stringa senza spazi esterni, lunga tra 1 e 255 caratteri.");
  }
  if (!isValidRequestFingerprint(requestFingerprint)) {
    fail("requestFingerprint non valido: deve essere un digest SHA-256 di 64 caratteri esadecimali minuscoli.");
  }

  return { subjectType, subjectId, operationKey, requestFingerprint };
}

function requireIntendedProjectId(subject, lifecycleOperation) {
  const mustHave = REQUIRES_INTENDED_PROJECT.includes(lifecycleOperation);
  const mustNotHave = FORBIDS_INTENDED_PROJECT.includes(lifecycleOperation);
  const { intendedProjectId } = subject;

  if (mustHave && !isUuid(intendedProjectId)) {
    fail(`intendedProjectId è obbligatorio e deve essere un UUID per ${lifecycleOperation}.`);
  }
  if (mustNotHave && intendedProjectId !== undefined && intendedProjectId !== null) {
    fail(`intendedProjectId non è ammesso per ${lifecycleOperation}.`);
  }

  return mustHave ? intendedProjectId : null;
}

function requireExpectedActiveLinkId(subject, lifecycleOperation) {
  const mustHave = REQUIRES_EXPECTED_ACTIVE_LINK.includes(lifecycleOperation);
  const mustNotHave = FORBIDS_EXPECTED_ACTIVE_LINK.includes(lifecycleOperation);
  const { expectedActiveLinkId } = subject;

  if (mustHave && !isUuid(expectedActiveLinkId)) {
    fail(`expectedActiveLinkId è obbligatorio e deve essere un UUID per ${lifecycleOperation}.`);
  }
  if (mustNotHave && expectedActiveLinkId !== undefined && expectedActiveLinkId !== null) {
    fail(`expectedActiveLinkId non è ammesso per ${lifecycleOperation}.`);
  }

  return mustHave ? expectedActiveLinkId : null;
}

/**
 * Not exported. This is the only place decisionOrigin is ever attached to a
 * command, and it always receives an already-trust-checked value from one
 * of the two exported constructors below -- never directly from a caller.
 * lifecycleOperation is always present on the returned command (normalized
 * here, not left for the caller/writer to derive or coalesce).
 */
function assembleCommand({ commandType, lifecycleOperation, serverContext, subject, decisionOrigin }) {
  if (!Object.values(LIFECYCLE_OPERATION).includes(lifecycleOperation)) {
    fail(`lifecycleOperation non valido: ${String(lifecycleOperation)}.`);
  }

  const organizationId = requireServerContext(serverContext);
  const subjectFields = requireSubject(subject || {});
  const intendedProjectId = requireIntendedProjectId(subject || {}, lifecycleOperation);
  const expectedActiveLinkId = requireExpectedActiveLinkId(subject || {}, lifecycleOperation);

  return Object.freeze({
    type: commandType,
    lifecycleOperation,
    organizationId,
    ...subjectFields,
    intendedProjectId,
    expectedActiveLinkId,
    decisionOrigin
  });
}

/**
 * The only way a command carrying decisionOrigin = MANUAL_CONFIRMATION can
 * ever be produced. No parameter exists through which a caller can request
 * a different origin here.
 */
export function buildManualConfirmationCommand(lifecycleOperation, { serverContext, subject } = {}) {
  return assembleCommand({
    commandType: COMMAND_TYPE.CONFIRM_PROJECT_MANUALLY,
    lifecycleOperation,
    serverContext,
    subject,
    decisionOrigin: DECISION_ORIGIN.MANUAL_CONFIRMATION
  });
}

/**
 * Safe entry point for automatic/deterministic decision sources.
 * MANUAL_CONFIRMATION is explicitly rejected even if a caller mistakenly
 * supplies it.
 */
export function buildAutomaticDecisionCommand(lifecycleOperation, { serverContext, subject, decisionOrigin } = {}) {
  if (decisionOrigin === DECISION_ORIGIN.MANUAL_CONFIRMATION) {
    fail("MANUAL_CONFIRMATION non è ammesso per una decisione automatica.");
  }
  if (!AUTOMATIC_DECISION_ORIGINS.includes(decisionOrigin)) {
    fail(`decisionOrigin automatico non valido: ${String(decisionOrigin)}.`);
  }

  return assembleCommand({
    commandType: COMMAND_TYPE.APPLY_AUTOMATIC_PROJECT_DECISION,
    lifecycleOperation,
    serverContext,
    subject,
    decisionOrigin
  });
}

export function isAutomaticDecisionOrigin(origin) {
  return AUTOMATIC_DECISION_ORIGINS.includes(origin);
}
