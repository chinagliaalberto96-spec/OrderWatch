export function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("it-IT").format(value);
}

export function formatPercent(value) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("it-IT", {
    style: "percent",
    maximumFractionDigits: 0
  }).format(value);
}

export function humanizeColumn(column, terminology) {
  const labels = {
    orderCode: "ID ordine",
    supplierName: terminology.supplierSingular,
    projectCode: terminology.projectSingular,
    material: terminology.material,
    orderDate: "Data ordine",
    dueDate: terminology.dueDate,
    // Etichetta richiesta dal cliente per la colonna giorni mancanti.
    daysRemaining: "Giorni mancanti",
    status: "Stato",
    owner: terminology.owner,
    quantity: "Quantita",
    aiConfidence: "AI confidence",
    // Colonne tabelle Fornitori / Lavori / Documenti.
    name: "Nome",
    email: "Email",
    onTimeRate: "Puntualita",
    openOrders: terminology.ordersPlural,
    risk: "Rischio",
    score: "Score",
    customer: terminology.customer,
    type: "Tipo",
    linkedOrder: terminology.orderSingular,
    confidence: "AI confidence",
    receivedAt: "Ricevuto il",
    subject: "Oggetto",
    from: "Mittente",
    classification: "Classificazione",
    linkedOrderCode: "Ordine collegato",
    linkedProjectCode: "Lavoro collegato",
    errorDetail: "Errore"
  };
  return labels[column] || column;
}
