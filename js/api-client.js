function resolveApiBase() {
  if (typeof window === "undefined") return "http://127.0.0.1:4174";
  if (window.CALLBACK_API_BASE) return window.CALLBACK_API_BASE;

  const { protocol, hostname, port } = window.location;
  // Same-origin when served by CallbackFlow server
  if (port === "4174" || port === "8787" || port === "") return "";
  return `${protocol}//${hostname}:4174`;
}

const API_BASE_URL = resolveApiBase();

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `API request failed with ${response.status}`);
  }
  return data;
}

export const callbackApi = {
  baseUrl: API_BASE_URL || window.location.origin,

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

  async createMissedCall(payload) {
    return request("/api/missed-call", {
      method: "POST",
      body: JSON.stringify(payload)
    });
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
  },

  async getSettings() {
    return request("/api/settings");
  },

  async saveSettings(payload) {
    return request("/api/settings", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async getStaff() {
    return request("/api/staff");
  },

  async saveStaff(payload) {
    return request("/api/staff", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  async deleteStaff(id) {
    return request(`/api/staff/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "delete" })
    });
  }
};
