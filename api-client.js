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

  async getInteractions() {
    return request("/api/interactions");
  },

  async getNotifications() {
    return request("/api/notifications");
  }
};
