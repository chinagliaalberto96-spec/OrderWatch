import { authorizeApiRequest } from "../lib/_auth.js";
import { orgFilter, supabaseRequest, withOrg } from "../lib/_supabaseRest.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUnit(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

async function moduleEnabled(organizationId) {
  const rows = await supabaseRequest(
    `settings?key=eq.modules.receiving&${orgFilter(organizationId)}&select=value,status&limit=1`
  );
  return rows?.[0]?.status === "active" && String(rows[0].value).toLowerCase() === "true";
}

async function settingNumber(key, fallback, organizationId) {
  const rows = await supabaseRequest(
    `settings?key=eq.${encodeURIComponent(key)}&${orgFilter(organizationId)}&select=value&limit=1`
  );
  const value = Number(rows?.[0]?.value);
  return Number.isFinite(value) ? value : fallback;
}

async function receivingData(organizationId) {
  const filter = orgFilter(organizationId);
  const [orders, orderLines, notes, noteLines, allocations] = await Promise.all([
    supabaseRequest(`orders?${filter}&select=id,order_code,supplier_name,status,due_date&order=created_at.desc&limit=300`),
    supabaseRequest(`purchase_order_lines?${filter}&select=*&order=created_at.desc&limit=1000`),
    supabaseRequest(`delivery_notes?${filter}&select=*&order=created_at.desc&limit=300`),
    supabaseRequest(`delivery_note_lines?${filter}&select=*&order=created_at.desc&limit=1000`),
    supabaseRequest(`receipt_allocations?${filter}&select=*&order=created_at.desc&limit=2000`)
  ]);

  const allocationsByOrderLine = new Map();
  for (const allocation of allocations || []) {
    if (!allocationsByOrderLine.has(allocation.purchase_order_line_id)) allocationsByOrderLine.set(allocation.purchase_order_line_id, []);
    allocationsByOrderLine.get(allocation.purchase_order_line_id).push(allocation);
  }

  const orderById = new Map((orders || []).map((row) => [row.id, row]));
  const orderLineById = new Map((orderLines || []).map((row) => [row.id, row]));
  const noteLineById = new Map((noteLines || []).map((row) => [row.id, row]));
  const noteById = new Map((notes || []).map((row) => [row.id, row]));

  const mappedOrderLines = (orderLines || []).map((line) => {
    const confirmed = (allocationsByOrderLine.get(line.id) || []).filter((row) => row.status === "confirmed");
    const received = confirmed.reduce((sum, row) => sum + number(row.allocated_quantity), 0);
    const ordered = number(line.ordered_quantity);
    return {
      id: line.id,
      orderId: line.order_id,
      orderCode: orderById.get(line.order_id)?.order_code || null,
      supplierName: orderById.get(line.order_id)?.supplier_name || null,
      lineNumber: line.line_number,
      internalItemCode: line.internal_item_code,
      supplierItemCode: line.supplier_item_code,
      description: line.description,
      orderedQuantity: ordered,
      confirmedQuantity: line.confirmed_quantity === null ? null : number(line.confirmed_quantity),
      receivedQuantity: received,
      remainingQuantity: Math.max(0, ordered - received),
      overReceivedQuantity: Math.max(0, received - ordered),
      unitOfMeasure: line.unit_of_measure,
      promisedDate: line.promised_date,
      status: line.status
    };
  });

  const mappedAllocations = (allocations || []).map((allocation) => {
    const ddtLine = noteLineById.get(allocation.delivery_note_line_id);
    const note = ddtLine ? noteById.get(ddtLine.delivery_note_id) : null;
    const orderLine = orderLineById.get(allocation.purchase_order_line_id);
    const order = orderLine ? orderById.get(orderLine.order_id) : null;
    return {
      id: allocation.id,
      status: allocation.status,
      allocatedQuantity: number(allocation.allocated_quantity),
      matchMethod: allocation.match_method,
      confidence: allocation.confidence,
      confirmedBy: allocation.confirmed_by,
      confirmedAt: allocation.confirmed_at,
      ddtNumber: note?.ddt_number || null,
      deliveryDate: note?.delivery_date || note?.received_date || null,
      deliveredDescription: ddtLine?.description || null,
      deliveredQuantity: ddtLine ? number(ddtLine.delivered_quantity) : null,
      deliveredUnit: ddtLine?.unit_of_measure || null,
      orderCode: order?.order_code || null,
      supplierName: order?.supplier_name || note?.supplier_name || null,
      orderLineNumber: orderLine?.line_number || null,
      orderedDescription: orderLine?.description || null,
      orderedQuantity: orderLine ? number(orderLine.ordered_quantity) : null,
      orderedUnit: orderLine?.unit_of_measure || null
    };
  });

  return {
    orderLines: mappedOrderLines,
    deliveryNotes: (notes || []).map((note) => ({
      id: note.id,
      ddtNumber: note.ddt_number,
      supplierName: note.supplier_name,
      orderCode: note.order_code,
      deliveryDate: note.delivery_date,
      receivedDate: note.received_date,
      status: note.status,
      needsReview: Boolean(note.needs_review),
      confidence: note.confidence,
      lines: (noteLines || []).filter((line) => line.delivery_note_id === note.id).map((line) => ({
        id: line.id,
        lineNumber: line.line_number,
        itemCode: line.internal_item_code || line.supplier_item_code,
        description: line.description,
        deliveredQuantity: number(line.delivered_quantity),
        unitOfMeasure: line.unit_of_measure,
        needsReview: Boolean(line.needs_review)
      }))
    })),
    allocations: mappedAllocations,
    summary: {
      openLines: mappedOrderLines.filter((line) => line.remainingQuantity > 0).length,
      partialLines: mappedOrderLines.filter((line) => line.receivedQuantity > 0 && line.remainingQuantity > 0).length,
      completedLines: mappedOrderLines.filter((line) => line.remainingQuantity === 0 && line.receivedQuantity > 0).length,
      proposedMatches: mappedAllocations.filter((row) => row.status === "proposed").length,
      overReceivedLines: mappedOrderLines.filter((line) => line.overReceivedQuantity > 0).length
    }
  };
}

