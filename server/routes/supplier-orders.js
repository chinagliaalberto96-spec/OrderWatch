import nodemailer from "nodemailer";
import { decryptSecret } from "../lib/_mailboxCrypto.js";
import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { buildSupplierOrderPdf } from "../lib/_supplierOrderPdf.js";
import { authorizeApiRequest } from "../lib/_auth.js";

// Workflow ordini verso fornitori — endpoint server-side coerente con
// /api/customer-confirmations. La service role resta solo qui, mai nel browser.
// Nessun invio automatico: prepare -> update -> approve -> send (esplicito).
// Azioni: prepare | update | approve | send | cancel.
//
// CANCELLO 2: ogni query e' filtrata sull'organizzazione dell'utente
// autenticato; ogni riga creata (ordini, dispatch, reminder, activities)
// viene marcata con quella organizzazione. Un id valido ma di un altro
// tenant produce 404, mai un match cross-tenant.

function clean(value) {
  return String(value || "").trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function mapDispatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    orderCode: row.order_code,
    projectId: row.project_id,
    projectCode: row.project_code,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierEmail: row.supplier_email,
    contactName: row.contact_name,
    senderMailboxId: row.sender_mailbox_id,
    subject: row.subject,
    body: row.body,
    status: row.status,
    approvalRequired: Boolean(row.approval_required),
    orderVersion: row.order_version,
    lines: Array.isArray(row.line_snapshot) ? row.line_snapshot : [],
    preparedAt: row.prepared_at,
    preparedBy: row.prepared_by,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    sentAt: row.sent_at,
    messageId: row.smtp_message_id,
    threadId: row.smtp_thread_id,
    confirmedAt: row.confirmed_at,
    promisedDate: row.promised_date,
    reminderCount: row.reminder_count,
    lastError: row.last_error
  };
}

async function settingValue(key, fallback, organizationId) {
  const rows = await supabaseRequest(`settings?select=value&key=eq.${encodeURIComponent(key)}&${orgFilter(organizationId)}&limit=1`);
  return rows?.[0]?.value ?? fallback;
}

async function assertFeatureEnabled(organizationId) {
  const enabled = await settingValue("supplier_orders.enabled", "true", organizationId);
  if (String(enabled).toLowerCase() !== "true") {
    throw httpError("Gli ordini fornitore sono disattivati nelle Impostazioni.", 409);
  }
}

function lineSnapshot(line) {
  return {
    id: line.id,
    description: clean(line.description) || null,
    quantity: clean(line.quantity) || null,
    unit: clean(line.unit) || null,
    item_code: clean(line.item_code) || null,
    required_date: line.required_date || null,
    project_code: line.project_code || null,
    // segnala i campi incompleti senza inventare nulla
    incomplete: !clean(line.quantity) || !clean(line.description)
  };
}

function orderBody({ supplierName, contactName, lines, reference, projectCode }) {
  const greeting = contactName ? `Buongiorno ${contactName},` : supplierName ? `Spett.le ${supplierName},` : "Buongiorno,";
  const materialList = lines.map((line) => {
    const qty = [clean(line.quantity), clean(line.unit)].filter(Boolean).join(" ");
    const code = clean(line.item_code) ? ` (cod. ${clean(line.item_code)})` : "";
    const req = line.required_date ? ` — data richiesta ${line.required_date}` : "";
    const missing = line.incomplete ? " [DA COMPLETARE]" : "";
    return `- ${clean(line.description) || "Materiale"}${code}${qty ? `: ${qty}` : ""}${req}${missing}`;
  }).join("\n");

  return [
    greeting,
    "",
    `con la presente trasmettiamo il nostro ordine${reference ? ` ${reference}` : ""}${projectCode ? ` (rif. lavoro ${projectCode})` : ""} per il seguente materiale:`,
    "",
    materialList,
    "",
    "Vi chiediamo cortese conferma di disponibilita' e data di consegna prevista.",
    "",
    "Restiamo in attesa di un vostro riscontro.",
    "",
    "Cordiali saluti"
  ].join("\n");
}

