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
    dueDate: "Data consegna promessa",
    material: "Materiale / Componente",
    customer: "Cliente",
    owner: "Responsabile"
  },
  theme: {
    primary: "#2563EB",
    primaryDark: "#1D4ED8",
    primarySoft: "#EFF4FE",
    accent: "#38BDF8",
    accentSoft: "#E6F7FF",
    background: "#F6F8FB",
    sidebar: "#FFFFFF",
    sidebarActive: "#2563EB",
    card: "#FFFFFF",
    text: "#111827",
    textMuted: "#64748B",
    border: "#D9E1EC",
    success: "#16A34A",
    warning: "#F59E0B",
    critical: "#F97316",
    danger: "#DC2626",
    muted: "#EEF2F7",
    chart1: "#2563EB",
    chart2: "#38BDF8",
    chart3: "#F59E0B",
    chart4: "#16A34A",
    chart5: "#94A3B8"
  },
  modules: {
    dashboard: true,
    orders: true,
    projects: true,
    suppliers: true,
    documents: true,
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
    documents: ["name", "type", "supplierName", "linkedOrder", "confidence", "receivedAt"]
  }
};

export default baseConfig;
