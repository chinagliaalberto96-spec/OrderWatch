import { authorizeApiRequest } from "../lib/_auth.js";
import { createJsonCompletion } from "../lib/_openai.js";
import { orgFilter, supabaseRequest, withOrg } from "../lib/_supabaseRest.js";

const MAX_QUESTION_LENGTH = 1200;
const MAX_HISTORY_MESSAGES = 12;
const MAX_REQUESTS_PER_MINUTE = 10;

const SYSTEM_PROMPT = `Sei Altera, l'assistente operativo interno di OrderWatch.
Rispondi in italiano usando esclusivamente i dati presenti nel CONTESTO ORDERWATCH fornito.

REGOLE VINCOLANTI:
- Non inventare mai ordini, date, quantita, stati, collegamenti o azioni eseguite.
- Distingui sempre tra dato osservato, dato incompleto e dato non disponibile.
- Se la copertura di una fonte e partial/unavailable, non trasformare l'assenza di un evento in certezza.
- Non dire "mai inviato", "nessuna risposta" o "non esiste" se le fonti non lo provano.
- Le evidenze con provenance "Storico MBOX" dimostrano che un messaggio outbound e stato osservato, ma hanno copertura partial: usale per completare il contesto senza considerare automaticamente applicata la modifica operativa proposta.
- Se un'evidenza storica ha suggestedOutcome "needs_review", presentala come ipotesi da verificare e non come fatto certo.
- Non eseguire modifiche. Puoi solo spiegare, riepilogare e indicare dove intervenire.
- Rispondi esattamente sull'oggetto richiesto: non sostituire DDT con righe operative generiche, ordini con lavori o fatture con documenti generici.
- Per i DDT usa stato, numero righe e abbinamenti ricezione. Un DDT in stato new/to_review/partially_matched o con righe non allocate e ancora da verificare.
- Mantieni la risposta concreta e breve: massimo 8 frasi, salvo richiesta esplicita di dettaglio.
- Ogni fatto operativo importante deve citare uno o piu ref realmente presenti nel contesto.

Rispondi SOLO con JSON valido:
{
  "answer": "risposta principale",
  "highlights": [
    { "label": "titolo breve", "value": "dato o azione", "severity": "info|warning|critical|success", "refs": ["O1"] }
  ],
  "citations": ["O1", "D2"],
  "suggestions": ["domanda successiva utile"]
}`;

function cleanText(value, limit = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function normalizeArray(value, limit = 6) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function actorFilter(user) {
  return user.legacy || !user.id || !String(user.id).includes("-")
    ? "app_user_id=is.null"
    : `app_user_id=eq.${encodeURIComponent(user.id)}`;
}

async function loadConversation(conversationId, user) {
  if (!conversationId) return null;
  const rows = await supabaseRequest(
    `altera_conversations?id=eq.${encodeURIComponent(conversationId)}&${orgFilter(user.organizationId)}&${actorFilter(user)}&status=eq.active&select=*&limit=1`
  );
  return rows?.[0] || null;
}

async function createConversation(question, user) {
  const rows = await supabaseRequest("altera_conversations?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: withOrg({
      app_user_id: user.legacy ? null : user.id,
      membership_id: user.membershipId || null,
      title: cleanText(question, 72)
    }, user.organizationId)
  });
  return rows?.[0];
}

async function loadHistory(conversationId, organizationId) {
  const rows = await supabaseRequest(
    `altera_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&${orgFilter(organizationId)}&select=role,content,created_at&order=created_at.desc&limit=${MAX_HISTORY_MESSAGES}`
  );
  return (rows || []).reverse();
}

async function enforceRateLimit(user) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const conversations = await supabaseRequest(
    `altera_conversations?${orgFilter(user.organizationId)}&${actorFilter(user)}&select=id&limit=30`
  );
  const ids = (conversations || []).map((row) => row.id);
  if (!ids.length) return;
  const rows = await supabaseRequest(
    `altera_messages?${orgFilter(user.organizationId)}&role=eq.user&created_at=gte.${encodeURIComponent(since)}&conversation_id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})&select=id&limit=${MAX_REQUESTS_PER_MINUTE + 1}`
  );
  if ((rows || []).length >= MAX_REQUESTS_PER_MINUTE) {
    throw Object.assign(new Error("Troppe richieste ravvicinate. Attendi un minuto e riprova."), { statusCode: 429 });
  }
}

function addRefs(rows, prefix, mapper, registry) {
  return (rows || []).map((row, index) => {
    const ref = `${prefix}${index + 1}`;
    const mapped = { ref, ...mapper(row) };
    registry.set(ref, mapped);
    return mapped;
  });
}