async function resolveSupplier({ supplierId, supplierName }, organizationId) {
  if (supplierId) {
    const rows = await supabaseRequest(`suppliers?id=eq.${encodeURIComponent(supplierId)}&${orgFilter(organizationId)}&select=*&limit=1`);
    if (rows?.[0]) return rows[0];
  }
  if (supplierName) {
    const rows = await supabaseRequest(`suppliers?normalized_name=eq.${encodeURIComponent(clean(supplierName).toUpperCase().replace(/[^A-Z0-9]/g, ""))}&${orgFilter(organizationId)}&select=*&limit=1`);
    if (rows?.[0]) return rows[0];
    const byName = await supabaseRequest(`suppliers?name=ilike.${encodeURIComponent(clean(supplierName))}&${orgFilter(organizationId)}&select=*&limit=1`);
    if (byName?.[0]) return byName[0];
  }
  return null;
}

async function primaryContactEmail(supplierId, organizationId) {
  if (!supplierId) return null;
  const rows = await supabaseRequest(`supplier_contacts?supplier_id=eq.${encodeURIComponent(supplierId)}&${orgFilter(organizationId)}&email=not.is.null&select=email,is_primary&order=is_primary.desc&limit=1`);
  return rows?.[0]?.email || null;
}

async function markQuoteConverted(quoteId, orderId, orderCode, organizationId) {
  if (!quoteId) return;
  const rows = await supabaseRequest(`quotes?id=eq.${encodeURIComponent(quoteId)}&${orgFilter(organizationId)}&select=id,notes&limit=1`);
  if (!rows?.[0]) throw httpError("Preventivo da convertire non trovato.", 404);
  await supabaseRequest(`quotes?id=eq.${encodeURIComponent(quoteId)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: {
      status: "converted",
      needs_review: false,
      notes: [rows[0].notes, `Convertito manualmente dal buyer nell'ordine ${orderCode || orderId}.`].filter(Boolean).join("\n"),
      updated_at: new Date().toISOString()
    }
  });
}

