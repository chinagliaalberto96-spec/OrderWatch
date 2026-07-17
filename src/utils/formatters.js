export function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "-";
  // Nel backend prodotto alcuni campi (es. quantity) sono testo libero
  // tipo "125 FG": se il valore non e' numerico va mostrato cosi' com'e'.
  const numeric = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat("it-IT").format(numeric);
}

export function formatPercent(value) {
  if (value === null || value === undefined) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return new Intl.NumberFormat("it-IT", {
    style: "percent",
    maximumFractionDigits: 0
  }).format(normalized);
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
    errorDetail: "Errore",
    invoiceNumber: "Numero fattura",
    totalAmount: "Importo",
    invoiceDate: "Data fattura",
    linked: "Ordine/Lavoro"
  };
  return labels[column] || column;
}
