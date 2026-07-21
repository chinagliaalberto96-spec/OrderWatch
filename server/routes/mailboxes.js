import { createHmac } from "node:crypto";
import { ImapFlow } from "imapflow";
import { encryptSecret } from "../lib/_mailboxCrypto.js";
import { normalizePublicMailHostname, resolvePublicMailHost } from "../lib/_mailHostSecurity.js";
import { publicMailboxError, sanitizeSecurityError } from "../lib/_securityRedaction.js";
import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { authorizeApiRequest } from "../lib/_auth.js";

const ROLE_SET = new Set(["Owner", "Administration", "Purchasing", "Suppliers", "General", "Other"]);
const PROVIDER_SET = new Set(["Hostinger", "Gmail", "Microsoft", "Aruba", "Zoho", "Other"]);
const ACTION_SET = new Set(["connect", "test", "disconnect"]);
const ALLOWED_MANAGEMENT_ROLES = ["Owner", "Admin", "IT"];
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitBuckets = new Map();

export function isMailboxManagementEnabled(env = process.env) {
  const secureAuth = String(env.AUTH_MODE || "").trim() === "supabase";
  const explicitlyEnabled = String(env.MAILBOX_MANAGEMENT_ENABLED || "").trim().toLowerCase() === "true";
  return secureAuth && explicitlyEnabled;
}

export function mapMailbox(row) {
  return {
    id: row.id,
    mailboxName: row.mailbox_name,
    emailAddress: row.email_address,
    role: row.role,
    provider: row.provider,
    active: Boolean(row.active),
    connectionStatus: row.connection_status,
    connectedAt: row.connected_at,
    lastCheckAt: row.last_check_at,
    lastError: publicMailboxError(row.last_error),
    hasPassword: Boolean(row.encrypted_password)
  };
}

export function normalizeMailbox(body = {}, { includePassword = false } = {}) {
  const mailboxName = String(body.mailboxName || "").trim();
  const emailAddress = String(body.emailAddress || "").trim().toLowerCase();
  const provider = PROVIDER_SET.has(body.provider) ? body.provider : "Hostinger";
  const imapPort = normalizePort(body.imapPort, 993);
  const smtpPort = normalizePort(body.smtpPort, 465);

  if (!mailboxName) throw new Error("Nome casella obbligatorio.");
  if (!emailAddress || !emailAddress.includes("@")) throw new Error("Email casella non valida.");

  const patch = {
    mailbox_name: mailboxName,
    email_address: emailAddress,
    role: ROLE_SET.has(body.role) ? body.role : "General",
    provider,
    active: body.active !== false,
    imap_host: normalizePublicMailHostname(body.imapHost || defaultImapHost(provider)),
    imap_port: imapPort,
    imap_secure: true,
    smtp_host: normalizePublicMailHostname(body.smtpHost || defaultSmtpHost(provider)),
    smtp_port: smtpPort,
    smtp_secure: smtpPort === 465,
    mailbox_source: emailAddress,
    notes: String(body.notes || "").trim() || null
  };

  if (includePassword && body.password) {
    patch.encrypted_password = encryptSecret(body.password);
    patch.encryption_version = "v1";
  }

  return patch;
}

function defaultImapHost(provider) {
  if (provider === "Gmail") return "imap.gmail.com";
  if (provider === "Microsoft") return "outlook.office365.com";
  if (provider === "Aruba") return "imaps.aruba.it";
  if (provider === "Zoho") return "imap.zoho.eu";
  if (provider === "Other") return "";
  return "imap.hostinger.com";
}

function defaultSmtpHost(provider) {
  if (provider === "Gmail") return "smtp.gmail.com";
  if (provider === "Microsoft") return "smtp.office365.com";
  if (provider === "Aruba") return "smtps.aruba.it";
  if (provider === "Zoho") return "smtp.zoho.eu";
  if (provider === "Other") return "";
  return "smtp.hostinger.com";
}

function normalizePort(value, fallback) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Porta mail non valida.");
  return port;
}