async function buildOperationalContext(organizationId) {
  const filter = orgFilter(organizationId);
  const [orders, projects, suppliers, lines, deliveryNotes, deliveryNoteLines, receiptAllocations, invoices, quotes, actions, coverage, health, historicalOutboundEvidence] = await Promise.all([
    supabaseRequest(`orders?${filter}&select=*&order=updated_at.desc&limit=120`),
    supabaseRequest(`projects?${filter}&select=*&order=updated_at.desc&limit=100`),
    supabaseRequest(`suppliers?${filter}&select=*&order=updated_at.desc&limit=100`),
    supabaseRequest(`canonical_operational_lines?${filter}&select=*&order=updated_at.desc&limit=160`),
    supabaseRequest(`delivery_notes?${filter}&select=*&order=updated_at.desc&limit=100`),
    supabaseRequest(`delivery_note_lines?${filter}&select=id,delivery_note_id,description,delivered_quantity,unit_of_measure,needs_review&order=created_at.desc&limit=500`),
    supabaseRequest(`receipt_allocations?${filter}&select=delivery_note_line_id,status,allocated_quantity&order=created_at.desc&limit=1000`),
    supabaseRequest(`invoices?${filter}&select=*&order=updated_at.desc&limit=100`),
    supabaseRequest(`quotes?${filter}&select=*&order=updated_at.desc&limit=100`),
    supabaseRequest(`buyer_actions?${filter}&select=*&order=created_at.desc&limit=100`),
    supabaseRequest(`data_source_coverage?${filter}&select=*`),
    supabaseRequest(`system_health_alerts?${filter}&select=*&limit=30`),
    supabaseRequest(`historical_email_import_proposals?${filter}&operational_writes_applied=eq.false&select=proposal_id,action_family,latest_type,latest_at,source_message_count,superseded_message_count,certainty,linked_order_code,linked_project_code,counterparty_name,counterparty_role,proposed_effect,suggested_outcome,review_status,provenance&order=latest_at.desc&limit=60`)
  ]);

  const registry = new Map();
  const ddtLinesByNote = new Map();
  for (const line of deliveryNoteLines || []) {
    if (!ddtLinesByNote.has(line.delivery_note_id)) ddtLinesByNote.set(line.delivery_note_id, []);
    ddtLinesByNote.get(line.delivery_note_id).push(line);
  }
  const allocationsByDdtLine = new Map();
  for (const allocation of receiptAllocations || []) {
    if (!allocationsByDdtLine.has(allocation.delivery_note_line_id)) allocationsByDdtLine.set(allocation.delivery_note_line_id, []);
    allocationsByDdtLine.get(allocation.delivery_note_line_id).push(allocation);
  }
  const context = {
    observedAt: new Date().toISOString(),
    orders: addRefs(orders, "O", (row) => ({
      type: "order", id: row.id, orderCode: row.order_code, supplier: row.supplier_name,
      projectCode: row.project_code, status: row.status, dueDate: row.due_date,
      requiredDate: row.required_date, needsReview: Boolean(row.needs_review), notes: cleanText(row.notes)
    }), registry),
    projects: addRefs(projects, "P", (row) => ({
      type: "project", id: row.id, projectCode: row.project_code, customer: row.customer,
      status: row.status, dueDate: row.due_date, openOrders: row.open_orders_count
    }), registry),
    suppliers: addRefs(suppliers, "S", (row) => ({
      type: "supplier", id: row.id, name: row.name, risk: row.risk_level, score: row.score,
      openOrders: row.open_orders_count, onTimeRate: row.on_time_rate
    }), registry),
    operationalLines: addRefs(lines, "L", (row) => ({
      type: "line", id: row.id, entityKind: row.entity_kind, description: cleanText(row.description),
      quantity: row.quantity, deliveredQuantity: row.delivered_quantity, remainingQuantity: row.remaining_quantity,
      unit: row.unit, orderCode: row.order_code, projectCode: row.project_code,
      supplier: row.supplier_name, customer: row.customer_name, requiredDate: row.required_date,
      dueDate: row.due_date, status: row.status, needsReview: Boolean(row.needs_review), confidence: row.confidence
    }), registry),
    deliveryNotes: addRefs(deliveryNotes, "D", (row) => {
      const ddtLines = ddtLinesByNote.get(row.id) || [];
      const lineStatuses = ddtLines.map((line) => {
        const allocations = allocationsByDdtLine.get(line.id) || [];
        return {
          description: cleanText(line.description, 120),
          deliveredQuantity: line.delivered_quantity,
          unit: line.unit_of_measure,
          needsReview: Boolean(line.needs_review),
          proposedMatches: allocations.filter((item) => item.status === "proposed").length,
          confirmedMatches: allocations.filter((item) => item.status === "confirmed").length
        };
      });
      return {
        type: "delivery_note", id: row.id, ddtNumber: row.ddt_number, supplier: row.supplier_name,
        orderCode: row.order_code, projectCode: row.project_code, deliveryDate: row.delivery_date,
        receivedDate: row.received_date, status: row.status, needsReview: Boolean(row.needs_review),
        confidence: row.confidence, lineCount: ddtLines.length,
        unallocatedLines: lineStatuses.filter((line) => line.confirmedMatches === 0).length,
        proposedMatches: lineStatuses.reduce((sum, line) => sum + line.proposedMatches, 0),
        confirmedMatches: lineStatuses.reduce((sum, line) => sum + line.confirmedMatches, 0),
        lines: lineStatuses.slice(0, 12)
      };
    }, registry),
    invoices: addRefs(invoices, "I", (row) => ({
      type: "invoice", id: row.id, invoiceNumber: row.invoice_number, supplier: row.supplier_name,
      orderCode: row.order_code, totalAmount: row.total_amount, invoiceDate: row.invoice_date,
      dueDate: row.due_date, status: row.status, needsReview: Boolean(row.needs_review)
    }), registry),
    quotes: addRefs(quotes, "Q", (row) => ({
      type: "quote", id: row.id, quoteNumber: row.quote_code, supplier: row.supplier_name,
      customer: row.customer_name, projectCode: row.project_code, status: row.status,
      validUntil: row.valid_until, totalAmount: row.total_amount, needsReview: Boolean(row.needs_review)
    }), registry),
    actions: addRefs(actions, "A", (row) => ({
      type: "action", id: row.id, actionType: row.action_type,
      title: cleanText(row.title, 140), description: cleanText(row.detail), status: row.status,
      orderCode: row.order_code, projectCode: row.project_code, supplier: row.supplier_name,
      actionAt: row.action_at, direction: row.direction
    }), registry),
    historicalOutboundEvidence: addRefs(historicalOutboundEvidence, "E", (row) => ({
      type: "historical_outbound_evidence", id: row.proposal_id,
      provenance: row.provenance?.label || "Storico MBOX", coverage: row.provenance?.coverage || "partial",
      observedAt: row.latest_at, actionFamily: row.action_family, messageType: row.latest_type,
      counterparty: row.counterparty_name, counterpartyRole: row.counterparty_role,
      orderCode: row.linked_order_code, projectCode: row.linked_project_code,
      certainty: row.certainty, suggestedOutcome: row.suggested_outcome, reviewStatus: row.review_status,
      sourceMessageCount: row.source_message_count, supersededMessages: row.superseded_message_count,
      proposedEffect: cleanText(row.proposed_effect)
    }), registry),
    coverage: addRefs(coverage, "C", (row) => ({
      type: "coverage", id: row.source_key, source: row.label, status: row.status,
      reliability: row.reliability, message: cleanText(row.message), limitation: cleanText(row.limitation)
    }), registry),
    health: addRefs(health, "H", (row) => ({
      type: "health", id: row.alert_key || row.id, severity: row.severity,
      title: cleanText(row.title, 140), message: cleanText(row.message), targetView: row.target_view
    }), registry)
  };
  return { context, registry };
}

