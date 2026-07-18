import { createHash } from "node:crypto";
import { authorizeApiRequest } from "../lib/_auth.js";
import { orgFilter, supabaseRequest, withOrg } from "../lib/_supabaseRest.js";

function clean(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function positiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function loadRequirement(id, organizationId) {
  const rows = await supabaseRequest(
    `procurement_requirements?id=eq.${encodeURIComponent(id)}&${orgFilter(organizationId)}&select=*&limit=1`
  );
  if (!rows?.[0]) throw httpError("Fabbisogno non trovato.", 404);
  return rows[0];
}

async function createRequirement(body, organizationId) {
  const sourceId = clean(body.sourceProjectRequirementId);
  if (!sourceId) throw httpError("Seleziona la richiesta cliente di origine.");

  const sourceRows = await supabaseRequest(
    `project_requirements?id=eq.${encodeURIComponent(sourceId)}&${orgFilter(organizationId)}&select=*&limit=1`
  );
  const source = sourceRows?.[0];
  if (!source) throw httpError("Richiesta cliente di origine non trovata.", 404);

  const description = clean(body.description);
  if (!description) {
    throw httpError("Descrivi il materiale o servizio da acquistare: non viene copiato automaticamente il prodotto finito del cliente.");
  }
  const quantity = positiveNumber(body.quantity);
  const unit = clean(body.unit) || null;
  const itemCode = clean(body.itemCode) || null;
  const identityKey = hash(itemCode ? `code:${normalize(itemCode)}` : `description:${normalize(description)}`);
  const canonicalKey = hash([
    identityKey,
    quantity ?? "",
    normalize(unit || "")
  ].join("|"));
  const approve = Boolean(body.approve);
  if (approve && (!quantity || !unit)) {
    throw httpError("Per approvare il fabbisogno servono quantità e unità di misura.");
  }

  const payload = withOrg({
    project_id: source.project_id,
    source_project_requirement_id: source.id,
    supplier_id: body.supplierId || null,
    item_code: itemCode,
    description,
    requested_quantity: quantity,
    unit_of_measure: unit,
    required_date: body.requiredDate || source.required_date || null,
    canonical_key: canonicalKey,
    identity_key: identityKey,
    status: approve ? "approved" : "draft",
    confidence: null,
    needs_review: !approve,
    source_email_id: source.source_email_id || null,
    source_document_id: source.source_document_id || null,
    notes: clean(body.notes) || `Fabbisogno definito dalla richiesta cliente: ${source.description}`
  }, organizationId);

  try {
    const rows = await supabaseRequest("procurement_requirements", {
      method: "POST",
      body: payload,
      headers: { Prefer: "return=representation" }
    });
    return rows?.[0] || null;
  } catch (error) {
    if (!String(error.message).includes("23505")) throw error;
    const existing = await supabaseRequest(
      `procurement_requirements?project_id=eq.${encodeURIComponent(source.project_id)}&canonical_key=eq.${canonicalKey}&${orgFilter(organizationId)}&select=*&limit=1`
    );
    return existing?.[0] || null;
  }
}

async function updateRequirement(body, organizationId) {
  const current = await loadRequirement(body.id, organizationId);
  if (["ordered", "fulfilled", "cancelled"].includes(current.status)) {
    throw httpError("Un fabbisogno già ordinato, ricevuto o annullato non può essere riscritto.", 409);
  }

  const patch = { updated_at: new Date().toISOString() };
  if ("description" in body) {
    const description = clean(body.description);
    if (!description) throw httpError("La descrizione del fabbisogno è obbligatoria.");
    patch.description = description;
  }
  if ("quantity" in body) patch.requested_quantity = positiveNumber(body.quantity);
  if ("unit" in body) patch.unit_of_measure = clean(body.unit) || null;
  if ("itemCode" in body) patch.item_code = clean(body.itemCode) || null;
  if ("supplierId" in body) patch.supplier_id = body.supplierId || null;
  if ("requiredDate" in body) patch.required_date = body.requiredDate || null;
  if ("notes" in body) patch.notes = clean(body.notes) || null;

  const description = patch.description ?? current.description;
  const quantity = patch.requested_quantity ?? current.requested_quantity;
  const unit = patch.unit_of_measure ?? current.unit_of_measure;
  const itemCode = patch.item_code ?? current.item_code;
  const identityKey = hash(itemCode ? `code:${normalize(itemCode)}` : `description:${normalize(description)}`);
  patch.identity_key = identityKey;
  patch.canonical_key = hash([identityKey, quantity ?? "", normalize(unit || "")].join("|"));
  patch.status = "draft";
  patch.needs_review = true;

  const rows = await supabaseRequest(
    `procurement_requirements?id=eq.${encodeURIComponent(current.id)}&${orgFilter(organizationId)}`,
    { method: "PATCH", body: patch, headers: { Prefer: "return=representation" } }
  );
  return rows?.[0] || null;
}

async function setStatus(body, organizationId, status) {
  const current = await loadRequirement(body.id, organizationId);
  if (status === "approved" && (!current.requested_quantity || !current.unit_of_measure || !clean(current.description))) {
    throw httpError("Completa descrizione, quantità e unità prima di approvare.", 409);
  }
  if (["ordered", "fulfilled"].includes(current.status) && status === "cancelled") {
    throw httpError("Il fabbisogno è già entrato nel ciclo ordine e non può essere annullato direttamente.", 409);
  }
  const rows = await supabaseRequest(
    `procurement_requirements?id=eq.${encodeURIComponent(current.id)}&${orgFilter(organizationId)}`,
    {
      method: "PATCH",
      body: { status, needs_review: status !== "approved", updated_at: new Date().toISOString() },
      headers: { Prefer: "return=representation" }
    }
  );
  return rows?.[0] || null;
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
    const action = clean(request.body?.action);
    let requirement;
    if (action === "create") requirement = await createRequirement(request.body || {}, user.organizationId);
    else if (action === "update") requirement = await updateRequirement(request.body || {}, user.organizationId);
    else if (action === "approve") requirement = await setStatus(request.body || {}, user.organizationId, "approved");
    else if (action === "cancel") requirement = await setStatus(request.body || {}, user.organizationId, "cancelled");
    else throw httpError("Azione fabbisogno non supportata.");

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ requirement });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Impossibile aggiornare il fabbisogno.",
      detail: error.statusCode ? undefined : error.message
    });
  }
}
