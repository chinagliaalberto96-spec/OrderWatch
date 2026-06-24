import baseConfig from "./base.config";

// Configurazione cliente: Graphic Center Group Srl
// Compilata da ORDERWATCH ONBOARDING - GRAPHIC CENTER GROUP SRL (giugno 2026).
// Punti ancora da confermare con il cliente sono segnalati con commenti "DA CONFERMARE".

const customerConfig = {
  ...baseConfig,
  product: {
    name: "OrderWatch",
    tagline: "Monitoraggio ordini materiali — Graphic Center Group"
  },
  company: {
    ...baseConfig.company,
    name: "Graphic Center Group Srl",
    logoUrl: "/brand/GraphicCenter_logo_preview_dark.png",
    sector: "Stampa offset e digitale, grafica, materiali per display e segnaletica"
  },
  brand: {
    clientInitials: "GC",
    orderWatchInitials: "OW",
    orderWatchLogoUrl: "/brand/orderwatch-logo.png",
    loginImageUrl: null
  },
  terminology: {
    ...baseConfig.terminology,
    projectsPlural: "Lavori",
    projectSingular: "Lavoro",
    ordersPlural: "Ordini materiali",
    orderSingular: "Ordine materiale",
    suppliersPlural: "Fornitori",
    supplierSingular: "Fornitore",
    documentsPlural: "Documenti",
    documentSingular: "Documento",
    dueDate: "Data partenza prevista",
    material: "Materiale",
    customer: "Cliente",
    owner: "Responsabile"
  },
  // Palette "Ink & Paper" confermata dal cliente — ispirata alla stampa offset.
  theme: {
    ...baseConfig.theme,
    primary: "#17213C", // blu inchiostro profondo
    accent: "#F0442E", // rosso tipografico
    success: "#2D8653",
    warning: "#F59E0B",
    critical: "#C85B24",
    danger: "#DC2626",
    background: "#F8F7F4", // carta naturale
    sidebar: "#FFFFFF",
    card: "#FFFFFF",
    text: "#111827",
    textMuted: "#6B7280",
    border: "#E3DED6",
    muted: "#F1ECE5"
  },
  modules: {
    ...baseConfig.modules
  },
  alertRules: {
    // Soglie ipotizzate per il settore stampa (scadenze molto ravvicinate),
    // da validare con il cliente durante il pilota.
    warningDays: 5,
    criticalDays: 2,
    overdueDays: 0,
    reminderDaysBeforeDue: 3,
    escalationDaysBeforeDue: 1
  },
  tableColumns: {
    orders: [
      "orderCode",
      "material",
      "supplierName",
      "projectCode",
      "dueDate",
      "daysRemaining",
      "status",
      "owner"
    ]
  },
  // Ruoli previsti per Graphic Center, mappati su src/utils/permissions.js:
  //   Responsabile commerciale/operativo -> "admin" (vede e modifica tutto)
  //   Addetto acquisti                   -> "buyer" (ordini, lavori, azioni, solleciti)
  //   Produzione                          -> "viewer" (sola lettura stato lavori)
  roles: {
    "Responsabile commerciale/operativo": "admin",
    "Addetto acquisti": "buyer",
    "Produzione": "viewer"
  }
};

export default customerConfig;
