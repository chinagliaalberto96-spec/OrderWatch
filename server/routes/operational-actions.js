import { supabaseRequest, orgFilter, withOrg } from "../lib/_supabaseRest.js";
import { authorizeApiRequest } from "../lib/_auth.js";

// CANCELLO 2: ogni query e' filtrata sull'organizzazione dell'utente
// autenticato. Un id valido ma di un altro tenant -> 404.
const TABLE_BY_KIND = {
  material_line: "material_lines",
  quote: "quotes",
  delivery_note: "delivery_notes",
  invoice: "invoices",
  processed_email: "processed_emails",
  buyer_action: "buyer_actions"
};

const LABEL_BY_KIND = {
  material_line: "Riga materiale",
  quote: "Preventivo",
  delivery_note: "DDT",
  invoice: "Fattura",
  processed_email: "Email",
  buyer_action: "Azione buyer"
};

function patchForVerify(kind, existing) {
  const now = new Date().toISOString();

  if (kind === "material_line") {
    return {
      needs_review: false,
      status: "Verificato",
      reviewed_at: now,
      updated_at: now
    };
  }

  if (kind === "quote") {
    return {
      needs_review: false,
      status: "new",
      updated_at: now
    };
  }

  if (kind === "delivery_note") {
    return {
      needs_review: false,
      status: existing.order_id ? "matched" : "confirmed",
      confirmed_at: now,
      updated_at: now
    };
  }

  if (kind === "invoice") {
    return {
      needs_review: false,
      status: existing.order_id ? "matched" : "new",
      updated_at: now
    };
  }

  if (kind === "processed_email") {
    return {
      needs_review: false,
      updated_at: now
    };
  }

  if (kind === "buyer_action") {
    return {
      status: "done",
      updated_at: now
    };
  }

  throw new Error("Tipo elemento non supportato.");
}

function patchForLink(kind, { project, order }) {
  const now = new Date().toISOString();
  const normalizedProject = project?.project_code || order?.project_code || null;
  const projectId = project?.id || order?.project_id || null;
  const normalizedOrder = order?.order_code || null;
  const orderId = order?.id || null;

  if (kind === "quote") {
    if (!normalizedProject) throw new Error("Seleziona un lavoro per collegare il preventivo.");
    return {
      project_id: projectId,
      project_code: normalizedProject,
      needs_review: false,
      updated_at: now
    };
  }

  if (kind === "processed_email") {
    return {
      linked_project_code: normalizedProject,
      linked_order_code: normalizedOrder,
      updated_at: now
    };
  }

  if (kind === "buyer_action") {
    return {
      project_id: projectId,
      project_code: normalizedProject,
      order_id: orderId,
      order_code: normalizedOrder,
      updated_at: now
    };
  }

  if (["material_line", "delivery_note", "invoice"].includes(kind)) {
    if (!normalizedProject && !normalizedOrder) throw new Error("Seleziona almeno un lavoro o un ordine.");
    return {
      project_id: projectId,
      project_code: normalizedProject,
      order_id: orderId,
      order_code: normalizedOrder,
      needs_review: false,
      ...(kind === "delivery_note" && orderId ? { status: "matched" } : {}),
      ...(kind === "invoice" && orderId ? { status: "matched" } : {}),
      updated_at: now
    };
  }

  throw new Error("Tipo elemento non supportato.");
}

async function resolveLinkTargets({ projectCode, orderCode }, organizationId) {
  let project = null;
  let order = null;
  if (orderCode) {
    const rows = await supabaseRequest(`orders?order_code=eq.${encodeURIComponent(orderCode)}&${orgFilter(organizationId)}&select=*&limit=1`);
    order = rows?.[0] || null;
    if (!order) throw new Error("Ordine selezionato non trovato.");
  }
  const effectiveProjectCode = projectCode || order?.project_code || null;
  if (effectiveProjectCode) {
    const rows = await supabaseRequest(`projects?project_code=eq.${encodeURIComponent(effectiveProjectCode)}&${orgFilter(organizationId)}&select=*&limit=1`);
    project = rows?.[0] || null;
    if (!project) throw new Error("Lavoro selezionato non trovato.");
  }
  return { project, order };
}

