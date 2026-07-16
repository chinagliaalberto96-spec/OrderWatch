import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { authorizeApiRequest } from "../lib/_auth.js";

// Azioni buyer sugli ordini (solo sorgente Supabase, il pilota Airtable resta
// in sola lettura). PATCH: campi editabili dal dettaglio ordine. DELETE:
// consentita SOLO per ordini chiusi o scaduti — la regola vive qui lato
// server, la UI la riflette soltanto.
//
// CANCELLO 2: ogni query e' filtrata sull'organizzazione dell'utente
// autenticato (mai un valore letto dal body). Un id valido ma di un altro
// tenant non viene trovato -> 404, esattamente come un id inesistente.
const CLOSED_STATUSES = new Set(["Ricevuto", "Annullato", "OK", "Concluso"]);
const EDITABLE_STATUSES = new Set(["In attesa", "Confermato", "Ricevuto", "In ritardo", "Scaduto", "Annullato", "OK"]);

const FIELD_MAP = {
  status: "status",
  needsReview: "needs_review",
  dueDate: "due_date",
  requiredDate: "required_date",
  orderDate: "order_date",
  quantity: "quantity",
  material: "material",
  notes: "notes",
  owner: "owner",
  projectCode: "project_code"
};

function normalizeDate(value) {
  if (value === null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error("Le date devono essere in formato YYYY-MM-DD.");
  }
  return value;
}

function buildPatch(body) {
  const patch = {};
  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (!(key in body)) continue;
    let value = body[key];
    if (key === "needsReview") value = Boolean(value);
    else if (key === "status") {
      if (!EDITABLE_STATUSES.has(value)) throw new Error(`Stato non valido: ${value}`);
    } else if (key === "dueDate" || key === "requiredDate" || key === "orderDate") {
      value = normalizeDate(value);
    } else {
      value = value === "" ? null : value;
    }
    patch[column] = value;
  }
  if (!Object.keys(patch).length) throw new Error("Nessun campo modificabile fornito.");
  patch.updated_at = new Date().toISOString();
  return patch;
}

async function getOrder(id, organizationId) {
  const rows = await supabaseRequest(`orders?id=eq.${encodeURIComponent(id)}&${orgFilter(organizationId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

function isDeletable(order) {
  if (CLOSED_STATUSES.has(order.status)) return true;
  if (order.status === "Scaduto") return true;
  if (order.due_date && order.due_date < new Date().toISOString().slice(0, 10)) return true;
  // Bozza mai verificata (tipicamente un ordine creato per errore dalla
  // pipeline email, dati incompleti): il buyer deve poterla rimuovere anche
  // se non e' ancora chiusa/scaduta.
  if (order.needs_review) return true;
  return false;
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin", "Buyer"] });
  if (!user) return;
  try {
    const body = request.body || {};
    const id = body.id;

    if (!id) {
      response.status(400).json({ error: "Missing order id." });
      return;
    }

    const order = await getOrder(id, user.organizationId);
    if (!order) {
      response.status(404).json({ error: "Order not found." });
      return;
    }

    if (request.method === "PATCH") {
      const patch = buildPatch(body);
      const rows = await supabaseRequest(`orders?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
        method: "PATCH",
        body: patch,
        headers: { Prefer: "return=representation" }
      });

      await supabaseRequest("activities", {
        method: "POST",
        body: withOrg({
          title: "Ordine aggiornato dal buyer",
          type: "Ordine",
          detail: `Ordine ${order.order_code}: campi aggiornati manualmente (${Object.keys(patch).filter((k) => k !== "updated_at").join(", ")}).`,
          order_code: order.order_code,
          supplier_name: order.supplier_name
        }, user.organizationId)
      });

      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ order: rows[0] });
      return;
    }

    if (request.method === "DELETE") {
      if (!isDeletable(order)) {
        response.status(403).json({
          error: "Si possono eliminare solo ordini chiusi o scaduti."
        });
        return;
      }

      // Prima di eliminare l'ordine si scollegano i documenti (restano come
      // archivio) e si lascia traccia in activities. Filtro organizzazione
      // anche qui: non si toccano mai righe di altri tenant.
      await supabaseRequest(`documents?order_id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
        method: "PATCH",
        body: { order_id: null }
      });
      await supabaseRequest(`reminders?order_id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
        method: "PATCH",
        body: { order_id: null }
      });
      await supabaseRequest(`orders?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, { method: "DELETE" });

      await supabaseRequest("activities", {
        method: "POST",
        body: withOrg({
          title: "Ordine eliminato dal buyer",
          type: "Ordine",
          detail: `Ordine ${order.order_code} (${order.supplier_name || "fornitore sconosciuto"}) eliminato: stato ${order.status}.`,
          order_code: order.order_code,
          supplier_name: order.supplier_name
        }, user.organizationId)
      });

      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ deleted: true, orderCode: order.order_code });
      return;
    }

    response.setHeader("Allow", "PATCH, DELETE");
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    response.status(500).json({ error: "Unable to manage order", detail: error.message });
  }
}
