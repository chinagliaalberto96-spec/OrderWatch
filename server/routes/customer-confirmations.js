import nodemailer from "nodemailer";
import { decryptSecret } from "../lib/_mailboxCrypto.js";
import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { authorizeApiRequest } from "../lib/_auth.js";

// CANCELLO 2: ogni query e' filtrata sull'organizzazione dell'utente
// autenticato; ogni riga creata viene marcata con quella organizzazione.

function clean(value) {
  return String(value || "").trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function mapConfirmation(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceEmailId: row.source_email_id,
    projectCode: row.project_code,
    orderCode: row.order_code,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    subject: row.subject,
    body: row.body,
    status: row.status,
    approvalRequired: Boolean(row.approval_required),
    preparedAt: row.prepared_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    senderMailboxId: row.sender_mailbox_id,
    sentAt: row.sent_at,
    messageId: row.smtp_message_id,
    lastError: row.last_error
  };
}

async function settingValue(key, fallback, organizationId) {
  const rows = await supabaseRequest(`settings?select=value&key=eq.${encodeURIComponent(key)}&${orgFilter(organizationId)}&limit=1`);
  return rows?.[0]?.value ?? fallback;
}

async function assertFeatureEnabled(organizationId) {
  const enabled = await settingValue("customer_confirmation.enabled", "true", organizationId);
  if (String(enabled).toLowerCase() !== "true") {
    const error = new Error("Le conferme cliente sono disattivate nelle Impostazioni.");
    error.statusCode = 409;
    throw error;
  }
}

function confirmationSubject(email, line) {
  const reference = line.source_reference || line.project_code || line.order_code;
  if (reference) return `Conferma ricezione ordine ${reference}`;
  const original = clean(email?.subject).replace(/^\s*(re|fw|fwd)\s*:\s*/i, "");
  return original ? `Conferma ricezione - ${original}` : "Conferma ricezione ordine";
}

function confirmationBody({ customerName, lines, reference }) {
  const greeting = customerName ? `Buongiorno ${customerName},` : "Buongiorno,";
  const materialList = lines.length
    ? lines.map((line) => {
        const quantity = [clean(line.quantity), clean(line.unit)].filter(Boolean).join(" ");
        return `- ${clean(line.description)}${quantity ? `: ${quantity}` : ""}`;
      }).join("\n")
    : "- Dettagli ordine ricevuti e in corso di verifica";

  return [
    greeting,
    "",
    `confermiamo la ricezione del vostro ordine${reference ? `, riferimento ${reference}` : ""}.`,
    "",
    materialList,
    "",
    "La presente conferma riguarda la ricezione della richiesta. Eventuali date di consegna saranno comunicate dopo la verifica operativa.",
    "",
    "Cordiali saluti"
  ].join("\n");
}

async function prepareDraft({ materialLineId }, organizationId) {
  await assertFeatureEnabled(organizationId);
  const lines = await supabaseRequest(`canonical_operational_lines?id=eq.${encodeURIComponent(materialLineId)}&${orgFilter(organizationId)}&entity_kind=eq.project_requirement&select=*&limit=1`);
  const line = lines?.[0];
  if (!line) {
    const error = new Error("Riga materiale non trovata.");
    error.statusCode = 404;
    throw error;
  }
  if (line.source_type !== "customer_request") {
    const error = new Error("La conferma cliente si prepara solo per richieste provenienti da clienti.");
    error.statusCode = 409;
    throw error;
  }
  if (!line.source_email_id) {
    const error = new Error("La richiesta non e' collegata alla mail originale.");
    error.statusCode = 409;
    throw error;
  }
  if (!line.project_code && !line.order_code) {
    const error = new Error("Collega prima la richiesta cliente a un lavoro o a un ordine.");
    error.statusCode = 409;
    throw error;
  }

  const [emailRows, siblingLines, existingRows] = await Promise.all([
    supabaseRequest(`processed_emails?id=eq.${encodeURIComponent(line.source_email_id)}&${orgFilter(organizationId)}&select=*&limit=1`),
    supabaseRequest(`canonical_operational_lines?source_email_id=eq.${encodeURIComponent(line.source_email_id)}&${orgFilter(organizationId)}&entity_kind=eq.project_requirement&select=*&order=created_at.asc`),
    supabaseRequest(`customer_confirmations?source_email_id=eq.${encodeURIComponent(line.source_email_id)}&${orgFilter(organizationId)}&status=neq.cancelled&select=*&limit=1`)
  ]);
  if (existingRows?.[0]) return mapConfirmation(existingRows[0]);

  const email = emailRows?.[0];
  const customerEmail = clean(email?.from_address).toLowerCase();
  if (!validEmail(customerEmail)) {
    const error = new Error("Email cliente assente o non valida: correggi prima il mittente della richiesta.");
    error.statusCode = 409;
    throw error;
  }

  const reference = line.source_reference || line.project_code || line.order_code || null;
  const payload = withOrg({
    source_email_id: line.source_email_id,
    project_id: line.project_id || null,
    project_code: line.project_code || null,
    order_id: line.order_id || null,
    order_code: line.order_code || null,
    customer_name: line.customer_name || null,
    customer_email: customerEmail,
    subject: confirmationSubject(email, line),
    body: confirmationBody({ customerName: line.customer_name, lines: siblingLines || [line], reference }),
    status: "draft",
    approval_required: true,
    prepared_at: new Date().toISOString()
  }, organizationId);

  const created = await supabaseRequest("customer_confirmations", {
    method: "POST",
    body: payload,
    headers: { Prefer: "return=representation" }
  });
  return mapConfirmation(created?.[0]);
}

