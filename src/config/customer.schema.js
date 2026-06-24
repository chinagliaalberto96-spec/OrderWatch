export const customerConfigSchema = {
  product: ["name", "tagline"],
  company: ["name", "logoUrl", "sector"],
  terminology: [
    "projectsPlural",
    "projectSingular",
    "ordersPlural",
    "orderSingular",
    "suppliersPlural",
    "supplierSingular",
    "documentsPlural",
    "documentSingular",
    "dueDate",
    "material",
    "customer",
    "owner"
  ],
  theme: [
    "primary",
    "accent",
    "background",
    "sidebar",
    "card",
    "text",
    "textMuted",
    "border",
    "success",
    "warning",
    "critical",
    "danger",
    "muted"
  ],
  modules: [
    "dashboard",
    "orders",
    "projects",
    "suppliers",
    "documents",
    "scorecard",
    "reminders",
    "settings"
  ],
  alertRules: [
    "warningDays",
    "criticalDays",
    "overdueDays",
    "reminderDaysBeforeDue",
    "escalationDaysBeforeDue"
  ],
  tableColumns: ["orders"]
};
