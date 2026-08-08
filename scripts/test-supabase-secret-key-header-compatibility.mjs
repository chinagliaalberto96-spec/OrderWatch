import assert from "node:assert/strict";

// Dummy credentials only. Never real values, never loaded from an env file.
//
// Two key GENERATIONS are exercised, because the runtime clients must support
// both during the migration window:
//
//   NEW    sb_secret_...  -> opaque, not a JWT. Must be sent as apikey only;
//                            sending it as Authorization Bearer is the defect
//                            this suite guards against.
//   LEGACY service_role   -> a JWT. Legacy semantics (including RLS bypass)
//                            depend on the Bearer form, so apikey AND
//                            Authorization: Bearer <same key> are required
//                            until configuration is migrated.
const LEGACY_JWT_SHAPED_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkdW1teS1zZXJ2aWNlLXJvbGUifQ.dGVzdC1zaWduYXR1cmUtbm90LXJlYWw";
const SB_SECRET_SHAPED_KEY = "sb_secret_dummy_1234567890abcdefDUMMY";
const OPAQUE_UNRECOGNIZED_KEY = "totally-opaque-not-a-jwt-and-not-sb-secret";
const DUMMY_END_USER_TOKEN = "dummy-end-user-session-jwt-not-a-real-token";
const DUMMY_HOST = "https://secret-key-header-test.invalid";

process.env.ENCRYPTION_KEY = "11".repeat(32);
process.env.AUTH_MODE = "supabase";
process.env.SUPABASE_URL = DUMMY_HOST;
delete process.env.NODE_ENV;
delete process.env.VERCEL_ENV;
delete process.env.RAILWAY_DEPLOYMENT_ID;
delete process.env.RAILWAY_ENVIRONMENT_ID;

const { supabaseRequest, isLegacyServiceRoleJwt } = await import("../server/lib/_supabaseRest.js");
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
// case-insensitive; an exact-case check would miss a leak reintroduced under
// a different casing. These helpers only read what the fetch stub actually
// captured -- they never reconstruct how any client builds its headers.
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

// ---------------------------------------------------------------------------
// Exercise both raw clients uniformly. Each returns the captured headers of
// the single fetch the real client issued.
// ---------------------------------------------------------------------------
async function captureSupabaseRestHeaders(key, extraHeaders) {
  process.env.SUPABASE_SERVICE_KEY = key;
  const calls = await withFetchSpy(() => okJsonResponse([]), async () => {
    await supabaseRequest("dummy_table?select=*", extraHeaders ? { headers: extraHeaders } : undefined);
  });
  assert.equal(calls.length, 1, "expected exactly one fetch call");
  return calls[0].headers;
}

// The adapter exposes no public method that forwards caller-supplied headers
// (getProjects() takes no arguments), so the custom-header cases below apply
// only to _supabaseRest.js, whose public API does accept them.
async function captureAdapterHeaders(key) {
  const adapter = createSupabaseAdapter({
    url: DUMMY_HOST,
    serviceKey: key,
    organizationId: "00000000-0000-4000-8000-000000000001"
  });
  const calls = await withFetchSpy(() => okJsonResponse([]), async () => {
    await adapter.getProjects();
  });
  assert.equal(calls.length, 1, "expected exactly one fetch call");
  return calls[0].headers;
}

const RAW_CLIENTS = [
  ["_supabaseRest.js", captureSupabaseRestHeaders],
  ["supabaseServerAdapter.js", captureAdapterHeaders]
];

// ---------------------------------------------------------------------------
// 1. NEW sb_secret_ : apikey present, service-key Authorization ABSENT.
// ---------------------------------------------------------------------------
for (const [label, capture] of RAW_CLIENTS) {
  await check(`${label}: sb_secret_ key -> exactly one apikey, zero Authorization headers`, async () => {
    const headers = await capture(SB_SECRET_SHAPED_KEY);
    const apikeyEntries = findHeaderEntriesByName(headers, "apikey");
    assert.equal(apikeyEntries.length, 1, "expected exactly one case-insensitive apikey header");
    assert.equal(apikeyEntries[0][1], SB_SECRET_SHAPED_KEY, "apikey must carry the sb_secret_ key");

    const authEntries = findHeaderEntriesByName(headers, "authorization");
    assert.equal(
      authEntries.length,
      0,
      `expected zero Authorization headers (found under: ${authEntries.map(([n]) => n).join(", ")})`
    );
    assert.equal(
      headerValueContains(headers, `Bearer ${SB_SECRET_SHAPED_KEY}`),
      false,
      "no header value may contain Bearer <sb_secret_ key> under any header name"
    );
  });
}

