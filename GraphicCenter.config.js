// NOTA: questo file e' superato. La configurazione attiva per Graphic Center
// Group ora vive in src/config/customer.config.js (importata da src/App.jsx),
// con terminologia, soglie alert e colonne tabella personalizzate secondo il
// form di onboarding. Questo file resta solo come bozza storica - non e'
// referenziato da nessuna parte dell'app.
const baseConfig = {
  product: {
    name: "OrderWatch",
    tagline: "Supplier order monitoring"
  },
  company: {
    name: "Graphic Center Group",
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
    accent: "#38BDF8",
    background: "#F6F8FB",
    sidebar: "#FFFFFF",
    card: "#FFFFFF",
    text: "#111827",
    textMuted: "#64748B",
    border: "#D9E1EC",
    success: "#16A34A",
    warning: "#F59E0B",
    critical: "#F97316",
    danger: "#DC2626",
    muted: "#EEF2F7"
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
    ]
  }
};

export default baseConfig;
