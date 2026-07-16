import { authorizeApiRequest } from "../lib/_auth.js";
import { requireOrganizationModule } from "../lib/_modules.js";
import { orgFilter, supabaseRequest, withOrg } from "../lib/_supabaseRest.js";

const WRITE_ROLES = new Set(["Owner", "IT", "Admin", "Buyer"]);
const CONTRACT_STATUSES = new Set(["draft", "active", "suspended", "completed"]);

function textValue(value, { required = false, max = 4000 } = {}) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw new Error("Compila tutti i campi obbligatori.");
  if (normalized.length > max) throw new Error(`Valore troppo lungo: massimo ${max} caratteri.`);
  return normalized || null;
}

function dateValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error("Le date devono essere in formato YYYY-MM-DD.");
  }
  return String(value);
}

function statusValue(value, fallback = "draft") {
  const normalized = String(value || fallback).toLowerCase();
  if (!CONTRACT_STATUSES.has(normalized)) throw new Error("Stato commessa non valido.");
  return normalized;
}

function booleanValue(value, fieldName) {
  if (typeof value !== "boolean") throw new Error(`${fieldName} deve essere true o false.`);
  return value;
}

function changedFields(payload) {
  return Object.keys(payload).filter((field) => field !== "updated_at");
}

async function recordContractActivity({ project, user, action, fields }) {
  const titleByAction = {
    created: "Commessa creata",
    updated: "Commessa aggiornata",
    archived: "Commessa archiviata",
    restored: "Commessa ripristinata"
  };

  await supabaseRequest("activities", {
    method: "POST",
    body: withOrg({
      title: titleByAction[action] || "Commessa aggiornata",
      type: "ContractWatch",
      detail: `${project.project_code} · ${project.name || "Commessa"}`,
      project_code: project.project_code,
      entity_type: "project",
      entity_id: project.id,
      action,
      actor_membership_id: user.membershipId || null,
      metadata: { changed_fields: fields }
    }, user.organizationId)
  });
}

function assertDates(startDate, expectedEndDate) {
  if (startDate && expectedEndDate && expectedEndDate < startDate) {
    throw new Error("La data di fine prevista non può precedere la data di inizio.");
  }
}

async function contactForOrganization(contactId, organizationId) {
  if (!contactId) return null;
  const rows = await supabaseRequest(
    `contacts?id=eq.${encodeURIComponent(contactId)}&${orgFilter(organizationId)}&status=eq.active&select=id,legal_name&limit=1`
  );
  if (!rows?.[0]) throw new Error("Cliente non valido per questa organizzazione.");
  return rows[0];
}

async function membershipForUser(appUserId, organizationId) {
  if (!appUserId) return null;
  const memberships = await supabaseRequest(
    `organization_memberships?app_user_id=eq.${encodeURIComponent(appUserId)}&${orgFilter(organizationId)}&active=eq.true&select=id,app_user_id&limit=1`
  );
  if (!memberships?.[0]) throw new Error("Responsabile non valido per questa organizzazione.");

  const users = await supabaseRequest(
    `app_users?id=eq.${encodeURIComponent(appUserId)}&active=eq.true&select=id,full_name&limit=1`
  );
  if (!users?.[0]) throw new Error("Responsabile non attivo.");
  return { ...memberships[0], fullName: users[0].full_name };
}

async function loadProject(id, organizationId) {
  const rows = await supabaseRequest(
    `projects?id=eq.${encodeURIComponent(id)}&contract_watch_enabled=eq.true&${orgFilter(organizationId)}&select=*&limit=1`
  );
  return rows?.[0] || null;
}

function ensureWriter(user, response) {
  if (WRITE_ROLES.has(user.role)) return true;
  response.status(403).json({ error: "Non hai i permessi necessari per modificare le commesse." });
  return false;
}

