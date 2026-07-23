// Adapter browser verso le API serverless del progetto (/api/*). La sorgente
// dati ufficiale e' Supabase; Airtable resta solo fallback tecnico server-side.
export function createApiAdapter(dataSource, { getAccessToken } = {}) {
  const suffix = dataSource ? `?source=${encodeURIComponent(dataSource)}` : "";

  async function apiFetch(url, options = {}) {
    const token = getAccessToken ? await getAccessToken() : null;
    return fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });
  }

  async function parseOrThrow(response, label) {
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const error = new Error(details.detail || details.error || `${label} failed: ${response.status}`);
      // Structured status lets callers branch on the real HTTP outcome
      // instead of pattern-matching the error message text.
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  return {
    async getDashboardData() {
      const response = await apiFetch(`/api/dashboard${suffix}`);
      return parseOrThrow(response, "Dashboard API");
    },

    async getReceivingData() {
      const response = await apiFetch("/api/receiving");
      return parseOrThrow(response, "Receiving API");
    },

    async receivingAction(payload) {
      const response = await apiFetch("/api/receiving", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseOrThrow(response, "Receiving action API");
    },

    async getAlteraChat(conversationId = null) {
      const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
      const response = await apiFetch(`/api/altera${query}`);
      return parseOrThrow(response, "Altera API");
    },

    async getOrderOperationalView(orderId, { signal } = {}) {
      const response = await apiFetch(`/api/order-operational-view?orderId=${encodeURIComponent(orderId)}`, { signal });
      return parseOrThrow(response, "Order operational view API");
    },

    async askAltera(question, conversationId = null) {
      const response = await apiFetch("/api/altera", {
        method: "POST",
        body: JSON.stringify({ question, conversationId })
      });
      return parseOrThrow(response, "Altera API");
    },

    async getTelegramConnections() {
      const response = await apiFetch("/api/telegram-connections");
      return parseOrThrow(response, "Telegram DDT API");
    },

    async telegramConnectionAction(payload) {
      const response = await apiFetch("/api/telegram-connections", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      return parseOrThrow(response, "Telegram DDT API");
    },

    async updateSetting(id, fields) {
      const response = await apiFetch(`/api/settings${suffix}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id, ...fields })
      });
      return parseOrThrow(response, "Settings API");
    },

    async updateOrder(id, fields) {
      const response = await apiFetch("/api/orders", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id, ...fields })
      });
      return parseOrThrow(response, "Orders API");
    },

    async updateProject(id, fields) {
      const response = await apiFetch("/api/projects", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id, ...fields })
      });
      return parseOrThrow(response, "Projects API");
    },

    async saveContractProject(fields) {
      const response = await apiFetch("/api/contract-projects", {
        method: fields.id ? "PATCH" : "POST",
        body: JSON.stringify(fields)
      });
      return parseOrThrow(response, "ContractWatch API");
    },

    async getContractProgressReports(projectId) {
      const response = await apiFetch(`/api/contract-progress-reports?projectId=${encodeURIComponent(projectId)}`);
      return parseOrThrow(response, "ContractWatch SAL API");
    },

    async saveContractProgressReport(fields) {
      const response = await apiFetch("/api/contract-progress-reports", {
        method: fields.id ? "PATCH" : "POST",
        body: JSON.stringify(fields)
      });
      return parseOrThrow(response, "ContractWatch SAL API");
    },

    async transitionContractProgressReport(id, action, fields = {}) {
      const response = await apiFetch("/api/contract-progress-reports", {
        method: "PUT",
        body: JSON.stringify({ id, action, ...fields })
      });
      return parseOrThrow(response, "ContractWatch SAL transition API");
    },

    async issueContractBillingItem(id, invoiceReference) {
      const response = await apiFetch("/api/contract-billing-items", {
        method: "PUT",
        body: JSON.stringify({ id, action: "issue", invoiceReference })
      });
      return parseOrThrow(response, "ContractWatch billing API");
    },

    async supplierAction(payload) {
      const response = await apiFetch("/api/suppliers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      return parseOrThrow(response, "Suppliers API");
    },

    async contactAction(payload) {
      const response = await apiFetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return parseOrThrow(response, "Contacts API");
    },

    async deleteOrder(id) {
      const response = await apiFetch("/api/orders", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id })
      });
      return parseOrThrow(response, "Order delete API");
    },

    async supplierOrderAction(payload) {
      const response = await apiFetch("/api/supplier-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      return parseOrThrow(response, "Supplier orders API");
    },

    async procurementRequirementAction(payload) {
      const response = await apiFetch("/api/procurement-requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return parseOrThrow(response, "Procurement requirements API");
    },

    async saveAppUser(fields) {
      const response = await apiFetch("/api/app-users", {
        method: fields.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fields)
      });
      return parseOrThrow(response, "Users API");
    },

    async saveReportRecipient(fields) {
      const response = await apiFetch("/api/report-recipients", {
        method: fields.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fields)
      });
      return parseOrThrow(response, "Report recipients API");
    },

    async deleteReportRecipient(id) {
      const response = await apiFetch("/api/report-recipients", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ id })
      });
      return parseOrThrow(response, "Report recipient delete API");
    },

    async saveMailbox(fields) {
      const response = await apiFetch("/api/mailboxes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "connect", ...fields })
      });
      return parseOrThrow(response, "Mailbox API");
    },

    async testMailbox(fields) {
      const response = await apiFetch("/api/mailboxes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "test", ...fields })
      });
      return parseOrThrow(response, "Mailbox test API");
    },

    async disconnectMailbox(id) {
      const response = await apiFetch("/api/mailboxes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "disconnect", id })
      });
      return parseOrThrow(response, "Mailbox disconnect API");
    },

    async verifyOperationalItem({ kind, id }) {
      const response = await apiFetch("/api/operational-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ kind, id, action: "verify" })
      });
      return parseOrThrow(response, "Operational action API");
    },

    async linkOperationalItem({ kind, id, projectCode, orderCode }) {
      const response = await apiFetch("/api/operational-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ kind, id, action: "link", projectCode, orderCode })
      });
      return parseOrThrow(response, "Operational link API");
    },

    async prepareCustomerConfirmation(materialLineId) {
      const response = await apiFetch("/api/customer-confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", materialLineId })
      });
      return parseOrThrow(response, "Customer confirmation API");
    },

    async updateCustomerConfirmation(fields) {
      const response = await apiFetch("/api/customer-confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", ...fields })
      });
      return parseOrThrow(response, "Customer confirmation update API");
    },

    async sendCustomerConfirmation({ id, senderMailboxId, approvedBy }) {
      const response = await apiFetch("/api/customer-confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", id, senderMailboxId, approvedBy })
      });
      return parseOrThrow(response, "Customer confirmation send API");
    }
  };
}

// Compatibilita' con l'uso precedente (nessuna sorgente esplicita:
// decide il default server-side via env DATA_SOURCE).
export const apiAdapter = createApiAdapter();
