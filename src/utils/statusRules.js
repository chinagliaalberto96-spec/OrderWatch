import { daysFromToday } from "./dateUtils";

// Etichette di stato richieste da Graphic Center Group (sezione 4.8 onboarding):
// SCADUTO / CRITICO / ATTENZIONE / IN CORSO, piu i due stati operativi del kit
// (Da verificare, Concluso) necessari per il flusso di revisione AI e per gli
// ordini chiusi/consegnati.
export const statusLabels = {
  OVERDUE: "Scaduto",
  CRITICAL: "Critico",
  WARNING: "Attenzione",
  OK: "In corso",
  TO_VERIFY: "Da verificare",
  CLOSED: "Concluso",
  // Stati lavoro (Lavori/Projects): salvati in italiano direttamente sul
  // record, non fanno parte del sistema di alert ordini sopra. Servono solo
  // perche' StatusBadge sappia associare loro un tono leggibile (altrimenti
  // ricadevano tutti sul fallback "muted", quasi invisibile).
  PROJECT_QUOTE: "Preventivo",
  PROJECT_OPEN: "Aperto",
  PROJECT_PRODUCTION: "In produzione",
  PROJECT_CANCELLED: "Annullato"
};

export function getOrderStatus(order, alertRules) {
  if (!order || order.needsReview) return "TO_VERIFY";
  if (order.status === "CLOSED") return "CLOSED";
  const daysRemaining = order.daysRemaining ?? daysFromToday(order.dueDate);
  if (daysRemaining === null) return "TO_VERIFY";
  if (daysRemaining < alertRules.overdueDays) return "OVERDUE";
  if (daysRemaining <= alertRules.criticalDays) return "CRITICAL";
  if (daysRemaining <= alertRules.warningDays) return "WARNING";
  return "OK";
}

export function getStatusTone(status) {
  return {
    OVERDUE: "danger",
    CRITICAL: "critical",
    WARNING: "warning",
    OK: "success",
    TO_VERIFY: "muted",
    CLOSED: "muted",
    PROJECT_QUOTE: "warning",
    PROJECT_OPEN: "success",
    PROJECT_PRODUCTION: "primary",
    PROJECT_CANCELLED: "danger"
  }[status] || "muted";
}
