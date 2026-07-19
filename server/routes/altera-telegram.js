import crypto from "node:crypto";
import { askAltera } from "./altera.js";
import { orgFilter, supabaseRequest } from "../lib/_supabaseRest.js";

const ALLOWED_ROLES = new Set(["Owner", "IT", "Admin", "Buyer", "ReadOnly"]);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function internalSecret(request) {
  return request.headers?.["x-orderwatch-internal-secret"];
}

async function loadTelegramUser(connectionId) {
  const connections = await supabaseRequest(
    `telegram_connections?id=eq.${encodeURIComponent(connectionId)}&status=eq.active&select=*&limit=1`
  );
  const connection = connections?.[0];
  if (!connection) throw Object.assign(new Error("Collegamento Telegram non attivo."), { statusCode: 403 });

  const organizations = await supabaseRequest(
    `organizations?id=eq.${encodeURIComponent(connection.organization_id)}&select=id,slug,name,display_name,status&limit=1`
  );
  const organization = organizations?.[0];
  if (!organization || ["suspended", "archived"].includes(organization.status)) {
    throw Object.assign(new Error("Organizzazione non attiva."), { statusCode: 403 });
  }

  let membership = null;
  let profile = null;
  if (connection.membership_id) {
    const memberships = await supabaseRequest(
      `organization_memberships?id=eq.${encodeURIComponent(connection.membership_id)}&organization_id=eq.${encodeURIComponent(connection.organization_id)}&active=eq.true&select=*&limit=1`
    );
    membership = memberships?.[0];
    if (!membership) throw Object.assign(new Error("Accesso OrderWatch non più attivo."), { statusCode: 403 });
    if (membership.app_user_id) {
      const profiles = await supabaseRequest(
        `app_users?id=eq.${encodeURIComponent(membership.app_user_id)}&active=eq.true&select=*&limit=1`
      );
      profile = profiles?.[0];
      if (!profile) throw Object.assign(new Error("Utente OrderWatch non più attivo."), { statusCode: 403 });
    }
  }

  const legacy = !profile;
  return {
    connection,
    user: {
      id: profile?.id || `telegram-${connection.id}`,
      membershipId: membership?.id || connection.membership_id || null,
      email: profile?.email || null,
      fullName: profile?.full_name || connection.display_name || "Utente Telegram",
      role: ALLOWED_ROLES.has(membership?.role) ? membership.role : "ReadOnly",
      legacy,
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationName: organization.display_name || organization.name
    }
  };
}

export default async function handler(request, response) {
  try {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      response.status(405).json({ error: "Method not allowed" });
      return;
    }

    if (!safeEqual(internalSecret(request), process.env.ORDERWATCH_INTERNAL_SECRET)) {
      response.status(401).json({ error: "Chiamata interna non autorizzata." });
      return;
    }

    const connectionId = String(request.body?.connectionId || "").trim();
    if (!connectionId) {
      response.status(400).json({ error: "Collegamento Telegram mancante." });
      return;
    }

    const { connection, user } = await loadTelegramUser(connectionId);
    const result = await askAltera({
      question: request.body?.question,
      conversationId: connection.altera_conversation_id,
      user
    });

    if (result.conversation?.id !== connection.altera_conversation_id) {
      await supabaseRequest(
        `telegram_connections?id=eq.${encodeURIComponent(connection.id)}&${orgFilter(connection.organization_id)}`,
        { method: "PATCH", body: { altera_conversation_id: result.conversation.id } }
      );
    }

    response.status(200).json(result);
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: "Altera Telegram non disponibile",
      detail: error.message
    });
  }
}
