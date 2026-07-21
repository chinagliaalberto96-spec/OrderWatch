import { getSupabaseConfig, supabaseRequest } from "./_supabaseRest.js";
import { sanitizeSecurityError } from "./_securityRedaction.js";

const ROLE_SET = new Set(["Owner", "IT", "Admin", "Buyer", "ReadOnly"]);

// Tenant legacy disponibile esclusivamente per sviluppo/manutenzione locale.
// In produzione l'autenticazione Supabase e' obbligatoria e il tenant non
// deriva mai da un parametro passato dal browser.
const LEGACY_ORGANIZATION_SLUG = process.env.LEGACY_ORGANIZATION_SLUG || "graphic-center";

let legacyOrgCache = null;

export function usesSecureAuth() {
  return String(process.env.AUTH_MODE || "").trim() === "supabase";
}

// Detect production-like environments. Treat as production when any indicator is set.
export function isProductionEnv(env = process.env) {
  const node = String(env.NODE_ENV || "").toLowerCase();
  const vercel = String(env.VERCEL_ENV || "").toLowerCase();
  const railwayDeployment = String(env.RAILWAY_DEPLOYMENT_ID || "").trim();
  const railwayEnvironment = String(env.RAILWAY_ENVIRONMENT_ID || "").trim();
  return node === "production" || vercel === "production" || Boolean(railwayDeployment || railwayEnvironment);
}

// Legacy auth is allowed only when NOT in production and ALLOW_LEGACY_AUTH is explicitly true.
export function allowLegacyAuth() {
  return !isProductionEnv() && String(process.env.ALLOW_LEGACY_AUTH || "").toLowerCase() === "true";
}

async function loadOrganizationBySlug(slug) {
  const rows = await supabaseRequest(`organizations?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`);
  return rows?.[0] || null;
}

function mapOrganization(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    displayName: row.display_name || row.name,
    status: row.status,
    authMode: row.auth_mode,
    timezone: row.timezone,
    locale: row.locale
  };
}

// Risoluzione tenant legacy: SOLO da configurazione server-side (env/slug
// fisso), mai da un valore fornito dal client. Cache in memoria di processo:
// non cambia tra una richiesta e l'altra, evita una query ripetuta ad ogni
// invocazione della stessa istanza serverless.
async function resolveLegacyOrganization() {
  if (legacyOrgCache) return legacyOrgCache;
  const row = await loadOrganizationBySlug(LEGACY_ORGANIZATION_SLUG);
  if (!row) {
    throw new Error(`Tenant legacy "${LEGACY_ORGANIZATION_SLUG}" non trovato in organizations.`);
  }
  legacyOrgCache = mapOrganization(row);
  return legacyOrgCache;
}

// Ogni deployment sicuro e' vincolato server-side a un solo tenant. Lo slug
// non arriva mai dal browser: in questo modo la stessa identita' puo' avere
// membership in piu' aziende senza poter scegliere o falsificare il tenant.
function secureOrganizationSlug() {
  return String(process.env.APP_ORGANIZATION_SLUG || "").trim().toLowerCase();
}

async function resolveMembership(appUserId, organizationId) {
  const memberships = await supabaseRequest(
    `organization_memberships?app_user_id=eq.${encodeURIComponent(appUserId)}&organization_id=eq.${encodeURIComponent(organizationId)}&active=eq.true&select=*&limit=1`
  );
  return memberships?.[0] || null;
}

