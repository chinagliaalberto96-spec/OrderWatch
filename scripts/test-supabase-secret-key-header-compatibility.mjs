import assert from "node:assert/strict";

// Dummy credentials only. Never real values, never loaded from an env file.
// Two key SHAPES are exercised because the header-construction bug this
// test guards against is shape-independent: the old code sent whichever
// string SUPABASE_SERVICE_KEY held as a Bearer token, which was merely
// harmless-looking while that string happened to be a JWT. A new
// sb_secret_-shaped key is not a JWT and PostgREST/GoTrue must never see it
// in an Authorization header.
const LEGACY_JWT_SHAPED_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkdW1teS1zZXJ2aWNlLXJvbGUifQ.dGVzdC1zaWduYXR1cmUtbm90LXJlYWw";
const SB_SECRET_SHAPED_KEY = "sb_secret_dummy_1234567890abcdefDUMMY";
const DUMMY_END_USER_TOKEN = "dummy-end-user-session-jwt-not-a-real-token";
const DUMMY_HOST = "https://secret-key-header-test.invalid";

process.env.ENCRYPTION_KEY = "11".repeat(32);
process.env.AUTH_MODE = "supabase";
process.env.SUPABASE_URL = DUMMY_HOST;
delete process.env.NODE_ENV;
delete process.env.VERCEL_ENV;
delete process.env.RAILWAY_DEPLOYMENT_ID;
delete process.env.RAILWAY_ENVIRONMENT_ID;

const { supabaseRequest } = await import("../server/lib/_supabaseRest.js");
const { createSupabaseAdapter } = await import("../src/adapters/supabaseServerAdapter.js");
const { requireApiUser } = await import("../server/lib/_auth.js");

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, status: "PASS" });
  } catch (error) {
    checks.push({ name, status: "FAIL", error: error.message });
  }
}

/**
 * Installs a fetch stub that records every call's headers and never touches
 * the network, then restores the original fetch. Mirrors the fetch-stubbing
 * pattern already used in scripts/test-mailbox-security.mjs.
 */
async function withFetchSpy(responseFactory, fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, headers: { ...(options.headers || {}) } });
    return responseFactory();
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return calls;
}

function okJsonResponse(body = []) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
}

function unauthorizedResponse() {
  return { ok: false, status: 401, text: async () => "", json: async () => ({}) };
}

// ---------------------------------------------------------------------------
// Test-only, case-insensitive header inspection. HTTP header names are
// case-insensitive; the runtime clients under test always write a fixed
// literal casing ("apikey", "Authorization"), but a future edit -- or a
// mutation -- could reintroduce the leaked service key under a differently
// -cased key ("authorization", "AUTHORIZATION", "AuThOrIzAtIoN") and an
// exact-case check like the previous `Object.hasOwn(headers, "Authorization")`
// would silently miss it. These helpers work only against the plain header
// object the fetch stub above actually captured from the real runtime
// call -- they never reconstruct or duplicate how any client builds its
// headers, they only read what was genuinely sent.
// ---------------------------------------------------------------------------
function headerEntries(headers) {
  return Object.entries(headers || {});
}

function findHeaderEntriesByName(headers, targetName) {
  const targetLower = targetName.toLowerCase();
  return headerEntries(headers).filter(([name]) => name.toLowerCase() === targetLower);
}

function headerValueContains(headers, needle) {
  return headerEntries(headers).some(([, value]) => String(value).includes(needle));
}

/**
 * Full case-insensitive proof for a raw PostgREST client (supabaseRequest or
 * the adapter's request()): exactly one apikey header carrying the dummy
 * service key, zero Authorization headers under any casing, and the dummy
 * service key never appears as a Bearer value under any header name.
 */
function assertRawClientHeaders(calls, key, label) {
  assert.equal(calls.length, 1, `${label}: expected exactly one fetch call`);
  assert.ok(calls[0].url.startsWith(DUMMY_HOST), `${label}: expected the dummy host, no real network target`);

  const apikeyEntries = findHeaderEntriesByName(calls[0].headers, "apikey");
  assert.equal(apikeyEntries.length, 1, `${label}: expected exactly one case-insensitive apikey header`);
  assert.equal(apikeyEntries[0][1], key, `${label}: apikey value must equal the dummy service key`);

  const authEntries = findHeaderEntriesByName(calls[0].headers, "authorization");
  assert.equal(
    authEntries.length,
    0,
    `${label}: expected zero case-insensitive Authorization headers (found under: ${authEntries.map(([n]) => n).join(", ")})`
  );

  assert.equal(
    headerValueContains(calls[0].headers, `Bearer ${key}`),
    false,
    `${label}: no header value may contain "Bearer <dummy service key>" under any header name`
  );
}

