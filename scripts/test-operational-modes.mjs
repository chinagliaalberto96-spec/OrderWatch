import { buildOperationalQueue, buildOperationalSuggestions } from "../src/adapters/supabaseServerAdapter.js";
import { getWorkflowPolicy } from "../src/config/workflowModes.js";

function dateAfter(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`OK: ${message}`);
}

const input = {
  materialLines: [
    { id: "critical", description: "Materiale critico", supplierName: "Fornitore A", dueDate: dateAfter(1), confidence: 0.98, needsReview: false },
    { id: "week", description: "Materiale della settimana", supplierName: "Fornitore B", dueDate: dateAfter(5), confidence: 0.98, needsReview: false },
    { id: "review", description: "Quantita dubbia", supplierName: "Fornitore C", confidence: 0.6, needsReview: true },
    { id: "makito-1", description: "Bicchiere", supplierName: "Makito Italia Srl", sourceType: "ddt", sourceEmailId: "email-makito", orderCode: "13542272", quantity: 10, unit: "pcs", dueDate: dateAfter(2), confidence: 0.9, needsReview: true },
    { id: "makito-2", description: "Serigrafia", supplierName: "Makito Italia Srl", sourceType: "ddt", sourceEmailId: "email-makito", orderCode: "13542272", quantity: 1, unit: "pcs", dueDate: dateAfter(4), confidence: 0.9, needsReview: true },
    { id: "makito-followup", description: "Imballo", supplierId: "makito-canonical", supplierName: "MAKITO", sourceType: "supplier_confirmation", sourceEmailId: "email-makito-followup", orderCode: "0013542272", quantity: 1, unit: "pcs", dueDate: dateAfter(3), confidence: 0.9, needsReview: true },
    { id: "separate-order", description: "Altro ordine", supplierName: "Makito Italia Srl", sourceType: "ddt", sourceEmailId: "email-separata", orderCode: "999", confidence: 0.7, needsReview: true }
  ],
  quotes: [
    { id: "ferrania", quoteCode: "2382", quoteType: "supplier", supplierName: "Ferrania Grafica", status: "open", needsReview: true },
    { id: "expiring", quoteCode: "Q-URGENTE", quoteType: "supplier", supplierName: "Fornitore D", status: "open", validUntil: dateAfter(1), needsReview: false }
  ],
  deliveryNotes: [{ id: "ddt", ddtNumber: "DDT-1", supplierName: "Fornitore A", needsReview: false }],
  invoices: [],
  processedEmails: [{ id: "email-error", status: "Error", subject: "Email non elaborata", receivedAt: new Date().toISOString() }],
  buyerActions: [],
  customerConfirmations: [],
  supplierDispatches: []
};

function queueFor(mode) {
  return buildOperationalQueue({ ...input, settingsMap: { "workflow.traceability_mode": mode } });
}

const essential = queueFor("supplier_only");
const essentialIds = new Set(essential.map((item) => item.id));
check(essentialIds.has("material-line-critical"), "Essenziale mostra una consegna critica");
check(essentialIds.has("material-line-review"), "Essenziale mostra un dato realmente dubbio");
check(essentialIds.has("quote-expiring"), "Essenziale mostra un preventivo in scadenza critica");
check(essentialIds.has("processed-email-email-error"), "Essenziale mostra un errore di elaborazione");
check(!essentialIds.has("material-line-week"), "Essenziale non porta in Oggi un arrivo regolare della settimana");
check(!essentialIds.has("quote-ferrania"), "Essenziale non porta in Oggi un preventivo aperto non urgente, anche se l'estrazione e' incerta");
check(essential.every((item) => item.status !== "needs_link"), "Essenziale non chiede collegamenti a commesse o ordini");
const makitoGroup = essential.find((item) => item.kind === "supplier_material_group" && item.orderCode === "13542272");
check(makitoGroup?.lineItems.length === 2, "Essenziale raggruppa le righe dello stesso ordine fornitore");
check(new Set(makitoGroup.lineItems.map((line) => line.dueDate)).size === 2, "Il gruppo conserva una data distinta per ogni riga materiale");
check(essential.some((item) => item.id === "material-line-separate-order"), "Un altro ordine dello stesso fornitore resta separato");

const canonicalInput = {
  ...input,
  materialLines: input.materialLines.map((line) => line.id.startsWith("makito-")
    ? { ...line, supplierId: "makito-canonical" }
    : line)
};
const canonicalEssential = buildOperationalQueue({ ...canonicalInput, settingsMap: { "workflow.traceability_mode": "supplier_only" } });
const canonicalMakito = canonicalEssential.find((item) => item.kind === "supplier_material_group" && item.orderCode === "13542272");
check(canonicalMakito?.lineItems.length === 3, "Alias Makito e zeri iniziali confluiscono nello stesso ordine anche da email successive");

const assisted = queueFor("assisted_link");
check(assisted.some((item) => item.id === "quote-ferrania"), "Assistito mantiene una verifica reale sui dati del preventivo");
check(assisted.some((item) => item.id === "material-line-week"), "Assistito mantiene gli arrivi della settimana da monitorare");
check(assisted.some((item) => item.kind === "supplier_material_group" && item.orderCode === "13542272"), "Assistito mantiene gli ordini raggruppati per righe");
const suggestions = buildOperationalSuggestions({ ...input, settingsMap: { "workflow.traceability_mode": "assisted_link" } });
check(suggestions.some((item) => item.id === "suggestion-material-week"), "Assistito espone i collegamenti come suggerimenti facoltativi");

const complete = queueFor("required_link");
check(complete.some((item) => item.id === "quote-ferrania"), "Completo mantiene il preventivo aperto nel flusso operativo completo");
check(complete.some((item) => item.status === "needs_link"), "Completo include le attivita obbligatorie di collegamento");
check(complete.some((item) => item.kind === "supplier_material_group" && item.orderCode === "13542272"), "Completo mantiene gli ordini raggruppati per righe");

check(!getWorkflowPolicy("supplier_only").showWeekFilter, "Essenziale nasconde il filtro settimanale");
check(getWorkflowPolicy("assisted_link").suggestsLinks, "Assistito abilita i suggerimenti separati");
check(getWorkflowPolicy("required_link").requiresLinks, "Completo richiede i collegamenti");

console.log("Modalita operative: tutti i controlli sono passati.");
