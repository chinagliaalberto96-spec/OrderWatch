import { authorizeApiRequest } from "../lib/_auth.js";
import {
  currencyValue,
  ensureActorMembership,
  ensureContractWriter,
  loadContractProject,
  numericValue,
  optionalDate,
  optionalText,
  recordContractActivity,
  requiredText
} from "../lib/_contractWatch.js";
import { requireOrganizationModule } from "../lib/_modules.js";
import { orgFilter, supabaseRequest, withOrg } from "../lib/_supabaseRest.js";

function validatePeriod(start, end) {
  if (start && end && end < start) throw new Error("La fine periodo non può precedere l'inizio.");
}

function editablePayload(body) {
  const patch = {};
  if ("salNumber" in body) patch.sal_number = requiredText(body.salNumber, "Numero SAL", 80);
  if ("title" in body) patch.title = requiredText(body.title, "Titolo");
  if ("periodStart" in body) patch.period_start = optionalDate(body.periodStart, "Inizio periodo");
  if ("periodEnd" in body) patch.period_end = optionalDate(body.periodEnd, "Fine periodo");
  if ("progressPercentage" in body) patch.progress_percentage = numericValue(body.progressPercentage, "Percentuale avanzamento", { min: 0, max: 100, optional: true });
  if ("amount" in body) patch.amount = numericValue(body.amount, "Importo", { min: 0 });
  if ("currency" in body) patch.currency = currencyValue(body.currency);
  if ("externalReference" in body) patch.external_reference = optionalText(body.externalReference, "Riferimento esterno", 240);
  return patch;
}

async function loadReport(id, organizationId) {
  const rows = await supabaseRequest(
    `contract_progress_reports?id=eq.${encodeURIComponent(id)}&${orgFilter(organizationId)}&select=*&limit=1`
  );
  return rows?.[0] || null;
}

async function listReports(projectId, user) {
  const project = await loadContractProject(projectId, user.organizationId);
  if (!project) return null;
  const [reports, billingItems] = await Promise.all([
    supabaseRequest(`contract_progress_reports?project_id=eq.${encodeURIComponent(projectId)}&${orgFilter(user.organizationId)}&select=*&order=created_at.desc`),
    supabaseRequest(`contract_billing_items?project_id=eq.${encodeURIComponent(projectId)}&${orgFilter(user.organizationId)}&select=*&order=created_at.desc`)
  ]);
  return { project, progressReports: reports || [], billingItems: billingItems || [] };
}

async function createReport(body, user) {
  const project = await loadContractProject(body.projectId, user.organizationId, { allowArchived: false });
  if (!project) throw new Error("Commessa ContractWatch non trovata o archiviata.");
  const payload = editablePayload({
    salNumber: body.salNumber,
    title: body.title,
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    progressPercentage: body.progressPercentage,
    amount: body.amount,
    currency: body.currency,
    externalReference: body.externalReference
  });
  validatePeriod(payload.period_start, payload.period_end);

  const rows = await supabaseRequest("contract_progress_reports", {
    method: "POST",
    body: withOrg({
      ...payload,
      project_id: project.id,
      status: "draft",
      created_by_membership_id: user.membershipId
    }, user.organizationId),
    headers: { Prefer: "return=representation" }
  });
  const report = rows?.[0];
  await recordContractActivity({
    user, project, entityType: "contract_progress_report", entityId: report.id,
    action: "created", title: "SAL creato", detail: `${report.sal_number} · ${report.title}`,
    changedFields: Object.keys(payload)
  });
  return report;
}

