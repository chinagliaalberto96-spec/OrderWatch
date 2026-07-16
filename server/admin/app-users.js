import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { getSupabaseConfig } from "../lib/_supabaseRest.js";
import { authorizeApiRequest, usesSecureAuth } from "../lib/_auth.js";
import { createClient } from "@supabase/supabase-js";

const ROLE_SET = new Set(["Owner", "IT", "Admin", "Buyer", "ReadOnly"]);

// CANCELLO 2 — app_users rappresenta l'identita' GLOBALE di una persona
// (email univoca a livello di sistema, decisione documentata nella
// migrazione tenant_isolation_gate2). Per il pilota attuale ogni persona
// appartiene a UNA sola organizzazione: app_users.organization_id e' quella
// "di origine" ed e' anche l'unica su cui questo endpoint opera. Il ruolo
// viene mantenuto sincronizzato anche su organization_memberships, che e'
// la fonte usata da _auth.js per autorizzare le richieste — cosi' i due non
// divergono anche se la UI non gestisce ancora piu' organizzazioni per utente.

function normalizeUser(body = {}) {
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = ROLE_SET.has(body.role) ? body.role : "Buyer";

  if (!fullName) throw new Error("Nome utente obbligatorio.");
  if (!email || !email.includes("@")) throw new Error("Email utente non valida.");

  return {
    full_name: fullName,
    email,
    role,
    active: body.active !== false,
    receives_daily_report: Boolean(body.receivesDailyReport),
    can_manage_settings: Boolean(body.canManageSettings),
    notes: String(body.notes || "").trim() || null
  };
}

function mapUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    active: Boolean(row.active),
    receivesDailyReport: Boolean(row.receives_daily_report),
    canManageSettings: Boolean(row.can_manage_settings),
    lastLoginAt: row.last_login_at,
    notes: row.notes,
    hasSecureAccess: Boolean(row.auth_user_id)
  };
}

async function inviteSecureUser(profile, request) {
  const { url, serviceKey } = getSupabaseConfig();
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const protocol = String(request.headers?.["x-forwarded-proto"] || "https");
  const host = request.headers?.host;
  const redirectTo = process.env.PUBLIC_APP_URL || (host ? `${protocol}://${host}` : undefined);
  const { data, error } = await client.auth.admin.inviteUserByEmail(profile.email, {
    redirectTo,
    data: { full_name: profile.full_name }
  });
  if (error) throw new Error(`Invito Supabase non riuscito: ${error.message}`);
  return data.user;
}

// Tiene allineata la membership (fonte di autorizzazione in _auth.js) al
// ruolo/stato gestiti da questo endpoint. Un solo tenant per utente nel
// pilota attuale -> is_default sempre true.
async function upsertMembership({ organizationId, appUserId, role, active }) {
  const existing = await supabaseRequest(
    `organization_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&app_user_id=eq.${encodeURIComponent(appUserId)}&select=id&limit=1`
  );
  if (existing?.[0]) {
    await supabaseRequest(`organization_memberships?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: "PATCH",
      body: { role, active, updated_at: new Date().toISOString() }
    });
    return;
  }
  await supabaseRequest("organization_memberships", {
    method: "POST",
    body: { organization_id: organizationId, app_user_id: appUserId, role, active, is_default: true }
  });
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin"] });
  if (!user) return;
  try {
    if (request.method === "GET") {
      const rows = await supabaseRequest(`app_users?select=*&${orgFilter(user.organizationId)}&order=full_name.asc`);
      response.status(200).json({ users: rows.map(mapUser) });
      return;
    }

    if (request.method === "POST") {
      const normalized = normalizeUser(request.body);

      // Lookup SOLO dentro il tenant corrente: un'email gia' usata in
      // un'altra organizzazione non deve essere ne' letta ne' sovrascritta
      // da qui (app_users.email resta globale, ma questo endpoint non
      // gestisce ancora l'adesione di un'identita' esistente a un secondo
      // tenant — fuori scope per il pilota a singola organizzazione).
      const existingInOrg = await supabaseRequest(
        `app_users?select=id,auth_user_id&email=eq.${encodeURIComponent(normalized.email)}&${orgFilter(user.organizationId)}&limit=1`
      );

      if (!existingInOrg.length) {
        const existingElsewhere = await supabaseRequest(`app_users?select=id&email=eq.${encodeURIComponent(normalized.email)}&limit=1`);
        if (existingElsewhere.length) {
          response.status(409).json({ error: "Questa email e' gia' registrata in un'altra organizzazione." });
          return;
        }
      }

      let authUserId = existingInOrg?.[0]?.auth_user_id || null;
      if (usesSecureAuth() && !authUserId) {
        const invited = await inviteSecureUser(normalized, request);
        authUserId = invited.id;
      }
      const secureNormalized = authUserId ? { ...normalized, auth_user_id: authUserId } : normalized;

      let savedUser;
      if (existingInOrg.length) {
        const rows = await supabaseRequest(`app_users?id=eq.${encodeURIComponent(existingInOrg[0].id)}&${orgFilter(user.organizationId)}`, {
          method: "PATCH",
          body: secureNormalized,
          headers: { Prefer: "return=representation" }
        });
        savedUser = rows[0];
      } else {
        const rows = await supabaseRequest("app_users", {
          method: "POST",
          body: withOrg(secureNormalized, user.organizationId),
          headers: { Prefer: "return=representation" }
        });
        savedUser = rows[0];
      }

      await upsertMembership({
        organizationId: user.organizationId,
        appUserId: savedUser.id,
        role: normalized.role,
        active: normalized.active
      });

      response.status(existingInOrg.length ? 200 : 201).json({ user: mapUser(savedUser) });
      return;
    }

    if (request.method === "PATCH") {
      const { id } = request.body || {};
      if (!id) {
        response.status(400).json({ error: "Missing user id." });
        return;
      }

      const normalized = normalizeUser(request.body);
      const rows = await supabaseRequest(`app_users?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
        method: "PATCH",
        body: normalized,
        headers: { Prefer: "return=representation" }
      });
      if (!rows?.[0]) {
        response.status(404).json({ error: "User not found." });
        return;
      }

      await upsertMembership({
        organizationId: user.organizationId,
        appUserId: rows[0].id,
        role: normalized.role,
        active: normalized.active
      });

      response.status(200).json({ user: mapUser(rows[0]) });
      return;
    }

    response.setHeader("Allow", "GET, POST, PATCH");
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    response.status(500).json({ error: "Unable to manage users", detail: error.message });
  }
}
