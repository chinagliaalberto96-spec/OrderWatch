const baseConfig = {
  product: {
    name: "OrderWatch",
    tagline: "Supplier order monitoring"
  },
  company: {
    name: "Demo Company",
    logoUrl: null,
    sector: "Manufacturing"
  },
  terminology: {
    projectsPlural: "Commesse",
    projectSingular: "Commessa",
    ordersPlural: "Ordini fornitori",
    orderSingular: "Ordine",
    suppliersPlural: "Fornitori",
    supplierSingular: "Fornitore",
    documentsPlural: "Documenti",
    documentSingular: "Documento",
    importsPlural: "Importazioni",
    importSingular: "Importazione",
    dueDate: "Data consegna promessa",
    material: "Materiale / Componente",
    customer: "Cliente",
    owner: "Responsabile"
  },
  // Palette ufficiale OrderWatch "Graphite & Coral" — brand generico del prodotto,
  // usato da ogni nuovo cliente finche' non viene definita una palette dedicata
  // (es. Graphic Center Group ha la propria palette "Ink & Paper" in customer.config.js,
  // che resta invariata e ha priorita' su questi valori).
  theme: {
    primary: "#23262B", // graphite
    primaryDark: "#14161A",
    primarySoft: "#ECEDEF",
    accent: "#FF5A48", // coral
    accentSoft: "#FFE5E0",
    background: "#F7F7F6",
    sidebar: "#FFFFFF",
    sidebarActive: "#23262B",
    card: "#FFFFFF",
    text: "#1A1C1F",
    textMuted: "#6B7178",
    border: "#E2E4E7",
    success: "#2E9B63",
    warning: "#F5A623",
    critical: "#FF8A4C",
    danger: "#D92D3D",
    muted: "#F1F1EF",
    chart1: "#23262B",
    chart2: "#FF5A48",
    chart3: "#F5A623",
    chart4: "#2E9B63",
    chart5: "#9AA0A8"
  },
  modules: {
    dashboard: true,
    orders: true,
    projects: true,
    suppliers: true,
    documents: true,
    imports: true,
    scorecard: true,
    reminders: true,
    settings: true
  },
  alertRules: {
    warningDays: 7,
    criticalDays: 3,
    overdueDays: 0,
    reminderDaysBeforeDue: 7,
    escalationDaysBeforeDue: 2
  },
  tableColumns: {
    orders: [
      "orderCode",
      "supplierName",
      "projectCode",
      "material",
      "orderDate",
      "dueDate",
      "daysRemaining",
      "status",
      "owner"
    ],
    suppliers: ["name", "email", "onTimeRate", "openOrders", "risk", "score"],
    projects: ["projectCode", "customer", "owner", "status", "dueDate", "openOrders"],
    documents: ["name", "type", "supplierName", "linkedOrder", "confidence", "receivedAt"],
    processedEmails: ["receivedAt", "subject", "from", "classification", "status", "linkedProjectCode", "errorDetail"]
  }
};

export default baseConfig;