// FASE 2 — Preparazione: parte da una o piu' righe materiale, raggruppate per
// fornitore. La v1 gestisce un fornitore per bozza (le righe di fornitori
// diversi vanno preparate separatamente); il grouping avviene lato UI.
async function prepareDraft(body, organizationId) {
  await assertFeatureEnabled(organizationId);
  const ids = Array.isArray(body.materialLineIds) && body.materialLineIds.length
    ? body.materialLineIds
    : body.materialLineId
      ? [body.materialLineId]
      : [];
  if (!ids.length) throw httpError("Seleziona almeno una riga materiale.", 400);

  const idList = ids.map((id) => `"${String(id)}"`).join(",");
  const lines = await supabaseRequest(`material_lines?id=in.(${idList})&${orgFilter(organizationId)}&select=*&order=created_at.asc`);
  if (!lines?.length) throw httpError("Righe materiale non trovate.", 404);

  // Un solo fornitore per bozza
  const supplierIds = [...new Set(lines.map((l) => l.supplier_id).filter(Boolean))];
  const supplierNames = [...new Set(lines.map((l) => clean(l.supplier_name)).filter(Boolean))];
  if (supplierIds.length > 1) throw httpError("Le righe selezionate hanno fornitori diversi: preparane uno per volta.", 409);

  let supplier = await resolveSupplier({
    supplierId: body.supplierId || supplierIds[0],
    supplierName: body.supplierName || supplierNames[0]
  }, organizationId);
  // Il fornitore puo' anche mancare del tutto: la UI lo chiede prima dell'invio,
  // ma la bozza si puo' preparare per lasciare al buyer la scelta.

  const projectCode = lines.map((l) => l.project_code).find(Boolean) || null;
  const projectId = lines.map((l) => l.project_id).find(Boolean) || null;

  // Codice ordine stabile: riusa quello gia' presente sulle righe, altrimenti
  // ne genera uno interno univoco (PO-xxxx).
  let orderCode = lines.map((l) => l.order_code).find(Boolean) || null;
  let orderId = lines.map((l) => l.order_id).find(Boolean) || null;

  // Idempotenza: se esiste gia' un dispatch attivo per queste righe/ordine, riusalo.
  if (orderId) {
    const existing = await supabaseRequest(`supplier_order_dispatches?order_id=eq.${encodeURIComponent(orderId)}&${orgFilter(organizationId)}&status=in.(draft,approved,sent,waiting_confirmation)&select=*&limit=1`);
    if (existing?.[0]) {
      await markQuoteConverted(body.quoteId, orderId, orderCode, organizationId);
      return mapDispatch(existing[0]);
    }
  }
  const existingByLine = await supabaseRequest(`supplier_order_dispatches?material_line_ids=ov.{${ids.join(",")}}&${orgFilter(organizationId)}&status=in.(draft,approved)&select=*&limit=1`);
  if (existingByLine?.[0]) {
    await markQuoteConverted(body.quoteId, existingByLine[0].order_id, existingByLine[0].order_code, organizationId);
    return mapDispatch(existingByLine[0]);
  }

  if (!orderCode) {
    const rpc = await supabaseRequest("rpc/next_supplier_po_code", { method: "POST", body: {} });
    orderCode = typeof rpc === "string" ? rpc : rpc?.[0]?.next_supplier_po_code || rpc;
  }

  // Crea/riusa l'ordine contenitore
  if (!orderId) {
    const found = await supabaseRequest(`orders?order_code=eq.${encodeURIComponent(orderCode)}&${orgFilter(organizationId)}&select=id&limit=1`);
    if (found?.[0]) {
      orderId = found[0].id;
    } else {
      const created = await supabaseRequest("orders", {
        method: "POST",
        body: withOrg({
          order_code: orderCode,
          supplier_id: supplier?.id || null,
          supplier_name: supplier?.name || supplierNames[0] || null,
          project_id: projectId,
          project_code: projectCode,
          status: "In attesa",
          supplier_order_status: "draft",
          needs_review: true,
          notes: "Ordine d'acquisto preparato dal buyer via OrderWatch."
        }, organizationId),
        headers: { Prefer: "return=representation" }
      });
      orderId = created?.[0]?.id || null;
    }
    // aggancia le righe all'ordine
    await supabaseRequest(`material_lines?id=in.(${idList})&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { order_id: orderId, order_code: orderCode, updated_at: new Date().toISOString() }
    });
  }

  const supplierEmail = clean(body.supplierEmail).toLowerCase()
    || clean(supplier?.email).toLowerCase()
    || (await primaryContactEmail(supplier?.id, organizationId))
    || null;

  const snapshot = lines.map(lineSnapshot);
  const payload = withOrg({
    order_id: orderId,
    order_code: orderCode,
    project_id: projectId,
    project_code: projectCode,
    supplier_id: supplier?.id || null,
    supplier_name: supplier?.name || supplierNames[0] || null,
    supplier_email: validEmail(supplierEmail) ? supplierEmail : null,
    contact_name: clean(body.contactName) || null,
    sender_mailbox_id: null,
    subject: `Ordine ${orderCode}${projectCode ? ` - lavoro ${projectCode}` : ""}`,
    body: orderBody({
      supplierName: supplier?.name || supplierNames[0],
      contactName: body.contactName,
      lines: snapshot,
      reference: orderCode,
      projectCode
    }),
    status: "draft",
    approval_required: true,
    line_snapshot: snapshot,
    material_line_ids: ids,
    prepared_at: new Date().toISOString(),
    prepared_by: clean(body.preparedBy) || "Buyer OrderWatch"
  }, organizationId);

  const created = await supabaseRequest("supplier_order_dispatches", {
    method: "POST",
    body: payload,
    headers: { Prefer: "return=representation" }
  });
  await markQuoteConverted(body.quoteId, orderId, orderCode, organizationId);
  return mapDispatch(created?.[0]);
}

async function loadDispatch(id, organizationId) {
  const rows = await supabaseRequest(`supplier_order_dispatches?id=eq.${encodeURIComponent(id)}&${orgFilter(organizationId)}&select=*&limit=1`);
  const dispatch = rows?.[0];
  if (!dispatch) throw httpError("Ordine fornitore non trovato.", 404);
  return dispatch;
}

async function updateDraft(body, organizationId) {
  await assertFeatureEnabled(organizationId);
  const dispatch = await loadDispatch(body.id, organizationId);
  // Modificabile finche' non e' partito. Un ordine gia' inviato/confermato no.
  if (!["draft", "approved", "failed"].includes(dispatch.status)) {
    throw httpError("L'ordine non e' piu' modificabile.", 409);
  }

  // Regola commerciale: ogni modifica dopo l'approvazione riporta a bozza e
  // richiede una nuova approvazione esplicita del buyer.
  const patch = { updated_at: new Date().toISOString(), last_error: null };
  if (dispatch.status !== "draft") {
    patch.status = "draft";
    patch.approved_at = null;
    patch.approved_by = null;
  }
  if ("supplierEmail" in body) {
    const email = clean(body.supplierEmail).toLowerCase();
    if (email && !validEmail(email)) throw httpError("Email fornitore non valida.", 400);
    patch.supplier_email = email || null;
  }
  if ("contactName" in body) patch.contact_name = clean(body.contactName) || null;
  if ("senderMailboxId" in body) patch.sender_mailbox_id = body.senderMailboxId || null;
  if ("subject" in body) {
    if (!clean(body.subject)) throw httpError("Oggetto obbligatorio.", 400);
    patch.subject = clean(body.subject);
  }
  if ("body" in body) {
    if (!clean(body.body)) throw httpError("Testo dell'ordine obbligatorio.", 400);
    patch.body = clean(body.body);
  }
  if ("supplierId" in body && body.supplierId) {
    const supplier = await resolveSupplier({ supplierId: body.supplierId }, organizationId);
    if (supplier) {
      patch.supplier_id = supplier.id;
      patch.supplier_name = supplier.name;
    }
  }
  if (Array.isArray(body.lines)) {
    patch.line_snapshot = body.lines.map(lineSnapshot);
  }

  const updated = await supabaseRequest(`supplier_order_dispatches?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: patch,
    headers: { Prefer: "return=representation" }
  });
  return mapDispatch(updated?.[0]);
}