// ---------------------------------------------------------------------------
// 2. LEGACY service_role JWT : apikey present AND Authorization Bearer.
// ---------------------------------------------------------------------------
for (const [label, capture] of RAW_CLIENTS) {
  await check(`${label}: legacy service_role JWT -> apikey AND Authorization: Bearer <same key>`, async () => {
    const headers = await capture(LEGACY_JWT_SHAPED_KEY);
    const apikeyEntries = findHeaderEntriesByName(headers, "apikey");
    assert.equal(apikeyEntries.length, 1, "expected exactly one case-insensitive apikey header");
    assert.equal(apikeyEntries[0][1], LEGACY_JWT_SHAPED_KEY, "apikey must carry the legacy key");

    const authEntries = findHeaderEntriesByName(headers, "authorization");
    assert.equal(authEntries.length, 1, "expected exactly one Authorization header for a legacy key");
    assert.equal(
      authEntries[0][1],
      `Bearer ${LEGACY_JWT_SHAPED_KEY}`,
      "legacy service_role semantics require Bearer <same legacy key>"
    );
  });
}

// ---------------------------------------------------------------------------
// 2b. UNRECOGNIZED opaque key : conservative fallback to the safer new-key
// form. An opaque string must never be promoted to a Bearer credential just
// because it is not sb_secret_-prefixed.
// ---------------------------------------------------------------------------
for (const [label, capture] of RAW_CLIENTS) {
  await check(`${label}: unrecognized opaque key -> apikey only, never Bearer`, async () => {
    const headers = await capture(OPAQUE_UNRECOGNIZED_KEY);
    assert.equal(findHeaderEntriesByName(headers, "apikey").length, 1);
    assert.equal(
      findHeaderEntriesByName(headers, "authorization").length,
      0,
      "an unrecognized opaque key must not be sent as a Bearer credential"
    );
  });
}

// ---------------------------------------------------------------------------
// 2c. The classifier itself discriminates correctly.
// ---------------------------------------------------------------------------
await check("isLegacyServiceRoleJwt classifies each key generation correctly", async () => {
  assert.equal(isLegacyServiceRoleJwt(LEGACY_JWT_SHAPED_KEY), true, "legacy JWT must be recognized");
  assert.equal(isLegacyServiceRoleJwt(SB_SECRET_SHAPED_KEY), false, "sb_secret_ must not be a legacy JWT");
  assert.equal(isLegacyServiceRoleJwt(OPAQUE_UNRECOGNIZED_KEY), false, "opaque string must not be a legacy JWT");
  assert.equal(isLegacyServiceRoleJwt(""), false);
  assert.equal(isLegacyServiceRoleJwt(null), false);
  assert.equal(isLegacyServiceRoleJwt(undefined), false);
  assert.equal(isLegacyServiceRoleJwt("eyJonly.two"), false, "two segments is not a JWT");
});

// ---------------------------------------------------------------------------
// 3. Custom-header safety: a caller cannot reintroduce the service key as a
// Bearer credential, under ANY header-name casing. Exercised on
// _supabaseRest.js, whose public API accepts caller headers.
// ---------------------------------------------------------------------------
for (const casing of ["Authorization", "authorization", "AUTHORIZATION", "AuThOrIzAtIoN"]) {
  await check(`_supabaseRest.js: caller-supplied "${casing}" cannot smuggle the sb_secret_ key as Bearer`, async () => {
    const headers = await captureSupabaseRestHeaders(SB_SECRET_SHAPED_KEY, {
      [casing]: `Bearer ${SB_SECRET_SHAPED_KEY}`
    });
    assert.equal(
      findHeaderEntriesByName(headers, "authorization").length,
      0,
      `caller-supplied ${casing} carrying the service key must be dropped`
    );
    assert.equal(
      headerValueContains(headers, `Bearer ${SB_SECRET_SHAPED_KEY}`),
      false,
      "the service key must not appear as a Bearer value under any header name"
    );
  });
}

await check("_supabaseRest.js: a caller cannot override apikey with another value", async () => {
  const headers = await captureSupabaseRestHeaders(SB_SECRET_SHAPED_KEY, { apikey: "attacker-supplied-value" });
  const apikeyEntries = findHeaderEntriesByName(headers, "apikey");
  assert.equal(apikeyEntries.length, 1);
  assert.equal(apikeyEntries[0][1], SB_SECRET_SHAPED_KEY, "the configured service key must win");
});

