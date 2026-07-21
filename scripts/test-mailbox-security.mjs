import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY = "11".repeat(32);
process.env.AUTH_MODE = "supabase";
process.env.SUPABASE_URL = "https://security-test.invalid";
process.env.SUPABASE_SERVICE_KEY = "test-service-key-not-a-real-secret";
process.env.AUDIT_HASH_KEY = "test-audit-hash-key-not-a-real-secret";

const {
  createMailboxHandler,
  enforceMailboxRateLimit,
  isMailboxManagementEnabled,
  mapMailbox,
  normalizeMailbox
} = await import("../server/routes/mailboxes.js");
const { requireApiUser } = await import("../server/lib/_auth.js");
const { encryptSecret, decryptSecret } = await import("../server/lib/_mailboxCrypto.js");

const organizationId = "00000000-0000-4000-8000-000000000001";
const mailboxId = "00000000-0000-4000-8000-000000000002";
const user = {
  id: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  organizationId,
  role: "Owner"
};

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, status: "PASS" });
  } catch (error) {
    checks.push({ name, status: "FAIL", error: error.message });
  }
}

function responseMock() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(key, value) { this.headers[key] = value; }
  };
}

function requestMock(method = "GET", body = {}) {
  return {
    method,
    body,
    headers: {
      "x-forwarded-for": "203.0.113.10",
      "user-agent": "OrderWatch security test"
    },
    socket: { remoteAddress: "203.0.113.10" }
  };
}

function mailboxRow(overrides = {}) {
  return {
    id: mailboxId,
    organization_id: organizationId,
    mailbox_name: "Casella test",
    email_address: "mailbox@example.test",
    role: "Owner",
    provider: "Other",
    active: true,
    connection_status: "connected",
    connected_at: "2026-07-21T12:00:00Z",
    last_check_at: "2026-07-21T12:10:00Z",
    last_error: "password=should-not-leak",
    encrypted_password: "ciphertext-should-not-leak",
    imap_host: "imap.example.test",
    smtp_host: "smtp.example.test",
    notes: "private",
    ...overrides
  };
}

function enabledEnv() {
  return { VERCEL_ENV: "production", AUTH_MODE: "supabase", MAILBOX_MANAGEMENT_ENABLED: "true" };
}

function authorizeAs(role) {
  return async (_request, response, options) => {
    if (!options.roles.includes(role)) {
      response.status(403).json({ error: "Forbidden" });
      return null;
    }
    return { ...user, role };
  };
}

await check("production legacy is always fail-closed", async () => {
  assert.equal(isMailboxManagementEnabled({ VERCEL_ENV: "production", AUTH_MODE: "legacy", MAILBOX_MANAGEMENT_ENABLED: "true" }), false);
  const handler = createMailboxHandler({ env: { VERCEL_ENV: "production", AUTH_MODE: "legacy", MAILBOX_MANAGEMENT_ENABLED: "true" } });
  const response = responseMock();
  await handler(requestMock(), response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { error: "Mailbox management temporarily unavailable" });
});

await check("GET without session returns 401 when secure management is enabled", async () => {
  const handler = createMailboxHandler({
    env: enabledEnv(),
    rateLimit: () => true,
    authorize: async (_request, response) => { response.status(401).json({ error: "Unauthorized" }); return null; }
  });
  const response = responseMock();
  await handler(requestMock("GET"), response);
  assert.equal(response.statusCode, 401);
});

await check("POST without session returns 401", async () => {
  const handler = createMailboxHandler({
    env: enabledEnv(),
    rateLimit: () => true,
    authorize: async (_request, response) => { response.status(401).json({ error: "Unauthorized" }); return null; }
  });
  const response = responseMock();
  await handler(requestMock("POST", { action: "disconnect", id: mailboxId }), response);
  assert.equal(response.statusCode, 401);
});

