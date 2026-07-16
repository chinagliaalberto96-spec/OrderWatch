import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_KEY sono obbligatorie.");

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const ids = { organizations: [], projects: [] };

async function insert(table, payload) {
  const { data, error } = await db.from(table).insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

function responseMock() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    }
  };
}

async function call(handler, method, body = {}) {
  const response = responseMock();
  await handler({ method, body, headers: {}, query: {} }, response);
  return response;
}

try {
  const organizationA = await insert("organizations", {
    slug: `contractwatch-api-a-${stamp}`,
    name: "ContractWatch API A",
    status: "active",
    auth_mode: "legacy"
  });
  const organizationB = await insert("organizations", {
    slug: `contractwatch-api-b-${stamp}`,
    name: "ContractWatch API B",
    status: "active",
    auth_mode: "legacy"
  });
  ids.organizations.push(organizationA.id, organizationB.id);

  await db.from("settings").insert([
    { organization_id: organizationA.id, key: "modules.contract_watch", value: "true", type: "boolean", group: "modules", customer_visible: false, status: "active" },
    { organization_id: organizationB.id, key: "modules.contract_watch", value: "true", type: "boolean", group: "modules", customer_visible: false, status: "active" }
  ]).throwOnError();

  const foreignProject = await insert("projects", {
    organization_id: organizationB.id,
    project_code: `CW-B-${stamp}`,
    name: "Commessa tenant B",
    status: "Aperto",
    contract_status: "active",
    contract_watch_enabled: true
  });
  ids.projects.push(foreignProject.id);

  process.env.AUTH_MODE = "legacy";
  process.env.LEGACY_ORGANIZATION_SLUG = organizationA.slug;
  const { default: handler } = await import(`../api/contract-projects.js?test=${stamp}`);

  const created = await call(handler, "POST", {
    projectCode: `CW-A-${stamp}`,
    name: "Commessa tenant A"
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.payload));
  ids.projects.push(created.payload.project.id);
  assert.equal(created.payload.project.organization_id, organizationA.id);
  assert.equal(created.payload.project.contract_status, "draft");

  const updated = await call(handler, "PATCH", {
    id: created.payload.project.id,
    name: "Commessa tenant A aggiornata",
    contractStatus: "active"
  });
  assert.equal(updated.statusCode, 200, JSON.stringify(updated.payload));
  assert.equal(updated.payload.project.name, "Commessa tenant A aggiornata");

  const archived = await call(handler, "PATCH", {
    id: created.payload.project.id,
    archived: true
  });
  assert.equal(archived.statusCode, 200, JSON.stringify(archived.payload));
  assert.equal(archived.payload.project.contract_status, "active");
  assert.equal(archived.payload.project.status, "Aperto");
  assert.ok(archived.payload.project.archived_at);

  const restored = await call(handler, "PATCH", {
    id: created.payload.project.id,
    archived: false
  });
  assert.equal(restored.statusCode, 200, JSON.stringify(restored.payload));
  assert.equal(restored.payload.project.contract_status, "active");
  assert.equal(restored.payload.project.status, "Aperto");
  assert.equal(restored.payload.project.archived_at, null);

  const { data: contractActivities, error: activitiesError } = await db
    .from("activities")
    .select("entity_type,entity_id,action,actor_membership_id,metadata")
    .eq("organization_id", organizationA.id)
    .eq("entity_id", created.payload.project.id)
    .order("date", { ascending: true });
  if (activitiesError) throw activitiesError;
  assert.deepEqual(contractActivities.map((activity) => activity.action), ["created", "updated", "archived", "restored"]);
  for (const activity of contractActivities) {
    assert.equal(activity.entity_type, "project");
    assert.equal(activity.entity_id, created.payload.project.id);
    assert.ok(Array.isArray(activity.metadata?.changed_fields));
  }

  const crossTenantUpdate = await call(handler, "PATCH", {
    id: foreignProject.id,
    name: "Tentativo non consentito"
  });
  assert.equal(crossTenantUpdate.statusCode, 404);

  await db.from("settings")
    .update({ value: "false" })
    .eq("organization_id", organizationA.id)
    .eq("key", "modules.contract_watch")
    .throwOnError();

  const disabled = await call(handler, "POST", {
    projectCode: `CW-DISABLED-${stamp}`,
    name: "Non deve essere creata"
  });
  assert.equal(disabled.statusCode, 403);

  const { count: disabledCount, error: disabledCountError } = await db
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationA.id)
    .eq("project_code", `CW-DISABLED-${stamp}`);
  if (disabledCountError) throw disabledCountError;
  assert.equal(disabledCount, 0);

  console.log("ContractWatch API module and isolation test: OK");
} finally {
  if (ids.projects.length) await db.from("projects").delete().in("id", ids.projects).throwOnError();
  if (ids.organizations.length) await db.from("activities").delete().in("organization_id", ids.organizations).throwOnError();
  if (ids.organizations.length) await db.from("settings").delete().in("organization_id", ids.organizations).throwOnError();
  if (ids.organizations.length) await db.from("organizations").delete().in("id", ids.organizations).throwOnError();
}
