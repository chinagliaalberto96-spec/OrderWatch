import { WRITER_OUTCOME } from "./projectLinkWriterResult.js";
import { toSafeDiagnosticCode, extractSafeDiagnostics } from "./projectLinkWriterDiagnostics.js";

export const LOG_SEVERITY = Object.freeze({
  INFO: "info",
  WARN: "warn",
  ERROR: "error"
});

/**
 * Closed set of phases within one writer attempt's single transaction, used
 * only to disambiguate which unique constraint a given SQLSTATE 23505 could
 * legitimately have come from. Not a general-purpose state machine -- the
 * writer supplies exactly one of these per call to classifySqlError.
 */
export const OPERATION_PHASE = Object.freeze({
  CLAIM: "CLAIM",
  CANONICAL_MUTATION: "CANONICAL_MUTATION",
  TERMINAL_UPDATE: "TERMINAL_UPDATE"
});

/**
 * The two unique constraints capable of producing SQLSTATE 23505 during a
 * writer attempt (confirmed against supabase/migrations/20260731102910_...
 * and 20260729170041_...). A 23505 on any other constraint name -- or on one
 * of these but from an operationPhase where it could not legitimately have
 * fired -- is never assumed to be a known race; see classifySqlError's
 * "23505" case.
 */
const LEDGER_CLAIM_KEY_CONSTRAINT = "uniq_project_link_operations_org_key";
const ACTIVE_LINK_UNIQUE_CONSTRAINTS = Object.freeze([
  "uniq_order_project_links_active",
  "uniq_line_project_links_active"
]);

/**
 * maxTotalAttempts counts the initial attempt plus any retries -- it is
 * never a "retries only" count. maxRetries = maxTotalAttempts - 1 is
 * provided explicitly alongside it so a caller never has to infer which
 * convention is in use. maxTotalAttempts: 1 means the initial attempt is
 * final and no retry is permitted.
 */
function policyEntry({ maxTotalAttempts, ...rest }) {
  return Object.freeze({
    maxTotalAttempts,
    maxRetries: maxTotalAttempts - 1,
    ...rest
  });
}

/**
 * Declarative retry-policy metadata only. No retry loop is implemented or
 * executed anywhere in this module -- callers own the retry loop and must
 * consult this table (or the policy embedded in classifySqlError's return
 * value) before deciding to retry.
 *
 * SQLSTATE_57014 (statement/query timeout) is intentionally a distinct
 * entry from SQLSTATE_55P03 (lock not available) -- they represent
 * different failure conditions with different safety properties, and this
 * entry only ever applies to the sub-case classifySqlError proves happened
 * strictly before COMMIT (commitInFlight === false). Any other 57014 is
 * classified as AMBIGUOUS_COMMIT and uses that policy instead.
 */
export const RETRY_POLICY = Object.freeze({
  PRE_BEGIN_TRANSPORT_FAILURE: policyEntry({
    maxTotalAttempts: 3,
    strategy: "exponential",
    jitterMs: Object.freeze({ min: 100, max: 1600 }),
    blindRetryAllowed: true
  }),
  SQLSTATE_40001: policyEntry({
    maxTotalAttempts: 3,
    strategy: "exponential",
    jitterMs: Object.freeze({ min: 50, max: 400 }),
    blindRetryAllowed: false,
    fullTransactionRetryAllowed: true
  }),
  SQLSTATE_40P01: policyEntry({
    maxTotalAttempts: 3,
    strategy: "exponential",
    jitterMs: Object.freeze({ min: 50, max: 400 }),
    blindRetryAllowed: false,
    fullTransactionRetryAllowed: true
  }),
  SQLSTATE_55P03: policyEntry({
    maxTotalAttempts: 2,
    strategy: "exponential",
    jitterMs: Object.freeze({ min: 100, max: 800 }),
    blindRetryAllowed: false,
    fullTransactionRetryAllowed: true
  }),
  SQLSTATE_57014: policyEntry({
    maxTotalAttempts: 2,
    strategy: "exponential",
    jitterMs: Object.freeze({ min: 100, max: 800 }),
    blindRetryAllowed: false,
    fullTransactionRetryAllowed: true,
    note: "applies only when the caller has proven commitInFlight === false"
  }),
  SQLSTATE_23505: policyEntry({
    maxTotalAttempts: 1,
    blindRetryAllowed: false,
    fullTransactionRetryAllowed: false,
    note: "reread required; retry only after recomputing intent from fresh state"
  }),
  SQLSTATE_55000: policyEntry({
    maxTotalAttempts: 1,
    blindRetryAllowed: false,
    fullTransactionRetryAllowed: false,
    note: "reread required; the acted-on row identity is stale"
  }),
  MANUAL_PRECEDENCE_23514: policyEntry({
    maxTotalAttempts: 1,
    blindRetryAllowed: false,
    fullTransactionRetryAllowed: false,
    note: "never retried automatically; requires manual review or a manual decision"
  }),
  AMBIGUOUS_COMMIT: policyEntry({
    maxTotalAttempts: 1,
    blindRetryAllowed: false,
    fullTransactionRetryAllowed: false,
    requiresIdempotencyLookup: true,
    note: "no replay until a durable idempotency lookup, by organizationId/" +
      "operationKey/requestFingerprint on a new connection, resolves the " +
      "true outcome; this policy never authorizes writing a database " +
      "AMBIGUOUS ledger status from the attempt that lost its own commit " +
      "acknowledgement -- see projectLinkWriterResultLedgerMapper.js's " +
      "LEDGER_ACTION.RECOVER_BY_LOOKUP"
  })
});

