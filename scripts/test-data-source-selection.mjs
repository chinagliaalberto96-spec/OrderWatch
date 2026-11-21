// Prove offline della scelta della sorgente dati (dashboard e impostazioni).
// Solo valori sintetici: nessuna rete, nessuna credenziale reale, nessun dato reale.
// Ogni fetch passa da uno stub che risponde a host fittizi e rifiuta tutto il resto.
import assert from "node:assert/strict";

const SUPABASE_URL = "https://data-source-test.invalid";
const AIRTABLE_HOST = "api.airtable.com";
const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ORG_GC = "00000000-0000-4000-8000-0000000000c0";
const APP_USER = "00000000-0000-4000-8000-000000000001";
const AUTH_USER = "00000000-0000-4000-8000-000000000002";
const SETTING_ID = "00000000-0000-4000-8000-000000000003";
const ORGANIZATIONS = {
  "org-a-test": { id: ORG_A, slug: "org-a-test", name: "Azienda Sintetica A", status: "active" },
  "org-b-test": { id: ORG_B, slug: "org-b-test", name: "Azienda Sintetica B", status: "active" },
  "graphic-center": { id: ORG_GC, slug: "graphic-center", name: "Tenant storico sintetico", status: "active" }
};

// Isola le prove da qualunque variabile presente nella shell.
const BASE_ENV = {
  AUTH_MODE: "supabase",
  VERCEL_ENV: "production",
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY: "synthetic-service-key-not-a-secret",
  APP_ORGANIZATION_SLUG: "org-a-test",
  DATA_SOURCE: undefined,
  AIRTABLE_ORGANIZATION_SLUG: undefined,
  AIRTABLE_BASE_ID: undefined,
  AIRTABLE_API_KEY: undefined,
  ALLOW_LEGACY_AUTH: undefined
};
function setEnv(overrides = {}) {
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
setEnv();

const calls = [];
let memberships = new Set([ORG_A]);
const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = options.method || "GET";
  const call = { method, host: url.host, path: decodeURIComponent(url.pathname + url.search), body: options.body ? JSON.parse(options.body) : null };
  calls.push(call);

  if (url.host === AIRTABLE_HOST) {
    const table = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (method === "PATCH") return json(200, { id: "recSyntheticSetting", fields: { Value: "2" } });
    return json(200, { records: table === "Orders"
      ? [{ id: "recSyntheticOrder", fields: { "Order Code": "AIRTABLE-ONLY-ORDER" } }]
      : [] });
  }
  if (url.origin !== SUPABASE_URL) throw new Error(`Rete bloccata nelle prove: ${url.origin}`);

  if (url.pathname === "/auth/v1/user") {
    const auth = options.headers?.Authorization || "";
    return auth === "Bearer synthetic-session-token"
      ? json(200, { id: AUTH_USER, email: "utente-sintetico@example.test" })
      : json(401, { message: "invalid" });
  }
  const table = url.pathname.replace("/rest/v1/", "");
  const query = decodeURIComponent(url.search);
  if (table === "app_users") {
    return json(200, [{ id: APP_USER, auth_user_id: AUTH_USER, email: "utente-sintetico@example.test", full_name: "Utente Sintetico", active: true }]);
  }
  if (table === "organizations") {
    const slug = /slug=eq\.([^&]+)/.exec(query)?.[1];
    return json(200, ORGANIZATIONS[slug] ? [ORGANIZATIONS[slug]] : []);
  }
  if (table === "organization_memberships") {
    const organizationId = /organization_id=eq\.([^&]+)/.exec(query)?.[1];
    return json(200, memberships.has(organizationId)
      ? [{ id: `membership-${organizationId}`, app_user_id: APP_USER, organization_id: organizationId, role: "Owner", active: true }]
      : []);
  }
  if (table === "settings" && method === "PATCH") {
    return json(200, [{ id: SETTING_ID, key: "general.synthetic", value: call.body.value, type: "number", group: "general", status: "active", customer_visible: true }]);
  }
  if (table === "settings") {
    return json(200, [{ id: SETTING_ID, key: "general.synthetic", value: "1", type: "number", group: "general", status: "active", customer_visible: true }]);
  }
  if (method !== "GET") throw new Error(`Scrittura inattesa nelle prove: ${method} ${table}`);
  return json(200, []);
};

const { default: dashboardHandler } = await import("../api/dashboard.js");
const { default: adminHandler } = await import("../api/admin.js");
const { resolveDataSource, selectDataAdapter } = await import("../server/lib/_dataSource.js");

function responseMock() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}
function request(method, { query = {}, body, headers = {} } = {}) {
  return { method, query, body, headers: { authorization: "Bearer synthetic-session-token", ...headers } };
}
async function run(handler, req) {
  calls.length = 0;
  const response = responseMock();
  await handler(req, response);
  return { response, calls: [...calls] };
}
const AUTH_TABLES = /^\/rest\/v1\/(app_users|organizations|organization_memberships)\?/;
const airtableCalls = (list) => list.filter((call) => call.host === AIRTABLE_HOST);
const dataCalls = (list) => list.filter((call) => call.host !== AIRTABLE_HOST && call.path.startsWith("/rest/v1/") && !AUTH_TABLES.test(call.path));

