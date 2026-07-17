import baseConfig from "./base.config";
import novaVisionConfig from "./novaVision.config";

// Configurazione cliente: Graphic Center Group Srl
// Compilata da ORDERWATCH ONBOARDING - GRAPHIC CENTER GROUP SRL (giugno 2026).
// Punti ancora da confermare con il cliente sono segnalati con commenti "DA CONFERMARE".

const customerConfig = {
  ...baseConfig,
  product: {
    name: "OrderWatch",
    // Niente nome cliente qui: nella dashboard il nome cliente compare SOLO
    // come testo in Topbar (in alto a destra). Questa tagline e' generica
    // e visibile in piu' punti (Sidebar, Topbar), quindi resta client-agnostic.
    tagline: "Monitoraggio ordini materiali"
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
    orderWatchLogoUrl: "/brand/orderwatch-lockup-light.png",
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
  // Da giugno 2026: usata SOLO nella pagina di Login (vedi src/App.jsx,
  // loginThemeStyle). La dashboard vera e propria non usa piu' questa
  // palette: mostra sempre il brand ufficiale OrderWatch "Graphite & Coral"
  // (base.config.js), con il nome del cliente solo come testo in Topbar.
  theme: {
    ...baseConfig.theme,
    primary: "#17213C", // blu inchiostro profondo
    primaryDark: "#0E1526", // inchiostro ancora piu' profondo, per gradienti/hover
    primarySoft: "#EAEDF3", // tinta tenue per sfondi e stati attivi
    accent: "#F0442E", // rosso tipografico
    accentSoft: "#FCEAE6", // tinta tenue del rosso per badge/hover
    success: "#2D8653",
    warning: "#F59E0B",
    critical: "#C85B24",
    danger: "#DC2626",
    background: "#F8F7F4", // carta naturale
    sidebar: "#FFFFFF",
    sidebarActive: "#17213C",
    card: "#FFFFFF",
    text: "#111827",
    textMuted: "#6B7280",
    border: "#E3DED6",
    muted: "#F1ECE5",
    // Palette grafici derivata dai colori brand, per distinguere meglio le serie.
    chart1: "#17213C",
    chart2: "#F0442E",
    chart3: "#F59E0B",
    chart4: "#2D8653",
    chart5: "#9CA9BE"
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
    ],
    suppliers: ["name", "email", "onTimeRate", "openOrders", "risk", "score"],
    projects: ["projectCode", "customer", "owner", "status", "dueDate", "openOrders"],
    documents: ["name", "type", "supplierName", "linkedOrder", "confidence", "receivedAt"],
    invoices: ["invoiceNumber", "supplierName", "totalAmount", "invoiceDate", "dueDate", "linked", "status"],
    // Aggiunta: mancava la colonna per la pagina Importazioni (ImportsView), che
    // quindi mostrava una tabella senza colonne in produzione. linkedProjectCode
    // (non linkedOrderCode, che non esiste nella tabella Airtable "Processed Emails").
    processedEmails: ["receivedAt", "subject", "from", "classification", "status", "linkedProjectCode", "errorDetail"]
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

const selectedConfig = import.meta.env.VITE_CUSTOMER_PROFILE === "nova-vision"
  ? novaVisionConfig
  : customerConfig;

export default selectedConfig;
