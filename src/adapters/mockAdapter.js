import { mockActivities } from "../data/mockActivities";
import { mockDocuments } from "../data/mockDocuments";
import { mockOrders } from "../data/mockOrders";
import { mockProjects } from "../data/mockProjects";
import { mockSuppliers } from "../data/mockSuppliers";

const mockProcessedEmails = [];

export const mockAdapter = {
  async getDashboardData() {
    return {
      orders: mockOrders,
      projects: mockProjects,
      suppliers: mockSuppliers,
      documents: mockDocuments,
      activities: mockActivities,
      processedEmails: mockProcessedEmails
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
  async getProcessedEmails() {
    return mockProcessedEmails;
  }
};