function policyResult({
  classification,
  rereadRequired,
  blindRetryAllowed,
  fullTransactionRetryAllowed,
  manualReviewRequired,
  idempotencyLookupRequired,
  logSeverity,
  safeDiagnosticCode,
  retryPolicyKey
}) {
  return Object.freeze({
    classification,
    rereadRequired: Boolean(rereadRequired),
    blindRetryAllowed: Boolean(blindRetryAllowed),
    fullTransactionRetryAllowed: Boolean(fullTransactionRetryAllowed),
    manualReviewRequired: Boolean(manualReviewRequired),
    idempotencyLookupRequired: Boolean(idempotencyLookupRequired),
    logSeverity,
    safeDiagnosticCode,
    retryPolicy: retryPolicyKey ? RETRY_POLICY[retryPolicyKey] : null
  });
}

/**
 * Pure PostgreSQL-error classifier. Accepts structured, already-sanitized
 * diagnostics (see projectLinkWriterDiagnostics.js) plus explicit
 * caller-supplied context flags for cases the SQLSTATE alone cannot
 * disambiguate (manual-precedence proof, ambiguous commit status,
 * operationPhase for 23505 constraint disambiguation).
 *
 * No retry loop is executed here -- only policy metadata is returned.
 *
 * The caller-supplied `diagnostics` is never trusted directly: it is always
 * re-normalized here through extractSafeDiagnostics before anything below
 * this point reads from it. This makes classifySqlError safe to call with a
 * raw, unsanitized, or actively hostile diagnostics value (inherited
 * properties, accessor getters, a Proxy) without requiring the caller to
 * have sanitized it first -- while still producing the exact same
 * classification as before for an already-sanitized diagnostics object,
 * since extractSafeDiagnostics is idempotent on its own output.
 */
