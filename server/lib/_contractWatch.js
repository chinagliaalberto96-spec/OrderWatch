import { orgFilter, supabaseRequest, withOrg } from "./_supabaseRest.js";

const WRITE_ROLES = new Set(["Owner", "IT", "Admin", "Buyer"]);

export function ensureContractWriter(user, response) {
  if (WRITE_ROLES.has(user.role)) return true;
  response.status(403).json({ error: "Non hai i permessi necessari per ContractWatch." });
  return false;
}

export function ensureActorMembership(user, response) {
  if (user.membershipId) return true;
  response.status(403).json({
    error: "ContractWatch richiede un utente autenticato con membership identificabile."
  });
  return false;
}

export function requiredText(value, label, max = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} è obbligatorio.`);
  if (normalized.length > max) throw new Error(`${label}: massimo ${max} caratteri.`);
  return normalized;
}

export function optionalText(value, label, max = 4000) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  if (normalized.length > max) throw new Error(`${label}: massimo ${max} caratteri.`);
  return normalized || null;
}

export function optionalDate(value, label) {
  if (value === null || value === undefined || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error(`${label} deve essere in formato YYYY-MM-DD.`);
  }
  return String(value);
}

export function numericValue(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} non valido.`);
  }
  return parsed;
}

export function currencyValue(value) {
  const normalized = String(value || "EUR").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("Valuta non valida.");
  return normalized;
}

export async function loadContractProject(projectId, organizationId, { allowArchived = true } = {}) {
  if (!projectId) throw new Error("Commessa mancante.");
  const archiveFilter = allowArchived ? "" : "&archived_at=is.null";
  const rows = await supabaseRequest(
    `projects?id=eq.${encodeURIComponent(projectId)}&contract_watch_enabled=eq.true${archiveFilter}&${orgFilter(organizationId)}&select=*&limit=1`
  );
  return rows?.[0] || null;
}

export async function recordContractActivity({ user, project, entityType, entityId, action, title, detail, changedFields = [], metadata = {} }) {
  await supabaseRequest("activities", {
    method: "POST",
    body: withOrg({
      title,
      type: "ContractWatch",
      detail,
      project_code: project?.project_code || null,
      entity_type: entityType,
      entity_id: entityId,
      action,
      actor_membership_id: user.membershipId,
      metadata: { changed_fields: changedFields, ...metadata }
    }, user.organizationId)
  });
}
