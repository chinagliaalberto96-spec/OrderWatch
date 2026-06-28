// Adapter Airtable per la base reale "OrderWatch - Graphic Center Group"
// (baseId appDoRPzXLmmwc6Zp, vedi docs/GRAPHIC_CENTER_ONBOARDING_NOTES.md sezione 9).
// I nomi dei campi in Airtable sono in "Title Case" leggibile (es. "Order Code",
// "Due Date") mentre il frontend si aspetta chiavi camelCase (es. orderCode,
// dueDate) come nei mock data. fieldMaps traduce Airtable -> frontend.
// L'interfaccia rispecchia mockAdapter.js cosi' lo scambio in App.jsx e' un cambio di una riga.
export function createAirtableAdapter({ baseId, apiKey, tableNames = {} }) {
  const endpoint = `https://api.airtable.com/v0/${baseId}`;
  const tables = {
    orders: tableNames.orders || "Orders",
    projects: tableNames.projects || "Projects",
    suppliers: tableNames.suppliers || "Suppliers",
    documents: tableNames.documents || "Documents",
    activities: tableNames.activities || "Activities",
    processedEmails: tableNames.processedEmails || "Processed Emails"
  };

  const fieldMaps = {
    orders: {
      "Order Code": "orderCode",
      "Supplier Name": "supplierName",
      "Supplier Order Ref": "supplierOrderRef",
      "Project Code": "projectCode",
      Material: "material",
      Quantity: "quantity",
      "Order Date": "orderDate",
      "Due Date": "dueDate",
      "Required Date": "requiredDate",
      "Days Remaining": "daysRemaining",
      Status: "status",
      Owner: "owner",
      "Supplier Response": "supplierResponse",
      "Reminder Count": "reminderCount",
      "Last Reminder Date": "lastReminderDate",
      "AI Confidence": "aiConfidence",
      "Needs Review": "needsReview",
      Notes: "notes"
    },
    projects: {
      "Project Code": "projectCode",
      Customer: "customer",
      Owner: "owner",
      Status: "status",
      "Due Date": "dueDate",
      "Open Orders": "openOrders"
    },
    suppliers: {
      "Supplier Name": "name",
      Email: "email",
      Category: "category",
      "On Time Rate": "onTimeRate",
      "Open Orders": "openOrders",
      "Risk Level": "risk",
      Score: "score"
    },
    documents: {
      Name: "name",
      Type: "type",
      "Supplier Name": "supplierName",
      "Linked Order": "linkedOrder",
      Confidence: "confidence",
      "Needs Human Review": "needsHumanReview",
      "Received At": "receivedAt"
    },
    activities: {
      Title: "title",
      Type: "type",
      Detail: "detail",
      "Order Code": "orderCode",
      Date: "date"
    },
    processedEmails: {
      "Message ID": "messageId",
      From: "from",
      Subjet: "subject",
      Subject: "subject",
      "Received At": "receivedAt",
      Classification: "classification",
      Status: "status",
      "Linked Project Code": "linkedProjectCode",
      "Linked Order Code": "linkedOrderCode",
      "Error Detail": "errorDetail",
      "Pre-Classification": "preClassification",
      "Final Classification": "finalClassification"
    }
  };

  function assertCredentials() {
    if (!baseId || !apiKey) {
      throw new Error("Airtable baseId and apiKey are required.");
    }
  }

  async function request(table, params = "") {
    assertCredentials();
    const response = await fetch(`${endpoint}/${encodeURIComponent(table)}${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Airtable request failed: ${response.status} ${table}`);
    }

    return response.json();
  }

  function toAirtableFields(entityKey, fields) {
    const map = fieldMaps[entityKey] || {};
    const reverseMap = Object.fromEntries(Object.entries(map).map(([airtableName, appKey]) => [appKey, airtableName]));
    return Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [reverseMap[key] || key, value])
    );
  }

  async function createRecord(table, fields) {
    assertCredentials();
    const response = await fetch(`${endpoint}/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      throw new Error(`Airtable create failed: ${response.status} ${table}`);
    }

    return response.json();
  }

  async function updateRecord(table, recordId, fields) {
    assertCredentials();
    const response = await fetch(`${endpoint}/${encodeURIComponent(table)}/${recordId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });

    if (!response.ok) {
      throw new Error(`Airtable update failed: ${response.status} ${table}`);
    }

    return response.json();
  }

  function normalizeAirtableValue(value) {
    if (Array.isArray(value)) {
      return value.map(normalizeAirtableValue);
    }
    if (value && typeof value === "object" && "name" in value && "id" in value) {
      return value.name;
    }
    return value;
  }

  function mapRecords(entityKey, data) {
    const map = fieldMaps[entityKey] || {};
    return data.records.map((record) => {
      const mapped = { id: record.id };
      for (const [airtableName, value] of Object.entries(record.fields)) {
        mapped[map[airtableName] || airtableName] = normalizeAirtableValue(value);
      }
      return mapped;
    });
  }

  return {
    async getDashboardData() {
      const [orders, projects, suppliers, documents, activities, processedEmails] = await Promise.all([
        this.getOrders(),
        this.getProjects(),
        this.getSuppliers(),
        this.getDocuments(),
        this.getActivities(),
        this.getProcessedEmails()
      ]);
      return { orders, projects, suppliers, documents, activities, processedEmails };
    },
    async getOrders() {
      return mapRecords("orders", await request(tables.orders));
    },
    async getProjects() {
      return mapRecords("projects", await request(tables.projects));
    },
    async getSuppliers() {
      return mapRecords("suppliers", await request(tables.suppliers));
    },
    async getDocuments() {
      return mapRecords("documents", await request(tables.documents));
    },
    async getActivities() {
      return mapRecords("activities", await request(tables.activities));
    },
    async getProcessedEmails() {
      return mapRecords("processedEmails", await request(tables.processedEmails));
    },
    async updateOrder(recordId, fields) {
      return updateRecord(tables.orders, recordId, toAirtableFields("orders", fields));
    },
    async createActivity(fields) {
      return createRecord(tables.activities, toAirtableFields("activities", fields));
    }
  };
}
