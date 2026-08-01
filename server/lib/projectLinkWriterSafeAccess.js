export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SQLSTATE_PATTERN = /^[0-9A-Za-z]{5}$/;
export const SAFE_LOWER_IDENTIFIER_PATTERN = /^[a-z0-9_]{1,128}$/i;
export const SAFE_UPPER_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
export const REQUEST_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
export const OPERATION_KEY_MAX_LENGTH = 255;

/**
 * True only for a literal object (Object.prototype or null prototype) that
 * is not an array. Rejects class instances, Error objects, functions, and
 * arrays as the top-level container for metadata-shaped input.
 */
export function isPlainMetadataObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Reads an own data property from `source` without ever invoking a getter,
 * a Proxy trap side effect, toString, or valueOf. Returns undefined for
 * anything that is not an own, plain data property -- including inherited
 * properties, accessor properties, and properties on non-object inputs.
 * Tolerates a hostile Proxy whose trap throws by returning undefined rather
 * than propagating the exception.
 */
export function readOwnDataProperty(source, key) {
  if (source === null || typeof source !== "object") return undefined;

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
