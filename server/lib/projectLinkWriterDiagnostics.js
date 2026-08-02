import { readOwnDataProperty, isSafeLowerIdentifier, isValidSqlstate } from "./projectLinkWriterSafeAccess.js";

/**
 * Exact RAISE EXCEPTION messages emitted by
 * supabase/migrations/20260730210335_enforce_manual_project_link_precedence.sql
 * (assert_order_project_link_manual_precedence /
 * assert_line_project_link_manual_precedence). Both triggers set only
 * `USING ERRCODE = '23514'` -- neither sets `USING CONSTRAINT = ...` -- so
 * PostgreSQL will not populate the error's constraint field for this
 * specific error. Detection therefore relies on an exact match against
 * these two literal messages, never on the constraint field and never on a
 * broad substring match.
 *
 * "Exact match" here means byte-for-byte string equality: case-sensitive,
 * whitespace-sensitive, no trimming. The migration emits these as fixed,
 * application-controlled literals -- there is no legitimate source of
 * incidental case or whitespace variation to tolerate, so none is applied.
 * A message that differs from either literal by even one leading/trailing
 * space, a tab, a newline, or a single character of case is NOT the
 * approved message and must not derive manualPrecedenceMarker.
 */
const MANUAL_PRECEDENCE_MESSAGES = Object.freeze([
  "order project-link manual precedence violation",
  "line project-link manual precedence violation"
]);

/**
 * Identity-based provenance registry, private to this module. Membership
 * means "this exact object instance was produced by extractSafeDiagnostics
 * itself" -- it is never set from any caller-supplied data, only ever
 * populated here, right before returning a freshly-built result. Because a
 * WeakSet is keyed by object identity, no ordinary object -- however it is
 * shaped, however many properties it carries, including a hand-set
 * manualPrecedenceMarker: true -- can ever get into this set. A shallow
 * clone or `{...sanitized}` spread copy of a trusted result is a different
 * object identity and is therefore never trusted, by construction. This is
 * deliberately not a Symbol brand on the object itself: a property-based
 * brand (even a Symbol-keyed one) is still something a caller could read
 * off a genuine result and attach to a forged object; a WeakSet lookup has
 * no such surface, since forging membership would require inserting into
 * this module-private WeakSet, which is never exported.
 */
const trustedSafeDiagnostics = new WeakSet();

function sanitizeIdentifier(value) {
  return isSafeLowerIdentifier(value) ? value.trim() : null;
}

function sanitizeSqlstate(value) {
  if (!isValidSqlstate(value)) return null;
  return value.trim().toUpperCase();
}

/**
 * Accepts a database error-like object and returns only a narrow,
 * allow-listed set of safe fields. `message`, `detail`, `hint`, `stack`,
 * and any connection-related property are never copied into the result.
 * Every property is read via readOwnDataProperty, so an object with a
 * hostile getter for `code`/`message`/etc. can never execute arbitrary
 * code through this function, and readOwnDataProperty's own Proxy
 * detection means a Proxy `dbErrorLike` never has any of its traps
 * invoked either.
 *
 * Idempotent by design: calling this on its own previously-returned output
 * returns that exact result again, unchanged. This is proven by identity,
 * not by shape -- see trustedSafeDiagnostics above. If `dbErrorLike` is an
 * object this module itself previously produced and registered, it is
 * returned as-is, with zero property reads. Anything else -- a raw
 * driver-shaped error, a hand-built object using the sanitized field names,
 * a clone or spread copy of a previous result, or a hostile value of either
 * apparent shape -- is treated as fully untrusted input: every field is
 * re-derived from scratch via readOwnDataProperty, and manualPrecedenceMarker
 * is derived ONLY from byte-for-byte exact equality against `message` (see
 * MANUAL_PRECEDENCE_MESSAGES) -- never from trimming, case-folding, or any
 * other normalization of `message`, and never from an own
 * manualPrecedenceMarker property on the input, since that would let
 * arbitrary caller-supplied data assert a manual-precedence classification
 * without ever having proven the one exact RAISE EXCEPTION message it is
 * supposed to represent.
 */
export function extractSafeDiagnostics(dbErrorLike) {
  if (dbErrorLike !== null && typeof dbErrorLike === "object" && trustedSafeDiagnostics.has(dbErrorLike)) {
    return dbErrorLike;
  }

  if (dbErrorLike === null || typeof dbErrorLike !== "object") {
    const result = Object.freeze({
      sqlstate: null,
      constraint: null,
      table: null,
      schema: null,
      routine: null,
      manualPrecedenceMarker: false
    });
    trustedSafeDiagnostics.add(result);
    return result;
  }

  const sqlstate = sanitizeSqlstate(readOwnDataProperty(dbErrorLike, "code"))
    || sanitizeSqlstate(readOwnDataProperty(dbErrorLike, "sqlstate"));
  const constraint = sanitizeIdentifier(readOwnDataProperty(dbErrorLike, "constraint"));
  const table = sanitizeIdentifier(readOwnDataProperty(dbErrorLike, "table"));
  const schema = sanitizeIdentifier(readOwnDataProperty(dbErrorLike, "schema"));
  const routine = sanitizeIdentifier(readOwnDataProperty(dbErrorLike, "routine"));

  const rawMessage = readOwnDataProperty(dbErrorLike, "message");
  const manualPrecedenceMarker = typeof rawMessage === "string"
    && MANUAL_PRECEDENCE_MESSAGES.includes(rawMessage);

  const result = Object.freeze({ sqlstate, constraint, table, schema, routine, manualPrecedenceMarker });
  trustedSafeDiagnostics.add(result);
  return result;
}

/**
 * Reduces raw diagnostics to a short, stable code safe for client-facing
 * responses and for persistence as project_link_operations.last_error_class.
 * Never includes free-text database content.
 *
 * Safe to call directly with an arbitrary, caller-controlled value: the
 * input is always re-normalized through extractSafeDiagnostics first, so
 * inherited properties, accessor getters and Proxy traps can never
 * influence the result, and a malformed value safely falls through to the
 * conservative "UNKNOWN" code. An already-sanitized diagnostics object
 * (the normal call shape, produced by extractSafeDiagnostics) passes
 * through unchanged, since extractSafeDiagnostics is idempotent.
 */
export function toSafeDiagnosticCode(diagnostics) {
  const safeDiagnostics = extractSafeDiagnostics(diagnostics);
  if (safeDiagnostics.manualPrecedenceMarker) return "MANUAL_PRECEDENCE";
  if (safeDiagnostics.sqlstate) return `SQLSTATE_${safeDiagnostics.sqlstate}`;
  return "UNKNOWN";
}