function describeRow(kind, row) {
  if (kind === "material_line") return row.description || row.order_code || row.project_code || row.id;
  if (kind === "quote") return row.quote_code || row.supplier_name || row.customer_name || row.id;
  if (kind === "delivery_note") return row.ddt_number || row.supplier_name || row.id;
  if (kind === "invoice") return row.invoice_number || row.supplier_name || row.id;
  if (kind === "processed_email") return row.subject || row.message_id || row.id;
  if (kind === "buyer_action") return row.title || row.action_type || row.id;
  return row.id;
}

export default async function handler(request, response) {
  const user = await authorizeApiRequest(request, response, { roles: ["Owner", "IT", "Admin", "Buyer"] });
  if (!user) return;
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { kind, id, action } = request.body || {};
    if (!kind || !id) {
      response.status(400).json({ error: "Missing operational item kind or id." });
      return;
    }

    if (!["verify", "link"].includes(action)) {
      response.status(400).json({ error: "Unsupported operational action." });
      return;
    }

    const table = TABLE_BY_KIND[kind];
    if (!table) {
      response.status(400).json({ error: "Unsupported operational item kind." });
      return;
    }

    const existingRows = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}&select=*&limit=1`);
    const existing = existingRows?.[0];
    if (!existing) {
      response.status(404).json({ error: "Operational item not found." });
      return;
    }

    if (action === "verify" && kind === "processed_email" && ["error", "processing"].includes(String(existing.status || "").toLowerCase())) {
      response.status(409).json({
        error: "Importazione tecnica da controllare nella vista completa."
      });
      return;
    }

    const targets = action === "link"
      ? await resolveLinkTargets({
          projectCode: request.body.projectCode || null,
          orderCode: request.body.orderCode || null
        }, user.organizationId)
      : null;
    const patch = action === "verify"
      ? patchForVerify(kind, existing)
      : patchForLink(kind, targets);

    const rows = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
      method: "PATCH",
      body: patch,
      headers: { Prefer: "return=representation" }
    });

    // Il documento generico e la tabella specializzata devono raccontare lo
    // stesso collegamento. In precedenza il drawer salvava solo il codice sul
    // DDT/fattura, lasciando document.order_id vuoto.
    if (action === "link" && ["delivery_note", "invoice"].includes(kind) && existing.source_email_id) {
      await supabaseRequest(`documents?source_email_id=eq.${encodeURIComponent(existing.source_email_id)}&${orgFilter(user.organizationId)}`, {
        method: "PATCH",
        body: {
          order_id: targets.order?.id || null,
          linked_order_code: targets.order?.order_code || null,
          updated_at: new Date().toISOString()
        }
      });
    }

    await supabaseRequest("activities", {
      method: "POST",
      body: withOrg({
        title: action === "verify"
          ? `${LABEL_BY_KIND[kind] || "Elemento"} verificato dal buyer`
          : `${LABEL_BY_KIND[kind] || "Elemento"} collegato dal buyer`,
        type: "Operativo",
        detail: action === "verify"
          ? `${LABEL_BY_KIND[kind] || "Elemento"} "${describeRow(kind, existing)}" segnato come verificato dalla home Oggi.`
          : `${LABEL_BY_KIND[kind] || "Elemento"} "${describeRow(kind, existing)}" collegato dalla home Oggi.`,
        order_code: targets?.order?.order_code || existing.order_code || existing.linked_order_code || null,
        project_code: targets?.project?.project_code || targets?.order?.project_code || existing.project_code || existing.linked_project_code || null,
        supplier_name: existing.supplier_name || null
      }, user.organizationId)
    });

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ item: rows?.[0] || null });
  } catch (error) {
    response.status(500).json({
      error: "Unable to update operational item",
      detail: error.message
    });
  }
}