export async function testImap({ host, port, email, password }, { resolveHost = resolvePublicMailHost } = {}) {
  const target = await resolveHost(host);
  const client = new ImapFlow({
    host: target.address,
    port,
    secure: true,
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      servername: target.hostname
    },
    auth: { user: email, pass: password },
    logger: false
  });

  await client.connect();
  try {
    const status = await client.status("INBOX", { messages: true, unseen: true });
    return {
      messages: status.messages ?? 0,
      unread: status.unseen ?? 0
    };
  } finally {
    await client.logout();
  }
}

export function enforceMailboxRateLimit(request, response, now = Date.now(), scope = "") {
  scope = String(scope || "");
  const key = `${scope}:${requestFingerprint(request)}`;
  if (rateLimitBuckets.size >= 1_000) {
    for (const [bucketKey, bucket] of rateLimitBuckets) {
      if (now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(bucketKey);
    }
    if (rateLimitBuckets.size >= 1_000 && !rateLimitBuckets.has(key)) {
      response.status(429).json({ error: "Troppe richieste. Riprovare più tardi." });
      return false;
    }
  }
  const current = rateLimitBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }

  current.count += 1;
  if (current.count <= RATE_LIMIT_MAX_REQUESTS) return true;
  response.status(429).json({ error: "Troppe richieste. Riprovare più tardi." });
  return false;
}

async function createAuditRecord({ request, user, action, mailboxId, emailAddress }, requestDb = supabaseRequest) {
  const rows = await requestDb("mailbox_management_audit_logs", {
    method: "POST",
    body: withOrg({
      actor_app_user_id: user.id,
      actor_membership_id: user.membershipId || null,
      mailbox_id: mailboxId || null,
      action,
      outcome: "attempted",
      request_method: String(request.method || "").toUpperCase(),
      request_path: "/api/mailboxes",
      request_ip_hash: auditHash(requestFingerprint(request)),
      user_agent: String(request.headers?.["user-agent"] || "").slice(0, 240) || null,
      deployment_id: String(process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || "").slice(0, 200) || null,
      target_email_hash: emailAddress ? auditHash(String(emailAddress).trim().toLowerCase()) : null
    }, user.organizationId),
    headers: { Prefer: "return=representation" }
  });
  if (!rows?.[0]?.id) throw new Error("Audit mailbox non disponibile.");
  return rows[0].id;
}

async function finishAuditRecord(auditId, outcome, requestDb = supabaseRequest, organizationId = null) {
  if (!auditId) return;
  const tenantFilter = organizationId ? `&${orgFilter(organizationId)}` : "";
  await requestDb(`mailbox_management_audit_logs?id=eq.${encodeURIComponent(auditId)}${tenantFilter}`, {
    method: "PATCH",
    body: { outcome },
    headers: { Prefer: "return=minimal" }
  });
}

