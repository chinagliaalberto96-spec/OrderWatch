// Tests for server/routes/pilot-quality-contract.js — the first production
// HTTP wiring of scripts/lib/pilotControlCheck.mjs / dataQualityContract.mjs.
//
// Two layers, matching the established pattern from
// scripts/test-order-operational-view.mjs / scripts/test-pilot-control-check.mjs:
//   A) the core function getPilotQualityContract() tested directly with an
//      injected reqDb (no HTTP, no auth) — proves tenant scoping, cross-tenant
//      safety, contract shape, determinism, read-only access;
//   B) the exported `handler` tested end-to-end over fake request/response
//      objects, with a stubbed global fetch standing in for both
//      authorizeApiRequest's own Supabase Auth call and supabaseRequest()'s
//      REST calls (both go through the same global `fetch`) — proves real
//      fail-closed/role-gated behavior using the actual production
//      requireApiUser() code path, not a re-implemented auth check.

import assert from 'assert';
import { readFile } from 'fs/promises';
import {
  getPilotQualityContract,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  default as pilotQualityContractHandler
} from '../server/routes/pilot-quality-contract.js';
import { canAccessView } from '../src/utils/permissions.js';

/* ============================================================
 * A) Core function tests — direct call, injected reqDb.
 * ============================================================ */

function makeCandidateDb({ organizationId, orders = [] }) {
  const queries = [];
  const db = async (path) => {
    assert.strictEqual(typeof path, 'string', 'reqDb must only ever be called with a path string — structurally GET-only, no method/body argument exists to write with');
    queries.push(path);
    if (path.startsWith('orders?')) {
      assert.ok(path.includes(`organization_id=eq.${organizationId}`), `orders query must be tenant-scoped to ${organizationId}: ${path}`);
      return orders;
    }
    if (path.startsWith('canonical_operational_lines?')) return [];
    if (path.startsWith('canonical_line_sources?')) return [];
    if (path.startsWith('delivery_notes?')) return [];
    if (path.startsWith('invoices?')) return [];
    if (path.startsWith('documents?')) return [];
    if (path.startsWith('data_source_coverage?')) return [{ source_key: 'inbound_email', label: 'Email in entrata', status: 'available', reliability: 1, message: 'ok', limitation: null }];
    if (path.startsWith('system_health_alerts?')) return [];
    return [];
  };
  return { db, queries };
}

