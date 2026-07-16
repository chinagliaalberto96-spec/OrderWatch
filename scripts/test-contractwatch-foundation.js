import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdapter } from "../src/adapters/supabaseServerAdapter.js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL e SUPABASE_SERVICE_KEY sono obbligatorie.");

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const ids = { organizations: [], users: [], memberships: [], projects: [] };

async function insert(table, payload) {
  const { data, error } = await db.from(table).insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

try {
  const organizationA = await insert("organizations", {
    slug: `contractwatch-test-a-${stamp}`,
    name: "ContractWatch Test A",
    status: "active",
    auth_mode: "supabase"
  });
  const organizationB = await insert("organizations", {
    slug: `contractwatch-test-b-${stamp}`,
    name: "ContractWatch Test B",
    status: "active",
    auth_mode: "supabase"
  });
  ids.organizations.push(organizationA.id, organizationB.id);

  const userA = await insert("app_users", {
    organization_id: organizationA.id,
    full_name: "ContractWatch User A",
    email: `contractwatch-a-${stamp}@orderwatch.local`,
    role: "Admin",
    active: true
  });
  const userB = await insert("app_users", {
    organization_id: organizationB.id,
    full_name: "ContractWatch User B",
    email: `contractwatch-b-${stamp}@orderwatch.local`,
    role: "Admin",
    active: true
  });
  ids.users.push(userA.id, userB.id);

  const membershipA = await insert("organization_memberships", {
    organization_id: organizationA.id,
    app_user_id: userA.id,
    role: "Admin",
    active: true,
    is_default: true
  });
  const membershipB = await insert("organization_memberships", {
    organization_id: organizationB.id,
    app_user_id: userB.id,
    role: "Admin",
    active: true,
    is_default: true
  });
  ids.memberships.push(membershipA.id, membershipB.id);

  const sharedCode = `CW-${stamp}`;
  const projectA = await insert("projects", {
    organization_id: organizationA.id,
    project_code: sharedCode,
    name: "Commessa A",
    status: "Aperto",
    contract_status: "active",
    contract_watch_enabled: true,
    responsible_membership_id: membershipA.id,
    created_by_membership_id: membershipA.id
  });
  const projectB = await insert("projects", {
    organization_id: organizationB.id,
    project_code: sharedCode,
    name: "Commessa B",
    status: "Aperto",
    contract_status: "active",
    contract_watch_enabled: true,
    responsible_membership_id: membershipB.id,
    created_by_membership_id: membershipB.id
  });
  ids.projects.push(projectA.id, projectB.id);

  const orderWatchProject = await insert("projects", {
    organization_id: organizationA.id,
    project_code: `OW-${stamp}`,
    status: "Aperto"
  });
  ids.projects.push(orderWatchProject.id);
  assert.equal(orderWatchProject.contract_watch_enabled, false);
  assert.equal(orderWatchProject.contract_status, null);

  const adapterA = createSupabaseAdapter({ url, serviceKey, organizationId: organizationA.id });
  const visibleToA = await adapterA.getProjects();
  assert.equal(visibleToA.some((project) => project.id === projectA.id), true);
  assert.equal(visibleToA.some((project) => project.id === projectB.id), false);

  const { error: crossTenantError } = await db.from("projects").insert({
    organization_id: organizationA.id,
    project_code: `CW-X-${stamp}`,
    name: "Relazione non valida",
    contract_status: "draft",
    contract_watch_enabled: true,
    responsible_membership_id: membershipB.id
  });
  assert.ok(crossTenantError, "Una membership di un altro tenant deve essere rifiutata.");

  const { error: invalidDatesError } = await db.from("projects").insert({
    organization_id: organizationA.id,
    project_code: `CW-D-${stamp}`,
    name: "Date non valide",
    contract_status: "draft",
    contract_watch_enabled: true,
    start_date: "2026-07-20",
    expected_end_date: "2026-07-10"
  });
  assert.ok(invalidDatesError, "La fine prevista precedente all'inizio deve essere rifiutata.");

  const { error: missingContractStatusError } = await db.from("projects").insert({
    organization_id: organizationA.id,
    project_code: `CW-NULL-${stamp}`,
    name: "Commessa senza stato",
    contract_watch_enabled: true
  });
  assert.ok(missingContractStatusError, "Una commessa ContractWatch senza stato deve essere rifiutata.");

  const { error: archivedContractStatusError } = await db.from("projects").insert({
    organization_id: organizationA.id,
    project_code: `CW-ARCHIVED-${stamp}`,
    name: "Archiviazione usata come stato",
    contract_status: "archived",
    contract_watch_enabled: true
  });
  assert.ok(archivedContractStatusError, "L'archiviazione non deve essere uno stato operativo.");

  const structuredActivity = await insert("activities", {
    organization_id: organizationA.id,
    title: "Commessa verificata",
    type: "ContractWatch",
    project_code: projectA.project_code,
    entity_type: "project",
    entity_id: projectA.id,
    action: "updated",
    actor_membership_id: membershipA.id,
    metadata: { changed_fields: ["name"] }
  });
  assert.equal(structuredActivity.actor_membership_id, membershipA.id);
  assert.deepEqual(structuredActivity.metadata.changed_fields, ["name"]);

  const { error: crossTenantActorError } = await db.from("activities").insert({
    organization_id: organizationA.id,
    title: "Autore non valido",
    type: "ContractWatch",
    entity_type: "project",
    entity_id: projectA.id,
    action: "updated",
    actor_membership_id: membershipB.id,
    metadata: { changed_fields: ["name"] }
  });
  assert.ok(crossTenantActorError, "L'autore dell'attività deve appartenere allo stesso tenant.");

  console.log("ContractWatch foundation isolation test: OK");
} finally {
  if (ids.projects.length) await db.from("projects").delete().in("id", ids.projects).throwOnError();
  if (ids.organizations.length) await db.from("activities").delete().in("organization_id", ids.organizations).throwOnError();
  if (ids.organizations.length) await db.from("settings").delete().in("organization_id", ids.organizations).throwOnError();
  if (ids.memberships.length) await db.from("organization_memberships").delete().in("id", ids.memberships).throwOnError();
  if (ids.users.length) await db.from("app_users").delete().in("id", ids.users).throwOnError();
  if (ids.organizations.length) await db.from("organizations").delete().in("id", ids.organizations).throwOnError();
}