export function createMailboxHandler({
  authorize = authorizeApiRequest,
  requestDb = supabaseRequest,
  testConnection = testImap,
  rateLimit = enforceMailboxRateLimit,
  auditStart = createAuditRecord,
  auditFinish = finishAuditRecord,
  env = process.env
} = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    if (!isMailboxManagementEnabled(env)) {
      response.status(503).json({ error: "Mailbox management temporarily unavailable" });
      return;
    }

    const user = await authorize(request, response, {
      roles: ALLOWED_MANAGEMENT_ROLES,
      requireSecureAuth: true
    });
    if (!user) return;
    if (!rateLimit(request, response, Date.now(), user.id)) return;

    let auditId = null;
    try {
      if (request.method === "GET") {
        const rows = await requestDb(`mailboxes?select=*&${orgFilter(user.organizationId)}&order=mailbox_name.asc`);
        response.status(200).json({ mailboxes: (rows || []).map(mapMailbox) });
        return;
      }

      if (request.method === "POST") {
        const body = request.body || {};
        const action = String(body.action || "connect");
        if (!ACTION_SET.has(action)) {
          response.status(400).json({ error: "Azione mailbox non valida." });
          return;
        }

        const requestedMailbox = body.id
          ? (await requestDb(
              `mailboxes?select=id,email_address&id=eq.${encodeURIComponent(body.id)}&${orgFilter(user.organizationId)}&limit=1`
            ))?.[0] || null
          : null;

        auditId = await auditStart({
          request,
          user,
          action,
          mailboxId: requestedMailbox?.id || null,
          emailAddress: body.emailAddress || requestedMailbox?.email_address
        }, requestDb);

        if (body.id && !requestedMailbox) {
          await auditFinish(auditId, "not_found", requestDb, user.organizationId);
          response.status(404).json({ error: "Mailbox not found." });
          return;
        }

        if (action === "disconnect") {
          if (!body.id) {
            await auditFinish(auditId, "rejected", requestDb, user.organizationId);
            response.status(400).json({ error: "Missing mailbox id." });
            return;
          }
          const rows = await requestDb(`mailboxes?id=eq.${encodeURIComponent(requestedMailbox.id)}&${orgFilter(user.organizationId)}`, {
            method: "PATCH",
            body: {
              encrypted_password: null,
              connection_status: "not_connected",
              connected_at: null,
              last_error: null
            },
            headers: { Prefer: "return=representation" }
          });
          if (!rows?.[0]) {
            await auditFinish(auditId, "not_found", requestDb, user.organizationId);
            response.status(404).json({ error: "Mailbox not found." });
            return;
          }
          await auditFinish(auditId, "succeeded", requestDb, user.organizationId);
          response.status(200).json({ mailbox: mapMailbox(rows[0]) });
          return;
        }

        const patch = normalizeMailbox(body, { includePassword: action === "connect" });
        if (!body.password) throw new Error("Password richiesta per testare o connettere la casella.");
        const testResult = await testConnection({
          host: patch.imap_host,
          port: patch.imap_port,
          email: patch.email_address,
          password: body.password
        });

        if (action === "test") {
          if (body.id) {
            const testedRows = await requestDb(`mailboxes?id=eq.${encodeURIComponent(body.id)}&${orgFilter(user.organizationId)}`, {
              method: "PATCH",
              body: { last_check_at: new Date().toISOString() },
              headers: { Prefer: "return=representation" }
            });
            if (!testedRows?.[0]) {
              await auditFinish(auditId, "not_found", requestDb, user.organizationId);
              response.status(404).json({ error: "Mailbox not found." });
              return;
            }
          }
          await auditFinish(auditId, "succeeded", requestDb, user.organizationId);
          response.status(200).json({ test: testResult });
          return;
        }

        patch.connection_status = "connected";
        patch.connected_at = new Date().toISOString();
        patch.last_error = null;

        let recordId = body.id;
        if (!recordId) {
          const existing = await requestDb(
            `mailboxes?select=id&email_address=eq.${encodeURIComponent(patch.email_address)}&${orgFilter(user.organizationId)}&limit=1`
          );
          recordId = existing?.[0]?.id;
        }

        const rows = recordId
          ? await requestDb(`mailboxes?id=eq.${encodeURIComponent(recordId)}&${orgFilter(user.organizationId)}`, {
              method: "PATCH",
              body: patch,
              headers: { Prefer: "return=representation" }
            })
          : await requestDb("mailboxes", {
              method: "POST",
              body: withOrg(patch, user.organizationId),
              headers: { Prefer: "return=representation" }
            });

        if (!rows?.[0]) {
          await auditFinish(auditId, "not_found", requestDb, user.organizationId);
          response.status(404).json({ error: "Mailbox not found." });
          return;
        }

        await auditFinish(auditId, "succeeded", requestDb, user.organizationId);
        response.status(200).json({ mailbox: mapMailbox(rows[0]), test: testResult });
        return;
      }

      response.setHeader("Allow", "GET, POST");
      response.status(405).json({ error: "Method not allowed" });
    } catch (error) {
      if (auditId) {
        try {
          await auditFinish(auditId, "failed", requestDb, user.organizationId);
        } catch (auditError) {
          console.warn("[mailboxes] aggiornamento audit fallito:", sanitizeSecurityError(auditError));
        }
      }
      console.warn("[mailboxes] richiesta fallita:", sanitizeSecurityError(error));
      response.status(500).json({ error: "Unable to manage mailboxes" });
    }
  };
}

function requestFingerprint(request) {
  const forwarded = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(request.headers?.["x-real-ip"] || request.socket?.remoteAddress || "unknown");
}

function auditHash(value) {
  const key = String(process.env.AUDIT_HASH_KEY || "");
  if (!key) throw new Error("Audit hash configuration missing.");
  return createHmac("sha256", key).update(String(value)).digest("hex");
}

export default createMailboxHandler();