async function updateDraft(body, organizationId) {
  await assertFeatureEnabled(organizationId);
  const customerEmail = clean(body.customerEmail).toLowerCase();
  const subject = clean(body.subject);
  const messageBody = clean(body.body);
  if (!validEmail(customerEmail)) throw new Error("Email cliente non valida.");
  if (!subject) throw new Error("Oggetto obbligatorio.");
  if (!messageBody) throw new Error("Testo della conferma obbligatorio.");

  const rows = await supabaseRequest(`customer_confirmations?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}&status=in.(draft,failed)&select=id&limit=1`);
  if (!rows?.[0]) {
    const error = new Error("La conferma non e' piu' modificabile.");
    error.statusCode = 409;
    throw error;
  }

  const updated = await supabaseRequest(`customer_confirmations?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: {
      customer_name: clean(body.customerName) || null,
      customer_email: customerEmail,
      subject,
      body: messageBody,
      status: "draft",
      last_error: null,
      updated_at: new Date().toISOString()
    },
    headers: { Prefer: "return=representation" }
  });
  return mapConfirmation(updated?.[0]);
}

async function chooseMailbox(mailboxId, organizationId) {
  const idFilter = mailboxId ? `&id=eq.${encodeURIComponent(mailboxId)}` : "";
  const rows = await supabaseRequest(`mailboxes?select=*&${orgFilter(organizationId)}&active=eq.true&connection_status=eq.connected&encrypted_password=not.is.null${idFilter}&order=connected_at.desc&limit=1`);
  const mailbox = rows?.[0];
  if (!mailbox) {
    const error = new Error("Nessuna casella aziendale con SMTP collegata.");
    error.statusCode = 409;
    throw error;
  }
  return mailbox;
}

async function sendConfirmation(body, organizationId) {
  await assertFeatureEnabled(organizationId);
  const rows = await supabaseRequest(`customer_confirmations?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}&select=*&limit=1`);
  const confirmation = rows?.[0];
  if (!confirmation) {
    const error = new Error("Conferma non trovata.");
    error.statusCode = 404;
    throw error;
  }
  if (confirmation.status === "sent") return mapConfirmation(confirmation);
  if (!validEmail(confirmation.customer_email)) throw new Error("Email cliente non valida.");

  const mailbox = await chooseMailbox(body.senderMailboxId, organizationId);
  const password = decryptSecret(mailbox.encrypted_password);
  const transporter = nodemailer.createTransport({
    host: mailbox.smtp_host,
    port: Number(mailbox.smtp_port || 465),
    secure: mailbox.smtp_secure !== false,
    auth: { user: mailbox.email_address, pass: password }
  });

  try {
    const result = await transporter.sendMail({
      from: mailbox.email_address,
      to: confirmation.customer_email,
      subject: confirmation.subject,
      text: confirmation.body
    });
    const now = new Date().toISOString();
    const updated = await supabaseRequest(`customer_confirmations?id=eq.${encodeURIComponent(confirmation.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: {
        status: "sent",
        approved_at: now,
        approved_by: clean(body.approvedBy) || "Buyer OrderWatch",
        sender_mailbox_id: mailbox.id,
        sent_at: now,
        smtp_message_id: result.messageId || null,
        last_error: null,
        updated_at: now
      },
      headers: { Prefer: "return=representation" }
    });

    await supabaseRequest("activities", {
      method: "POST",
      body: withOrg({
        title: "Conferma ricezione ordine inviata",
        type: "Cliente",
        detail: `Conferma inviata a ${confirmation.customer_email} da ${mailbox.email_address}.`,
        order_code: confirmation.order_code,
        project_code: confirmation.project_code,
        date: now
      }, organizationId)
    });
    return mapConfirmation(updated?.[0]);
  } catch (error) {
    await supabaseRequest(`customer_confirmations?id=eq.${encodeURIComponent(confirmation.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { status: "failed", last_error: error.message, updated_at: new Date().toISOString() }
    });
    throw error;
  }
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin", "Buyer"] });
  if (!user) return;
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = { ...(request.body || {}), approvedBy: user.email };
    const organizationId = user.organizationId;
    let confirmation;
    if (body.action === "prepare") confirmation = await prepareDraft({ materialLineId: body.materialLineId }, organizationId);
    else if (body.action === "update") confirmation = await updateDraft(body, organizationId);
    else if (body.action === "send") confirmation = await sendConfirmation(body, organizationId);
    else {
      response.status(400).json({ error: "Unsupported confirmation action." });
      return;
    }

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ confirmation });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: "Unable to manage customer confirmation",
      detail: error.message
    });
  }
}
