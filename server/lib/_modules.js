import { orgFilter, supabaseRequest } from "./_supabaseRest.js";

export async function organizationModuleEnabled(organizationId, moduleKey) {
  const normalizedKey = String(moduleKey || "").trim().toLowerCase();
  if (!normalizedKey) return false;

  const rows = await supabaseRequest(
    `settings?key=eq.modules.${encodeURIComponent(normalizedKey)}&${orgFilter(organizationId)}&status=eq.active&select=value&limit=1`
  );

  return String(rows?.[0]?.value || "").toLowerCase() === "true";
}

export async function requireOrganizationModule(response, organizationId, moduleKey) {
  if (await organizationModuleEnabled(organizationId, moduleKey)) return true;

  response.status(403).json({
    error: `Il modulo ${moduleKey} non è abilitato per questa organizzazione.`
  });
  return false;
}
