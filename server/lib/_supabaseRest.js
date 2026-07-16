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

export async function supabaseRequest(path, { method = "GET", body, headers = {} } = {}) {
  const { url, serviceKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...headers
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