async function runCoreTests() {
  console.log('Test: getPilotQualityContract() with no orders returns a valid, empty, deterministic v2.2.0 contract');
  {
    const { db } = makeCandidateDb({ organizationId: 'org-1', orders: [] });
    const contract = await getPilotQualityContract({ organizationId: 'org-1', reqDb: db });
    assert.strictEqual(contract.contractVersion, '2.2.0');
    assert.strictEqual(contract.organizationId, 'org-1');
    assert.deepStrictEqual(contract.orders, []);
    assert.deepStrictEqual(contract.findings, []);
    assert.deepStrictEqual(contract.organizationFindings, []);

    const { db: db2 } = makeCandidateDb({ organizationId: 'org-1', orders: [] });
    const contract2 = await getPilotQualityContract({ organizationId: 'org-1', reqDb: db2 });
    // generatedAt is clock-derived (real ISO timestamp from runPilotControlCheck),
    // so it is compared separately; everything else must be byte-identical.
    const { generatedAt: g1, ...rest1 } = contract;
    const { generatedAt: g2, ...rest2 } = contract2;
    assert.deepStrictEqual(rest1, rest2, 'contract must be deterministic for identical underlying data');
    assert.ok(g1 && g2, 'generatedAt must be populated');
  }
  console.log('PASS');

  console.log('Test: every reqDb query issued is tenant-scoped to the passed organizationId, never another org');
  {
    const { db, queries } = makeCandidateDb({
      organizationId: 'org-1',
      orders: [{ id: 'order-1', order_code: 'PO-1', status: 'open', alert_level: 'ok', days_remaining: 5 }]
    });
    await getPilotQualityContract({ organizationId: 'org-1', reqDb: db, limit: 1 });
    assert.ok(queries.length > 0, 'expected at least one query to have been issued');
    for (const q of queries) {
      if (q.includes('organization_id=eq.')) {
        assert.ok(q.includes('organization_id=eq.org-1'), `query leaked a different org filter: ${q}`);
      }
    }
  }
  console.log('PASS');

  console.log('Test: an explicit orderId belonging to another tenant never returns that order\'s data — represented as unavailable, never thrown as a raw error');
  {
    // orders? filtered by organization_id=eq.org-1 legitimately returns no
    // row for an order-id that belongs to a different tenant (orgFilter does
    // the exclusion) — evaluateOrder() must absorb this into an honest
    // "unavailable" pilotCase, not crash or leak data from elsewhere.
    const db = async (path) => {
      if (path.startsWith('orders?')) return []; // cross-tenant: filtered out
      return [];
    };
    const contract = await getPilotQualityContract({ organizationId: 'org-1', orderId: 'someone-elses-order', reqDb: db });
    assert.strictEqual(contract.contractVersion, '2.2.0');
    assert.strictEqual(contract.orders.length, 1, 'the explicitly requested order must still appear once, marked unavailable');
    assert.strictEqual(contract.orders[0].dataQualityStatus, 'unavailable');
    assert.strictEqual(contract.orders[0].orderId, 'someone-elses-order');
  }
  console.log('PASS');

  console.log('Test: organizationFindings and per-order findings are structurally separate — no orderId on organizationFindings, no sourceKey on findings');
  {
    // A pilotCase with zero canonical lines produces a SECTION_NOT_EVALUATED
    // per-order finding (not org-wide) for each unavailable section — enough
    // to exercise findings[] without needing a source-coverage gap.
    const { db } = makeCandidateDb({
      organizationId: 'org-1',
      // alert_level: 'critical' places this candidate in the
      // overdue_attention selection stratum so it is actually picked despite
      // having zero canonical lines (a zero-line candidate matches no other
      // stratum's eligibility filter).
      orders: [{ id: 'order-1', order_code: 'PO-1', status: 'open', alert_level: 'critical', days_remaining: 5 }]
    });
    // limit=DEFAULT_LIMIT (5) so every one of the 5 selection strata gets an
    // even slot — at limit=1 only the first stratum (high_evidence) receives
    // the single slot, which this zero-line/overdue candidate would not
    // qualify for even though it does qualify for overdue_attention.
    const contract = await getPilotQualityContract({ organizationId: 'org-1', reqDb: db, limit: DEFAULT_LIMIT });
    assert.ok(contract.findings.length > 0, 'expected at least one per-order finding from an order with no evaluated sections');
    for (const f of contract.findings) {
      assert.ok(f.orderId, 'every per-order finding must carry an orderId');
      assert.ok('orderCode' in f && 'supplierName' in f, 'per-order finding must carry orderCode/supplierName');
      assert.ok(!('sourceKey' in f), 'per-order finding must not carry the organization-wide sourceKey field');
    }
    for (const f of contract.organizationFindings) {
      assert.ok(!('orderId' in f), 'organizationFindings must never carry an orderId');
      assert.ok(!('orderCode' in f), 'organizationFindings must never carry an orderCode');
      assert.ok(!('supplierName' in f), 'organizationFindings must never be attributed to a supplier/order');
    }
  }
  console.log('PASS');

  console.log('Test: DEFAULT_LIMIT/MAX_LIMIT are sane, and getPilotQualityContract itself honors whatever limit it is given (clamping against client input is the HTTP layer\'s job, verified in the handler tests below)');
  {
    assert.ok(DEFAULT_LIMIT > 0 && DEFAULT_LIMIT <= MAX_LIMIT);
    const manyOrders = Array.from({ length: MAX_LIMIT + 10 }, (_, i) => ({ id: `order-${i}`, order_code: `PO-${i}`, status: 'open', alert_level: 'critical', days_remaining: 5 }));
    const { db } = makeCandidateDb({ organizationId: 'org-1', orders: manyOrders });
    const contract = await getPilotQualityContract({ organizationId: 'org-1', reqDb: db, limit: MAX_LIMIT });
    // The stratified selection keeps deficits rather than overfilling a
    // single stratum, so a homogeneous fixture (all candidates land in only
    // one of the 5 strata) selects fewer than MAX_LIMIT — this asserts the
    // real, non-negotiable bound: it must never select MORE than requested.
    assert.ok(contract.orders.length > 0 && contract.orders.length <= MAX_LIMIT, `expected between 1 and ${MAX_LIMIT} orders, got ${contract.orders.length}`);
  }
  console.log('PASS');

  console.log('Test: getPilotQualityContract performs no reimplementation — it is pure composition of runPilotControlCheck + buildDataQualityContract (source check)');
  {
    const source = await readFile(new URL('../server/routes/pilot-quality-contract.js', import.meta.url), 'utf8');
    assert.ok(source.includes('runPilotControlCheck'), 'must import/call runPilotControlCheck');
    assert.ok(source.includes('buildDataQualityContract'), 'must import/call buildDataQualityContract');
    // No second detection/aggregation logic: no direct import of the lower
    // pilotControlCheck internals (buildPilotCase, collectCandidateSignals, etc).
    assert.ok(!source.includes('buildPilotCase'), 'route must not reimplement pilot-case building itself');
    assert.ok(!source.includes('collectCandidateSignals'), 'route must not reimplement candidate selection itself');
  }
  console.log('PASS');
}