const checks = [];
async function check(name, fn) {
  try {
    setEnv();
    memberships = new Set([ORG_A]);
    await fn();
    checks.push({ name, status: "PASS" });
  } catch (error) {
    checks.push({ name, status: "FAIL", error: error.message });
  }
}

// 1. Dashboard: il client non puo' scegliere Airtable quando il server usa Supabase.
await check("dashboard ignores ?source=airtable when the server source is Supabase", async () => {
  // Caso peggiore: credenziali e collegamento Airtable presenti, ma DATA_SOURCE non lo seleziona.
  for (const dataSource of [undefined, "supabase"]) {
    setEnv({ DATA_SOURCE: dataSource, AIRTABLE_ORGANIZATION_SLUG: "org-a-test",
      AIRTABLE_BASE_ID: "appSyntheticBase0", AIRTABLE_API_KEY: "synthetic-airtable-key-not-a-secret" });
    for (const source of ["airtable", "AIRTABLE", ["airtable"]]) {
      const { response, calls: made } = await run(dashboardHandler, request("GET", { query: { source } }));
      assert.equal(response.statusCode, 200, JSON.stringify(response.body));
      assert.equal(response.body.meta.dataSource, "supabase");
      assert.equal(airtableCalls(made).length, 0);
      assert.doesNotMatch(JSON.stringify(response.body), /AIRTABLE-ONLY-ORDER/);
      assert.ok(dataCalls(made).length > 0, "la dashboard deve leggere da Supabase");
    }
  }
});

// 2. Impostazioni: source in query o body non legge ne' modifica Airtable.
await check("settings ignore source in query and body and stay on Supabase", async () => {
  setEnv({ AIRTABLE_ORGANIZATION_SLUG: "org-a-test", AIRTABLE_BASE_ID: "appSyntheticBase0", AIRTABLE_API_KEY: "synthetic-airtable-key-not-a-secret" });
  for (const variant of [
    { query: { route: "settings", source: "airtable" }, body: { id: SETTING_ID, value: "2" } },
    { query: { route: "settings" }, body: { id: SETTING_ID, value: "2", source: "airtable" } },
    { query: { route: "settings", source: "airtable" }, body: { id: SETTING_ID, value: "2", source: "airtable", organization_id: ORG_B } }
  ]) {
    const { response, calls: made } = await run(adminHandler, request("PATCH", variant));
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(airtableCalls(made).length, 0);
    const read = dataCalls(made).find((call) => call.method === "GET" && call.path.startsWith("/rest/v1/settings?"));
    const write = dataCalls(made).find((call) => call.method === "PATCH");
    assert.match(read.path, new RegExp(`organization_id=eq\\.${ORG_A}`));
    assert.match(write.path, new RegExp(`^/rest/v1/settings\\?id=eq\\.${SETTING_ID}&organization_id=eq\\.${ORG_A}$`));
    assert.equal(write.body.organization_id, ORG_A);
    assert.equal("source" in write.body, false);
  }
});

// 3. Percorso Supabase: l'organizzazione deriva dalla membership autenticata.
await check("Supabase path scopes every data query to the membership organization", async () => {
  memberships = new Set([ORG_A, ORG_B]);
  const { response, calls: made } = await run(dashboardHandler, request("GET", {
    query: { source: "supabase", organizationId: ORG_B, organization_id: ORG_B, org: "org-b-test" },
    headers: { "x-organization-id": ORG_B, "x-organization-slug": "org-b-test" }
  }));
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.meta.organization.id, ORG_A);
  const data = dataCalls(made);
  assert.ok(data.length > 0);
  for (const call of data) {
    assert.match(call.path, new RegExp(`organization_id=eq\\.${ORG_A}`), call.path);
    assert.doesNotMatch(call.path, new RegExp(ORG_B), call.path);
  }
});

await check("a user without membership in the deployment organization gets no data", async () => {
  memberships = new Set([ORG_B]);
  const { response, calls: made } = await run(dashboardHandler, request("GET", { query: { source: "airtable" } }));
  assert.equal(response.statusCode, 403);
  assert.equal(dataCalls(made).length, 0);
  assert.equal(airtableCalls(made).length, 0);
});

// 4. Modalita' storica Airtable: solo con configurazione server esplicita e vincolata.
await check("Airtable without an explicit organization binding fails closed", async () => {
  setEnv({ DATA_SOURCE: "airtable", AIRTABLE_BASE_ID: "appSyntheticBase0", AIRTABLE_API_KEY: "synthetic-airtable-key-not-a-secret" });
  const { response, calls: made } = await run(dashboardHandler, request("GET", { query: { source: "airtable" } }));
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(airtableCalls(made).length, 0);
  assert.equal(dataCalls(made).length, 0);
});