async function recalculateOrderLine(orderLineId, organizationId) {
  const filter = orgFilter(organizationId);
  const [lineRows, allocationRows] = await Promise.all([
    supabaseRequest(`purchase_order_lines?id=eq.${encodeURIComponent(orderLineId)}&${filter}&select=*&limit=1`),
    supabaseRequest(`receipt_allocations?purchase_order_line_id=eq.${encodeURIComponent(orderLineId)}&${filter}&status=eq.confirmed&select=allocated_quantity`)
  ]);
  const line = lineRows?.[0];
  if (!line) return;
  const received = (allocationRows || []).reduce((sum, row) => sum + number(row.allocated_quantity), 0);
  const ordered = number(line.ordered_quantity);
  const status = received > ordered ? "over_received" : received === ordered ? "received" : received > 0 ? "partially_received" : (line.confirmed_quantity !== null ? "confirmed" : "ordered");
  await supabaseRequest(`purchase_order_lines?id=eq.${encodeURIComponent(line.id)}&${filter}`, {
    method: "PATCH",
    body: { status, updated_at: new Date().toISOString() }
  });

  const siblingRows = await supabaseRequest(`purchase_order_lines?order_id=eq.${encodeURIComponent(line.order_id)}&${filter}&select=status`);
  const allReceived = siblingRows?.length && siblingRows.every((row) => row.status === "received");
  const needsReview = siblingRows?.some((row) => ["over_received", "disputed"].includes(row.status));
  await supabaseRequest(`orders?id=eq.${encodeURIComponent(line.order_id)}&${filter}`, {
    method: "PATCH",
    body: { status: allReceived ? "Ricevuto" : "Confermato", needs_review: Boolean(needsReview), updated_at: new Date().toISOString() }
  });
}

async function recalculateDeliveryNote(deliveryNoteLineId, organizationId) {
  const filter = orgFilter(organizationId);
  const rows = await supabaseRequest(`delivery_note_lines?id=eq.${encodeURIComponent(deliveryNoteLineId)}&${filter}&select=delivery_note_id&limit=1`);
  const deliveryNoteId = rows?.[0]?.delivery_note_id;
  if (!deliveryNoteId) return;
  const lines = await supabaseRequest(`delivery_note_lines?delivery_note_id=eq.${encodeURIComponent(deliveryNoteId)}&${filter}&select=id,delivered_quantity`);
  let matched = 0;
  for (const line of lines || []) {
    const allocations = await supabaseRequest(`receipt_allocations?delivery_note_line_id=eq.${encodeURIComponent(line.id)}&${filter}&status=eq.confirmed&select=allocated_quantity`);
    const total = (allocations || []).reduce((sum, row) => sum + number(row.allocated_quantity), 0);
    if (total === number(line.delivered_quantity)) matched += 1;
  }
  const allMatched = Boolean(lines?.length) && matched === lines.length;
  await supabaseRequest(`delivery_notes?id=eq.${encodeURIComponent(deliveryNoteId)}&${filter}`, {
    method: "PATCH",
    body: {
      status: allMatched ? "confirmed" : matched > 0 ? "partially_matched" : "to_review",
      needs_review: !allMatched,
      confirmed_at: allMatched ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }
  });
}

