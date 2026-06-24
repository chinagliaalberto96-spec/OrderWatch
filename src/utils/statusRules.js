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
  CLOSED: "Concluso"
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
    CLOSED: "muted"
  }[status] || "muted";
}
