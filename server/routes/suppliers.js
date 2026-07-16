import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { authorizeApiRequest } from "../lib/_auth.js";

// Gestione fornitori + contatti. Pattern ad azioni come api/mailboxes.js.
// I contatti servono soprattutto al workflow ordini fornitore (selezione
// email destinatario nel drawer), oggi vuoti: la UI Fornitori li rende
// gestibili direttamente dal buyer.
//
// CANCELLO 2: ogni lettura/scrittura e' filtrata sull'organizzazione
// dell'utente autenticato. Un supplierId/contactId di un altro tenant non
// viene trovato -> 404 (mai un errore generico che confermi l'esistenza).

function clean(value) {
  return String(value || "").trim();
}

function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function mapSupplier(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    onTimeRate: row.on_time_rate,
    openOrders: row.open_orders_count,
    risk: row.risk_level,
    score: row.score,
    notes: row.notes,
    registryStatus: row.registry_status || "verified"
  };
}

function mapContact(row) {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isPrimary: Boolean(row.is_primary)
  };
}

async function updateSupplier(body, organizationId) {
  const email = clean(body.email);
  if (!validEmail(email)) throw new Error("Email fornitore non valida.");

  const patch = { updated_at: new Date().toISOString() };
  if ("email" in body) patch.email = email || null;
  if ("phone" in body) patch.phone = clean(body.phone) || null;
  if ("notes" in body) patch.notes = clean(body.notes) || null;
  if ("registryStatus" in body) {
    const registryStatus = clean(body.registryStatus).toLowerCase();
    if (!["verified", "candidate", "ignored"].includes(registryStatus)) {
      throw new Error("Stato anagrafico fornitore non valido.");
    }
    patch.registry_status = registryStatus;
  }

  const rows = await supabaseRequest(`suppliers?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: patch,
    headers: { Prefer: "return=representation" }
  });
  if (!rows?.[0]) throw notFound("Fornitore non trovato.");
  return mapSupplier(rows[0]);
}

async function assertSupplierInOrg(supplierId, organizationId) {
  const rows = await supabaseRequest(`suppliers?id=eq.${encodeURIComponent(supplierId)}&${orgFilter(organizationId)}&select=id&limit=1`);
  if (!rows?.[0]) throw notFound("Fornitore non trovato.");
}

async function addContact(body, organizationId) {
  const email = clean(body.email);
  const name = clean(body.name);
  if (!validEmail(email) || !email) throw new Error("Email contatto obbligatoria e valida.");
  if (!body.supplierId) throw new Error("Fornitore mancante.");
  await assertSupplierInOrg(body.supplierId, organizationId);

  // Se marcato principale, gli altri contatti dello stesso fornitore non lo sono piu'.
  if (body.isPrimary) {
    await supabaseRequest(`supplier_contacts?supplier_id=eq.${encodeURIComponent(body.supplierId)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { is_primary: false }
    });
  }

  const rows = await supabaseRequest("supplier_contacts", {
    method: "POST",
    body: withOrg({
      supplier_id: body.supplierId,
      name: name || null,
      email,
      phone: clean(body.phone) || null,
      role: clean(body.role) || null,
      is_primary: Boolean(body.isPrimary)
    }, organizationId),
    headers: { Prefer: "return=representation" }
  });
  return mapContact(rows[0]);
}

async function updateContact(body, organizationId) {
  const patch = {};
  if ("name" in body) patch.name = clean(body.name) || null;
  if ("email" in body) {
    const email = clean(body.email);
    if (!validEmail(email) || !email) throw new Error("Email contatto non valida.");
    patch.email = email;
  }
  if ("phone" in body) patch.phone = clean(body.phone) || null;
  if ("role" in body) patch.role = clean(body.role) || null;

  if (body.isPrimary) {
    const rows = await supabaseRequest(`supplier_contacts?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}&select=supplier_id&limit=1`);
    const supplierId = rows?.[0]?.supplier_id;
    if (!supplierId) throw notFound("Contatto non trovato.");
    await supabaseRequest(`supplier_contacts?supplier_id=eq.${encodeURIComponent(supplierId)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { is_primary: false }
    });
    patch.is_primary = true;
  } else if ("isPrimary" in body) {
    patch.is_primary = false;
  }

  patch.updated_at = new Date().toISOString();
  const rows = await supabaseRequest(`supplier_contacts?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}`, {
    method: "PATCH",
    body: patch,
    headers: { Prefer: "return=representation" }
  });
  if (!rows?.[0]) throw notFound("Contatto non trovato.");
  return mapContact(rows[0]);
}

async function deleteContact(body, organizationId) {
  if (!body.id) throw new Error("Contatto mancante.");
  const rows = await supabaseRequest(`supplier_contacts?id=eq.${encodeURIComponent(body.id)}&${orgFilter(organizationId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" }
  });
  if (!rows?.[0]) throw notFound("Contatto non trovato.");
  return { deleted: true, id: body.id };
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
    const body = request.body || {};
    if (body.action === "update") {
      const supplier = await updateSupplier(body, user.organizationId);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ supplier });
      return;
    }
    if (body.action === "add_contact") {
      const contact = await addContact(body, user.organizationId);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ contact });
      return;
    }
    if (body.action === "update_contact") {
      const contact = await updateContact(body, user.organizationId);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ contact });
      return;
    }
    if (body.action === "delete_contact") {
      const result = await deleteContact(body, user.organizationId);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(result);
      return;
    }
    response.status(400).json({ error: "Azione fornitore non supportata." });
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: "Unable to manage supplier", detail: error.message });
  }
}
