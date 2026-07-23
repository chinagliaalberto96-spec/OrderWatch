import contactsHandler from "../server/routes/contacts.js";
import contractBillingItemsHandler from "../server/routes/contract-billing-items.js";
import contractProgressReportsHandler from "../server/routes/contract-progress-reports.js";
import contractProjectsHandler from "../server/routes/contract-projects.js";
import customerConfirmationsHandler from "../server/routes/customer-confirmations.js";
import mailboxesHandler from "../server/routes/mailboxes.js";
import operationalActionsHandler from "../server/routes/operational-actions.js";
import ordersHandler from "../server/routes/orders.js";
import projectsHandler from "../server/routes/projects.js";
import procurementRequirementsHandler from "../server/routes/procurement-requirements.js";
import receivingHandler from "../server/routes/receiving.js";
import supplierOrdersHandler from "../server/routes/supplier-orders.js";
import suppliersHandler from "../server/routes/suppliers.js";
import orderOperationalViewHandler from "../server/routes/order-operational-view.js";
import alteraHandler from "../server/routes/altera.js";
import alteraTelegramHandler from "../server/routes/altera-telegram.js";
import telegramConnectionsHandler from "../server/routes/telegram-connections.js";

const handlers = {
  altera: alteraHandler,
  "altera-telegram": alteraTelegramHandler,
  contacts: contactsHandler,
  "contract-billing-items": contractBillingItemsHandler,
  "contract-progress-reports": contractProgressReportsHandler,
  "contract-projects": contractProjectsHandler,
  "customer-confirmations": customerConfirmationsHandler,
  mailboxes: mailboxesHandler,
  "operational-actions": operationalActionsHandler,
  orders: async function(request, response) {
    const route = normalizeAppRoute(request.query?.route);
    if (route === 'order-operational-view') {
      return orderOperationalViewHandler(request, response);
    }
    return ordersHandler(request, response);
  },
  "order-operational-view": orderOperationalViewHandler,
  projects: projectsHandler,
  "procurement-requirements": procurementRequirementsHandler,
  receiving: receivingHandler,
  "supplier-orders": supplierOrdersHandler,
  suppliers: suppliersHandler,
  "telegram-connections": telegramConnectionsHandler
};

export function normalizeAppRoute(rawRoute) {
  if (Array.isArray(rawRoute)) return String(rawRoute[0] || "").trim();
  return String(rawRoute || "").trim();
}

export default async function handler(request, response) {
  const route = normalizeAppRoute(request.query?.route);
  const selected = handlers[route];
  if (!selected) {
    response.status(404).json({ error: "Application route not found." });
    return;
  }
  await selected(request, response);
}
