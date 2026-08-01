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
 */
const MANUAL_PRECEDENCE_MESSAGES = Object.freeze([
  "order project-link manual precedence violation",
  "line project-link manual precedence violation"
]);

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
 * code through this function.
 */
export function extractSafeDiagnostics(dbErrorLike) {
  if (dbErrorLike === null || typeof dbErrorLike !== "object") {
    return Object.freeze({
      sqlstate: null,
      constraint: null,
      table: null,
      schema: null,
      routine: null,
      manualPrecedenceMarker: false
    });
  }

  const sqlstate = sanitizeSqlstate(readOwnDataProperty(dbErrorLike, "code"))
    || sanitizeSqlstate(readOwnDataProperty(dbErrorLike, "sqlstate"));
  const constraint = sanitizeIdentifier(readOwnDataProperty(dbErrorLike, "constraint"));
  const table = sanitizeIdentifier(readOwnDataProperty(dbErrorLike, "table"));
  const schema = sanitizeIdentifier(readOwnDataProperty(dbErrorLike, "schema"));
  const routine = sanitizeIdentifier(readOwnDataProperty(dbErrorLike, "routine"));

  const rawMessage = readOwnDataProperty(dbErrorLike, "message");
  const manualPrecedenceMarker = typeof rawMessage === "string"
    && MANUAL_PRECEDENCE_MESSAGES.includes(rawMessage.trim().toLowerCase());

  return Object.freeze({ sqlstate, constraint, table, schema, routine, manualPrecedenceMarker });
}

/**
 * Reduces raw diagnostics to a short, stable code safe for client-facing
 * responses and for persistence as project_link_operations.last_error_class.
 * Never includes free-text database content.
 */
export function toSafeDiagnosticCode(diagnostics) {
  if (!diagnostics) return "UNKNOWN";
  if (diagnostics.manualPrecedenceMarker) return "MANUAL_PRECEDENCE";
  if (diagnostics.sqlstate) return `SQLSTATE_${diagnostics.sqlstate}`;
  return "UNKNOWN";
}
