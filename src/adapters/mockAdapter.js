import { mockActivities } from "../data/mockActivities";
import { mockDocuments } from "../data/mockDocuments";
import { mockOrders } from "../data/mockOrders";
import { mockProjects } from "../data/mockProjects";
import { mockSuppliers } from "../data/mockSuppliers";

const mockProcessedEmails = [];
const mockReminders = [
  {
    id: "reminder-demo-1",
    orderCode: "GCG-001",
    supplierName: "Fornitore Demo",
    sentTo: "buyer@graphiccentergroup.it",
    type: "draft",
    status: "draft",
    sentAt: null,
    body: "Bozza sollecito fornitore pronta per revisione."
  }
];
const mockDailyReports = [];
const mockSettings = [
  {
    id: "set-client-mailbox",
    settingKey: "client.monitored_mailbox",
    value: "Da collegare: mailbox Graphic Center",
    type: "text",
    description: "Casella email che Make dovra' monitorare quando il pilota passa su dati reali Graphic Center.",
    group: "Client",
    status: "Planned",
    customerVisible: "Yes"
  },
  {
    id: "set-warning-days",
    settingKey: "alerts.warning_days",
    value: "5",
    type: "number",
    description: "Giorni prima della scadenza in cui un ordine entra in stato attenzione.",
    group: "Alerts",
    status: "Active",
    customerVisible: "Yes"
  },
  {
    id: "set-critical-days",
    settingKey: "alerts.critical_days",
    value: "2",
    type: "number",
    description: "Giorni prima della scadenza in cui un ordine diventa critico.",
    group: "Alerts",
    status: "Active",
    customerVisible: "Yes"
  }
];

export const mockAdapter = {
  async getDashboardData() {
    return {
      orders: mockOrders,
      projects: mockProjects,
      suppliers: mockSuppliers,
      documents: mockDocuments,
      activities: mockActivities,
      reminders: mockReminders,
      dailyReports: mockDailyReports,
      processedEmails: mockProcessedEmails,
      settings: mockSettings
    };
  },
  async getOrders() {
    return mockOrders;
  },
  async getProjects() {
    return mockProjects;
  },
  async getSuppliers() {
    return mockSuppliers;
  },
  async getDocuments() {
    return mockDocuments;
  },
  async getActivities() {
    return mockActivities;
  },
  async getReminders() {
    return mockReminders;
  },
  async getDailyReports() {
    return mockDailyReports;
  },
  async getProcessedEmails() {
    return mockProcessedEmails;
  },
  async getSettings() {
    return mockSettings;
  },
  async updateSetting(id, fields) {
    const index = mockSettings.findIndex((setting) => setting.id === id);
    if (index === -1) throw new Error("Setting not found.");
    mockSettings[index] = { ...mockSettings[index], ...fields };
    return { setting: mockSettings[index] };
  }
};
