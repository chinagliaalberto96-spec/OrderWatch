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
 * RETAIN_CLAIMED           -- reserved, unused by this mapper. No final
 *                              WRITER_OUTCOME maps to it (see below) -- it
 *                              must NEVER be interpreted as permission to
 *                              commit a durable CLAIMED row. The atomic
 *                              writer's claim and every canonical mutation
 *                              attempted under it share one transaction;
 *                              when a canonical-table conflict is detected,
 *                              the writer rolls the claim back together with
 *                              the attempted canonical mutation and returns
 *                              a structured conflict result from an
 *                              exception handler within that same
 *                              transaction -- it never leaves the claim
 *                              committed for a later, separate invocation to
 *                              resume. This value is kept in the enum only
 *                              because it is part of this module's already
 *                              exported, committed public surface (removing
 *                              it would be a breaking export change outside
 *                              this correction's narrow scope); it is not
 *                              removed, but mapResultToLedgerState never
 *                              returns it.
 * TRANSACTION_ROLLED_BACK  -- the whole transaction, including the CLAIMED
 *                              insert itself (and, where one was attempted,
 *                              the canonical mutation), was rolled back by
 *                              Postgres; there is no ledger row left to
 *                              update, and a retry means starting a fresh
 *                              transaction (which may reuse the same
 *                              operation_key/request_fingerprint, since
 *                              nothing persisted). This is also the correct
 *                              action for a canonical-table conflict
 *                              (CONFLICT_CONCURRENT_CHANGE,
 *                              CONFLICT_STALE_STATE): the atomic writer
 *                              rolls the claim back together with the
 *                              canonical mutation it attempted, exactly as
 *                              for any other whole-transaction rollback --
 *                              there is no different-in-kind "retain the
 *                              claim" action for this case (see
 *                              RETAIN_CLAIMED above).
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
 *                              attempt, because there is either nothing new
 *                              to persist or no row that could physically
 *                              have been claimed in the first place:
 *                                - a replay of an already-terminal result
 *                                  (nothing new happened);
 *                                - idempotency-key reuse with a different
 *                                  fingerprint (rejected before any
 *                                  claim/mutation was attempted);
 *                                - INVALID_PARENT_OR_TENANT (SQLSTATE 23503
 *                                  from the operation-ledger's own
 *                                  reference-validation trigger can reject
 *                                  the CLAIMED insert itself, before any
 *                                  operation row exists to update);
 *                                - FORBIDDEN (SQLSTATE 42501 can likewise
 *                                  occur before the claim insert succeeds,
 *                                  if the caller lacks INSERT privilege on
 *                                  project_link_operations -- there is no
 *                                  row, and no privilege basis, to
 *                                  reliably terminalize one).
 *                              A NO_LEDGER_WRITE result must never be used
 *                              to authorize a ledger UPDATE: it carries a
 *                              null status and no field a caller could
 *                              mistake for permission to write one.
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

    case WRITER_OUTCOME.INTERNAL_FAILURE:
      // Unlike INVALID_PARENT_OR_TENANT/FORBIDDEN below, every classifier
      // branch that produces INTERNAL_FAILURE (an unrecognized/missing
      // 23505 constraint, a 23514 without the manual-precedence message, an
      // unmapped SQLSTATE) can only arise from a canonical-mutation-phase or
      // deferred-constraint-forcing-phase statement -- never from the claim
      // insert itself -- so a claimed row always already exists by the time
      // this outcome is determined. PERSIST_TERMINAL remains correct and
      // physically achievable here.
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.PERSIST_TERMINAL,
        status: LEDGER_STATUS.FAILED,
        finalOutcome: outcome,
        lastErrorClass: toLedgerErrorClass(safeDiagnosticCode, CANONICAL_ERROR_CLASS.UNKNOWN),
        decisionId: null,
        priorLinkId: null,
        resultLinkId: null
      });

    case WRITER_OUTCOME.INVALID_PARENT_OR_TENANT:
      // SQLSTATE 23503 from the operation-ledger's own reference-validation
      // trigger (assert_project_link_operation_references) can reject the
      // CLAIMED insert itself, before any operation row exists -- there is
      // nothing to persist a terminal FAILED status against. See this
      // module's NO_LEDGER_WRITE doc comment above for the full rationale.
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.NO_LEDGER_WRITE,
        status: null,
        finalOutcome: outcome,
        lastErrorClass: null,
        decisionId: null,
        priorLinkId: null,
        resultLinkId: null
      });

    case WRITER_OUTCOME.FORBIDDEN:
      // SQLSTATE 42501 can likewise occur before the claim insert itself
      // succeeds, if the caller lacks INSERT privilege on
      // project_link_operations -- there is no row, and no privilege basis,
      // to reliably terminalize one. Kept classified as FORBIDDEN for
      // transport/application diagnostics only; never represented as a
      // normal terminal business result the writer persisted.
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.NO_LEDGER_WRITE,
        status: null,
        finalOutcome: outcome,
        lastErrorClass: null,
        decisionId: null,
        priorLinkId: null,
        resultLinkId: null
      });

    case WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE:
    case WRITER_OUTCOME.CONFLICT_STALE_STATE:
      // Conflict on the canonical link tables. The atomic writer's claim
      // and its canonical-mutation attempt share one transaction; on this
      // conflict, both are rolled back together and a structured result is
      // returned from within that same transaction -- there is no ledger
      // row left afterward, exactly as for any other whole-transaction
      // rollback (see TRANSACTION_ROLLED_BACK above). A later, separate
      // attempt to retry this logical operation starts a fresh transaction
      // (it may reuse the same operation_key/request_fingerprint, since
      // nothing persisted) -- it never "resumes" a durably-claimed row.
      return Object.freeze({
        ledgerAction: LEDGER_ACTION.TRANSACTION_ROLLED_BACK,
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