async function updateAllocation(body, user) {
  const filter = orgFilter(user.organizationId);
  const rows = await supabaseRequest(`receipt_allocations?id=eq.${encodeURIComponent(body.id)}&${filter}&select=*&limit=1`);
  const allocation = rows?.[0];
  if (!allocation) throw Object.assign(new Error("Abbinamento non trovato."), { statusCode: 404 });
  if (!["confirm", "reject", "reverse"].includes(body.action)) throw Object.assign(new Error("Azione non supportata."), { statusCode: 400 });

  if (body.action === "confirm") {
    const [orderLineRows, ddtLineRows, existingOrderAllocations, existingDdtAllocations] = await Promise.all([
      supabaseRequest(`purchase_order_lines?id=eq.${encodeURIComponent(allocation.purchase_order_line_id)}&${filter}&select=*&limit=1`),
      supabaseRequest(`delivery_note_lines?id=eq.${encodeURIComponent(allocation.delivery_note_line_id)}&${filter}&select=*&limit=1`),
      supabaseRequest(`receipt_allocations?purchase_order_line_id=eq.${encodeURIComponent(allocation.purchase_order_line_id)}&id=neq.${encodeURIComponent(allocation.id)}&${filter}&status=eq.confirmed&select=allocated_quantity`),
      supabaseRequest(`receipt_allocations?delivery_note_line_id=eq.${encodeURIComponent(allocation.delivery_note_line_id)}&id=neq.${encodeURIComponent(allocation.id)}&${filter}&status=eq.confirmed&select=allocated_quantity`)
    ]);
    const orderLine = orderLineRows?.[0];
    const ddtLine = ddtLineRows?.[0];
    if (!orderLine || !ddtLine) throw Object.assign(new Error("Righe collegate non disponibili."), { statusCode: 409 });
    if (normalizeUnit(orderLine.unit_of_measure) !== normalizeUnit(ddtLine.unit_of_measure)) {
      throw Object.assign(new Error("Unita di misura diverse: correggi le righe prima di confermare."), { statusCode: 409 });
    }
    const quantity = number(allocation.allocated_quantity);
    const ddtAlreadyAllocated = (existingDdtAllocations || []).reduce((sum, row) => sum + number(row.allocated_quantity), 0);
    if (ddtAlreadyAllocated + quantity > number(ddtLine.delivered_quantity)) {
      throw Object.assign(new Error("La quantita assegnata supera quella indicata nel DDT."), { statusCode: 409 });
    }
    const tolerance = await settingNumber("receiving.overdelivery_tolerance_percent", 0, user.organizationId);
    const maximum = number(orderLine.ordered_quantity) * (1 + Math.max(0, tolerance) / 100);
    const alreadyReceived = (existingOrderAllocations || []).reduce((sum, row) => sum + number(row.allocated_quantity), 0);
    if (alreadyReceived + quantity > maximum) {
      throw Object.assign(new Error("La consegna supera la quantita ordinata e la tolleranza configurata."), { statusCode: 409 });
    }
  }

  const status = body.action === "confirm" ? "confirmed" : body.action === "reject" ? "rejected" : "reversed";
  const now = new Date().toISOString();
  await supabaseRequest(`receipt_allocations?id=eq.${encodeURIComponent(allocation.id)}&${filter}`, {
    method: "PATCH",
    body: {
      status,
      confirmed_by: body.action === "confirm" ? user.email : null,
      confirmed_at: body.action === "confirm" ? now : null,
      notes: body.notes || allocation.notes || null,
      updated_at: now
    }
  });
  await recalculateOrderLine(allocation.purchase_order_line_id, user.organizationId);
  await recalculateDeliveryNote(allocation.delivery_note_line_id, user.organizationId);
  await supabaseRequest("activities", {
    method: "POST",
    body: withOrg({
      title: body.action === "confirm" ? "Ricezione DDT confermata" : body.action === "reject" ? "Abbinamento DDT rifiutato" : "Ricezione DDT annullata",
      type: "Operativo",
      detail: `Abbinamento ricezione ${allocation.id} aggiornato da ${user.email}.`,
      date: now
    }, user.organizationId)
  });
}

export default async function handler(request, response) {
  const roles = request.method === "GET" ? ["Owner", "IT", "Admin", "Buyer", "ReadOnly"] : ["Owner", "IT", "Admin", "Buyer"];
  const user = await authorizeApiRequest(request, response, { roles });
  if (!user) return;
  if (!await moduleEnabled(user.organizationId)) {
    response.status(404).json({ error: "Modulo Ricevimenti non attivo per questa organizzazione." });
    return;
  }

  try {
    if (request.method === "GET") {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await receivingData(user.organizationId));
      return;
    }
    if (request.method === "POST") {
      await updateAllocation(request.body || {}, user);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await receivingData(user.organizationId));
      return;
    }
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: "Unable to manage receiving", detail: error.message });
  }
}
