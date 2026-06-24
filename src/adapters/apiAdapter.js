export const apiAdapter = {
  async getDashboardData() {
    const response = await fetch("/api/dashboard");

    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.detail || details.error || `Dashboard API failed: ${response.status}`);
    }

    return response.json();
  }
};