// ---------------------------------------------------------------------------
// server/lib/_supabaseRest.js -- exercises the actual exported
// supabaseRequest(), not a reimplementation of its header logic, for both
// dummy key shapes.
// ---------------------------------------------------------------------------
for (const [label, key] of [["legacy JWT-shaped key", LEGACY_JWT_SHAPED_KEY], ["sb_secret_-shaped key", SB_SECRET_SHAPED_KEY]]) {
  await check(`_supabaseRest.js: supabaseRequest() sends exactly one case-insensitive apikey and zero Authorization headers (${label})`, async () => {
    process.env.SUPABASE_SERVICE_KEY = key;
    const calls = await withFetchSpy(() => okJsonResponse([]), async () => {
      await supabaseRequest("dummy_table?select=*");
    });
    assertRawClientHeaders(calls, key, "_supabaseRest.js");
  });
}

// ---------------------------------------------------------------------------
// src/adapters/supabaseServerAdapter.js -- exercises the real request() path
// via a genuine adapter method (getOrders(), which issues exactly one
// request()), for both dummy key shapes.
// ---------------------------------------------------------------------------
for (const [label, key] of [["legacy JWT-shaped key", LEGACY_JWT_SHAPED_KEY], ["sb_secret_-shaped key", SB_SECRET_SHAPED_KEY]]) {
  await check(`supabaseServerAdapter.js: request() sends exactly one case-insensitive apikey and zero Authorization headers (${label})`, async () => {
    const adapter = createSupabaseAdapter({
      url: DUMMY_HOST,
      serviceKey: key,
      organizationId: "00000000-0000-4000-8000-000000000001"
    });
    const calls = await withFetchSpy(() => okJsonResponse([]), async () => {
      await adapter.getOrders();
    });
    assertRawClientHeaders(calls, key, "supabaseServerAdapter.js");
  });
}

// ---------------------------------------------------------------------------
// server/lib/_auth.js is UNCHANGED behaviour and must be preserved exactly:
// apikey carries the project/service key, Authorization carries the
// end-user session JWT -- and the two are never the same value, proving they
// are not confused. Both are located case-insensitively: a header-name
// casing change here is legitimate (HTTP headers are case-insensitive) and
// must still be ACCEPTED, unlike the raw clients above where any casing of
// Authorization is itself the leak. requireApiUser's GoTrue call
// (fetch(`${url}/auth/v1/user`, ...)) is exercised directly; the stub
// returns 401 so the call chain stops right after that one fetch, matching
// the existing "invalid Supabase token returns 401" precedent in
// scripts/test-mailbox-security.mjs.
// ---------------------------------------------------------------------------
for (const [label, serviceKey] of [["legacy JWT-shaped key", LEGACY_JWT_SHAPED_KEY], ["sb_secret_-shaped key", SB_SECRET_SHAPED_KEY]]) {
  await check(`_auth.js: requireApiUser() sends apikey: <project key> and Authorization: Bearer <end-user token>, both located case-insensitively (${label})`, async () => {
    process.env.SUPABASE_SERVICE_KEY = serviceKey;
    const responseStub = {
      statusCode: null,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
    const calls = await withFetchSpy(() => unauthorizedResponse(), async () => {
      await requireApiUser(
        { headers: { authorization: `Bearer ${DUMMY_END_USER_TOKEN}` } },
        responseStub,
        { requireSecureAuth: true }
      );
    });

    assert.equal(calls.length, 1, "expected exactly one fetch call to /auth/v1/user");
    assert.ok(calls[0].url.startsWith(DUMMY_HOST), "expected the dummy host, no real network target");
    assert.equal(calls[0].url, `${DUMMY_HOST}/auth/v1/user`);

    const apikeyEntries = findHeaderEntriesByName(calls[0].headers, "apikey");
    assert.equal(apikeyEntries.length, 1, "expected exactly one case-insensitive apikey header");
    assert.equal(apikeyEntries[0][1], serviceKey, "apikey must carry the project/service key");

    const authEntries = findHeaderEntriesByName(calls[0].headers, "authorization");
    assert.equal(
      authEntries.length,
      1,
      `expected exactly one case-insensitive Authorization header (found under: ${authEntries.map(([n]) => n).join(", ")})`
    );
    assert.equal(
      authEntries[0][1],
      `Bearer ${DUMMY_END_USER_TOKEN}`,
      "Authorization must carry the end-user session token, unchanged, regardless of the header-name casing used to send it"
    );
    assert.equal(
      String(authEntries[0][1]).includes(serviceKey),
      false,
      "the Authorization value must never contain the project/service key"
    );

    assert.equal(responseStub.statusCode, 401, "the stubbed GoTrue rejection must still surface as 401");
  });
}

// ---------------------------------------------------------------------------
// The user token and the service key are never the same credential slot,
// checked directly rather than inferred from the two checks above.
// ---------------------------------------------------------------------------
await check("the end-user token and the service key are structurally distinct values", async () => {
  assert.notEqual(DUMMY_END_USER_TOKEN, LEGACY_JWT_SHAPED_KEY);
  assert.notEqual(DUMMY_END_USER_TOKEN, SB_SECRET_SHAPED_KEY);
});

for (const item of checks) {
  console.log(`${item.status}  ${item.name}${item.error ? `: ${item.error}` : ""}`);
}

const failed = checks.filter((item) => item.status === "FAIL");
if (failed.length) process.exitCode = 1;
else console.log(`\n${checks.length}/${checks.length} Supabase secret-key header compatibility checks passed.`);