async function approveDraft(body, organizationId) {
  await assertFeatureEnabled(organizationId);
  const dispatch = await loadDispatch(body.id, organizationId);
  if (dispatch.status === "approved") return mapDispatch(dispatch);
  if (dispatch.status !== "draft") throw httpError("Solo una bozza puo' essere approvata.", 409);
  if (!Array.isArray(dispatch.line_snapshot) || !dispatch.line_snapshot.length) {
    throw httpError("Nessuna riga materiale nell'ordine.", 409);
  }

  const now = new Date().toISOString();
  const updated = await supabaseRequest(`supplier_order_dispatches?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: { status: "approved", approved_at: now, approved_by: clean(body.approvedBy) || "Buyer OrderWatch", updated_at: now },
    headers: { Prefer: "return=representation" }
  });
  return mapDispatch(updated?.[0]);
}

async function chooseMailbox(mailboxId, organizationId) {
  const idFilter = mailboxId ? `&id=eq.${encodeURIComponent(mailboxId)}` : "";
  const rows = await supabaseRequest(`mailboxes?select=*&${orgFilter(organizationId)}&active=eq.true&connection_status=eq.connected&encrypted_password=not.is.null${idFilter}&order=connected_at.desc&limit=1`);
  const mailbox = rows?.[0];
  if (!mailbox) throw httpError("Nessuna casella aziendale con SMTP collegata.", 409);
  return mailbox;
}

// FASE 3 — Invio sicuro. Con SUPPLIER_ORDER_SMTP_DRY_RUN=true nessuna mail
// parte davvero (transport JSON): usato nei test. Idempotente: un ordine gia'
// inviato non viene reinviato.
async function sendOrder(body, organizationId) {
  await assertFeatureEnabled(organizationId);
  const dispatch = await loadDispatch(body.id, organizationId);
  if (["sent", "waiting_confirmation", "confirmed"].includes(dispatch.status)) {
    return mapDispatch(dispatch); // idempotenza: gia' inviato
  }
  if (dispatch.status !== "approved") {
    throw httpError("Approva l'ordine prima di inviarlo.", 409);
  }
  if (!validEmail(dispatch.supplier_email)) throw httpError("Email fornitore assente o non valida.", 409);
  if (!Array.isArray(dispatch.line_snapshot) || !dispatch.line_snapshot.length) {
    throw httpError("Nessuna riga materiale da inviare.", 409);
  }
  if (!clean(dispatch.subject) || !clean(dispatch.body)) {
    throw httpError("Oggetto o testo mancante.", 409);
  }

  const mailbox = await chooseMailbox(body.senderMailboxId || dispatch.sender_mailbox_id, organizationId);
  const dryRun = String(process.env.SUPPLIER_ORDER_SMTP_DRY_RUN || "").toLowerCase() === "true";

  const transporter = dryRun
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: mailbox.smtp_host,
        port: Number(mailbox.smtp_port || 465),
        secure: mailbox.smtp_secure !== false,
        auth: { user: mailbox.email_address, pass: decryptSecret(mailbox.encrypted_password) }
      });

  // Allegato PDF opzionale (default: si'). Layout generico v1, vedi
  // _supplierOrderPdf.js — sostituibile col template definitivo del cliente
  // senza toccare il resto del flusso di invio.
  const attachments = [];
  if (body.attachPdf !== false) {
    try {
      const companyName = await settingValue("client.company_name", "Azienda", organizationId);
      const pdfBuffer = await buildSupplierOrderPdf(
        { orderCode: dispatch.order_code, projectCode: dispatch.project_code, supplierName: dispatch.supplier_name, supplierEmail: dispatch.supplier_email, contactName: dispatch.contact_name, lines: dispatch.line_snapshot },
        { name: companyName }
      );
      attachments.push({ filename: `Ordine_${dispatch.order_code || "fornitore"}.pdf`, content: pdfBuffer, contentType: "application/pdf" });
    } catch (pdfError) {
      // Un problema nella generazione del PDF non deve bloccare l'invio
      // dell'ordine: si procede senza allegato e si traccia l'anomalia.
      console.warn("[supplier-orders] Generazione PDF fallita:", pdfError.message);
    }
  }

  try {
    const result = await transporter.sendMail({
      from: mailbox.email_address,
      to: dispatch.supplier_email,
      subject: dispatch.subject,
      text: dispatch.body,
      attachments
    });
    const now = new Date().toISOString();
    const messageId = result.messageId || `dryrun-${dispatch.id}`;
    const updated = await supabaseRequest(`supplier_order_dispatches?id=eq.${encodeURIComponent(dispatch.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: {
        status: "waiting_confirmation",
        sender_mailbox_id: mailbox.id,
        sent_at: now,
        smtp_message_id: messageId,
        smtp_thread_id: messageId,
        last_error: null,
        updated_at: now
      },
      headers: { Prefer: "return=representation" }
    });

    if (dispatch.order_id) {
      await supabaseRequest(`orders?id=eq.${encodeURIComponent(dispatch.order_id)}&${orgFilter(organizationId)}`, {
        method: "PATCH",
        body: { supplier_order_status: "waiting_confirmation", last_buyer_action_at: now, updated_at: now }
      });
    }

    await supabaseRequest("activities", {
      method: "POST",
      body: withOrg({
        title: dryRun ? "Ordine fornitore inviato (simulazione)" : "Ordine fornitore inviato",
        type: "Ordine",
        detail: `Ordine ${dispatch.order_code} inviato a ${dispatch.supplier_email} da ${mailbox.email_address}${dryRun ? " [DRY RUN]" : ""}.`,
        order_code: dispatch.order_code,
        project_code: dispatch.project_code,
        supplier_name: dispatch.supplier_name,
        date: now
      }, organizationId)
    });
    return mapDispatch(updated?.[0]);
  } catch (error) {
    await supabaseRequest(`supplier_order_dispatches?id=eq.${encodeURIComponent(dispatch.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { status: "failed", last_error: error.message, updated_at: new Date().toISOString() }
    });
    throw error;
  }
}

// FASE 5 — Solleciti fornitore. Sempre bozza + approvazione buyer, mai auto.
async function prepareReminder(body, organizationId) {
  const remEnabled = await settingValue("supplier_reminders.enabled", "true", organizationId);
  if (String(remEnabled).toLowerCase() !== "true") {
    throw httpError("I solleciti fornitore sono disattivati nelle Impostazioni.", 409);
  }
  const dispatch = await loadDispatch(body.id, organizationId);
  if (dispatch.status !== "waiting_confirmation") {
    throw httpError("Si sollecita solo un ordine inviato e in attesa di conferma.", 409);
  }
  const maxAttempts = Number(await settingValue("supplier_reminders.max_attempts", "2", organizationId));
  if (Number(dispatch.reminder_count || 0) >= maxAttempts) {
    throw httpError(`Raggiunto il numero massimo di solleciti (${maxAttempts}).`, 409);
  }
  if (!validEmail(dispatch.supplier_email)) throw httpError("Email fornitore non valida.", 409);

  // Idempotenza: se esiste gia' una bozza sollecito per questo dispatch, riusala.
  const existing = await supabaseRequest(`reminders?dispatch_id=eq.${encodeURIComponent(dispatch.id)}&${orgFilter(organizationId)}&status=eq.draft&select=*&order=created_at.desc&limit=1`);
  if (existing?.[0]) return mapReminder(existing[0]);

  const attempt = Number(dispatch.reminder_count || 0) + 1;
  const subject = /^re:/i.test(dispatch.subject || "") ? dispatch.subject : `Re: ${dispatch.subject || `Ordine ${dispatch.order_code}`}`;
  const reminderBody = [
    dispatch.contact_name ? `Buongiorno ${dispatch.contact_name},` : "Buongiorno,",
    "",
    `torniamo a scrivervi in merito al nostro ordine ${dispatch.order_code}, ancora in attesa di conferma.`,
    "",
    "Vi chiediamo cortesemente di confermarci disponibilita' e data di consegna prevista.",
    "",
    "Grazie, cordiali saluti"
  ].join("\n");

  const created = await supabaseRequest("reminders", {
    method: "POST",
    body: withOrg({
      dispatch_id: dispatch.id,
      order_id: dispatch.order_id,
      order_code: dispatch.order_code,
      supplier_id: dispatch.supplier_id,
      supplier_name: dispatch.supplier_name,
      supplier_email: dispatch.supplier_email,
      subject,
      body: reminderBody,
      status: "draft",
      reminder_type: "supplier_order",
      attempt,
      approval_required: true
    }, organizationId),
    headers: { Prefer: "return=representation" }
  });
  return mapReminder(created?.[0]);
}

async function sendReminder(body, organizationId) {
  const rows = await supabaseRequest(`reminders?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}&select=*&limit=1`);
  const reminder = rows?.[0];
  if (!reminder) throw httpError("Sollecito non trovato.", 404);
  if (reminder.status === "sent") return mapReminder(reminder);
  if (reminder.status !== "draft") throw httpError("Il sollecito non e' piu' inviabile.", 409);
  if (!validEmail(reminder.supplier_email)) throw httpError("Email fornitore non valida.", 409);

  const dispatch = reminder.dispatch_id ? await loadDispatch(reminder.dispatch_id, organizationId) : null;
  const mailbox = await chooseMailbox(body.senderMailboxId || dispatch?.sender_mailbox_id, organizationId);
  const dryRun = String(process.env.SUPPLIER_ORDER_SMTP_DRY_RUN || "").toLowerCase() === "true";
  const transporter = dryRun
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: mailbox.smtp_host,
        port: Number(mailbox.smtp_port || 465),
        secure: mailbox.smtp_secure !== false,
        auth: { user: mailbox.email_address, pass: decryptSecret(mailbox.encrypted_password) }
      });

  try {
    const result = await transporter.sendMail({
      from: mailbox.email_address,
      to: reminder.supplier_email,
      subject: reminder.subject,
      text: reminder.body,
      // Threading sul messaggio originale dell'ordine
      inReplyTo: dispatch?.smtp_message_id || undefined,
      references: dispatch?.smtp_message_id || undefined
    });
    const now = new Date().toISOString();
    const updated = await supabaseRequest(`reminders?id=eq.${encodeURIComponent(reminder.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { status: "sent", sent_at: now, smtp_message_id: result.messageId || `dryrun-${reminder.id}`, updated_at: now },
      headers: { Prefer: "return=representation" }
    });
    if (dispatch) {
      await supabaseRequest(`supplier_order_dispatches?id=eq.${encodeURIComponent(dispatch.id)}&${orgFilter(organizationId)}`, {
        method: "PATCH",
        body: { reminder_count: Number(dispatch.reminder_count || 0) + 1, last_reminder_at: now, updated_at: now }
      });
    }
    await supabaseRequest("activities", {
      method: "POST",
      body: withOrg({
        title: dryRun ? "Sollecito fornitore inviato (simulazione)" : "Sollecito fornitore inviato",
        type: "Ordine",
        detail: `Sollecito ordine ${reminder.order_code} a ${reminder.supplier_email}${dryRun ? " [DRY RUN]" : ""} (tentativo ${reminder.attempt}).`,
        order_code: reminder.order_code,
        supplier_name: reminder.supplier_name,
        date: now
      }, organizationId)
    });
    return mapReminder(updated?.[0]);
  } catch (error) {
    await supabaseRequest(`reminders?id=eq.${encodeURIComponent(reminder.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { status: "failed", error_detail: error.message, updated_at: new Date().toISOString() }
    });
    throw error;
  }
}

function mapReminder(row) {
  if (!row) return null;
  return {
    id: row.id,
    dispatchId: row.dispatch_id,
    orderCode: row.order_code,
    supplierName: row.supplier_name,
    supplierEmail: row.supplier_email,
    subject: row.subject,
    body: row.body,
    status: row.status,
    attempt: row.attempt,
    sentAt: row.sent_at,
    messageId: row.smtp_message_id,
    lastError: row.error_detail
  };
}

async function cancelOrder(body, organizationId) {
  const dispatch = await loadDispatch(body.id, organizationId);
  if (["sent", "waiting_confirmation", "confirmed"].includes(dispatch.status)) {
    throw httpError("Un ordine gia' inviato non puo' essere annullato dalla bozza.", 409);
  }
  const now = new Date().toISOString();
  const updated = await supabaseRequest(`supplier_order_dispatches?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: { status: "cancelled", updated_at: now },
    headers: { Prefer: "return=representation" }
  });
  return mapDispatch(updated?.[0]);
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
    const body = {
      ...(request.body || {}),
      approvedBy: user.email,
      preparedBy: user.email
    };
    const organizationId = user.organizationId;
    let dispatch;
    if (body.action === "prepare") dispatch = await prepareDraft(body, organizationId);
    else if (body.action === "update") dispatch = await updateDraft(body, organizationId);
    else if (body.action === "approve") dispatch = await approveDraft(body, organizationId);
    else if (body.action === "send") dispatch = await sendOrder(body, organizationId);
    else if (body.action === "cancel") dispatch = await cancelOrder(body, organizationId);
    else if (body.action === "prepare_reminder") {
      const reminder = await prepareReminder(body, organizationId);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ reminder });
      return;
    } else if (body.action === "send_reminder") {
      const reminder = await sendReminder(body, organizationId);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ reminder });
      return;
    } else {
      response.status(400).json({ error: "Azione ordine fornitore non supportata." });
      return;
    }

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ dispatch });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: "Unable to manage supplier order",
      detail: error.message
    });
  }
}