function citationTarget(item) {
  if (!item) return null;
  if (item.type === "order") return { view: "orders", orderCode: item.orderCode };
  if (item.type === "project") return { view: "projects", projectCode: item.projectCode };
  if (item.type === "supplier") return { view: "suppliers", supplierId: item.id, supplierName: item.name };
  if (item.type === "delivery_note") return { view: "receiving", deliveryNoteId: item.id };
  if (item.type === "invoice") return { view: "invoices", invoiceId: item.id };
  if (item.type === "quote") return { view: "quotes", quoteId: item.id };
  if (item.type === "historical_outbound_evidence") {
    if (item.orderCode) return { view: "orders", orderCode: item.orderCode };
    if (item.projectCode) return { view: "projects", projectCode: item.projectCode };
    return { view: "imports" };
  }
  if (item.type === "coverage" || item.type === "health") return { view: "settings" };
  if (item.type === "line") {
    if (item.orderCode) return { view: "orders", orderCode: item.orderCode };
    if (item.projectCode) return { view: "projects", projectCode: item.projectCode };
    return { view: "dashboard" };
  }
  return { view: "dashboard" };
}

function citationLabel(item) {
  if (item.type === "order") return `Ordine ${item.orderCode || "senza codice"}`;
  if (item.type === "project") return `Lavoro ${item.projectCode || "senza codice"}`;
  if (item.type === "supplier") return item.name || "Fornitore";
  if (item.type === "delivery_note") return `DDT ${item.ddtNumber || "da verificare"}`;
  if (item.type === "invoice") return `Fattura ${item.invoiceNumber || "da verificare"}`;
  if (item.type === "quote") return `Preventivo ${item.quoteNumber || "da verificare"}`;
  if (item.type === "historical_outbound_evidence") return `Storico MBOX · ${item.counterparty || "controparte da verificare"}`;
  if (item.type === "coverage") return item.source;
  if (item.type === "health") return item.title;
  if (item.type === "line") return item.description || "Riga operativa";
  return item.title || "Dato OrderWatch";
}

