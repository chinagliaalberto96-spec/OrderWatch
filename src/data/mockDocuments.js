// Documenti acquisiti via email (casella Hostinger). Le confidence per Fedrigoni
// e Sunclear ricalcano le stime indicate nell'onboarding (layout tabellare
// professionale Fedrigoni ~97%+, layout piu' semplice Sunclear ~93%+). La conferma
// Cartaria Subalpina ha confidence piu' bassa per la data scritta in modo ambiguo.
export const mockDocuments = [
  {
    id: "doc_gcg101_conferma",
    name: "Conferma_GCG-101_Fedrigoni_13974707.pdf",
    type: "Conferma ordine",
    supplierName: "Fedrigoni",
    linkedOrder: "GCG-101",
    confidence: 0.97,
    receivedAt: "2026-05-22"
  },
  {
    id: "doc_gcg101_ddt",
    name: "DDT_GCG-101_Fedrigoni.pdf",
    type: "DDT",
    supplierName: "Fedrigoni",
    linkedOrder: "GCG-101",
    confidence: 0.95,
    receivedAt: "2026-06-11"
  },
  {
    id: "doc_gcg118_conferma",
    name: "Conferma_GCG-118_Sunclear_399863.pdf",
    type: "Conferma ordine",
    supplierName: "Sunclear Italia",
    linkedOrder: "GCG-118",
    confidence: 0.93,
    receivedAt: "2026-06-11"
  },
  {
    id: "doc_gcg124_conferma",
    name: "Conferma_GCG-124_CartariaSubalpina.pdf",
    type: "Conferma ordine",
    supplierName: "Cartaria Subalpina",
    linkedOrder: "GCG-124",
    confidence: 0.81,
    receivedAt: "2026-06-16"
  }
];