export function classifySqlError({
  diagnostics,
  ambiguousCommit = false,
  commitInFlight = null,
  operationPhase = null
} = {}) {
  const safeDiagnostics = extractSafeDiagnostics(diagnostics);
  const sqlstate = safeDiagnostics.sqlstate;
  const safeDiagnosticCode = toSafeDiagnosticCode(safeDiagnostics);

  if (ambiguousCommit) {
    // The caller's own COMMIT acknowledgement was lost. This is never
    // resolved by a retry from here -- only by a durable idempotency lookup
    // on a fresh connection/attempt. It never authorizes writing a database
    // AMBIGUOUS ledger status either; see RETRY_POLICY.AMBIGUOUS_COMMIT's
    // note and projectLinkWriterResultLedgerMapper.js's
    // LEDGER_ACTION.RECOVER_BY_LOOKUP.
    return policyResult({
      classification: WRITER_OUTCOME.AMBIGUOUS_COMMIT,
      rereadRequired: true,
      idempotencyLookupRequired: true,
      logSeverity: LOG_SEVERITY.ERROR,
      safeDiagnosticCode,
      retryPolicyKey: "AMBIGUOUS_COMMIT"
    });
  }

  switch (sqlstate) {
    case "23505": {
      const constraint = safeDiagnostics.constraint;

      // Ledger claim race: two attempts raced to insert/observe the same
      // (organization_id, operation_key). This classifier deliberately does
      // NOT decide same-vs-different fingerprint here -- it only signals
      // that a durable reread is required; the writer rereads the winning
      // row and produces either a replay result or
      // WRITER_OUTCOME.CONFLICT_IDEMPOTENCY_KEY_REUSE depending on whether
      // the fingerprints match.
      if (constraint === LEDGER_CLAIM_KEY_CONSTRAINT && operationPhase === OPERATION_PHASE.CLAIM) {
        return policyResult({
          classification: WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE,
          rereadRequired: true,
          idempotencyLookupRequired: true,
          blindRetryAllowed: false,
          fullTransactionRetryAllowed: false,
          logSeverity: LOG_SEVERITY.WARN,
          safeDiagnosticCode,
          retryPolicyKey: "SQLSTATE_23505"
        });
      }

      // Canonical active-link race: two attempts raced to create/reactivate
      // an active ORDER/LINE link when this attempt's own prior read
      // believed zero were active. This is a stale-canonical-state
      // conflict, not an idempotency-key conflict -- classified identically
      // to (and sharing the retry policy of) SQLSTATE 55000, since both
      // mean "reread the canonical state and bound the retry, never mark
      // the ledger claim FAILED for this alone."
      if (ACTIVE_LINK_UNIQUE_CONSTRAINTS.includes(constraint) && operationPhase === OPERATION_PHASE.CANONICAL_MUTATION) {
        return policyResult({
          classification: WRITER_OUTCOME.CONFLICT_STALE_STATE,
          rereadRequired: true,
          blindRetryAllowed: false,
          fullTransactionRetryAllowed: false,
          logSeverity: LOG_SEVERITY.WARN,
          safeDiagnosticCode,
          retryPolicyKey: "SQLSTATE_55000"
        });
      }

      // Unknown/missing constraint, or a recognized constraint fired from a
      // phase where it could not legitimately have come from that
      // constraint (e.g. the ledger-claim constraint outside CLAIM, or an
      // active-link constraint outside CANONICAL_MUTATION). Never silently
      // fall back to a known race classification for an unproven case.
      return policyResult({
        classification: WRITER_OUTCOME.INTERNAL_FAILURE,
        blindRetryAllowed: false,
        fullTransactionRetryAllowed: false,
        logSeverity: LOG_SEVERITY.ERROR,
        safeDiagnosticCode
      });
    }

    case "55000":
      return policyResult({
        classification: WRITER_OUTCOME.CONFLICT_STALE_STATE,
        rereadRequired: true,
        logSeverity: LOG_SEVERITY.WARN,
        safeDiagnosticCode,
        retryPolicyKey: "SQLSTATE_55000"
      });

    case "23514":
      if (safeDiagnostics.manualPrecedenceMarker) {
        return policyResult({
          classification: WRITER_OUTCOME.BLOCKED_MANUAL_PRECEDENCE,
          rereadRequired: true,
          manualReviewRequired: true,
          logSeverity: LOG_SEVERITY.WARN,
          safeDiagnosticCode: "MANUAL_PRECEDENCE",
          retryPolicyKey: "MANUAL_PRECEDENCE_23514"
        });
      }
      // A 23514 without proof of the manual-precedence enforcing message is
      // treated as an unexpected constraint violation (likely a writer
      // bug), never silently classified as a precedence block.
      return policyResult({
        classification: WRITER_OUTCOME.INTERNAL_FAILURE,
        logSeverity: LOG_SEVERITY.ERROR,
        safeDiagnosticCode
      });

    case "23503":
      return policyResult({
        classification: WRITER_OUTCOME.INVALID_PARENT_OR_TENANT,
        logSeverity: LOG_SEVERITY.ERROR,
        safeDiagnosticCode
      });

    case "42501":
      return policyResult({
        classification: WRITER_OUTCOME.FORBIDDEN,
        logSeverity: LOG_SEVERITY.ERROR,
        safeDiagnosticCode
      });

    case "40001":
      return policyResult({
        classification: WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE,
        fullTransactionRetryAllowed: true,
        logSeverity: LOG_SEVERITY.WARN,
        safeDiagnosticCode,
        retryPolicyKey: "SQLSTATE_40001"
      });

    case "40P01":
      return policyResult({
        classification: WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE,
        fullTransactionRetryAllowed: true,
        logSeverity: LOG_SEVERITY.WARN,
        safeDiagnosticCode,
        retryPolicyKey: "SQLSTATE_40P01"
      });

    case "55P03":
      return policyResult({
        classification: WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE,
        fullTransactionRetryAllowed: true,
        logSeverity: LOG_SEVERITY.WARN,
        safeDiagnosticCode,
        retryPolicyKey: "SQLSTATE_55P03"
      });

    case "57014":
      // A statement/query timeout is only safe to treat as a plain
      // retryable failure when the caller explicitly proves the commit was
      // NOT in flight. Any other value (unknown or true) defaults to the
      // ambiguous-commit classification -- retry safety must never be
      // assumed when the commit may have started. This uses its own
      // dedicated SQLSTATE_57014 policy, never the SQLSTATE_55P03 one.
      if (commitInFlight === false) {
        return policyResult({
          classification: WRITER_OUTCOME.RETRYABLE_TRANSACTION_FAILURE,
          fullTransactionRetryAllowed: true,
          logSeverity: LOG_SEVERITY.WARN,
          safeDiagnosticCode,
          retryPolicyKey: "SQLSTATE_57014"
        });
      }
      return policyResult({
        classification: WRITER_OUTCOME.AMBIGUOUS_COMMIT,
        rereadRequired: true,
        idempotencyLookupRequired: true,
        logSeverity: LOG_SEVERITY.ERROR,
        safeDiagnosticCode,
        retryPolicyKey: "AMBIGUOUS_COMMIT"
      });

    default:
      return policyResult({
        classification: WRITER_OUTCOME.INTERNAL_FAILURE,
        logSeverity: LOG_SEVERITY.ERROR,
        safeDiagnosticCode
      });
  }
}