function validateResponse(raw, registry) {
  const requestedRefs = new Set([
    ...normalizeArray(raw.citations, 12),
    ...normalizeArray(raw.highlights, 8).flatMap((item) => normalizeArray(item?.refs, 4))
  ]);
  const citations = [...requestedRefs]
    .map((ref) => ({ ref, item: registry.get(ref) }))
    .filter((entry) => entry.item)
    .map(({ ref, item }) => ({ ref, label: citationLabel(item), target: citationTarget(item) }));

  return {
    answer: cleanText(raw.answer || "Non ho trovato dati sufficienti per rispondere con affidabilita.", 1800),
    highlights: normalizeArray(raw.highlights, 8).map((item) => ({
      label: cleanText(item?.label, 80),
      value: cleanText(item?.value, 260),
      severity: ["info", "warning", "critical", "success"].includes(item?.severity) ? item.severity : "info"
    })).filter((item) => item.label && item.value),
    citations,
    suggestions: normalizeArray(raw.suggestions, 4).map((item) => cleanText(item, 140)).filter(Boolean)
  };
}

async function saveMessage({ conversationId, user, role, content, response, model, usage }) {
  const rows = await supabaseRequest("altera_messages?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: withOrg({
      conversation_id: conversationId,
      role,
      content,
      highlights: response?.highlights || [],
      citations: response?.citations || [],
      model: model || null,
      prompt_tokens: usage?.prompt_tokens || null,
      completion_tokens: usage?.completion_tokens || null
    }, user.organizationId)
  });
  return rows?.[0];
}

async function getChat(request, response, user) {
  const conversations = await supabaseRequest(
    `altera_conversations?${orgFilter(user.organizationId)}&${actorFilter(user)}&select=*&order=updated_at.desc&limit=20`
  );
  const selectedId = request.query?.conversationId || conversations?.[0]?.id;
  const conversation = selectedId ? await loadConversation(selectedId, user) : null;
  const messages = conversation
    ? await supabaseRequest(`altera_messages?conversation_id=eq.${encodeURIComponent(conversation.id)}&${orgFilter(user.organizationId)}&select=*&order=created_at.asc&limit=100`)
    : [];
  response.status(200).json({ conversations: conversations || [], conversation, messages: messages || [] });
}

export async function askAltera({ question: rawQuestion, conversationId, user }) {
  const question = cleanText(rawQuestion, MAX_QUESTION_LENGTH);
  if (question.length < 2) throw Object.assign(new Error("Scrivi una domanda per Altera."), { statusCode: 400 });
  await enforceRateLimit(user);

  let conversation = await loadConversation(conversationId, user);
  if (!conversation) conversation = await createConversation(question, user);
  if (!conversation) throw new Error("Impossibile aprire la conversazione.");

  const history = await loadHistory(conversation.id, user.organizationId);
  await saveMessage({ conversationId: conversation.id, user, role: "user", content: question });
  const { context, registry } = await buildOperationalContext(user.organizationId);
  const messages = [
    ...history.map((message) => ({ role: message.role, content: message.content })),
    {
      role: "user",
      content: `${question}\n\nCONTESTO ORDERWATCH (snapshot di sola lettura):\n${JSON.stringify(context)}`
    }
  ];
  const completion = await createJsonCompletion({ system: SYSTEM_PROMPT, messages });
  const validated = validateResponse(completion.content, registry);
  const saved = await saveMessage({
    conversationId: conversation.id,
    user,
    role: "assistant",
    content: validated.answer,
    response: validated,
    model: completion.model,
    usage: completion.usage
  });
  await supabaseRequest(`altera_conversations?id=eq.${encodeURIComponent(conversation.id)}&${orgFilter(user.organizationId)}`, {
    method: "PATCH",
    body: { updated_at: new Date().toISOString() }
  });

  return { conversation, message: { ...saved, ...validated } };
}

async function postChat(request, response, user) {
  const result = await askAltera({
    question: request.body?.question,
    conversationId: request.body?.conversationId,
    user
  });
  response.status(200).json(result);
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, {
    roles: ["Owner", "IT", "Admin", "Buyer", "ReadOnly"]
  });
  if (!user) return;

  try {
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET") return await getChat(request, response, user);
    if (request.method === "POST") return await postChat(request, response, user);
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: "Altera non disponibile", detail: error.message });
  }
}
