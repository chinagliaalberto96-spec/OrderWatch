export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Supabase configuration missing.");
  }

  return { url, serviceKey };
}

// CANCELLO 2 — helper di isolamento multi-tenant, ad uso di tutti gli
// endpoint che chiamano supabaseRequest() direttamente (non tramite
// supabaseServerAdapter.js). organizationId arriva SEMPRE dal contesto
// server (user.organizationId da api/_auth.js), mai da un parametro client.
//
// orgFilter(id) -> frammento query da appendere a un path per limitare
// SELECT/UPDATE/DELETE alle sole righe del tenant.
// withOrg(body, id) -> body con organization_id impostato/sovrascritto per
// un INSERT (ignora qualunque organization_id eventualmente gia' presente).
export function orgFilter(organizationId) {
  if (!organizationId) throw new Error("Missing organization context.");
  return `organization_id=eq.${encodeURIComponent(organizationId)}`;
}

export function withOrg(body, organizationId) {
  if (!organizationId) throw new Error("Missing organization context.");
  const { organization_id: _ignoredClientValue, ...rest } = body || {};
  return { ...rest, organization_id: organizationId };
}

/**
 * Recognizes a legacy Supabase service_role key, which is a JWT: three
 * base64url segments separated by dots, the header segment starting with the
 * "eyJ" that base64url-encodes '{"'. Deliberately conservative -- an opaque
 * string that is merely "not sb_secret_" is NOT treated as a legacy JWT, so
 * an unrecognized key never gets sent as a Bearer credential. The payload is
 * never decoded or inspected.
 */
export function isLegacyServiceRoleJwt(key) {
  return /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(key || ""));
}

/**
 * Project authentication headers for the two key generations supported
 * during the migration window:
 *
 *   NEW  sb_secret_...  -> apikey only. These keys are opaque, not JWTs, and
 *                          must never be sent as Authorization Bearer.
 *   LEGACY service_role -> apikey + Authorization Bearer (the same JWT).
 *                          Legacy service_role semantics, including RLS
 *                          bypass, depend on the Bearer form, so it is
 *                          preserved until configuration is migrated.
 *
 * Anything unrecognized is treated as the safer new-key case (apikey only).
 */
function projectAuthHeaders(serviceKey) {
  return isLegacyServiceRoleJwt(serviceKey)
    ? { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    : { apikey: serviceKey };
}

/**
 * Drops any caller-supplied header that would place the project/service key
 * into an Authorization credential, under any header-name casing. No runtime
 * caller supplies Authorization today (all 51 header-passing call sites pass
 * only Prefer), and no user-scoped Authorization mechanism flows through this
 * client -- server/lib/_auth.js sends the end-user JWT on its own fetch. An
 * Authorization header carrying some other value is left untouched, so this
 * cannot break a future user-scoped mechanism.
 */
function stripServiceKeyAuthorization(headers, serviceKey) {
  const safe = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (name.toLowerCase() === "authorization" && String(value).includes(serviceKey)) continue;
    safe[name] = value;
  }
  return safe;
}

export async function supabaseRequest(path, { method = "GET", body, headers = {} } = {}) {
  const { url, serviceKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...stripServiceKeyAuthorization(headers, serviceKey),
      ...projectAuthHeaders(serviceKey)
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase request failed: ${response.status} ${detail.slice(0, 240)}`);
  }

  // PostgREST risponde spesso 200/201 con body vuoto (senza Prefer:
  // return=representation): il parse va tentato solo se c'e' contenuto.
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}
