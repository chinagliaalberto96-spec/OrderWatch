export const apiAdapter = {
  async getDashboardData() {
    const response = await fetch("/api/dashboard");

    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.detail || details.error || `Dashboard API failed: ${response.status}`);
    }

    return response.json();
  },

  async updateSetting(id, fields) {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id, ...fields })
    });

    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.detail || details.error || `Settings API failed: ${response.status}`);
    }

    return response.json();
  }
};
