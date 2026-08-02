import { WRITER_OUTCOME } from "./projectLinkWriterResult.js";

/**
 * What a future writer should do with the ledger row for a given attempt.
 *
 * The writer is a single atomic transaction: claim, decision, canonical
 * mutation and terminal ledger update all commit together or not at all
 * (see the architecture-decision record accompanying this correction). A
 * fresh connection can therefore only ever observe the whole transaction
 * committed (terminal ledger row + canonical mutation present) or the whole
 * transaction absent -- never a durable CLAIMED row missing its terminal
 * update. There is consequently no database write this module can ever
 * correctly instruct for an ambiguous-commit attempt; see RECOVER_BY_LOOKUP.
 *
 * PERSIST_TERMINAL         -- write a terminal COMPLETED or FAILED row.
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
 * RECOVER_BY_LOOKUP        -- this specific attempt's outcome is unknown
 *                              (its own COMMIT acknowledgement was lost).
 *                              Perform NO ledger write from this connection.
 *                              The true outcome must instead be resolved on
 *                              a new connection by looking up the existing
 *                              row for (organizationId, operationKey,
 *                              requestFingerprint) -- it will already be
 *                              either a terminal row (the transaction did
 *                              commit) or absent (it did not). Never write a
 *                              database AMBIGUOUS status from this action.
 * NO_LEDGER_WRITE          -- no ledger mutation of any kind applies to this
 *                              attempt: either it is a replay of an
 *                              already-terminal result (nothing new
 *                              happened), or it was rejected before any
 *                              claim/mutation was attempted (idempotency-key
 *                              reuse with a different fingerprint).
 *
 * RECOVERY INVARIANT (not implemented by this module -- documented here
 * because RECOVER_BY_LOOKUP is the action that makes it load-bearing):
 * a no-row lookup performed immediately after a lost RPC/COMMIT response
 * does NOT, by itself, prove the original attempt's transaction has already
 * rolled back -- that first attempt's transaction may still genuinely be in
 * flight (still holding its claim lock, not yet at COMMIT) at the exact
 * moment a recovery lookup runs. A future recovery implementation must
 * therefore never treat "no row yet" as a green light to start a second,
 * independent write for the same (organizationId, operationKey) without
 * either (a) bounded polling that re-checks after a grace period, or
 * (b) idempotently re-invoking the very same write with the same
 * organizationId, operationKey and requestFingerprint and letting
 * uniq_project_link_operations_org_key serialize any genuine overlap
 * between the two attempts. This module performs no such polling or
 * re-invocation itself -- it only ever returns a classification, never a
 * write, for the ambiguous case.
 */
export const LEDGER_ACTION = Object.freeze({
  PERSIST_TERMINAL: "PERSIST_TERMINAL",
  RETAIN_CLAIMED: "RETAIN_CLAIMED",
  TRANSACTION_ROLLED_BACK: "TRANSACTION_ROLLED_BACK",
  RECOVER_BY_LOOKUP: "RECOVER_BY_LOOKUP",
  NO_LEDGER_WRITE: "NO_LEDGER_WRITE"
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
    safeDiagnosticCode = null,
    replayed = false
  } = result;

  // Takes precedence over every outcome-specific branch below: a replayed
  // result means this attempt did no new work at all -- it only
  // reconstructed and returned an already-persisted terminal outcome, so no
  // ledger status transition is ever implied, regardless of which terminal
  // outcome was replayed. Only projectLinkWriterResult.js's own
  // REPLAY_ELIGIBLE_OUTCOMES may legally carry replayed === true, but this
  // check is unconditional here as a defensive default: it can never be
  // less safe than the outcome-specific mapping it preempts.
  if (replayed === true) {
    return Object.freeze({
      ledgerAction: LEDGER_ACTION.NO_LEDGER_WRITE,
      status: null,
      finalOutcome: outcome,
      lastErrorClass: null,
      decisionId,
      priorLinkId,
      resultLinkId
    });
  }

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
      // This attempt's own COMMIT acknowledgement was lost -- its true
      // outcome is unknown to this connection and MUST NOT be guessed at or
      // written here. See the LEDGER_ACTION doc comment: under the
      // single-transaction writer, a durable CLAIMED row missing its
      // terminal update is not a reachable database state, so there is no
      // row for a later connection to "convert" to AMBIGUOUS either. The
      // only correct action is a durable lookup, by
      // (organizationId, operationKey, requestFingerprint), on a new
      // connection/attempt -- never a write from this one.
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.RECOVER_BY_LOOKUP,
        status: null,
        finalOutcome: null,
        lastErrorClass: null,
        decisionId: null,
        priorLinkId: null,
        resultLinkId: null
      });

    case WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE:
      // An existing operation already owns this (organizationId,
      // operationKey) with a different requestFingerprint. Nothing about
      // this attempt is persisted: no request fact may be overwritten
      // (the immutability trigger would reject it anyway), no canonical
      // mutation and no ledger mutation ever ran for this attempt.
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.NO_LEDGER_WRITE,
        status: null,
        finalOutcome: outcome,
        lastErrorClass: null,
        decisionId: null,
        priorLinkId: null,
        resultLinkId: null
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
