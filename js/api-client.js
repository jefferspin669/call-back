const API_BASE_URL = "http://127.0.0.1:8787";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `API request failed with ${response.status}`);
  }
  return data;
}

export const callbackApi = {
  async isAvailable() {
    try {
      await request("/health");
      return true;
    } catch {
      return false;
    }
  },

  getRequestToken() {
    return new URLSearchParams(window.location.search).get("request");
  },

  async getMissedCall(token) {
    return request(`/api/request/${encodeURIComponent(token)}`);
  },

  async createCallbackRequest(payload) {
    return request("/api/callback-requests", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async updateCallbackRequest(id, payload) {
    return request(`/api/callback-requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },

  async cancelCallbackRequest(id) {
    return this.updateCallbackRequest(id, { action: "cancel" });
  },

  async rescheduleCallbackRequest(id, payload) {
    return this.updateCallbackRequest(id, { action: "reschedule", ...payload });
  },

  async markUrgent(id) {
    return this.updateCallbackRequest(id, { action: "mark_urgent" });
  },

  async completeCallbackRequest(id) {
    return this.updateCallbackRequest(id, { action: "complete" });
  },

  async addStaffNote(id, payload) {
    return request(`/api/callback-requests/${encodeURIComponent(id)}/notes`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async getCustomerHistory(phone) {
    return request(`/api/customers/${encodeURIComponent(phone)}/history`);
  },

  async getInteractions() {
    return request("/api/interactions");
  },

  async getNotifications() {
    return request("/api/notifications");
  },

  async getAnalytics() {
    return request("/api/analytics");
  },

  async getReviews() {
    return request("/api/reviews");
  },

  async createReview(payload) {
    return request("/api/reviews", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
};
