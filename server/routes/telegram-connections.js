import crypto from "node:crypto";
import { authorizeApiRequest } from "../lib/_auth.js";
import { orgFilter, supabaseRequest, withOrg } from "../lib/_supabaseRest.js";

function pairingHash(code) {
  const secret = process.env.TELEGRAM_PAIRING_SECRET || process.env.SUPABASE_SERVICE_KEY;
  return crypto.createHmac("sha256", secret).update(String(code).trim().toUpperCase()).digest("hex");
}

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join("");
}

async function telegramStatus(organizationId) {
  const filter = orgFilter(organizationId);
  const [connections, submissions, settings] = await Promise.all([
    supabaseRequest(`telegram_connections?${filter}&select=id,telegram_username,display_name,status,connected_at,last_seen_at&order=connected_at.desc&limit=30`),
    supabaseRequest(`telegram_ddt_submissions?${filter}&select=id,status,delivery_note_id,error_detail,created_at&order=created_at.desc&limit=20`),
    supabaseRequest(`settings?${filter}&key=eq.receiving.telegram_bot_username&select=value&limit=1`)
  ]);
  return {
    connections: connections || [],
    submissions: submissions || [],
    botUsername: settings?.[0]?.value || process.env.TELEGRAM_BOT_USERNAME || null
  };
}

async function createPairingCode(user) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await supabaseRequest("telegram_pairing_codes", {
    method: "POST",
    body: withOrg({
      membership_id: user.membershipId || null,
      code_hash: pairingHash(code),
      expires_at: expiresAt
    }, user.organizationId)
  });
  return { code, expiresAt };
}

async function revokeConnection(id, user) {
  if (!id) throw Object.assign(new Error("Collegamento Telegram non indicato."), { statusCode: 400 });
  const rows = await supabaseRequest(`telegram_connections?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}&select=id&limit=1`);
  if (!rows?.[0]) throw Object.assign(new Error("Collegamento Telegram non trovato."), { statusCode: 404 });
  await supabaseRequest(`telegram_connections?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
    method: "PATCH",
    body: { status: "revoked", revoked_at: new Date().toISOString() }
  });
}

export default async function handler(request, response) {
  const roles = request.method === "GET"
    ? ["Owner", "IT", "Admin", "Buyer", "ReadOnly"]
    : ["Owner", "IT", "Admin", "Buyer"];
  const user = await authorizeApiRequest(request, response, { roles });
  if (!user) return;

  try {
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET") {
      response.status(200).json(await telegramStatus(user.organizationId));
      return;
    }
    if (request.method === "POST") {
      const action = request.body?.action;
      if (action === "pair") {
        response.status(200).json({ ...(await telegramStatus(user.organizationId)), pairing: await createPairingCode(user) });
        return;
      }
      if (action === "revoke") {
        await revokeConnection(request.body?.id, user);
        response.status(200).json(await telegramStatus(user.organizationId));
        return;
      }
      throw Object.assign(new Error("Azione Telegram non supportata."), { statusCode: 400 });
    }
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: "Configurazione Telegram non disponibile", detail: error.message });
  }
}

