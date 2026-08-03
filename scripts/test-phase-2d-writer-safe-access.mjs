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
  assert.equal(isPlainMetadataObject(new Date()), false);
  assert.equal(isPlainMetadataObject(new Map()), false);
  assert.equal(isPlainMetadataObject(new Set()), false);
  assert.equal(isPlainMetadataObject(new WeakMap()), false);
  assert.equal(isPlainMetadataObject(new WeakSet()), false);
  assert.equal(isPlainMetadataObject(/x/), false);
  assert.equal(isPlainMetadataObject(new Error('x')), false);
  assert.equal(isPlainMetadataObject(Promise.resolve()), false);
  assert.equal(isPlainMetadataObject(new ArrayBuffer(8)), false);
  assert.equal(isPlainMetadataObject(new DataView(new ArrayBuffer(8))), false);
  assert.equal(isPlainMetadataObject(new Uint8Array(8)), false);
  assert.equal(isPlainMetadataObject(() => {}), false);
  assert.equal(isPlainMetadataObject(null), false);
  assert.equal(isPlainMetadataObject('x'), false);
  assert.equal(isPlainMetadataObject(1n), false);
  assert.equal(isPlainMetadataObject(Symbol('x')), false);
  assert.equal(isPlainMetadataObject(class Foo {}), false);
  assert.equal(isPlainMetadataObject(new (class Foo {})()), false);
}

console.log('  prototype-inspection failure is rejected fail-closed and Object.getPrototypeOf is restored exactly');
{
  const originalGetPrototypeOf = Object.getPrototypeOf;
  const sentinel = {};
  let result;

  try {
    Object.getPrototypeOf = (value) => {
      if (value === sentinel) {
        throw new Error('forced prototype-inspection failure');
      }
      return originalGetPrototypeOf(value);
    };

    assert.doesNotThrow(() => {
      result = isPlainMetadataObject(sentinel);
    });
    assert.equal(result, false, 'an uninspectable prototype must be rejected conservatively');
  } finally {
    Object.getPrototypeOf = originalGetPrototypeOf;
  }

  assert.equal(Object.getPrototypeOf, originalGetPrototypeOf, 'the exact original Object.getPrototypeOf reference must be restored');
  assert.equal(isPlainMetadataObject({}), true);
  assert.equal(isPlainMetadataObject(Object.create(null)), true);
  assert.equal(isPlainMetadataObject(new (class Foo {})()), false);
}