await check("invalid Supabase token returns 401", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    const response = responseMock();
    await requireApiUser({ headers: { authorization: "Bearer invalid-token" } }, response, { roles: ["Owner"], requireSecureAuth: true });
    assert.equal(response.statusCode, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check("authenticated user without an allowed role returns 403", async () => {
  const handler = createMailboxHandler({ env: enabledEnv(), rateLimit: () => true, authorize: authorizeAs("Buyer") });
  const response = responseMock();
  await handler(requestMock("GET"), response);
  assert.equal(response.statusCode, 403);
});

for (const role of ["Owner", "Admin", "IT"]) {
  await check(`${role} can read only the safe mailbox allowlist`, async () => {
    const handler = createMailboxHandler({
      env: enabledEnv(),
      rateLimit: () => true,
      authorize: authorizeAs(role),
      requestDb: async () => [mailboxRow()]
    });
    const response = responseMock();
    await handler(requestMock("GET"), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.mailboxes[0].hasPassword, true);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes("encrypted_password"), false);
    assert.equal(serialized.includes("ciphertext-should-not-leak"), false);
    assert.equal(serialized.includes("imap.example.test"), false);
    assert.equal(serialized.includes("password=should-not-leak"), false);
  });
}

await check("cross-tenant mailbox id returns 404 and is never modified", async () => {
  const calls = [];
  const handler = createMailboxHandler({
    env: enabledEnv(),
    rateLimit: () => true,
    authorize: authorizeAs("Owner"),
    requestDb: async (path, options) => { calls.push({ path, options }); return []; },
    auditStart: async ({ mailboxId: auditedId }) => { assert.equal(auditedId, null); return "audit-cross-tenant"; },
    auditFinish: async (_id, outcome) => { assert.equal(outcome, "not_found"); }
  });
  const response = responseMock();
  await handler(requestMock("POST", { action: "disconnect", id: "other-tenant-mailbox" }), response);
  assert.equal(response.statusCode, 404);
  assert.equal(calls.some((call) => call.options?.method === "PATCH"), false);
});

await check("client cannot override tenant, ciphertext or TLS policy", async () => {
  let inserted;
  let auditStarted = 0;
  let auditFinished = 0;
  const handler = createMailboxHandler({
    env: enabledEnv(),
    rateLimit: () => true,
    authorize: authorizeAs("Owner"),
    requestDb: async (path, options) => {
      if (path.startsWith("mailboxes?select=id&email_address=")) return [];
      if (path.startsWith("mailboxes?select=id&email_address&id=")) return [];
      if (path === "mailboxes" && options?.method === "POST") {
        inserted = options.body;
        return [mailboxRow(options.body)];
      }
      return [];
    },
    testConnection: async () => ({ messages: 0, unread: 0 }),
    auditStart: async () => { auditStarted += 1; return "audit-connect"; },
    auditFinish: async (_id, outcome) => { auditFinished += 1; assert.equal(outcome, "succeeded"); }
  });
  const response = responseMock();
  await handler(requestMock("POST", {
    action: "connect",
    organization_id: "attacker-organization",
    encrypted_password: "attacker-ciphertext",
    mailboxName: "Test",
    emailAddress: "mailbox@example.test",
    provider: "Other",
    imapHost: "imap.example.test",
    imapPort: 993,
    imapSecure: false,
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpSecure: false,
    password: "mailbox-app-password"
  }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(inserted.organization_id, organizationId);
  assert.notEqual(inserted.encrypted_password, "attacker-ciphertext");
  assert.equal(inserted.imap_secure, true);
  assert.equal(inserted.smtp_secure, false);
  assert.equal(auditStarted, 1);
  assert.equal(auditFinished, 1);
});

await check("every test and disconnect mutation writes an audit outcome", async () => {
  for (const action of ["test", "disconnect"]) {
    const outcomes = [];
    const handler = createMailboxHandler({
      env: enabledEnv(),
      rateLimit: () => true,
      authorize: authorizeAs("Admin"),
      requestDb: async (path, options) => {
        if (path.includes("select=id,email_address")) return [{ id: mailboxId, email_address: "mailbox@example.test" }];
        if (options?.method === "PATCH") return [mailboxRow()];
        return [];
      },
      testConnection: async () => ({ messages: 0, unread: 0 }),
      auditStart: async () => "audit-id",
      auditFinish: async (_id, outcome) => { outcomes.push(outcome); }
    });
    const response = responseMock();
    await handler(requestMock("POST", {
      action,
      id: mailboxId,
      mailboxName: "Test",
      emailAddress: "mailbox@example.test",
      provider: "Other",
      imapHost: "imap.example.test",
      smtpHost: "smtp.example.test",
      password: action === "test" ? "mailbox-app-password" : undefined
    }), response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(outcomes, ["succeeded"]);
  }
});

await check("AES-GCM uses a fresh nonce and rejects tampering", async () => {
  const first = encryptSecret("same-password");
  const second = encryptSecret("same-password");
  assert.notEqual(first, second);
  assert.equal(decryptSecret(first), "same-password");
  const parts = first.split(":");
  const encrypted = Buffer.from(parts[3], "base64");
  encrypted[0] ^= 1;
  parts[3] = encrypted.toString("base64");
  assert.throws(() => decryptSecret(parts.join(":")));
});

await check("normalizer ignores browser secure=false", async () => {
  const normalized = normalizeMailbox({
    mailboxName: "Test",
    emailAddress: "mailbox@example.test",
    provider: "Other",
    imapHost: "imap.example.test",
    smtpHost: "smtp.example.test",
    smtpPort: 465,
    imapSecure: false,
    smtpSecure: false
  });
  assert.equal(normalized.imap_secure, true);
  assert.equal(normalized.smtp_secure, true);
});

await check("safe mapper never exposes raw credential or server fields", async () => {
  const safe = mapMailbox(mailboxRow());
  assert.equal(Object.hasOwn(safe, "encrypted_password"), false);
  assert.equal(Object.hasOwn(safe, "imapHost"), false);
  assert.equal(Object.hasOwn(safe, "smtpHost"), false);
});

await check("rate limiter blocks the 21st request in one minute", async () => {
  const request = requestMock("GET");
  request.headers["x-forwarded-for"] = "203.0.113.99";
  for (let index = 0; index < 20; index += 1) {
    assert.equal(enforceMailboxRateLimit(request, responseMock(), 1_000), true);
  }
  const response = responseMock();
  assert.equal(enforceMailboxRateLimit(request, response, 1_000), false);
  assert.equal(response.statusCode, 429);
});

for (const item of checks) {
  console.log(`${item.status}  ${item.name}${item.error ? `: ${item.error}` : ""}`);
}

const failed = checks.filter((item) => item.status === "FAIL");
if (failed.length) process.exitCode = 1;
else console.log(`\n${checks.length}/${checks.length} mailbox security checks passed.`);
