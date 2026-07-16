import { createClient } from "@supabase/supabase-js";

process.env.AUTH_MODE = "legacy";
process.env.LEGACY_ORGANIZATION_SLUG = "nova-vision";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { default: handler } = await import("../api/receiving.js");
const stamp = Date.now();
const ids = { supplier: null, order: null, orderLine: null, note: null, noteLine: null, allocation: null };
let orgId;

async function insert(table, row) {
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

async function call(method, body) {
  const response = responseCapture();
  await handler({ method, body, headers: {} }, response);
  if (response.statusCode >= 400) throw new Error(`${response.statusCode}: ${response.payload?.detail || response.payload?.error}`);
  return response.payload;
}

async function cleanup() {
  if (ids.allocation && orgId) {
    await db.from("activities").delete().eq("organization_id", orgId).ilike("detail", `%${ids.allocation}%`);
  }
  if (ids.allocation) await db.from("receipt_allocations").delete().eq("id", ids.allocation);
  if (ids.noteLine) await db.from("delivery_note_lines").delete().eq("id", ids.noteLine);
  if (ids.note) await db.from("delivery_notes").delete().eq("id", ids.note);
  if (ids.orderLine) await db.from("purchase_order_lines").delete().eq("id", ids.orderLine);
  if (ids.order) await db.from("orders").delete().eq("id", ids.order);
  if (ids.supplier) await db.from("suppliers").delete().eq("id", ids.supplier);
}

try {
  const { data: org, error } = await db.from("organizations").select("id").eq("slug", "nova-vision").single();
  if (error) throw error;
  orgId = org.id;
  ids.supplier = (await insert("suppliers", { organization_id: orgId, name: "Fixture API Ricezioni" })).id;
  ids.order = (await insert("orders", { organization_id: orgId, order_code: `NV-API-${stamp}`, supplier_id: ids.supplier, supplier_name: "Fixture API Ricezioni", material: "Componente API", quantity: "100 pz", status: "Confermato" })).id;
  ids.orderLine = (await insert("purchase_order_lines", { organization_id: orgId, order_id: ids.order, line_number: 1, description: "Componente API", ordered_quantity: 100, confirmed_quantity: 100, unit_of_measure: "pz", status: "confirmed" })).id;
  ids.note = (await insert("delivery_notes", { organization_id: orgId, ddt_number: `API-${stamp}`, supplier_id: ids.supplier, supplier_name: "Fixture API Ricezioni", order_id: ids.order, order_code: `NV-API-${stamp}`, status: "to_review", needs_review: true })).id;
  ids.noteLine = (await insert("delivery_note_lines", { organization_id: orgId, delivery_note_id: ids.note, line_number: 1, description: "Componente API", delivered_quantity: 60, unit_of_measure: "pz", needs_review: true })).id;
  ids.allocation = (await insert("receipt_allocations", { organization_id: orgId, delivery_note_line_id: ids.noteLine, purchase_order_line_id: ids.orderLine, allocated_quantity: 60, match_method: "description", confidence: 0.9, status: "proposed" })).id;

  const before = await call("GET");
  if (before.summary.proposedMatches !== 1 || before.orderLines[0].remainingQuantity !== 100) throw new Error("GET iniziale incoerente");
  const after = await call("POST", { action: "confirm", id: ids.allocation });
  if (after.summary.proposedMatches !== 0 || after.orderLines[0].receivedQuantity !== 60 || after.orderLines[0].remainingQuantity !== 40) throw new Error("Conferma API incoerente");
  console.log("OK — GET ricezioni tenant Nova Vision");
  console.log("OK — conferma abbinamento 60/100");
  console.log("OK — residuo ricalcolato a 40");
} finally {
  await cleanup();
}
