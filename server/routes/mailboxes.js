import { ImapFlow } from "imapflow";
import { encryptSecret } from "../lib/_mailboxCrypto.js";
import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { authorizeApiRequest } from "../lib/_auth.js";

// CANCELLO 2: ogni lettura/scrittura e' filtrata sull'organizzazione
// dell'utente autenticato. Le credenziali IMAP/SMTP di un tenant non sono
// mai visibili o modificabili da un altro.
const ROLE_SET = new Set(["Owner", "Administration", "Purchasing", "Suppliers", "General", "Other"]);
const PROVIDER_SET = new Set(["Hostinger", "Gmail", "Microsoft", "Aruba", "Zoho", "Other"]);

function mapMailbox(row) {
  return {
    id: row.id,
    mailboxName: row.mailbox_name,
    emailAddress: row.email_address,
    role: row.role,
    provider: row.provider,
    active: Boolean(row.active),
    connectionStatus: row.connection_status,
    mailboxSource: row.mailbox_source,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    lastCheckAt: row.last_check_at,
    connectedAt: row.connected_at,
    lastError: row.last_error,
    hasPassword: Boolean(row.encrypted_password),
    notes: row.notes
  };
}

function normalizeMailbox(body = {}, { includePassword = false } = {}) {
  const mailboxName = String(body.mailboxName || "").trim();
  const emailAddress = String(body.emailAddress || "").trim().toLowerCase();
  const provider = PROVIDER_SET.has(body.provider) ? body.provider : "Hostinger";

  if (!mailboxName) throw new Error("Nome casella obbligatorio.");
  if (!emailAddress || !emailAddress.includes("@")) throw new Error("Email casella non valida.");

  const patch = {
    mailbox_name: mailboxName,
    email_address: emailAddress,
    role: ROLE_SET.has(body.role) ? body.role : "General",
    provider,
    active: body.active !== false,
    imap_host: String(body.imapHost || defaultImapHost(provider)).trim(),
    imap_port: Number(body.imapPort || 993),
    imap_secure: body.imapSecure !== false,
    smtp_host: String(body.smtpHost || defaultSmtpHost(provider)).trim(),
    smtp_port: Number(body.smtpPort || 465),
    smtp_secure: body.smtpSecure !== false,
    mailbox_source: String(body.mailboxSource || emailAddress).trim(),
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

async function testImap({ host, port, email, password }) {
  const client = new ImapFlow({
    host,
    port,
    secure: true,
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

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin"] });
  if (!user) return;
  try {
    if (request.method === "GET") {
      const rows = await supabaseRequest(`mailboxes?select=*&${orgFilter(user.organizationId)}&order=mailbox_name.asc`);
      response.status(200).json({ mailboxes: rows.map(mapMailbox) });
      return;
    }

    if (request.method === "POST") {
      const body = request.body || {};
      const action = body.action || "connect";

      if (action === "disconnect") {
        if (!body.id) {
          response.status(400).json({ error: "Missing mailbox id." });
          return;
        }
        const rows = await supabaseRequest(`mailboxes?id=eq.${encodeURIComponent(body.id)}&${orgFilter(user.organizationId)}`, {
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
          response.status(404).json({ error: "Mailbox not found." });
          return;
        }
        response.status(200).json({ mailbox: mapMailbox(rows[0]) });
        return;
      }

      const patch = normalizeMailbox(body, { includePassword: action === "connect" });
      let testResult = null;

      if (action === "connect" || action === "test") {
        if (!body.password) throw new Error("Password richiesta per testare o connettere la casella.");
        testResult = await testImap({
          host: patch.imap_host,
          port: patch.imap_port,
          email: patch.email_address,
          password: body.password
        });
      }

      // Solo "connect" salva la password cifrata e marca la casella come
      // connessa (e' l'unico stato che il worker considera monitorabile).
      // "test" verifica le credenziali senza cambiare lo stato ne' creare
      // record: una casella testata ma non salvata non deve mai risultare
      // connessa senza password.
      if (action === "test") {
        if (body.id) {
          await supabaseRequest(`mailboxes?id=eq.${encodeURIComponent(body.id)}&${orgFilter(user.organizationId)}`, {
            method: "PATCH",
            body: { last_check_at: new Date().toISOString() }
          });
        }
        response.status(200).json({ test: testResult });
        return;
      }

      patch.connection_status = "connected";
      patch.connected_at = new Date().toISOString();
      patch.last_error = null;

      let recordId = body.id;
      if (!recordId) {
        // Il riaggancio per email resta dentro il tenant: due aziende
        // possono avere la stessa casella storica senza scavalcarsi.
        const existing = await supabaseRequest(
          `mailboxes?select=id&email_address=eq.${encodeURIComponent(patch.email_address)}&${orgFilter(user.organizationId)}&limit=1`
        );
        recordId = existing[0]?.id;
      }

      const rows = recordId
        ? await supabaseRequest(`mailboxes?id=eq.${encodeURIComponent(recordId)}&${orgFilter(user.organizationId)}`, {
            method: "PATCH",
            body: patch,
            headers: { Prefer: "return=representation" }
          })
        : await supabaseRequest("mailboxes", {
            method: "POST",
            body: withOrg(patch, user.organizationId),
            headers: { Prefer: "return=representation" }
          });

      if (!rows?.[0]) {
        response.status(404).json({ error: "Mailbox not found." });
        return;
      }

      response.status(200).json({ mailbox: mapMailbox(rows[0]), test: testResult });
      return;
    }

    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    response.status(500).json({ error: "Unable to manage mailboxes", detail: error.message });
  }
}