export async function requireApiUser(request, response, { roles, requireSecureAuth = false } = {}) {
  const authMode = String(process.env.AUTH_MODE || "").trim();
  const prod = isProductionEnv();
  if (prod) {
    if (!authMode) {
      response.status(500).json({ error: "AUTH_MODE must be configured in production." });
      return null;
    }
    if (authMode !== "supabase") {
      response.status(500).json({ error: "Unsupported AUTH_MODE in production." });
      return null;
    }
  }

  if (requireSecureAuth && !usesSecureAuth()) {
    response.status(401).json({ error: "Autenticazione sicura richiesta." });
    return null;
  }

  if (!usesSecureAuth()) {
    if (!allowLegacyAuth()) {
      response.status(401).json({ error: "Legacy authentication is disabled in this environment." });
      return null;
    }
    const organization = await resolveLegacyOrganization();
    const configuredMembershipId = String(process.env.LEGACY_ACTOR_MEMBERSHIP_ID || "").trim();
    let legacyMembership = null;
    if (configuredMembershipId) {
      const rows = await supabaseRequest(
        `organization_memberships?id=eq.${encodeURIComponent(configuredMembershipId)}&organization_id=eq.${encodeURIComponent(organization.id)}&active=eq.true&select=id,app_user_id,role&limit=1`
      );
      legacyMembership = rows?.[0] || null;
      if (!legacyMembership) {
        response.status(403).json({ error: "Membership legacy configurata non valida per questa organizzazione." });
        return null;
      }
    }
    return {
      id: legacyMembership?.app_user_id || "legacy-graphic-center",
      membershipId: legacyMembership?.id || null,
      authUserId: null,
      email: "legacy@graphic-center.local",
      fullName: "Graphic Center",
      role: legacyMembership?.role || "Owner",
      legacy: true,
      organizationId: organization.id,
      organizationSlug: organization.slug,
      organizationName: organization.displayName
    };
  }

  const token = bearerToken(request.headers?.authorization);
  if (!token) {
    response.status(401).json({ error: "Sessione mancante. Accedi nuovamente." });
    return null;
  }

  const { url, serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) {
    response.status(500).json({ error: "Supabase configuration incomplete." });
    return null;
  }
  const authResponse = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${token}`
    }
  });
  if (!authResponse.ok) {
    response.status(401).json({ error: "Sessione scaduta o non valida." });
    return null;
  }

  const authUser = await authResponse.json();
  const rows = await supabaseRequest(
    `app_users?select=*&or=(auth_user_id.eq.${encodeURIComponent(authUser.id)},email.eq.${encodeURIComponent(String(authUser.email || "").toLowerCase())})&limit=1`
  );
  const profile = rows?.[0];
  if (!profile || !profile.active) {
    response.status(403).json({ error: "Utente non autorizzato per questo pilota." });
    return null;
  }

  if (!profile.auth_user_id) {
    await supabaseRequest(`app_users?id=eq.${encodeURIComponent(profile.id)}`, {
      method: "PATCH",
      body: { auth_user_id: authUser.id },
      headers: { Prefer: "return=minimal" }
    });
  }

  const organizationSlug = secureOrganizationSlug();
  if (!organizationSlug) {
    response.status(500).json({ error: "Tenant applicativo non configurato." });
    return null;
  }
  const organization = mapOrganization(await loadOrganizationBySlug(organizationSlug));
  if (!organization) {
    response.status(500).json({ error: "Tenant applicativo non trovato." });
    return null;
  }

  // L'organizzazione e il ruolo derivano ESCLUSIVAMENTE dalla membership
  // attiva per il tenant del deployment, mai da user_metadata o da input
  // del client. Un utente senza quella membership non puo' operare.
  const membership = await resolveMembership(profile.id, organization.id);
  if (!membership) {
    response.status(403).json({ error: "Nessuna organizzazione associata a questo utente." });
    return null;
  }

  if (organization.status === "suspended" || organization.status === "archived") {
    response.status(403).json({ error: "Organizzazione non attiva." });
    return null;
  }

  const role = ROLE_SET.has(membership.role) ? membership.role : "ReadOnly";
  if (roles?.length && !roles.includes(role)) {
    response.status(403).json({ error: "Non hai i permessi necessari per questa operazione." });
    return null;
  }

  return {
    id: profile.id,
    membershipId: membership.id,
    authUserId: authUser.id,
    email: profile.email,
    fullName: profile.full_name,
    role,
    canManageSettings: Boolean(profile.can_manage_settings),
    isPlatformAdmin: Boolean(profile.is_platform_admin),
    legacy: false,
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.displayName
  };
}

export async function authorizeApiRequest(request, response, options) {
  try {
    return await requireApiUser(request, response, options);
  } catch (error) {
    console.warn("[auth] verifica autorizzazione non disponibile:", sanitizeSecurityError(error));
    response.status(500).json({ error: "Verifica autorizzazione non disponibile." });
    return null;
  }
}

function bearerToken(value) {
  const match = String(value || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
