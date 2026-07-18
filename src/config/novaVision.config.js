import baseConfig from "./base.config";

const novaVisionConfig = {
  ...baseConfig,
  product: {
    name: "OrderWatch",
    tagline: "Controllo acquisti, ricezioni e materiali"
  },
  company: {
    ...baseConfig.company,
    name: "Nova Vision Srl",
    logoUrl: "/brand/nova-vision-company-logo.png",
    sector: "Stampa con inchiostri ad acqua su materiali plastici e soluzioni per superfici tecniche"
  },
  brand: {
    clientInitials: "NV",
    orderWatchInitials: "OW",
    orderWatchLogoUrl: "/brand/orderwatch-lockup-light.png",
    loginImageUrl: null
  },
  login: {
    logoLayout: "banner",
    headline: "Ordini, materiali e consegne sotto controllo.",
    description: "OrderWatch collega ordini fornitori, conferme, DDT, consegne parziali e disponibilità dei materiali.",
    emailPlaceholder: "nome@novavisioncompany.it",
    footer: "Dashboard operativa Nova Vision collegata a un ambiente dati dedicato."
  },
  terminology: {
    ...baseConfig.terminology,
    projectsPlural: "Produzioni",
    projectSingular: "Produzione",
    ordersPlural: "Ordini fornitori",
    orderSingular: "Ordine fornitore",
    suppliersPlural: "Fornitori",
    supplierSingular: "Fornitore",
    documentsPlural: "Documenti",
    documentSingular: "Documento",
    importsPlural: "Acquisizioni",
    importSingular: "Acquisizione",
    dueDate: "Data consegna prevista",
    material: "Articolo / Componente",
    customer: "Cliente",
    owner: "Responsabile"
  },
  // La login usa il logo Nova Vision ma mantiene la palette ufficiale
  // OrderWatch. La dashboard usa sempre il brand del prodotto.
  theme: {
    ...baseConfig.theme
  },
  modules: {
    ...baseConfig.modules
  },
  alertRules: {
    warningDays: 7,
    criticalDays: 3,
    overdueDays: 0,
    reminderDaysBeforeDue: 5,
    escalationDaysBeforeDue: 2
  }
};

export default novaVisionConfig;