async function updateReport(body, user) {
  const report = await loadReport(body.id, user.organizationId);
  if (!report) return null;
  if (!["draft", "rejected"].includes(report.status)) throw new Error("Il SAL non è più modificabile.");
  const project = await loadContractProject(report.project_id, user.organizationId);
  const patch = editablePayload(body);
  validatePeriod(
    "period_start" in patch ? patch.period_start : report.period_start,
    "period_end" in patch ? patch.period_end : report.period_end
  );
  if (!Object.keys(patch).length) throw new Error("Nessun campo modificabile fornito.");
  patch.updated_at = new Date().toISOString();
  const rows = await supabaseRequest(`contract_progress_reports?id=eq.${encodeURIComponent(report.id)}&${orgFilter(user.organizationId)}`, {
    method: "PATCH", body: patch, headers: { Prefer: "return=representation" }
  });
  const updated = rows?.[0];
  await recordContractActivity({
    user, project, entityType: "contract_progress_report", entityId: report.id,
    action: "updated", title: "SAL aggiornato", detail: `${updated.sal_number} · ${updated.title}`,
    changedFields: Object.keys(patch).filter((field) => field !== "updated_at")
  });
  return updated;
}

async function transitionReport(body, user) {
  const report = await loadReport(body.id, user.organizationId);
  if (!report) return null;
  const project = await loadContractProject(report.project_id, user.organizationId);
  if (!project) return null;

  if (body.action === "approve") {
    return supabaseRequest("rpc/contractwatch_approve_progress_report", {
      method: "POST",
      body: {
        p_organization_id: user.organizationId,
        p_progress_report_id: report.id,
        p_actor_membership_id: user.membershipId
      }
    });
  }

  let patch;
  let activity;
  if (body.action === "submit") {
    if (!["draft", "rejected"].includes(report.status)) throw new Error("Solo un SAL in bozza o rifiutato può essere inviato.");
    patch = {
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by_membership_id: user.membershipId,
      rejection_reason: null,
      updated_at: new Date().toISOString()
    };
    activity = { action: "submitted", title: "SAL inviato" };
  } else if (body.action === "reject") {
    if (report.status !== "submitted") throw new Error("Solo un SAL inviato può essere rifiutato.");
    patch = {
      status: "rejected",
      rejection_reason: requiredText(body.rejectionReason, "Motivo del rifiuto", 1000),
      approved_at: null,
      approved_by_membership_id: null,
      updated_at: new Date().toISOString()
    };
    activity = { action: "rejected", title: "SAL rifiutato" };
  } else {
    throw new Error("Transizione SAL non supportata.");
  }

  const rows = await supabaseRequest(`contract_progress_reports?id=eq.${encodeURIComponent(report.id)}&${orgFilter(user.organizationId)}`, {
    method: "PATCH", body: patch, headers: { Prefer: "return=representation" }
  });
  const updated = rows?.[0];
  await recordContractActivity({
    user, project, entityType: "contract_progress_report", entityId: report.id,
    action: activity.action, title: activity.title, detail: `${report.sal_number} · ${report.title}`,
    changedFields: Object.keys(patch).filter((field) => field !== "updated_at")
  });
  return { progress_report: updated };
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response);
  if (!user) return;
  if (!(await requireOrganizationModule(response, user.organizationId, "contract_watch"))) return;

  try {
    if (request.method === "GET") {
      const result = await listReports(request.query?.projectId, user);
      if (!result) return response.status(404).json({ error: "Commessa non trovata." });
      response.setHeader("Cache-Control", "no-store");
      return response.status(200).json(result);
    }

    if (!ensureContractWriter(user, response) || !ensureActorMembership(user, response)) return;
    if (request.method === "POST") return response.status(201).json({ progressReport: await createReport(request.body || {}, user) });
    if (request.method === "PATCH") {
      const report = await updateReport(request.body || {}, user);
      return report ? response.status(200).json({ progressReport: report }) : response.status(404).json({ error: "SAL non trovato." });
    }
    if (request.method === "PUT") {
      const result = await transitionReport(request.body || {}, user);
      return result ? response.status(200).json(result) : response.status(404).json({ error: "SAL non trovato." });
    }
    response.setHeader("Allow", "GET, POST, PATCH, PUT");
    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const duplicate = error.message.includes("contract_progress_reports_number_key");
    response.status(duplicate ? 409 : 400).json({
      error: duplicate ? "Esiste già un SAL con questo numero per la commessa." : "Operazione SAL non riuscita.",
      detail: error.message
    });
  }
}