console.log('  Proxy rejection occurs before prototype inspection, including throwing and revoked Proxies');
{
  const originalGetPrototypeOf = Object.getPrototypeOf;
  let proxyPrototypeInspectionCalls = 0;
  let proxyTrapCalls = 0;
  const ordinaryProxy = new Proxy({}, {
    getPrototypeOf() {
      proxyTrapCalls += 1;
      throw new Error('ordinary Proxy getPrototypeOf trap fired');
    }
  });
  const throwingProxy = new Proxy({}, {
    get() {
      proxyTrapCalls += 1;
      throw new Error('throwing Proxy get trap fired');
    },
    getPrototypeOf() {
      proxyTrapCalls += 1;
      throw new Error('throwing Proxy getPrototypeOf trap fired');
    }
  });
  const { proxy: revokedProxy, revoke } = Proxy.revocable({}, {});
  revoke();
  const proxyValues = [ordinaryProxy, throwingProxy, revokedProxy];

  try {
    Object.getPrototypeOf = (value) => {
      if (proxyValues.includes(value)) proxyPrototypeInspectionCalls += 1;
      return originalGetPrototypeOf(value);
    };

    for (const proxyValue of proxyValues) {
      assert.doesNotThrow(() => isPlainMetadataObject(proxyValue));
      assert.equal(isPlainMetadataObject(proxyValue), false);
    }
  } finally {
    Object.getPrototypeOf = originalGetPrototypeOf;
  }

  assert.equal(proxyPrototypeInspectionCalls, 0, 'Proxy inputs must never reach Object.getPrototypeOf');
  assert.equal(proxyTrapCalls, 0, 'no Proxy trap may execute during rejection');
  assert.equal(Object.getPrototypeOf, originalGetPrototypeOf);
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

console.log('  Proxy safety: no reflective trap is ever invoked by isPlainMetadataObject or readOwnDataProperty');
{
  // Every trap below increments its own counter and, for the traps that
  // getPrototypeOf/getOwnPropertyDescriptor could plausibly reach, also
  // throws -- so if any of them fired, the function under test would
  // either see a nonzero counter or propagate the thrown error, not
  // silently succeed.
  function buildInstrumentedProxy(target = {}) {
    const counts = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 };
    const proxy = new Proxy(target, {
      getPrototypeOf(_t) { counts.getPrototypeOf += 1; throw new Error('getPrototypeOf trap fired'); },
      getOwnPropertyDescriptor(_t, _key) { counts.getOwnPropertyDescriptor += 1; throw new Error('getOwnPropertyDescriptor trap fired'); },
      get(_t, _key) { counts.get += 1; throw new Error('get trap fired'); },
      ownKeys(_t) { counts.ownKeys += 1; throw new Error('ownKeys trap fired'); },
      has(_t, _key) { counts.has += 1; throw new Error('has trap fired'); }
    });
    return { proxy, counts };
  }

  {
    const { proxy, counts } = buildInstrumentedProxy();
    let result;
    assert.doesNotThrow(() => { result = isPlainMetadataObject(proxy); });
    assert.equal(result, false, 'isPlainMetadataObject(proxy) must return the safe rejection result');
    assert.deepEqual(counts, { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 });
  }

  {
    const { proxy, counts } = buildInstrumentedProxy();
    let result;
    assert.doesNotThrow(() => { result = readOwnDataProperty(proxy, 'field'); });
    assert.equal(result, undefined, 'readOwnDataProperty(proxy, "field") must return the safe unavailable result');
    assert.deepEqual(counts, { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, get: 0, ownKeys: 0, has: 0 });
  }

  // A Proxy whose *only* trap is one of the five, to prove each is
  // individually never reached (not just that a bundle of traps sums to
  // zero because some cancel out).
  for (const trapName of ['getPrototypeOf', 'getOwnPropertyDescriptor', 'get', 'ownKeys', 'has']) {
    let trapCount = 0;
    const soloTrapProxy = new Proxy({}, {
      [trapName](..._args) {
        trapCount += 1;
        throw new Error(`${trapName} trap fired`);
      }
    });
    assert.doesNotThrow(() => isPlainMetadataObject(soloTrapProxy));
    assert.doesNotThrow(() => readOwnDataProperty(soloTrapProxy, 'field'));
    assert.equal(trapCount, 0, `the ${trapName} trap must never be invoked by either function`);
  }
}

console.log('  a revoked Proxy is rejected/treated as unavailable safely, with no trap exception escaping');
{
  const { proxy: revocable, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.doesNotThrow(() => isPlainMetadataObject(revocable));
  assert.equal(isPlainMetadataObject(revocable), false);
  assert.doesNotThrow(() => readOwnDataProperty(revocable, 'field'));
  assert.equal(readOwnDataProperty(revocable, 'field'), undefined);
}

console.log('  ordinary plain objects and null-prototype objects remain accepted, unaffected by Proxy detection');
{
  assert.equal(isPlainMetadataObject({}), true);
  assert.equal(isPlainMetadataObject({ a: 1, b: 2 }), true);
  assert.equal(isPlainMetadataObject(Object.create(null)), true);
  const nullProtoWithData = Object.create(null);
  nullProtoWithData.field = 'value';
  assert.equal(isPlainMetadataObject(nullProtoWithData), true);
  assert.equal(readOwnDataProperty(nullProtoWithData, 'field'), 'value');
}

console.log('  an ordinary own data property remains readable, and an accessor getter remains uninvoked, on a non-Proxy object');
{
  const plain = { field: 'value' };
  assert.equal(readOwnDataProperty(plain, 'field'), 'value');

  let getterInvoked = false;
  const withAccessor = {};
  Object.defineProperty(withAccessor, 'field', {
    enumerable: true,
    get() { getterInvoked = true; return 'from getter'; }
  });
  assert.equal(readOwnDataProperty(withAccessor, 'field'), undefined);
  assert.equal(getterInvoked, false, 'an accessor getter must never be invoked');
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