async function createProject(body, user) {
  const projectCode = textValue(body.projectCode, { required: true, max: 80 });
  const name = textValue(body.name, { required: true, max: 240 });
  const description = textValue(body.description, { max: 4000 });
  const startDate = dateValue(body.startDate);
  const expectedEndDate = dateValue(body.expectedEndDate);
  const contractStatus = statusValue(body.contractStatus);
  assertDates(startDate, expectedEndDate);

  const customer = await contactForOrganization(body.customerContactId, user.organizationId);
  const responsible = await membershipForUser(body.responsibleAppUserId, user.organizationId);

  const rows = await supabaseRequest("projects", {
    method: "POST",
    body: withOrg({
      project_code: projectCode,
      name,
      description,
      customer_contact_id: customer?.id || null,
      customer: customer?.legal_name || null,
      responsible_membership_id: responsible?.id || null,
      owner: responsible?.fullName || null,
      start_date: startDate,
      expected_end_date: expectedEndDate,
      due_date: expectedEndDate,
      contract_status: contractStatus,
      contract_watch_enabled: true,
      status: contractStatus === "completed" || contractStatus === "archived" ? "Concluso" : "Aperto",
      created_by_membership_id: user.membershipId || null,
      archived_at: contractStatus === "archived" ? new Date().toISOString() : null
    }, user.organizationId),
    headers: { Prefer: "return=representation" }
  });

  const project = rows?.[0];
  await recordContractActivity({
    project,
    user,
    action: "created",
    fields: changedFields({
      project_code: projectCode,
      name,
      description,
      customer_contact_id: customer?.id || null,
      responsible_membership_id: responsible?.id || null,
      start_date: startDate,
      expected_end_date: expectedEndDate,
      contract_status: contractStatus,
      contract_watch_enabled: true
    })
  });

  return project;
}

async function updateProject(project, body, user) {
  const patch = {};

  if ("projectCode" in body) patch.project_code = textValue(body.projectCode, { required: true, max: 80 });
  if ("name" in body) patch.name = textValue(body.name, { required: true, max: 240 });
  if ("description" in body) patch.description = textValue(body.description, { max: 4000 });
  if ("startDate" in body) patch.start_date = dateValue(body.startDate);
  if ("expectedEndDate" in body) {
    patch.expected_end_date = dateValue(body.expectedEndDate);
    patch.due_date = patch.expected_end_date;
  }

  if ("customerContactId" in body) {
    const customer = await contactForOrganization(body.customerContactId, user.organizationId);
    patch.customer_contact_id = customer?.id || null;
    patch.customer = customer?.legal_name || null;
  }

  if ("responsibleAppUserId" in body) {
    const responsible = await membershipForUser(body.responsibleAppUserId, user.organizationId);
    patch.responsible_membership_id = responsible?.id || null;
    patch.owner = responsible?.fullName || null;
  }

  if ("contractStatus" in body) {
    patch.contract_status = statusValue(body.contractStatus);
    if (patch.contract_status === "completed") patch.status = "Concluso";
    else if (project.status === "Concluso") patch.status = "Aperto";
  }

  if ("archived" in body) {
    patch.archived_at = booleanValue(body.archived, "archived") ? new Date().toISOString() : null;
  }

  assertDates(
    "start_date" in patch ? patch.start_date : project.start_date,
    "expected_end_date" in patch ? patch.expected_end_date : project.expected_end_date
  );

  if (!Object.keys(patch).length) throw new Error("Nessun campo modificabile fornito.");
  patch.updated_at = new Date().toISOString();

  const rows = await supabaseRequest(
    `projects?id=eq.${encodeURIComponent(project.id)}&contract_watch_enabled=eq.true&${orgFilter(user.organizationId)}`,
    {
      method: "PATCH",
      body: patch,
      headers: { Prefer: "return=representation" }
    }
  );

  const updated = rows?.[0];
  await recordContractActivity({
    project: updated,
    user,
    action: "archived" in body ? (body.archived ? "archived" : "restored") : "updated",
    fields: changedFields(patch)
  });

  return updated;
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response);
  if (!user) return;
  if (!(await requireOrganizationModule(response, user.organizationId, "contract_watch"))) return;

  try {
    if (request.method === "POST") {
      if (!ensureWriter(user, response)) return;
      const project = await createProject(request.body || {}, user);
      response.setHeader("Cache-Control", "no-store");
      response.status(201).json({ project });
      return;
    }

    if (request.method === "PATCH") {
      if (!ensureWriter(user, response)) return;
      const id = request.body?.id;
      if (!id) {
        response.status(400).json({ error: "Commessa mancante." });
        return;
      }

      const project = await loadProject(id, user.organizationId);
      if (!project) {
        response.status(404).json({ error: "Commessa non trovata." });
        return;
      }

      const updated = await updateProject(project, request.body || {}, user);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ project: updated });
      return;
    }

    response.setHeader("Allow", "POST, PATCH");
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const duplicate = error.message.includes("projects_org_project_code_key");
    response.status(duplicate ? 409 : 400).json({
      error: duplicate ? "Esiste già una commessa con questo codice." : "Impossibile salvare la commessa.",
      detail: error.message
    });
  }
}
