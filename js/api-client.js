import { auth } from "./auth.js";

let resolvedBase = null;
let resolvePromise = null;

function candidateBases() {
  if (typeof window === "undefined") {
    return ["http://127.0.0.1:4174", "http://localhost:4174"];
  }

  if (window.CALLBACK_API_BASE) {
    return [window.CALLBACK_API_BASE];
  }

  const { protocol, hostname, origin, port } = window.location;
  const list = [];

  if (protocol === "http:" || protocol === "https:") {
    // Prefer same-origin when the page is served by CallbackFlow.
    list.push("");
    list.push(origin);
    if (hostname && port !== "4174") {
      list.push(`${protocol}//${hostname}:4174`);
    }
  }

  list.push("http://127.0.0.1:4174", "http://localhost:4174");

  // Deduplicate while preserving order.
  return [...new Set(list)];
}

async function probeBase(base) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 2500) : null;
  try {
    const response = await fetch(`${base}/health`, {
      method: "GET",
      signal: controller?.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return Boolean(data && data.ok);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveApiBase(force = false) {
  if (!force && resolvedBase !== null) return resolvedBase;
  if (!force && resolvePromise) return resolvePromise;

  resolvePromise = (async () => {
    for (const base of candidateBases()) {
      if (await probeBase(base)) {
        resolvedBase = base;
        return resolvedBase;
      }
    }
    // Fall back to same-origin or localhost so error messages stay useful.
    resolvedBase = typeof window !== "undefined"
      && (window.location.protocol === "http:" || window.location.protocol === "https:")
      ? ""
      : "http://127.0.0.1:4174";
    return resolvedBase;
  })();

  try {
    return await resolvePromise;
  } finally {
    resolvePromise = null;
  }
}

async function request(path, options = {}) {
  const base = await resolveApiBase();
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const token = auth.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers
    });
  } catch (error) {
    // Retry discovery once on network failure.
    resolvedBase = null;
    const retryBase = await resolveApiBase(true);
    response = await fetch(`${retryBase}${path}`, {
      ...options,
      headers
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      if (path !== "/api/auth/login" && path !== "/api/auth/me") {
        auth.clearSession();
      }
    }
    throw new Error(data.error || `API request failed with ${response.status}`);
  }
  return data;
}

export const callbackApi = {
  get baseUrl() {
    if (resolvedBase !== null) {
      return resolvedBase || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:4174");
    }
    return typeof window !== "undefined" && (window.location.protocol === "http:" || window.location.protocol === "https:")
      ? window.location.origin
      : "http://127.0.0.1:4174";
  },

  async isAvailable() {
    try {
      resolvedBase = null;
      const base = await resolveApiBase(true);
      return probeBase(base);
    } catch {
      return false;
    }
  },

  async getConnectionInfo() {
    const available = await this.isAvailable();
    return {
      available,
      baseUrl: this.baseUrl,
      hint: available
        ? `Connected to ${this.baseUrl}`
        : "Server not reachable. In a terminal run: node server.js  then open http://127.0.0.1:4174/"
    };
  },

  getRequestToken() {
    return new URLSearchParams(window.location.search).get("request");
  },

  async getAuthStatus() {
    return request("/api/auth/status");
  },

  async signup(payload) {
    const result = await request("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ ...payload, rememberMe: payload.rememberMe !== false })
    });
    auth.saveSession({
      token: result.token,
      account: result.account,
      rememberMe: result.rememberMe !== false,
      email: payload.email
    });
    return result;
  },

  async login(payload) {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    auth.saveSession({
      token: result.token,
      account: result.account,
      rememberMe: Boolean(payload.rememberMe || result.rememberMe),
      email: payload.email
    });
    return result;
  },

  async logout() {
    try {
      if (auth.getToken()) {
        await request("/api/auth/logout", { method: "POST", body: "{}" });
      }
    } catch {
      // ignore network errors on logout
    }
    auth.clearSession({ keepRememberedEmail: true });
  },

  async me() {
    return request("/api/auth/me");
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
