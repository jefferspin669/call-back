const TOKEN_KEY = "cf_auth_token";
const ACCOUNT_KEY = "cf_auth_account";

export const auth = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  },

  getAccount() {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null");
    } catch {
      return null;
    }
  },

  isLoggedIn() {
    return Boolean(this.getToken() && this.getAccount());
  },

  saveSession({ token, account }) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    window.dispatchEvent(new CustomEvent("cf:auth-changed", {
      detail: { loggedIn: true, account }
    }));
  },

  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
    window.dispatchEvent(new CustomEvent("cf:auth-changed", {
      detail: { loggedIn: false, account: null }
    }));
  }
};
