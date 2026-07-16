import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { authorizeApiRequest } from "../lib/_auth.js";

// Azioni buyer sui lavori (progetti). Stesso pattern di api/orders.js:
// PATCH per i campi editabili dal pannello dettaglio, tracciamento in
// activities. CANCELLO 2: ogni query filtrata sull'organizzazione
// dell'utente autenticato; un id di un altro tenant -> 404.
const EDITABLE_STATUSES = new Set(["Aperto", "Preventivo", "In produzione", "Concluso", "Annullato"]);

const FIELD_MAP = {
  status: "status",
  owner: "owner",
  dueDate: "due_date",
  notes: "notes",
  customer: "customer"
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
    if (key === "status") {
      if (!EDITABLE_STATUSES.has(value)) throw new Error(`Stato non valido: ${value}`);
    } else if (key === "dueDate") {
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

async function getProject(id, organizationId) {
  const rows = await supabaseRequest(`projects?id=eq.${encodeURIComponent(id)}&${orgFilter(organizationId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin", "Buyer"] });
  if (!user) return;
  try {
    if (request.method !== "PATCH") {
      response.setHeader("Allow", "PATCH");
      response.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = request.body || {};
    const id = body.id;
    if (!id) {
      response.status(400).json({ error: "Missing project id." });
      return;
    }

    const project = await getProject(id, user.organizationId);
    if (!project) {
      response.status(404).json({ error: "Project not found." });
      return;
    }

    const patch = buildPatch(body);
    const rows = await supabaseRequest(`projects?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
      method: "PATCH",
      body: patch,
      headers: { Prefer: "return=representation" }
    });

    await supabaseRequest("activities", {
      method: "POST",
      body: withOrg({
        title: "Lavoro aggiornato dal buyer",
        type: "Ordine",
        detail: `Lavoro ${project.project_code}: campi aggiornati manualmente (${Object.keys(patch).filter((k) => k !== "updated_at").join(", ")}).`,
        project_code: project.project_code
      }, user.organizationId)
    });

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ project: rows[0] });
  } catch (error) {
    response.status(500).json({ error: "Unable to manage project", detail: error.message });
  }
}