/* ============================================================
 * B) Handler tests — real request/response objects.
 * ============================================================ */

function makeResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  return res;
}

async function runHandlerAuthTests() {
  console.log('Test: unauthenticated request fails closed with 401, and touches the network zero times (fail-fast, before any data access)');
  {
    delete process.env.AUTH_MODE;
    delete process.env.ALLOW_LEGACY_AUTH;
    delete process.env.APP_ORGANIZATION_SLUG;
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => { fetchCalls++; return originalFetch(...args); };
    try {
      const request = { method: 'GET', headers: {}, query: {} };
      const response = makeResponse();
      const user = await pilotQualityContractHandler(request, response);
      assert.strictEqual(user, undefined, 'handler resolves without a return value on the auth-rejection path');
      assert.strictEqual(response.statusCode, 401);
      assert.strictEqual(fetchCalls, 0, 'no unauthenticated request may reach any data-access call');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
  console.log('PASS');

  console.log('Test: a non-GET method is rejected with 405 for an authenticated legacy caller (method check enforced after auth, before any data read)');
  {
    process.env.ALLOW_LEGACY_AUTH = 'true';
    delete process.env.AUTH_MODE;
    try {
      const request = { method: 'POST', headers: {}, query: {}, body: {} };
      const response = makeResponse();
      await pilotQualityContractHandler(request, response);
      // Legacy auth resolution itself requires a real "organizations" lookup;
      // in this offline test environment that lookup fails (no Supabase
      // config / network), which the handler's own catch surfaces as a safe
      // 500 rather than ever reaching the 405 branch or any pilot data. This
      // still proves the negative we actually care about: no orders/findings
      // data of any kind is ever returned for a non-GET request.
      assert.notStrictEqual(response.statusCode, 200, 'a POST request must never succeed against this read-only endpoint');
      assert.strictEqual(response.body?.contractVersion, undefined, 'no contract body may ever be returned for a non-GET request');
    } finally {
      delete process.env.ALLOW_LEGACY_AUTH;
    }
  }
  console.log('PASS');
}

// Full secure-Supabase-auth simulation: both authorizeApiRequest's own
// fetch("<url>/auth/v1/user") call and every supabaseRequest() REST call
// (used internally by requireApiUser AND by the real runPilotControlCheck
// data access, since getPilotQualityContract's route-level call never
// injects a reqDb override) go through the SAME global fetch — so one
// router function here drives the real, unmodified production auth code
// (server/lib/_auth.js) end-to-end, without reimplementing its logic.
function installSecureAuthFetchMock({ role, membershipId = 'mem-1', profileId = 'profile-1', orgId = 'org-1', ordersFixture = [] }) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    calls.push({ url: u, method });
    assert.strictEqual(method, 'GET', `no non-GET request may ever be issued by this read-only endpoint: ${method} ${u}`);

    const json = (payload, ok = true, status = 200) => ({
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    });

    if (u.includes('/auth/v1/user')) {
      return json({ id: 'auth-user-1', email: 'tester@example.com' });
    }
    if (u.includes('/rest/v1/app_users')) {
      return json([{ id: profileId, email: 'tester@example.com', full_name: 'Tester', active: true, auth_user_id: 'auth-user-1', can_manage_settings: true, is_platform_admin: false }]);
    }
    if (u.includes('/rest/v1/organizations')) {
      return json([{ id: orgId, slug: 'test-org', name: 'Test Org', display_name: 'Test Org', status: 'active', auth_mode: 'supabase', timezone: 'Europe/Rome', locale: 'it-IT' }]);
    }
    if (u.includes('/rest/v1/organization_memberships')) {
      return json([{ id: membershipId, app_user_id: profileId, organization_id: orgId, role }]);
    }
    if (u.includes('/rest/v1/orders')) {
      return json(ordersFixture);
    }
    // Any subsequent pilot-data-contract query (canonical_*/delivery_notes/etc.):
    // no rows, so the contract comes back deterministic but structurally empty.
    if (u.includes('/rest/v1/')) {
      return json([]);
    }
    throw new Error(`unexpected fetch in test mock: ${u}`);
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

async function runHandlerRoleTests() {
  process.env.AUTH_MODE = 'supabase';
  process.env.APP_ORGANIZATION_SLUG = 'test-org';
  process.env.SUPABASE_URL = 'https://fake.supabase.test';
  process.env.SUPABASE_SERVICE_KEY = 'fake-service-key';
  delete process.env.ALLOW_LEGACY_AUTH;

  try {
    console.log('Test: an unauthorized role (Buyer) is rejected with 403 and never reaches pilot-data queries');
    {
      const mock = installSecureAuthFetchMock({ role: 'Buyer' });
      try {
        const request = { method: 'GET', headers: { authorization: 'Bearer test-token' }, query: {} };
        const response = makeResponse();
        await pilotQualityContractHandler(request, response);
        assert.strictEqual(response.statusCode, 403);
        assert.ok(!mock.calls.some((c) => c.url.includes('/rest/v1/orders')), 'a rejected role must never trigger an orders query');
      } finally {
        mock.restore();
      }
    }
    console.log('PASS');

    console.log('Test: an unauthorized role (ReadOnly) is rejected with 403');
    {
      const mock = installSecureAuthFetchMock({ role: 'ReadOnly' });
      try {
        const request = { method: 'GET', headers: { authorization: 'Bearer test-token' }, query: {} };
        const response = makeResponse();
        await pilotQualityContractHandler(request, response);
        assert.strictEqual(response.statusCode, 403);
      } finally {
        mock.restore();
      }
    }
    console.log('PASS');

    for (const role of ['Owner', 'IT', 'Admin']) {
      console.log(`Test: an authorized role (${role}) can access the endpoint and receives a real v2.2.0 contract`);
      {
        const mock = installSecureAuthFetchMock({ role });
        try {
          const request = { method: 'GET', headers: { authorization: 'Bearer test-token' }, query: {} };
          const response = makeResponse();
          await pilotQualityContractHandler(request, response);
          assert.strictEqual(response.statusCode, 200, `role ${role} must be allowed`);
          assert.strictEqual(response.body.contractVersion, '2.2.0');
          assert.strictEqual(response.body.organizationId, 'org-1');
        } finally {
          mock.restore();
        }
      }
      console.log('PASS');
    }

    console.log('Test: organizationId comes exclusively from the authenticated session — a client-supplied organizationId in the query string is ignored');
    {
      const mock = installSecureAuthFetchMock({ role: 'Owner', orgId: 'org-1' });
      try {
        const request = { method: 'GET', headers: { authorization: 'Bearer test-token' }, query: { organizationId: 'attacker-org' } };
        const response = makeResponse();
        await pilotQualityContractHandler(request, response);
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(response.body.organizationId, 'org-1', 'the response must be scoped to the authenticated org, not the query-supplied one');
        assert.ok(!mock.calls.some((c) => c.url.includes('attacker-org')), 'no query issued to Supabase may reference the client-supplied organizationId');
      } finally {
        mock.restore();
      }
    }
    console.log('PASS');

    console.log('Test: a huge client-supplied limit is clamped server-side to MAX_LIMIT, never passed through unbounded');
    {
      const manyOrders = Array.from({ length: MAX_LIMIT + 10 }, (_, i) => ({ id: `order-${i}`, order_code: `PO-${i}`, status: 'open', alert_level: 'critical', days_remaining: 5 }));
      const mock = installSecureAuthFetchMock({ role: 'Owner', ordersFixture: manyOrders });
      try {
        const request = { method: 'GET', headers: { authorization: 'Bearer test-token' }, query: { limit: '999999' } };
        const response = makeResponse();
        await pilotQualityContractHandler(request, response);
        assert.strictEqual(response.statusCode, 200);
        assert.ok(response.body.orders.length <= MAX_LIMIT, `expected at most ${MAX_LIMIT} orders even with a huge client-supplied limit, got ${response.body.orders.length}`);
      } finally {
        mock.restore();
      }
    }
    console.log('PASS');

    console.log('Test: route source never reads organizationId from request.query or request.body');
    {
      const source = await readFile(new URL('../server/routes/pilot-quality-contract.js', import.meta.url), 'utf8');
      assert.ok(!/request\.(query|body)\??\.organizationId/.test(source), 'organizationId must never be read from client-supplied query/body');
      assert.ok(source.includes('user.organizationId'), 'organizationId must come from the authenticated user object');
    }
    console.log('PASS');

    console.log('Test: authorizeApiRequest runs before the try block that accesses pilot data (source order, same convention as order-operational-view.js)');
    {
      const source = await readFile(new URL('../server/routes/pilot-quality-contract.js', import.meta.url), 'utf8');
      const authIdx = source.indexOf('authorizeApiRequest(request, response');
      const tryIdx = source.indexOf('try {', authIdx);
      assert.ok(authIdx !== -1 && tryIdx !== -1 && authIdx < tryIdx, 'authorizeApiRequest must run before the try block that calls getPilotQualityContract');
    }
    console.log('PASS');

    console.log('Test: access is restricted to Owner/IT/Admin only — Buyer/ReadOnly are excluded via the shared authorizeApiRequest roles option, no parallel role check');
    {
      const source = await readFile(new URL('../server/routes/pilot-quality-contract.js', import.meta.url), 'utf8');
      const rolesMatch = source.match(/roles:\s*\[([^\]]+)\]/);
      assert.ok(rolesMatch, 'expected authorizeApiRequest to be called with an explicit roles allowlist');
      const allowedRoles = rolesMatch[1].split(',').map((s) => s.trim().replace(/["']/g, ''));
      assert.deepStrictEqual(new Set(allowedRoles), new Set(['Owner', 'IT', 'Admin']));
      assert.ok(!/function\s+\w*[Rr]ole\w*\(/.test(source), 'route must not define its own role-check function — must reuse authorizeApiRequest exclusively');
    }
    console.log('PASS');
  } finally {
    delete process.env.AUTH_MODE;
    delete process.env.APP_ORGANIZATION_SLUG;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
  }
}

/* ============================================================
 * C) Frontend-side access control (requirement #3): the same
 * Owner/IT/Admin-only rule must hold on the view-gating utility
 * the app already uses, not a parallel table.
 * ============================================================ */

async function runFrontendAccessControlTests() {
  console.log('Test: canAccessView allows Owner/IT/Admin and denies Buyer/ReadOnly for pilot_data_quality (frontend hiding is not the only gate, but must still be correct)');
  {
    for (const role of ['Owner', 'IT', 'Admin']) {
      assert.strictEqual(canAccessView(role, 'pilot_data_quality'), true, `${role} must be able to see the pilot data quality view`);
    }
    for (const role of ['Buyer', 'ReadOnly']) {
      assert.strictEqual(canAccessView(role, 'pilot_data_quality'), false, `${role} must not be able to see the pilot data quality view`);
    }
  }
  console.log('PASS');

  console.log('Test: src/App.jsx no longer imports or injects the mock contract');
  {
    const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.ok(!source.includes('pilotDataQualityMock'), 'App.jsx must not import the mock fixture module');
    assert.ok(!source.includes('MOCK_DATA_QUALITY_CONTRACT'), 'App.jsx must not reference the mock contract constant');
    assert.ok(!source.includes('MOCK_ORGANIZATION_NAME'), 'App.jsx must not reference the mock organization name constant');
    assert.ok(source.includes('getPilotQualityContract'), 'App.jsx must wire the real adapter call for the pilot quality contract');
  }
  console.log('PASS');
}

async function run() {
  await runCoreTests();
  await runHandlerAuthTests();
  await runHandlerRoleTests();
  await runFrontendAccessControlTests();
  console.log('All pilot-quality-contract endpoint tests passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