// ---------------------------------------------------------------------------
// 4. Legitimate operational custom headers are preserved untouched.
// ---------------------------------------------------------------------------
await check("_supabaseRest.js: operational Prefer header is preserved (both key generations)", async () => {
  for (const key of [SB_SECRET_SHAPED_KEY, LEGACY_JWT_SHAPED_KEY]) {
    const headers = await captureSupabaseRestHeaders(key, { Prefer: "return=representation" });
    const preferEntries = findHeaderEntriesByName(headers, "prefer");
    assert.equal(preferEntries.length, 1, "Prefer must survive");
    assert.equal(preferEntries[0][1], "return=representation");
    assert.equal(findHeaderEntriesByName(headers, "content-type").length, 1, "Content-Type must survive");
  }
});

await check("_supabaseRest.js: an unrelated Authorization value is NOT destroyed", async () => {
  // Guards the "do not silently destroy a future user-scoped mechanism" rule:
  // only an Authorization carrying the service key is dropped.
  const headers = await captureSupabaseRestHeaders(SB_SECRET_SHAPED_KEY, {
    Authorization: "Bearer some-unrelated-user-token"
  });
  const authEntries = findHeaderEntriesByName(headers, "authorization");
  assert.equal(authEntries.length, 1, "an unrelated Authorization must survive");
  assert.equal(authEntries[0][1], "Bearer some-unrelated-user-token");
});

// ---------------------------------------------------------------------------
// 5. Existing error behavior unchanged.
// ---------------------------------------------------------------------------
await check("_supabaseRest.js: non-ok responses still throw the same error shape", async () => {
  process.env.SUPABASE_SERVICE_KEY = SB_SECRET_SHAPED_KEY;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => "denied" });
  try {
    await assert.rejects(
      () => supabaseRequest("dummy_table?select=*"),
      /Supabase request failed: 401 denied/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check("_supabaseRest.js: missing configuration still throws", async () => {
  const saved = process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  try {
    await assert.rejects(() => supabaseRequest("dummy_table?select=*"), /Supabase configuration missing/);
  } finally {
    process.env.SUPABASE_SERVICE_KEY = saved;
  }
});

// ---------------------------------------------------------------------------
// 6. server/lib/_auth.js is UNCHANGED: apikey carries the project key, and
// Authorization carries the END-USER session JWT -- never the project key --
// for BOTH key generations. Both are located case-insensitively.
// ---------------------------------------------------------------------------
for (const [label, serviceKey] of [["legacy JWT key", LEGACY_JWT_SHAPED_KEY], ["sb_secret_ key", SB_SECRET_SHAPED_KEY]]) {
  await check(`_auth.js: user JWT stays the Authorization Bearer, project key stays apikey (${label})`, async () => {
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
    assert.equal(calls[0].url, `${DUMMY_HOST}/auth/v1/user`);

    const apikeyEntries = findHeaderEntriesByName(calls[0].headers, "apikey");
    assert.equal(apikeyEntries.length, 1);
    assert.equal(apikeyEntries[0][1], serviceKey, "apikey must carry the project key");

    const authEntries = findHeaderEntriesByName(calls[0].headers, "authorization");
    assert.equal(authEntries.length, 1);
    assert.equal(
      authEntries[0][1],
      `Bearer ${DUMMY_END_USER_TOKEN}`,
      "Authorization must carry the END-USER token, not the project key"
    );
    assert.notEqual(
      authEntries[0][1],
      `Bearer ${serviceKey}`,
      "the project key must never be the Authorization Bearer value in _auth.js"
    );
    assert.equal(responseStub.statusCode, 401, "the stubbed GoTrue rejection must still surface as 401");
  });
}

await check("the end-user token and the service keys are structurally distinct values", async () => {
  assert.notEqual(DUMMY_END_USER_TOKEN, LEGACY_JWT_SHAPED_KEY);
  assert.notEqual(DUMMY_END_USER_TOKEN, SB_SECRET_SHAPED_KEY);
});

for (const item of checks) {
  console.log(`${item.status}  ${item.name}${item.error ? `: ${item.error}` : ""}`);
}

const failed = checks.filter((item) => item.status === "FAIL");
if (failed.length) process.exitCode = 1;
else console.log(`\n${checks.length}/${checks.length} Supabase dual-key header compatibility checks passed.`);
