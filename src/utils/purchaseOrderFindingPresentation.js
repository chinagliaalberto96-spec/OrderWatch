export const PURCHASE_ORDER_FINDING_FACTUAL_COPY = Object.freeze({
  ORDER_LINK_MISSING:
    "L'ordine collegato alla segnalazione non risulta disponibile nell'organizzazione corrente.",
  DANGLING_PROVENANCE:
    "Un riferimento di provenienza non può essere collegato all'evidenza attesa.",
  DOCUMENT_LINK_UNPROVEN:
    "Il collegamento tra uno o più documenti e l'ordine non è confermato in modo deterministico.",
  OPERATIONAL_STATE_UNEXPLAINED:
    "Lo stato operativo corrente non è completamente spiegato dai dati disponibili.",
  LINE_WITHOUT_EVIDENCE:
    "Una o più righe non hanno una fonte di evidenza collegata.",
  QUANTITY_CONFLICT:
    "Le fonti disponibili riportano quantità differenti per una o più righe.",
  DATE_CONFLICT:
    "Le date disponibili non risultano coerenti tra loro.",
  DUPLICATE_LINE:
    "Una o più righe potrebbero rappresentare lo stesso elemento e richiedono una verifica."
});

export const UNKNOWN_PURCHASE_ORDER_FINDING_FACTUAL_COPY =
  "È presente una segnalazione di qualità dati da verificare.";

export function getPurchaseOrderFindingFactualCopy(findingType) {
  return PURCHASE_ORDER_FINDING_FACTUAL_COPY[findingType]
    || UNKNOWN_PURCHASE_ORDER_FINDING_FACTUAL_COPY;
}
