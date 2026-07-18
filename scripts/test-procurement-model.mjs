import assert from "node:assert/strict";
import {
  canPrepareSupplierOrderFromLine,
  isCustomerRequirement,
  isProcurementRequirement,
  splitProjectOperationalLines
} from "../src/utils/procurement.js";
import { assertOrderableCanonicalLines } from "../server/routes/supplier-orders.js";
import { buildOperationalQueue } from "../src/adapters/supabaseServerAdapter.js";

const customerDeliverable = {
  id: "customer-1",
  entityKind: "project_requirement",
  sourceType: "customer_request",
  description: "50 card da stampare",
  quantity: 50,
  unit: "PZ",
  status: "Richiesto",
  needsReview: false
};
const approvedNeed = {
  id: "need-1",
  entityKind: "procurement_requirement",
  sourceType: "procurement_requirement",
  description: "Carta patinata 300 g",
  quantity: 2,
  unit: "RISME",
  status: "Da ordinare",
  needsReview: false
};
const draftNeed = { ...approvedNeed, id: "need-2", status: "Da definire", needsReview: true };

assert.equal(isCustomerRequirement(customerDeliverable), true);
assert.equal(isProcurementRequirement(customerDeliverable), false);
assert.equal(canPrepareSupplierOrderFromLine(customerDeliverable), false,
  "Un prodotto richiesto dal cliente non deve diventare automaticamente un ordine fornitore");
assert.equal(canPrepareSupplierOrderFromLine(approvedNeed), true);
assert.equal(canPrepareSupplierOrderFromLine(draftNeed), false);

const groups = splitProjectOperationalLines([customerDeliverable, approvedNeed, draftNeed]);
assert.equal(groups.customerRequirements.length, 1);
assert.equal(groups.procurementRequirements.length, 2);
assert.equal(groups.purchaseOrderLines.length, 0);

assert.throws(
  () => assertOrderableCanonicalLines([{ entity_kind: "project_requirement" }]),
  (error) => error.statusCode === 409 && /prodotto finito/i.test(error.message)
);
assert.throws(
  () => assertOrderableCanonicalLines([{
    entity_kind: "procurement_requirement",
    description: "Carta patinata",
    quantity: 2,
    unit: "RISME",
    status: "Da definire",
    needs_review: true
  }]),
  (error) => error.statusCode === 409 && /approva/i.test(error.message)
);
assert.doesNotThrow(() => assertOrderableCanonicalLines([{
  entity_kind: "procurement_requirement",
  description: "Carta patinata",
  quantity: 2,
  unit: "RISME",
  status: "Da ordinare",
  needs_review: false
}]));

const operationalQueue = buildOperationalQueue({
  materialLines: [{
    ...approvedNeed,
    createdAt: "2026-07-18T08:00:00.000Z",
    dueDate: "2026-08-30",
    projectCode: "LAV-TEST"
  }],
  quotes: [],
  deliveryNotes: [],
  invoices: [],
  processedEmails: [],
  buyerActions: [],
  operationalActions: [],
  customerConfirmations: [],
  supplierDispatches: [],
  settingsMap: {
    "workflow.traceability_mode": "required_link",
    "modules.supplier_orders": "true"
  }
});
assert.equal(operationalQueue.length, 1,
  "Un fabbisogno approvato deve restare nella coda operativa anche con scadenza lontana");
assert.equal(operationalQueue[0].status, "procurement_pending");
assert.equal(operationalQueue[0].canPrepareSupplierOrder, true);
assert.equal(operationalQueue[0].actionLabel, "Prepara ordine fornitore");

console.log("Procurement model tests passed.");
