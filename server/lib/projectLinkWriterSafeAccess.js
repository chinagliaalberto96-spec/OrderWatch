import { types } from "node:util";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SQLSTATE_PATTERN = /^[0-9A-Za-z]{5}$/;
export const SAFE_LOWER_IDENTIFIER_PATTERN = /^[a-z0-9_]{1,128}$/i;
export const SAFE_UPPER_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
export const REQUEST_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
export const OPERATION_KEY_MAX_LENGTH = 255;

/**
 * Detects a Proxy exotic object (revoked or not) using Node's built-in,
 * trap-free type check (util.types.isProxy) -- never Object.getPrototypeOf,
 * Object.getOwnPropertyDescriptor, or any other reflective operation that
 * would invoke a handler trap merely to test for Proxy-ness. Every exported
 * function below that performs reflection on its input must call this
 * *before* any such operation, and must treat a detected Proxy exactly like
 * an unavailable/unsafe value -- never a special case that still reaches a
 * trap. Fails closed (treats the value as a Proxy) if the detection call
 * itself throws for any reason, since the safe default here is "do not
 * proceed to a reflective operation," not "assume it's safe."
 */
function isProxyLike(value) {
  try {
    return types.isProxy(value);
  } catch {
    return true;
  }
}

/**
 * True only for a literal object (Object.prototype or null prototype) that
 * is not an array and is not a Proxy. Rejects class instances, Error
 * objects, functions, arrays, and Proxies (including revoked ones) as the
 * top-level container for metadata-shaped input. The Proxy check runs
 * first and unconditionally, before Object.getPrototypeOf is ever called --
 * Array.isArray and Object.getPrototypeOf are never reached for a Proxy, so
 * no getPrototypeOf/ownKeys/has trap can ever fire from this function. If
 * prototype inspection itself fails for any other reason, the value is
 * rejected conservatively rather than allowing the exception to escape.
 */
export function isPlainMetadataObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (isProxyLike(value)) return false;
  if (Array.isArray(value)) return false;
  let proto;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return proto === Object.prototype || proto === null;
}

/**
 * Reads an own data property from `source` without ever invoking a getter,
 * a Proxy trap side effect, toString, or valueOf. Returns undefined for
 * anything that is not an own, plain data property -- including inherited
 * properties, accessor properties, properties on non-object inputs, and
 * anything on a Proxy (revoked or not). The Proxy check runs first and
 * unconditionally, before Object.getOwnPropertyDescriptor is ever called --
 * a try/catch around that call alone is not sufficient, since the
 * getOwnPropertyDescriptor trap itself still executes (and any side effect
 * inside it still happens) before it can throw or return; detecting the
 * Proxy up front means the trap is never invoked at all, not merely that
 * its exception is caught afterward.
 */
export function readOwnDataProperty(source, key) {
  if (source === null || typeof source !== "object") return undefined;
  if (isProxyLike(source)) return undefined;

  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(source, key);
  } catch {
    return undefined;
  }

  if (!descriptor || !("value" in descriptor)) return undefined;
  return descriptor.value;
}

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isValidOperationKey(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= OPERATION_KEY_MAX_LENGTH
    && value === value.trim();
}

export function isValidRequestFingerprint(value) {
  return typeof value === "string" && REQUEST_FINGERPRINT_PATTERN.test(value);
}

export function isSafeUpperIdentifier(value) {
  return typeof value === "string" && SAFE_UPPER_IDENTIFIER_PATTERN.test(value);
}

export function isSafeLowerIdentifier(value) {
  return typeof value === "string" && SAFE_LOWER_IDENTIFIER_PATTERN.test(value.trim());
}

export function isValidSqlstate(value) {
  return typeof value === "string" && SQLSTATE_PATTERN.test(value.trim());
}

export function isBoundedPositiveInteger(value, max = 1000) {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 1
    && value <= max;
}

export function isBoundedNonNegativeNumber(value, max = 24 * 60 * 60 * 1000) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= max;
}
