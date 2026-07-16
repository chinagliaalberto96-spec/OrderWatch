// Test workflow ordini fornitore — SMTP in DRY RUN, nessuna email reale.
// Esegui con:  SUPPLIER_ORDER_SMTP_DRY_RUN=true node --env-file=.env.local scripts/test-supplier-orders.js
// Crea fixture temporanee, esercita l'endpoint api/supplier-orders.js e pulisce tutto a fine test.

import handler from "../api/supplier-orders.js";
import { supabaseRequest } from "../api/_supabaseRest.js";

process.env.SUPPLIER_ORDER_SMTP_DRY_RUN = "true";

const stamp = Date.now();
let failures = 0;
const created = { supplierIds: [], lineIds: [], dispatchIds: [], orderCodes: [], reminderIds: [] };

function assert(name, cond, extra = "") {
  console.log(`${cond ? "OK  " : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
  if (!cond) failures += 1;
}

async function call(body) {
  let statusCode = 200;
  let json = null;
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(payload) { json = payload; return this; }
  };
  await handler({ method: "POST", body }, res);
  return { statusCode, json };
}

async function makeLine({ supplierId, supplierName, supplierEmail, withProject = true }) {
  const rows = await supabaseRequest("material_lines", {
    method: "POST",
    body: {
      source_type: "customer_request",
      description: `Materiale test ${stamp}-${Math.random().toString(36).slice(2, 6)}`,
      quantity: "100",
      unit: "pz",
      project_code: withProject ? `LAV-TESTSO-${stamp}` : null,
      supplier_id: supplierId || null,
      supplier_name: supplierName || null,
      needs_review: false
    },
    headers: { Prefer: "return=representation" }
  });
  const id = rows[0].id;
  created.lineIds.push(id);
  return rows[0];
}

async function main() {
  // Fixtures: un fornitore CON email
  const supRows = await supabaseRequest("suppliers", {
    method: "POST",
    body: { name: `Fornitore Test SO ${stamp}`, email: `fornitore.test.${stamp}@example.com`, normalized_name: `FORNITORETESTSO${stamp}` },
    headers: { Prefer: "return=representation" }
  });
  const supplier = supRows[0];
  created.supplierIds.push(supplier.id);

  // 1. Bozza da UNA riga materiale
  const line1 = await makeLine({ supplierId: supplier.id, supplierName: supplier.name });
  let r = await call({ action: "prepare", materialLineIds: [line1.id] });
  const d1 = r.json?.dispatch;
  if (d1?.id) { created.dispatchIds.push(d1.id); created.orderCodes.push(d1.orderCode); }
  assert("1. Bozza da una riga materiale", r.statusCode === 200 && d1?.status === "draft" && d1?.lines.length === 1, d1?.orderCode);

  // 2. Bozza con PIU' materiali (stesso fornitore)
  const line2 = await makeLine({ supplierId: supplier.id, supplierName: supplier.name });
  const line3 = await makeLine({ supplierId: supplier.id, supplierName: supplier.name });
  r = await call({ action: "prepare", materialLineIds: [line2.id, line3.id] });
  const d2 = r.json?.dispatch;
  if (d2?.id) { created.dispatchIds.push(d2.id); created.orderCodes.push(d2.orderCode); }
  assert("2. Bozza con piu' materiali", r.statusCode === 200 && d2?.lines.length === 2);

  // 6. Idempotenza preparazione: ripreparare le stesse righe -> stesso dispatch
  r = await call({ action: "prepare", materialLineIds: [line2.id, line3.id] });
  assert("6. Idempotenza preparazione", r.json?.dispatch?.id === d2?.id, `${r.json?.dispatch?.id === d2?.id}`);

  // 5. Salvataggio e modifica bozza
  r = await call({ action: "update", id: d1.id, subject: "Ordine modificato test", contactName: "Mario Rossi" });
  assert("5. Modifica bozza", r.statusCode === 200 && r.json?.dispatch?.subject === "Ordine modificato test");

  // 3. Blocco se manca il fornitore (email): riga senza fornitore/email
  const orphanLine = await makeLine({ withProject: true });
  r = await call({ action: "prepare", materialLineIds: [orphanLine.id] });
  const dOrphan = r.json?.dispatch;
  if (dOrphan?.id) { created.dispatchIds.push(dOrphan.id); created.orderCodes.push(dOrphan.orderCode); }
  await call({ action: "approve", id: dOrphan.id });
  r = await call({ action: "send", id: dOrphan.id });
  assert("3. Blocco invio se manca email fornitore", r.statusCode === 409 && /email fornitore/i.test(r.json?.detail || ""), r.json?.detail);

  // 4. Blocco se manca la mailbox mittente (id inesistente).
  // Bozza dedicata con email valida, cosi' il blocco scatta sulla mailbox e non sull'email.
  const line4 = await makeLine({ supplierId: supplier.id, supplierName: supplier.name });
  r = await call({ action: "prepare", materialLineIds: [line4.id] });
  const d4 = r.json?.dispatch;
  if (d4?.id) { created.dispatchIds.push(d4.id); created.orderCodes.push(d4.orderCode); }
  await call({ action: "update", id: d4.id, supplierEmail: supplier.email });
  await call({ action: "approve", id: d4.id });
  r = await call({ action: "send", id: d4.id, senderMailboxId: "00000000-0000-0000-0000-000000000000" });
  assert("4. Blocco invio se manca mailbox", r.statusCode === 409 && /casella aziendale/i.test(r.json?.detail || ""), r.json?.detail);

  // Modifica dopo approvazione riporta a bozza (richiede ri-approvazione)
  r = await call({ action: "update", id: d4.id, subject: "Nuovo oggetto post-approvazione" });
  assert("Modifica post-approvazione torna a bozza", r.json?.dispatch?.status === "draft");

  // 8. Simulazione SMTP (dry run) su d1: imposta email, approva, invia
  await call({ action: "update", id: d1.id, supplierEmail: supplier.email });
  r = await call({ action: "approve", id: d1.id });
  assert("Approvazione ordine", r.statusCode === 200 && r.json?.dispatch?.status === "approved");
  r = await call({ action: "send", id: d1.id });
  const sent = r.json?.dispatch;
  assert("8. Invio SMTP simulato", r.statusCode === 200 && sent?.status === "waiting_confirmation" && Boolean(sent?.messageId), sent?.messageId);

  // 7. Idempotenza invio: reinviare non deve cambiare stato ne' rimandare
  r = await call({ action: "send", id: d1.id });
  assert("7. Idempotenza invio", r.statusCode === 200 && r.json?.dispatch?.messageId === sent?.messageId);

  // Verifica: nessun invio reale (dry run) + activity registrata
  const acts = await supabaseRequest(`activities?order_code=eq.${encodeURIComponent(sent.orderCode)}&select=title`);
  assert("Activity invio registrata", acts.some((a) => /Ordine fornitore inviato/i.test(a.title)));

  // 13. Creazione sollecito senza invio automatico (dispatch in waiting_confirmation = d1)
  r = await call({ action: "prepare_reminder", id: d1.id });
  const rem = r.json?.reminder;
  if (rem?.id) created.reminderIds.push(rem.id);
  assert("13. Sollecito preparato come bozza (no auto-send)", r.statusCode === 200 && rem?.status === "draft" && rem?.attempt === 1);
  // idempotenza sollecito: ripreparare -> stessa bozza
  r = await call({ action: "prepare_reminder", id: d1.id });
  assert("13b. Idempotenza preparazione sollecito", r.json?.reminder?.id === rem?.id);
  // invio sollecito in dry-run
  r = await call({ action: "send_reminder", id: rem.id });
  assert("13c. Invio sollecito simulato", r.statusCode === 200 && r.json?.reminder?.status === "sent" && Boolean(r.json?.reminder?.messageId));
}

async function cleanup() {
  for (const id of created.reminderIds) {
    await supabaseRequest(`reminders?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  }
  for (const id of created.dispatchIds) {
    await supabaseRequest(`supplier_order_dispatches?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  }
  for (const code of [...new Set(created.orderCodes)].filter(Boolean)) {
    await supabaseRequest(`activities?order_code=eq.${encodeURIComponent(code)}`, { method: "DELETE" }).catch(() => {});
    await supabaseRequest(`orders?order_code=eq.${encodeURIComponent(code)}`, { method: "DELETE" }).catch(() => {});
  }
  for (const id of created.lineIds) {
    await supabaseRequest(`material_lines?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  }
  for (const id of created.supplierIds) {
    await supabaseRequest(`suppliers?id=eq.${id}`, { method: "DELETE" }).catch(() => {});
  }
}

try {
  await main();
} catch (error) {
  console.error("Errore test:", error.message);
  failures += 1;
} finally {
  await cleanup();
  console.log("---");
  console.log(failures ? `${failures} test FALLITI` : "Tutti i test ordini fornitore OK");
  process.exit(failures ? 1 : 0);
}
