const TOKEN_KEY = "cf_auth_token";
const ACCOUNT_KEY = "cf_auth_account";
const REMEMBER_EMAIL_KEY = "cf_remember_email";
const REMEMBER_FLAG_KEY = "cf_remember_me";

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

  getRememberedEmail() {
    return localStorage.getItem(REMEMBER_EMAIL_KEY) || "";
  },

  shouldRememberMe() {
    return localStorage.getItem(REMEMBER_FLAG_KEY) === "1";
  },

  saveSession({ token, account, rememberMe = false, email }) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));

    const emailToRemember = email || account?.email || "";
    if (rememberMe && emailToRemember) {
      localStorage.setItem(REMEMBER_EMAIL_KEY, emailToRemember);
      localStorage.setItem(REMEMBER_FLAG_KEY, "1");
    } else if (!rememberMe) {
      localStorage.setItem(REMEMBER_FLAG_KEY, "0");
      // Keep email for convenience unless user unchecked remember me intentionally.
      // Email is still useful to prefill; account itself is never deleted server-side.
    }

    window.dispatchEvent(new CustomEvent("cf:auth-changed", {
      detail: { loggedIn: true, account }
    }));
  },

  clearSession({ keepRememberedEmail = true } = {}) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
    if (!keepRememberedEmail) {
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
      localStorage.removeItem(REMEMBER_FLAG_KEY);
    }
    window.dispatchEvent(new CustomEvent("cf:auth-changed", {
      detail: { loggedIn: false, account: null }
    }));
  }
};
