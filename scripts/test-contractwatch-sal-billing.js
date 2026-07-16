import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

function responseMock() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    setHeader(name, value) { this.headers[name] = value; }
  };
}

async function call(handler, method, body = {}, query = {}) {
  const response = responseMock();
  await handler({ method, body, query, headers: {} }, response);
  return response;
}

try {
  const organizationA = await insert("organizations", { slug: `contractwatch-sal-a-${stamp}`, name: "SAL tenant A", status: "active", auth_mode: "legacy" });
  const organizationB = await insert("organizations", { slug: `contractwatch-sal-b-${stamp}`, name: "SAL tenant B", status: "active", auth_mode: "legacy" });
  ids.organizations.push(organizationA.id, organizationB.id);

  const userA = await insert("app_users", { organization_id: organizationA.id, full_name: "SAL User A", email: `sal-a-${stamp}@test.local`, role: "Admin", active: true });
  const userB = await insert("app_users", { organization_id: organizationB.id, full_name: "SAL User B", email: `sal-b-${stamp}@test.local`, role: "Admin", active: true });
  ids.users.push(userA.id, userB.id);
  const membershipA = await insert("organization_memberships", { organization_id: organizationA.id, app_user_id: userA.id, role: "Admin", active: true, is_default: true });
  const membershipB = await insert("organization_memberships", { organization_id: organizationB.id, app_user_id: userB.id, role: "Admin", active: true, is_default: true });
  ids.memberships.push(membershipA.id, membershipB.id);

  await db.from("settings").insert([
    { organization_id: organizationA.id, key: "modules.contract_watch", value: "true", type: "boolean", group: "modules", customer_visible: false, status: "active" },
    { organization_id: organizationB.id, key: "modules.contract_watch", value: "true", type: "boolean", group: "modules", customer_visible: false, status: "active" }
  ]).throwOnError();

  const projectA1 = await insert("projects", { organization_id: organizationA.id, project_code: `CW-A1-${stamp}`, name: "Commessa A1", status: "Aperto", contract_watch_enabled: true, contract_status: "active", responsible_membership_id: membershipA.id });
  const projectA2 = await insert("projects", { organization_id: organizationA.id, project_code: `CW-A2-${stamp}`, name: "Commessa A2", status: "Aperto", contract_watch_enabled: true, contract_status: "active" });
  const projectB = await insert("projects", { organization_id: organizationB.id, project_code: `CW-B-${stamp}`, name: "Commessa B", status: "Aperto", contract_watch_enabled: true, contract_status: "active", responsible_membership_id: membershipB.id });
  const orderWatchProject = await insert("projects", { organization_id: organizationA.id, project_code: `OW-${stamp}`, status: "Aperto" });
  const archivedProject = await insert("projects", { organization_id: organizationA.id, project_code: `CW-ARCH-${stamp}`, name: "Commessa archiviata", status: "Aperto", contract_watch_enabled: true, contract_status: "active", archived_at: new Date().toISOString() });
  ids.projects.push(projectA1.id, projectA2.id, projectB.id, orderWatchProject.id, archivedProject.id);

  const sameNumberA1 = await insert("contract_progress_reports", { organization_id: organizationA.id, project_id: projectA1.id, sal_number: "SAL-01", title: "SAL uno", amount: 1000, created_by_membership_id: membershipA.id });
  const sameNumberA2 = await insert("contract_progress_reports", { organization_id: organizationA.id, project_id: projectA2.id, sal_number: "SAL-01", title: "SAL stesso numero altra commessa", amount: 500, created_by_membership_id: membershipA.id });
  assert.notEqual(sameNumberA1.id, sameNumberA2.id);

  const { error: duplicateError } = await db.from("contract_progress_reports").insert({ organization_id: organizationA.id, project_id: projectA1.id, sal_number: "SAL-01", title: "Duplicato", amount: 1, created_by_membership_id: membershipA.id });
  assert.ok(duplicateError, "Lo stesso numero SAL sulla stessa commessa deve essere rifiutato.");

  const { error: orderWatchError } = await db.from("contract_progress_reports").insert({ organization_id: organizationA.id, project_id: orderWatchProject.id, sal_number: "SAL-OW", title: "Non valido", amount: 1, created_by_membership_id: membershipA.id });
  assert.ok(orderWatchError, "Un progetto non ContractWatch deve essere rifiutato.");
  const { error: archivedError } = await db.from("contract_progress_reports").insert({ organization_id: organizationA.id, project_id: archivedProject.id, sal_number: "SAL-ARCH", title: "Non valido", amount: 1, created_by_membership_id: membershipA.id });
  assert.ok(archivedError, "Una commessa archiviata non deve accettare nuovi SAL.");
  const { error: foreignMembershipError } = await db.from("contract_progress_reports").insert({ organization_id: organizationA.id, project_id: projectA1.id, sal_number: "SAL-FK", title: "Autore esterno", amount: 1, created_by_membership_id: membershipB.id });
  assert.ok(foreignMembershipError, "Una membership di un altro tenant deve essere rifiutata.");

  const submitted = await insert("contract_progress_reports", {
    organization_id: organizationA.id, project_id: projectA1.id, sal_number: "SAL-CONCURRENT", title: "Approvazione concorrente",
    amount: 1250, currency: "EUR", status: "submitted", submitted_at: new Date().toISOString(),
    created_by_membership_id: membershipA.id, submitted_by_membership_id: membershipA.id
  });
  const approvalParams = { p_organization_id: organizationA.id, p_progress_report_id: submitted.id, p_actor_membership_id: membershipA.id };
  const approvals = await Promise.all([db.rpc("contractwatch_approve_progress_report", approvalParams), db.rpc("contractwatch_approve_progress_report", approvalParams)]);
  for (const approval of approvals) assert.equal(approval.error, null, approval.error?.message);

  const { count: billingCount } = await db.from("contract_billing_items").select("id", { count: "exact", head: true }).eq("organization_id", organizationA.id).eq("progress_report_id", submitted.id);
  const dedupeKey = `contract_progress_report:${submitted.id}:invoice_to_issue`;
  const { count: actionCount } = await db.from("operational_actions").select("id", { count: "exact", head: true }).eq("organization_id", organizationA.id).eq("deduplication_key", dedupeKey);
  assert.equal(billingCount, 1);
  assert.equal(actionCount, 1);

  const dashboardAdapterA = createSupabaseAdapter({ url, serviceKey, organizationId: organizationA.id });
  const dashboardData = await dashboardAdapterA.getDashboardData();
  const invoiceAction = dashboardData.operationalQueue.find((item) => item.salNumber === "SAL-CONCURRENT");
  assert.ok(invoiceAction, "L'azione fattura da emettere deve comparire nella dashboard Oggi.");
  assert.equal(invoiceAction.kind, "operational_action");
  assert.equal(invoiceAction.projectCode, projectA1.project_code);
  assert.equal(Number(invoiceAction.amount), 1250);
  assert.equal(invoiceAction.responsibleName, userA.full_name);

  const { data: billingItem } = await db.from("contract_billing_items").select("*").eq("organization_id", organizationA.id).eq("progress_report_id", submitted.id).single();
  const { data: issued, error: issueError } = await db.rpc("contractwatch_issue_billing_item", {
    p_organization_id: organizationA.id,
    p_billing_item_id: billingItem.id,
    p_actor_membership_id: membershipA.id,
    p_invoice_reference: `FT-${stamp}`
  });
  assert.equal(issueError, null, issueError?.message);
  assert.equal(issued.billing_item.status, "issued");
  assert.equal(issued.operational_action.status, "done");

  const rollbackSal = await insert("contract_progress_reports", {
    organization_id: organizationA.id, project_id: projectA1.id, sal_number: "SAL-ROLLBACK", title: "Rollback azione",
    amount: 99, status: "submitted", submitted_at: new Date().toISOString(),
    created_by_membership_id: membershipA.id, submitted_by_membership_id: membershipA.id
  });
  await insert("operational_actions", {
    organization_id: organizationA.id, action_type: "conflict", status: "open", title: "Conflitto intenzionale",
    entity_type: "wrong_entity", entity_id: randomUUID(), project_id: projectA1.id,
    created_by_membership_id: membershipA.id,
    deduplication_key: `contract_progress_report:${rollbackSal.id}:invoice_to_issue`
  });
  const { error: rollbackError } = await db.rpc("contractwatch_approve_progress_report", {
    p_organization_id: organizationA.id, p_progress_report_id: rollbackSal.id, p_actor_membership_id: membershipA.id
  });
  assert.ok(rollbackError, "Il conflitto sull'azione deve annullare l'approvazione.");
  const { data: unchangedSal } = await db.from("contract_progress_reports").select("status").eq("id", rollbackSal.id).single();
  const { count: rolledBackBilling } = await db.from("contract_billing_items").select("id", { count: "exact", head: true }).eq("progress_report_id", rollbackSal.id);
  assert.equal(unchangedSal.status, "submitted");
  assert.equal(rolledBackBilling, 0);

  const { error: crossTenantApprovalError } = await db.rpc("contractwatch_approve_progress_report", {
    p_organization_id: organizationB.id, p_progress_report_id: rollbackSal.id, p_actor_membership_id: membershipB.id
  });
  assert.ok(crossTenantApprovalError, "Un tenant non deve approvare il SAL di un altro tenant.");

  const adapterA = dashboardAdapterA;
  const visibleReports = await adapterA.getContractProgressReports();
  assert.equal(visibleReports.some((report) => report.id === submitted.id), true);
  const projectBReport = await insert("contract_progress_reports", { organization_id: organizationB.id, project_id: projectB.id, sal_number: "SAL-B", title: "Tenant B", amount: 10, created_by_membership_id: membershipB.id });
  assert.equal((await adapterA.getContractProgressReports()).some((report) => report.id === projectBReport.id), false);
  assert.equal((await adapterA.getProjects()).some((project) => project.id === orderWatchProject.id), true);

  process.env.AUTH_MODE = "legacy";
  process.env.LEGACY_ORGANIZATION_SLUG = organizationA.slug;
  process.env.LEGACY_ACTOR_MEMBERSHIP_ID = membershipA.id;
  const { default: progressHandler } = await import(`../api/contract-progress-reports.js?test=${stamp}`);
  const apiCreated = await call(progressHandler, "POST", {
    organizationId: organizationB.id,
    projectId: projectA1.id,
    salNumber: "SAL-API",
    title: "Creato via API",
    amount: 42
  });
  assert.equal(apiCreated.statusCode, 201, JSON.stringify(apiCreated.payload));
  const { data: apiRow } = await db.from("contract_progress_reports").select("organization_id").eq("id", apiCreated.payload.progressReport.id).single();
  assert.equal(apiRow.organization_id, organizationA.id);

  await db.from("settings").update({ value: "false" }).eq("organization_id", organizationA.id).eq("key", "modules.contract_watch").throwOnError();
  const disabled = await call(progressHandler, "GET", {}, { projectId: projectA1.id });
  assert.equal(disabled.statusCode, 403);

  console.log("ContractWatch SAL and billing vertical test: OK");
} finally {
  if (ids.organizations.length) await db.from("activities").delete().in("organization_id", ids.organizations).throwOnError();
  if (ids.organizations.length) await db.from("contract_billing_items").delete().in("organization_id", ids.organizations).throwOnError();
  if (ids.organizations.length) await db.from("operational_actions").delete().in("organization_id", ids.organizations).throwOnError();
  if (ids.organizations.length) await db.from("contract_progress_reports").delete().in("organization_id", ids.organizations).throwOnError();
  if (ids.projects.length) await db.from("projects").delete().in("id", ids.projects).throwOnError();
  if (ids.organizations.length) await db.from("settings").delete().in("organization_id", ids.organizations).throwOnError();
  if (ids.memberships.length) await db.from("organization_memberships").delete().in("id", ids.memberships).throwOnError();
  if (ids.users.length) await db.from("app_users").delete().in("id", ids.users).throwOnError();
  if (ids.organizations.length) await db.from("organizations").delete().in("id", ids.organizations).throwOnError();
}
