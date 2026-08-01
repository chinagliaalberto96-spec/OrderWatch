import { WRITER_OUTCOME } from "./projectLinkWriterResult.js";
import { toSafeDiagnosticCode } from "./projectLinkWriterDiagnostics.js";

export const LOG_SEVERITY = Object.freeze({
  INFO: "info",
  WARN: "warn",
  ERROR: "error"
});

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
    note: "no replay until a durable idempotency lookup resolves the true outcome"
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
 * disambiguate (manual-precedence proof, ambiguous commit status).
 *
 * No retry loop is executed here -- only policy metadata is returned.
 */
export function classifySqlError({ diagnostics, ambiguousCommit = false, commitInFlight = null } = {}) {
  const safeDiagnostics = diagnostics || {};
  const sqlstate = safeDiagnostics.sqlstate || null;
  const safeDiagnosticCode = toSafeDiagnosticCode(safeDiagnostics);

  if (ambiguousCommit) {
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
    case "23505":
      return policyResult({
        classification: WRITER_OUTCOME.CONFLICT_CONCURRENT_CHANGE,
        rereadRequired: true,
        logSeverity: LOG_SEVERITY.WARN,
        safeDiagnosticCode,
        retryPolicyKey: "SQLSTATE_23505"
      });

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
