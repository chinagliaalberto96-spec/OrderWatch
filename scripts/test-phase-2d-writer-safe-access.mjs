import assert from 'node:assert/strict';
import {
  isPlainMetadataObject,
  readOwnDataProperty,
  isUuid,
  isValidOperationKey,
  isValidRequestFingerprint,
  isSafeUpperIdentifier,
  isSafeLowerIdentifier,
  isValidSqlstate,
  isBoundedPositiveInteger,
  isBoundedNonNegativeNumber
} from '../server/lib/projectLinkWriterSafeAccess.js';

console.log('Phase 2D.1B writer contract: shared safe-access helpers');

console.log('  isPlainMetadataObject accepts only literal objects');
{
  assert.equal(isPlainMetadataObject({}), true);
  assert.equal(isPlainMetadataObject(Object.create(null)), true);
  assert.equal(isPlainMetadataObject([]), false);
  assert.equal(isPlainMetadataObject(new Error('x')), false);
  assert.equal(isPlainMetadataObject(() => {}), false);
  assert.equal(isPlainMetadataObject(null), false);
  assert.equal(isPlainMetadataObject('x'), false);
  assert.equal(isPlainMetadataObject(class Foo {}), false);
  assert.equal(isPlainMetadataObject(new (class Foo {})()), false);
}

console.log('  readOwnDataProperty never invokes a getter');
{
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'x', { enumerable: true, get() { invoked = true; return 1; } });
  assert.equal(readOwnDataProperty(hostile, 'x'), undefined);
  assert.equal(invoked, false);
}

console.log('  readOwnDataProperty ignores inherited properties');
{
  const proto = { inherited: 'nope' };
  const obj = Object.create(proto);
  obj.own = 'yes';
  assert.equal(readOwnDataProperty(obj, 'inherited'), undefined);
  assert.equal(readOwnDataProperty(obj, 'own'), 'yes');
}

console.log('  readOwnDataProperty tolerates a Proxy trap that throws');
{
  const hostileProxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('trap'); } });
  assert.doesNotThrow(() => readOwnDataProperty(hostileProxy, 'x'));
  assert.equal(readOwnDataProperty(hostileProxy, 'x'), undefined);
}

console.log('  readOwnDataProperty safely handles non-object sources');
{
  assert.equal(readOwnDataProperty(null, 'x'), undefined);
  assert.equal(readOwnDataProperty(undefined, 'x'), undefined);
  assert.equal(readOwnDataProperty('a string', 'x'), undefined);
  assert.equal(readOwnDataProperty(42, 'x'), undefined);
}

console.log('  isUuid validates format strictly');
{
  assert.equal(isUuid('10000000-0000-4000-8000-000000000001'), true);
  assert.equal(isUuid('10000000-0000-4000-8000-00000000000'), false);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(123), false);
  assert.equal(isUuid(null), false);
}

console.log('  isValidOperationKey matches the ledger btrim + length(1,255) CHECK');
{
  assert.equal(isValidOperationKey('op-1'), true);
  assert.equal(isValidOperationKey(''), false);
  assert.equal(isValidOperationKey('x'.repeat(255)), true);
  assert.equal(isValidOperationKey('x'.repeat(256)), false);
  assert.equal(isValidOperationKey('  op-1  '), false);
  assert.equal(isValidOperationKey(42), false);
}

console.log('  isValidRequestFingerprint matches the ledger ^[0-9a-f]{64}$ CHECK exactly');
{
  assert.equal(isValidRequestFingerprint('a'.repeat(64)), true);
  assert.equal(isValidRequestFingerprint('A'.repeat(64)), false);
  assert.equal(isValidRequestFingerprint('a'.repeat(63)), false);
  assert.equal(isValidRequestFingerprint('g'.repeat(64)), false);
  assert.equal(isValidRequestFingerprint(null), false);
}

console.log('  isSafeUpperIdentifier / isSafeLowerIdentifier / isValidSqlstate reject malformed values');
{
  assert.equal(isSafeUpperIdentifier('MANUAL_PRECEDENCE'), true);
  assert.equal(isSafeUpperIdentifier('not-uppercase'), false);
  assert.equal(isSafeUpperIdentifier('x'.repeat(200)), false);
  assert.equal(isSafeLowerIdentifier('uniq_order_project_links_active'), true);
  assert.equal(isSafeLowerIdentifier('DROP TABLE orders; --'), false);
  assert.equal(isValidSqlstate('23505'), true);
  assert.equal(isValidSqlstate('not-a-code'), false);
}

console.log('  isBoundedPositiveInteger / isBoundedNonNegativeNumber reject malformed numbers');
{
  assert.equal(isBoundedPositiveInteger(1), true);
  assert.equal(isBoundedPositiveInteger(0), false);
  assert.equal(isBoundedPositiveInteger(-1), false);
  assert.equal(isBoundedPositiveInteger(1.5), false);
  assert.equal(isBoundedPositiveInteger('1'), false);
  assert.equal(isBoundedNonNegativeNumber(0), true);
  assert.equal(isBoundedNonNegativeNumber(-1), false);
  assert.equal(isBoundedNonNegativeNumber(Infinity), false);
  assert.equal(isBoundedNonNegativeNumber(NaN), false);
}

console.log('PASS: shared safe-access helpers are correct and hostile-getter-safe');
