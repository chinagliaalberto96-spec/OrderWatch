import { WRITER_OUTCOME } from "./projectLinkWriterResult.js";

/**
 * What a future writer should do with the ledger row for a given attempt.
 *
 * PERSIST_TERMINAL         -- write a terminal COMPLETED or FAILED row.
 * PERSIST_AMBIGUOUS        -- write an AMBIGUOUS row (commit outcome unknown).
 * RETAIN_CLAIMED           -- leave the existing CLAIMED row untouched; the
 *                              conflict was on the canonical link tables, not
 *                              on the ledger's own operation identity, so the
 *                              same logical operation should reread state and
 *                              retry its canonical mutation under the same
 *                              claim, not be marked FAILED.
 * TRANSACTION_ROLLED_BACK  -- the whole transaction, including the CLAIMED
 *                              insert itself, was rolled back by Postgres;
 *                              there is no ledger row left to update, and a
 *                              retry means starting a fresh transaction
 *                              (which may reuse the same operation_key/
 *                              request_fingerprint, since nothing persisted).
 */
export const LEDGER_ACTION = Object.freeze({
  PERSIST_TERMINAL: "PERSIST_TERMINAL",
  PERSIST_AMBIGUOUS: "PERSIST_AMBIGUOUS",
  RETAIN_CLAIMED: "RETAIN_CLAIMED",
  TRANSACTION_ROLLED_BACK: "TRANSACTION_ROLLED_BACK"
});

const LEDGER_STATUS = Object.freeze({
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  AMBIGUOUS: "AMBIGUOUS"
});

/**
 * Canonical project_link_operations.last_error_class vocabulary. Must stay
 * in sync with projectLinkWriterDiagnostics.js#toSafeDiagnosticCode, plus
 * the AMBIGUOUS_COMMIT label for the one case that isn't SQLSTATE-derived.
 * Never persist a hand-written semantic label (e.g. "STALE_ACTIVE_LINK").
 */
export const CANONICAL_ERROR_CLASS = Object.freeze({
  MANUAL_PRECEDENCE: "MANUAL_PRECEDENCE",
  AMBIGUOUS_COMMIT: "AMBIGUOUS_COMMIT",
  UNKNOWN: "UNKNOWN"
});

const SQLSTATE_ERROR_CLASS_PATTERN = /^SQLSTATE_[0-9A-Z]{5}$/;

function fail(message) {
  throw new Error(message);
}

function toLedgerErrorClass(safeDiagnosticCode, fallback) {
  if (typeof safeDiagnosticCode === "string") {
    if (safeDiagnosticCode === CANONICAL_ERROR_CLASS.MANUAL_PRECEDENCE) return safeDiagnosticCode;
    if (SQLSTATE_ERROR_CLASS_PATTERN.test(safeDiagnosticCode)) return safeDiagnosticCode;
  }
  return fallback;
}

/**
 * Maps a validated writer result (projectLinkWriterResult.js) onto the
 * ledger state transition it implies. Performs no UPDATE -- it returns a
 * plain description of what a future writer should persist, or that
 * nothing should be persisted for this attempt at all.
 */
export function mapResultToLedgerState(result) {
  if (!result || typeof result !== "object") {
    fail("result è obbligatorio.");
  }

  const {
    outcome,
    decisionId = null,
    priorLinkId = null,
    resultLinkId = null,
    safeDiagnosticCode = null
  } = result;

  switch (outcome) {
    case WRITER_OUTCOME.SUCCESS_CREATED:
    case WRITER_OUTCOME.SUCCESS_REACTIVATED:
    case WRITER_OUTCOME.SUCCESS_REPLACED:
    case WRITER_OUTCOME.SUCCESS_TERMINALLY_ENDED:
    case WRITER_OUTCOME.SUCCESS_ALREADY_CURRENT:
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.PERSIST_TERMINAL,
        status: LEDGER_STATUS.COMPLETED,
        finalOutcome: outcome,
        lastErrorClass: null,
        decisionId,
        priorLinkId,
        resultLinkId
      });

    case WRITER_OUTCOME.AMBIGUOUS_COMMIT:
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.PERSIST_AMBIGUOUS,
        status: LEDGER_STATUS.AMBIGUOUS,
        finalOutcome: null,
        lastErrorClass: CANONICAL_ERROR_CLASS.AMBIGUOUS_COMMIT,
        decisionId,
        priorLinkId,
        resultLinkId
      });

    case WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE:
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.PERSIST_TERMINAL,
        status: LEDGER_STATUS.FAILED,
        finalOutcome: outcome,
        lastErrorClass: toLedgerErrorClass(safeDiagnosticCode, CANONICAL_ERROR_CLASS.MANUAL_PRECEDENCE),
        decisionId: null,
        priorLinkId,
        resultLinkId: null
      });

    case WRITER_OUTCOME.INVALID_PARENT_OR_TENANT:
    case WRITER_OUTCOME.FORBIDDEN:
    case WRITER_OUTCOME.INTERNAL_FAILURE:
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.PERSIST_TERMINAL,
        status: LEDGER_STATUS.FAILED,
        finalOutcome: outcome,
        lastErrorClass: toLedgerErrorClass(safeDiagnosticCode, CANONICAL_ERROR_CLASS.UNKNOWN),
        decisionId: null,
        priorLinkId: null,
        resultLinkId: null
      });

    case WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE:
    case WRITER_OUTCOME.CONFLICT_STALE_STATE:
      // Conflict on the canonical link tables, not on the ledger row's own
      // identity -- the same claimed operation should retry, not be marked
      // FAILED.
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.RETAIN_CLAIMED,
        status: null,
        finalOutcome: null,
        lastErrorClass: null,
        decisionId: null,
        priorLinkId: null,
        resultLinkId: null
      });

    case WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE:
      // The whole transaction, including the CLAIMED insert, is guaranteed
      // rolled back by Postgres for 40001/40P01/55P03/57014(pre-commit) --
      // there is nothing left to persist.
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.TRANSACTION_ROLLED_BACK,
        status: null,
        finalOutcome: null,
        lastErrorClass: null,
        decisionId: null,
        priorLinkId: null,
        resultLinkId: null
      });

    default:
      fail(`Esito non gestito dal mapper: ${String(outcome)}.`);
      return undefined;
  }
}
