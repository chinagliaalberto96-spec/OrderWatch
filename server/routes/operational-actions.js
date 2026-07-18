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

const CANONICAL_TABLE_BY_KIND = {
  project_requirement: "project_requirements",
  procurement_requirement: "procurement_requirements",
  quote_line: "quote_lines",
  purchase_order_line: "purchase_order_lines",
  delivery_note_line: "delivery_note_lines"
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

async function loadCanonicalLine(id, organizationId) {
  const rows = await supabaseRequest(`canonical_operational_lines?id=eq.${encodeURIComponent(id)}&${orgFilter(organizationId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function updateCanonicalLine({ existing, action, targets, organizationId }) {
  const table = CANONICAL_TABLE_BY_KIND[existing.entity_kind];
  if (!table) throw new Error("Tipo riga canonica non supportato.");
  const now = new Date().toISOString();

  if (action === "verify") {
    const currentRows = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(existing.id)}&${orgFilter(organizationId)}&select=*&limit=1`);
    const current = currentRows?.[0];
    if (!current) throw new Error("Riga canonica non trovata.");
    const patch = { needs_review: false, updated_at: now };
    if (existing.entity_kind === "project_requirement" && current.status === "needs_review") patch.status = "requested";
    if (existing.entity_kind === "procurement_requirement") {
      if (!current.description || !current.requested_quantity || !current.unit_of_measure) {
        throw new Error("Completa descrizione, quantità e unità prima di approvare il fabbisogno.");
      }
      patch.status = "approved";
    }
    if (existing.entity_kind === "purchase_order_line" && current.status === "draft") patch.status = "ordered";
    await supabaseRequest(`${table}?id=eq.${encodeURIComponent(existing.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: patch
    });
  } else if (existing.entity_kind === "project_requirement") {
    if (!targets.project && !targets.order) throw new Error("Seleziona un lavoro o un ordine.");
    await supabaseRequest(`${table}?id=eq.${encodeURIComponent(existing.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: {
        project_id: targets.project?.id || targets.order?.project_id || existing.project_id,
        order_id: null,
        status: "requested",
        needs_review: false,
        updated_at: now
      }
    });
  } else if (existing.entity_kind === "procurement_requirement") {
    if (!targets.project) throw new Error("Seleziona il lavoro a cui appartiene il fabbisogno.");
    await supabaseRequest(`${table}?id=eq.${encodeURIComponent(existing.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: {
        project_id: targets.project.id,
        needs_review: true,
        status: "draft",
        updated_at: now
      }
    });
  } else if (existing.entity_kind === "quote_line") {
    if (!targets.project) throw new Error("Seleziona un lavoro per collegare il preventivo.");
    await supabaseRequest(`quotes?id=eq.${encodeURIComponent(existing.parent_id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: {
        project_id: targets.project.id,
        project_code: targets.project.project_code,
        updated_at: now
      }
    });
    await supabaseRequest(`${table}?id=eq.${encodeURIComponent(existing.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { needs_review: false, updated_at: now }
    });
  } else if (existing.entity_kind === "purchase_order_line") {
    if (!targets.order) throw new Error("Seleziona un ordine per collegare la riga fornitore.");
    await supabaseRequest(`${table}?id=eq.${encodeURIComponent(existing.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { order_id: targets.order.id, needs_review: false, updated_at: now }
    });
  } else if (existing.entity_kind === "delivery_note_line") {
    if (!targets.order && !targets.project) throw new Error("Seleziona un ordine o un lavoro per collegare il DDT.");
    await supabaseRequest(`delivery_notes?id=eq.${encodeURIComponent(existing.parent_id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: {
        order_id: targets.order?.id || null,
        order_code: targets.order?.order_code || null,
        project_id: targets.project?.id || targets.order?.project_id || null,
        project_code: targets.project?.project_code || targets.order?.project_code || null,
        status: targets.order ? "matched" : "confirmed",
        needs_review: false,
        updated_at: now
      }
    });
    await supabaseRequest(`${table}?id=eq.${encodeURIComponent(existing.id)}&${orgFilter(organizationId)}`, {
      method: "PATCH",
      body: { needs_review: false, updated_at: now }
    });
  }

  return loadCanonicalLine(existing.id, organizationId);
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

    let canonicalLine = null;
    if (kind === "material_line") canonicalLine = await loadCanonicalLine(id, user.organizationId);
    const existingRows = canonicalLine
      ? [canonicalLine]
      : await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}&select=*&limit=1`);
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
    let rows;
    if (canonicalLine) {
      const item = await updateCanonicalLine({ existing, action, targets, organizationId: user.organizationId });
      rows = item ? [item] : [];
    } else {
      const patch = action === "verify"
        ? patchForVerify(kind, existing)
        : patchForLink(kind, targets);
      rows = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}&${orgFilter(user.organizationId)}`, {
        method: "PATCH",
        body: patch,
        headers: { Prefer: "return=representation" }
      });
    }

    // Il documento generico e la tabella specializzata devono raccontare lo
    // stesso collegamento. In precedenza il drawer salvava solo il codice sul
    // DDT/fattura, lasciando document.order_id vuoto.
    const linkedDocumentKind = canonicalLine?.entity_kind === "delivery_note_line"
      ? "delivery_note"
      : kind;
    if (action === "link" && ["delivery_note", "invoice"].includes(linkedDocumentKind) && existing.source_email_id) {
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
          ? `${canonicalLine ? "Riga operativa" : LABEL_BY_KIND[kind] || "Elemento"} verificato dal buyer`
          : `${canonicalLine ? "Riga operativa" : LABEL_BY_KIND[kind] || "Elemento"} collegato dal buyer`,
        type: "Operativo",
        detail: action === "verify"
          ? `${canonicalLine ? "Riga operativa" : LABEL_BY_KIND[kind] || "Elemento"} "${describeRow(kind, existing)}" segnato come verificato dalla home Oggi.`
          : `${canonicalLine ? "Riga operativa" : LABEL_BY_KIND[kind] || "Elemento"} "${describeRow(kind, existing)}" collegato dalla home Oggi.`,
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
