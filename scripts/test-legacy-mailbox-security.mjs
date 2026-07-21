import assert from "node:assert/strict";

process.env.AUTH_MODE = "supabase";
process.env.SUPABASE_URL = "https://security-test.invalid";
process.env.SUPABASE_SERVICE_KEY = "test-service-key-not-a-real-secret";

const { allowLegacyAuth, isProductionEnv, requireApiUser } = await import("../server/lib/_auth.js");
const { sanitizeSecurityError } = await import("../server/lib/_securityRedaction.js");
const {
  buildMailboxSmtpOptions,
  createMailboxSmtpTransport
} = await import("../server/lib/_smtpTransport.js");
const customerConfirmations = await import("../server/routes/customer-confirmations.js");
const supplierOrders = await import("../server/routes/supplier-orders.js");

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, status: "PASS" });
  } catch (error) {
    checks.push({ name, status: "FAIL", error: sanitizeSecurityError(error) });
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

function requestMock(body = {}) {
  return { method: "POST", headers: {}, body };
}

function mailbox(overrides = {}) {
  return {
    id: "mailbox-a",
    smtp_host: "smtp.example.test",
    smtp_port: 465,
    smtp_secure: false,
    email_address: "buyer@example.test",
    encrypted_password: "encrypted-test-secret",
    active: true,
    connection_status: "connected",
    ...overrides
  };
}

await check("Railway deployment IDs are treated as production", () => {
  assert.equal(isProductionEnv({ RAILWAY_ENVIRONMENT_ID: "environment-id" }), true);
  assert.equal(isProductionEnv({ RAILWAY_DEPLOYMENT_ID: "deployment-id" }), true);
  assert.equal(isProductionEnv({ RAILWAY_ENVIRONMENT_NAME: "staging" }), false);
});

await check("legacy auth remains disabled in production", () => {
  const previous = { ...process.env };
  process.env.NODE_ENV = "production";
  process.env.AUTH_MODE = "legacy";
  process.env.ALLOW_LEGACY_AUTH = "true";
  try {
    assert.equal(allowLegacyAuth(), false);
  } finally {
    process.env.NODE_ENV = previous.NODE_ENV;
    process.env.AUTH_MODE = previous.AUTH_MODE;
    process.env.ALLOW_LEGACY_AUTH = previous.ALLOW_LEGACY_AUTH;
  }
});

await check("production without AUTH_MODE fails closed", async () => {
  const previous = process.env.AUTH_MODE;
  process.env.NODE_ENV = "production";
  delete process.env.AUTH_MODE;
  const response = responseMock();
  try {
    await requireApiUser(requestMock(), response);
    assert.equal(response.statusCode, 500);
  } finally {
    process.env.AUTH_MODE = previous;
    delete process.env.NODE_ENV;
  }
});

await check("anonymous customer confirmation cannot reach SMTP", async () => {
  process.env.AUTH_MODE = "supabase";
  const response = responseMock();
  await customerConfirmations.default(requestMock({ action: "send", id: "confirmation-a" }), response);
  assert.equal(response.statusCode, 401);
});

await check("anonymous supplier order cannot reach SMTP", async () => {
  process.env.AUTH_MODE = "supabase";
  const response = responseMock();
  await supplierOrders.default(requestMock({ action: "send", id: "dispatch-a" }), response);
  assert.equal(response.statusCode, 401);
});

for (const [label, chooseMailbox] of [
  ["customer confirmation", customerConfirmations.chooseMailbox],
  ["supplier order", supplierOrders.chooseMailbox]
]) {
  await check(`${label} mailbox lookup is tenant-scoped and returns generic 404`, async () => {
    const calls = [];
    await assert.rejects(
      chooseMailbox("foreign-mailbox", "organization-a", async (path) => {
        calls.push(path);
        return [];
      }),
      (error) => error.statusCode === 404
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0], /organization_id=eq\.organization-a/);
    assert.match(calls[0], /id=eq\.foreign-mailbox/);
  });
}

await check("SMTP port 465 enforces implicit verified TLS", () => {
  const options = buildMailboxSmtpOptions(mailbox(), "app-password");
  assert.equal(options.secure, true);
  assert.equal(Object.hasOwn(options, "requireTLS"), false);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.tls.minVersion, "TLSv1.2");
});

await check("SMTP non-465 enforces STARTTLS and ignores smtp_secure", () => {
  const options = buildMailboxSmtpOptions(mailbox({ smtp_port: 587, smtp_secure: false }), "app-password");
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.tls.minVersion, "TLSv1.2");
});

await check("transport creation is dependency-injected without mutating ESM exports", async () => {
  let received;
  const transport = await createMailboxSmtpTransport(mailbox(), {
    decrypt: (ciphertext) => {
      assert.equal(ciphertext, "encrypted-test-secret");
      return "app-password";
    },
    createTransport: (options) => {
      received = options;
      return { sendMail: async () => ({ messageId: "test-message" }) };
    },
    resolveHost: async () => ({ hostname: "smtp.example.test", address: "93.184.216.34" })
  });
  assert.equal(typeof transport.sendMail, "function");
  assert.equal(received.auth.pass, "app-password");
  assert.equal(received.tls.rejectUnauthorized, true);
  assert.equal(received.host, "93.184.216.34");
  assert.equal(received.tls.servername, "smtp.example.test");
});

await check("decryption errors are redactable and never reach transport", async () => {
  const secret = "credential-value-that-must-not-leak";
  let transportCalled = false;
  let caught;
  await assert.rejects(
    createMailboxSmtpTransport(mailbox(), {
      decrypt: () => { throw new Error(`password=${secret}`); },
      createTransport: () => { transportCalled = true; }
    }),
    (error) => {
      caught = error;
      return true;
    }
  );
  assert.equal(transportCalled, false);
  assert.equal(sanitizeSecurityError(caught).includes(secret), false);
});

for (const item of checks) {
  console.log(`${item.status} - ${item.name}${item.error ? `: ${item.error}` : ""}`);
}

const failed = checks.filter((item) => item.status === "FAIL");
if (failed.length) process.exitCode = 1;
else console.log(`\n${checks.length}/${checks.length} behavioral security checks passed.`);
