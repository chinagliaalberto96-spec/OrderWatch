import assert from "node:assert/strict";
import fs from "node:fs";

const files = {
  auth: fs.readFileSync("server/lib/_auth.js", "utf8"),
  mailHost: fs.readFileSync("server/lib/_mailHostSecurity.js", "utf8"),
  smtp: fs.readFileSync("server/lib/_smtpTransport.js", "utf8"),
  session: fs.readFileSync("api/session.js", "utf8"),
  customer: fs.readFileSync("server/routes/customer-confirmations.js", "utf8"),
  supplier: fs.readFileSync("server/routes/supplier-orders.js", "utf8")
};

const checks = [];

function check(name, fn) {
  try {
    fn();
    checks.push({ name, status: "PASS" });
  } catch (error) {
    checks.push({ name, status: "FAIL", error: error.message });
  }
}

check("Railway uses documented deployment identifiers", () => {
  assert.equal(/process\.env\.RAILWAY_ENV\b/.test(files.auth), false);
  assert.match(files.auth, /RAILWAY_ENVIRONMENT_ID/);
  assert.match(files.auth, /RAILWAY_DEPLOYMENT_ID/);
});

check("mailbox queries use an explicit field allowlist", () => {
  assert.equal(/mailboxes\?select=\*/.test(files.customer), false);
  assert.equal(/mailboxes\?select=\*/.test(files.supplier), false);
  assert.match(files.customer, /const columns = "id,smtp_host,smtp_port,smtp_secure,email_address,encrypted_password,active,connection_status,connected_at"/);
  assert.match(files.supplier, /const columns = "id,smtp_host,smtp_port,smtp_secure,email_address,encrypted_password,active,connection_status,connected_at"/);
});

check("cross-tenant mailbox existence probes are absent", () => {
  assert.equal(/mailboxes\?id=eq\./.test(files.customer), false);
  assert.equal(/mailboxes\?id=eq\./.test(files.supplier), false);
});

check("all three SMTP flows use the central hardened transport", () => {
  assert.equal((files.customer.match(/createMailboxSmtpTransport\(/g) || []).length, 1);
  assert.equal((files.supplier.match(/createMailboxSmtpTransport\(/g) || []).length, 2);
  assert.equal(/nodemailer\.createTransport/.test(files.customer), false);
  assert.equal(/nodemailer\.createTransport/.test(files.supplier), false);
});

check("SMTP route errors are never persisted or returned raw", () => {
  for (const source of [files.customer, files.supplier]) {
    assert.equal(/(?:last_error|error_detail):\s*error\.message/.test(source), false);
    assert.equal(/detail:\s*error\.message/.test(source), false);
    assert.equal(/lastError:\s*row\.(?:last_error|error_detail)/.test(source), false);
  }
});

check("session validation never returns raw infrastructure errors", () => {
  assert.equal(/detail:\s*error\.message/.test(files.session), false);
  assert.match(files.session, /authorizeApiRequest/);
});

check("SMTP helper enforces TLS policy", () => {
  assert.match(files.smtp, /port === 465/);
  assert.match(files.smtp, /requireTLS: true/);
  assert.match(files.smtp, /rejectUnauthorized: true/);
  assert.match(files.smtp, /minVersion: "TLSv1\.2"/);
});

check("mail transports pin DNS to public addresses", () => {
  assert.match(files.mailHost, /resolvePublicMailHost/);
  assert.match(files.smtp, /options\.host = target\.address/);
  assert.match(files.smtp, /options\.tls\.servername = target\.hostname/);
});

check("tests contain no unconditional success escape", () => {
  const current = fs.readFileSync("scripts/test-legacy-mailbox-static.mjs", "utf8");
  assert.equal(/\|\|\s*true/.test(current), false);
});

for (const item of checks) {
  console.log(`${item.status} - ${item.name}${item.error ? `: ${item.error}` : ""}`);
}

if (checks.some((item) => item.status === "FAIL")) process.exitCode = 1;
else console.log(`\n${checks.length}/${checks.length} static security checks passed.`);
