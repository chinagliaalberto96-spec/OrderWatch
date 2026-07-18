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
import alteraHandler from "../server/routes/altera.js";
import telegramConnectionsHandler from "../server/routes/telegram-connections.js";

const handlers = {
  altera: alteraHandler,
  contacts: contactsHandler,
  "contract-billing-items": contractBillingItemsHandler,
  "contract-progress-reports": contractProgressReportsHandler,
  "contract-projects": contractProjectsHandler,
  "customer-confirmations": customerConfirmationsHandler,
  mailboxes: mailboxesHandler,
  "operational-actions": operationalActionsHandler,
  orders: ordersHandler,
  projects: projectsHandler,
  "procurement-requirements": procurementRequirementsHandler,
  receiving: receivingHandler,
  "supplier-orders": supplierOrdersHandler,
  suppliers: suppliersHandler,
  "telegram-connections": telegramConnectionsHandler
};

export default async function handler(request, response) {
  const route = String(request.query?.route || "").trim();
  const selected = handlers[route];
  if (!selected) {
    response.status(404).json({ error: "Application route not found." });
    return;
  }
  await selected(request, response);
}
