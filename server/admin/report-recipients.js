import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { authorizeApiRequest } from "../lib/_auth.js";

// CANCELLO 2: destinatari report specifici del tenant. Ogni query filtrata
// sull'organizzazione dell'utente autenticato; un id di un altro tenant non
// viene trovato -> 404/rows vuote, mai un errore generico che confermi
// l'esistenza altrove.
const ROLE_SET = new Set(["Buyer", "Owner", "Administration", "Manager", "Other"]);
const CHANNEL_SET = new Set(["email", "teams"]);

function normalizeRecipient(body = {}) {
  const recipientName = String(body.recipientName || body.recipient_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = ROLE_SET.has(body.role) ? body.role : "Buyer";
  const channel = CHANNEL_SET.has(body.channel) ? body.channel : "email";

  if (!recipientName) throw new Error("Nome destinatario obbligatorio.");
  if (!email || !email.includes("@")) throw new Error("Email destinatario non valida.");

  return {
    recipient_name: recipientName,
    email,
    role,
    active: body.active !== false,
    daily_report: body.dailyReport !== false,
    channel,
    notes: String(body.notes || "").trim() || null
  };
}

function mapRecipient(row) {
  return {
    id: row.id,
    recipientName: row.recipient_name,
    email: row.email,
    role: row.role,
    active: Boolean(row.active),
    dailyReport: Boolean(row.daily_report),
    channel: row.channel,
    notes: row.notes
  };
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin"] });
  if (!user) return;
  try {
    if (request.method === "GET") {
      const rows = await supabaseRequest(`report_recipients?select=*&${orgFilter(user.organizationId)}&order=recipient_name.asc`);
      response.status(200).json({ recipients: rows.map(mapRecipient) });
      return;
    }

    if (request.method === "POST") {
      const normalized = normalizeRecipient(request.body);
      const existing = await supabaseRequest(
        `report_recipients?select=id&email=eq.${encodeURIComponent(normalized.email)}&${orgFilter(user.organizationId)}&limit=1`
      );

      if (existing.length) {
        const rows = await supabaseRequest(`report_recipients?id=eq.${encodeURIComponent(existing[0].id)}&${orgFilter(user.organizationId)}`, {
          method: "PATCH",
          body: normalized,
          headers: { Prefer: "return=representation" }
        });
        response.status(200).json({ recipient: mapRecipient(rows[0]) });
        return;
      }

      const rows = await supabaseRequest("report_recipients", {
        method: "POST",
        body: withOrg(normalized, user.organizationId),
        headers: { Prefer: "return=representation" }
      });
      response.status(201).json({ recipient: mapRecipient(rows[0]) });
      return;
    }

    if (request.method === "PATCH") {
      const { id } = request.body || {};
      if (!id) {
        response.status(400).json({ error: "Missing recipient id." });
        return;
      }

      const rows = await supabaseRequest(`report_recipients?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
        method: "PATCH",
        body: normalizeRecipient(request.body),
        headers: { Prefer: "return=representation" }
      });
      if (!rows?.[0]) {
        response.status(404).json({ error: "Recipient not found." });
        return;
      }
      response.status(200).json({ recipient: mapRecipient(rows[0]) });
      return;
    }

    if (request.method === "DELETE") {
      const { id } = request.body || {};
      if (!id) {
        response.status(400).json({ error: "Missing recipient id." });
        return;
      }

      const rows = await supabaseRequest(`report_recipients?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" }
      });
      if (!rows?.[0]) {
        response.status(404).json({ error: "Recipient not found." });
        return;
      }
      response.status(200).json({ deletedId: id });
      return;
    }

    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    response.status(500).json({ error: "Unable to manage report recipients", detail: error.message });
  }
}