await check("a deployment for another company that keeps Airtable credentials fails closed", async () => {
  // Deployment vincolato a org-a-test con configurazione Airtable del tenant storico.
  setEnv({ DATA_SOURCE: "airtable", AIRTABLE_ORGANIZATION_SLUG: "graphic-center",
    AIRTABLE_BASE_ID: "appSyntheticBase0", AIRTABLE_API_KEY: "synthetic-airtable-key-not-a-secret" });
  for (const [handler, req] of [
    [dashboardHandler, request("GET")],
    [adminHandler, request("PATCH", { query: { route: "settings" }, body: { id: SETTING_ID, value: "2" } })]
  ]) {
    const { response, calls: made } = await run(handler, req);
    assert.equal(response.statusCode, 503, JSON.stringify(response.body));
    assert.equal(airtableCalls(made).length, 0);
    assert.equal(dataCalls(made).length, 0);
  }
});

// Regressione: binding Airtable impostato per errore sullo slug dell'azienda B,
// con la base storica Graphic Center. Gli slug coincidono ma non sono Graphic Center.
await check("another company's deployment cannot enable Airtable by binding its own slug", async () => {
  memberships = new Set([ORG_B]);
  setEnv({ APP_ORGANIZATION_SLUG: "org-b-test", DATA_SOURCE: "airtable", AIRTABLE_ORGANIZATION_SLUG: "org-b-test",
    AIRTABLE_BASE_ID: "appSyntheticHistoricGC", AIRTABLE_API_KEY: "synthetic-airtable-key-not-a-secret" });
  for (const [handler, req] of [
    [dashboardHandler, request("GET")],
    [dashboardHandler, request("GET", { query: { source: "airtable" } })],
    [adminHandler, request("PATCH", { query: { route: "settings" }, body: { id: SETTING_ID, value: "2" } })]
  ]) {
    const { response, calls: made } = await run(handler, req);
    assert.equal(response.statusCode, 503, JSON.stringify(response.body));
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(airtableCalls(made).length, 0);
    assert.equal(dataCalls(made).length, 0);
  }
  assert.throws(
    () => selectDataAdapter({ organizationId: ORG_B, organizationSlug: "org-b-test" }),
    (error) => error.name === "DataSourceConfigError"
  );
});

await check("Airtable is used only by the explicitly bound server configuration, never by client choice", async () => {
  memberships = new Set([ORG_GC]);
  setEnv({ APP_ORGANIZATION_SLUG: "graphic-center", DATA_SOURCE: "airtable", AIRTABLE_ORGANIZATION_SLUG: "graphic-center",
    AIRTABLE_BASE_ID: "appSyntheticBase0", AIRTABLE_API_KEY: "synthetic-airtable-key-not-a-secret" });
  for (const source of [undefined, "supabase"]) {
    const { response, calls: made } = await run(dashboardHandler, request("GET", { query: source ? { source } : {} }));
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.body.meta.dataSource, "airtable");
    assert.equal(response.body.meta.organization.id, ORG_GC);
    assert.match(JSON.stringify(response.body.orders), /AIRTABLE-ONLY-ORDER/);
    assert.ok(airtableCalls(made).length > 0);
    assert.equal(dataCalls(made).length, 0, "nessuna lettura dati Supabase in modalita' storica");
  }
});

await check("Airtable binding without base credentials fails closed", async () => {
  memberships = new Set([ORG_GC]);
  setEnv({ APP_ORGANIZATION_SLUG: "graphic-center", DATA_SOURCE: "airtable", AIRTABLE_ORGANIZATION_SLUG: "graphic-center", AIRTABLE_BASE_ID: "appSyntheticBase0" });
  const { response, calls: made } = await run(dashboardHandler, request("GET"));
  assert.equal(response.statusCode, 503);
  assert.equal(airtableCalls(made).length, 0);
});

await check("an unknown server source fails closed instead of falling back", async () => {
  setEnv({ DATA_SOURCE: "airtabel" });
  const { response, calls: made } = await run(dashboardHandler, request("GET"));
  assert.equal(response.statusCode, 503);
  assert.equal(dataCalls(made).length, 0);
  assert.equal(airtableCalls(made).length, 0);
});

await check("the selector cannot receive a client override", async () => {
  setEnv({ AIRTABLE_ORGANIZATION_SLUG: "org-a-test", AIRTABLE_BASE_ID: "appSyntheticBase0", AIRTABLE_API_KEY: "synthetic-airtable-key-not-a-secret" });
  assert.equal(resolveDataSource("airtable"), "supabase");
  assert.equal(resolveDataSource({ DATA_SOURCE: "airtable", source: "supabase" }), "airtable");
  assert.throws(() => selectDataAdapter("airtable", ORG_A), TypeError);
  assert.equal(selectDataAdapter({ organizationId: ORG_A, organizationSlug: "org-a-test", source: "airtable" }).source, "supabase");
});

for (const item of checks) {
  console.log(`${item.status}  ${item.name}${item.error ? `: ${item.error}` : ""}`);
}
const failed = checks.filter((item) => item.status === "FAIL");
if (failed.length) process.exitCode = 1;
else console.log(`\n${checks.length}/${checks.length} data source selection checks passed.`);
