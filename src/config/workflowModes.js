export const WORKFLOW_MODES = [
  {
    value: "supplier_only",
    label: "Essenziale",
    summary: "Fornitori, materiali, quantità e date, senza codici obbligatori.",
    today: "Solo ritardi, anomalie, errori e dati realmente dubbi.",
    links: "Nessun collegamento a commessa o ordine richiesto.",
    ddt: "Registra ricevuto e residuo; segnala soltanto le differenze.",
    invoices: "Archivia e segnala anomalie evidenti.",
    policy: {
      requiresLinks: false,
      suggestsLinks: false,
      exceptionsOnly: true,
      showWeekFilter: false,
      allowSupplierOrderPreparation: false,
      createOrderFromUnmatchedDdt: false,
      groupSupplierMaterialLines: true
    }
  },
  {
    value: "assisted_link",
    label: "Assistita",
    summary: "Aggiunge suggerimenti senza bloccare il lavoro quotidiano.",
    today: "Criticità reali; i suggerimenti restano in una sezione separata.",
    links: "Propone commessa, ordine e corrispondenze, senza renderli obbligatori.",
    ddt: "Propone ordine e righe compatibili; non crea ordini tecnici da solo.",
    invoices: "Propone il confronto con ordine e DDT.",
    policy: {
      requiresLinks: false,
      suggestsLinks: true,
      exceptionsOnly: false,
      showWeekFilter: true,
      allowSupplierOrderPreparation: true,
      createOrderFromUnmatchedDdt: false,
      groupSupplierMaterialLines: true
    }
  },
  {
    value: "required_link",
    label: "Completa",
    summary: "Commessa, ordine e documenti fanno parte del controllo completo.",
    today: "Include anche collegamenti e attività obbligatorie mancanti.",
    links: "Commessa e ordine devono essere collegati prima della chiusura.",
    ddt: "Controlla quadratura e consegne parziali; può ricostruire un ordine da verificare.",
    invoices: "Controlla la catena ordine, DDT e fattura.",
    policy: {
      requiresLinks: true,
      suggestsLinks: false,
      exceptionsOnly: false,
      showWeekFilter: true,
      allowSupplierOrderPreparation: true,
      createOrderFromUnmatchedDdt: true,
      groupSupplierMaterialLines: true
    }
  }
];

export const WORKFLOW_MODE_VALUES = WORKFLOW_MODES.map((mode) => mode.value);

export function getWorkflowMode(value) {
  return WORKFLOW_MODES.find((mode) => mode.value === value)
    || WORKFLOW_MODES.find((mode) => mode.value === "required_link");
}

export function getWorkflowPolicy(value) {
  return getWorkflowMode(value).policy;
}
