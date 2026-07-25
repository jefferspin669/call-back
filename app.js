import { callbackApi } from "./js/api-client.js";
import { store } from "./js/shared-store.js";
import { getAiTriage } from "./js/ai-triage.js";
import { auth } from "./js/auth.js";

let activeInteractionId = null;
let latestAnalytics = null;
let editingStaffId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusClass(status) {
  const map = {
    "Awaiting Response": "status-awaiting",
    Scheduled: "status-scheduled",
    "In Progress": "status-progress",
    Escalated: "status-escalated",
    Completed: "status-completed",
    Cancelled: "status-cancelled"
  };
  return map[status] || "";
}

function priorityClass(priority) {
  if (priority === "High") return "badge-high";
  if (priority === "Medium") return "badge-medium";
  return "badge-low";
}

function priorityRowClass(priority) {
  if (priority === "High") return "priority-high";
  if (priority === "Medium") return "priority-medium";
  return "priority-low";
}

function getInteractions() {
  return store.getInteractions();
}

function showStatus(text, type = "success") {
  const el = document.getElementById("appStatus");
  if (!el) return;
  el.hidden = false;
  el.className = `app-status ${type}`;
  el.textContent = text;
  window.clearTimeout(showStatus._timer);
  showStatus._timer = window.setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

function setMessage(id, text, type = "success") {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `message ${type}`;
  el.textContent = text;
}

function updateAuthUI() {
  const loggedIn = auth.isLoggedIn();
  const account = auth.getAccount();
  const lock = document.getElementById("adminLock");
  const panel = document.getElementById("adminPanel");
  const logoutBtn = document.getElementById("logoutBtn");
  const logoutBtnTop = document.getElementById("logoutBtnTop");
  const sidebarStatus = document.getElementById("authSidebarStatus");
  const accountLabel = document.getElementById("adminAccountLabel");

  if (lock) lock.hidden = loggedIn;
  if (panel) panel.hidden = !loggedIn;
  if (logoutBtn) logoutBtn.hidden = !loggedIn;
  if (logoutBtnTop) logoutBtnTop.hidden = !loggedIn;

  if (sidebarStatus) {
    sidebarStatus.textContent = loggedIn
      ? `Signed in: ${account?.businessName || account?.email || "Admin"}`
      : "Admin locked";
  }
  if (accountLabel) {
    accountLabel.textContent = loggedIn
      ? `Signed in as ${account?.ownerName || "Owner"} · ${account?.businessName || ""}`
      : "Signed in";
  }
}

async function refreshAuthStatus() {
  updateAuthUI();
  try {
    if (!(await callbackApi.isAvailable())) return;
    const status = await callbackApi.getAuthStatus();
    const hint = document.getElementById("adminLockHint");
    if (hint) {
      hint.textContent = status.hasAccounts
        ? "Sign in with your business email and password to unlock Admin."
        : "New here? Create a business account first, then come back to sign in.";
    }
    if (auth.isLoggedIn()) {
      try {
        const me = await callbackApi.me();
        auth.saveSession({ token: auth.getToken(), account: me.account });
      } catch {
        auth.clearSession();
      }
    }
  } catch (error) {
    console.warn("Auth status unavailable", error);
  }
  updateAuthUI();
}

function activateTab(tabName) {
  const target = document.getElementById(tabName);
  if (!target) return;

  document.querySelectorAll(".nav-btn[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === tabName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === tabName);
  });

  if (tabName === "analytics") renderAnalytics();
  if (tabName === "reviews") renderReviews();
  if (tabName === "admin") {
    updateAuthUI();
    if (auth.isLoggedIn()) {
      loadSettingsForm();
      renderStaffList();
    }
  }

  const hash = tabName === "dashboard" ? "#" : `#${tabName}`;
  if (window.location.hash !== hash) {
    history.replaceState(null, "", hash === "#" ? window.location.pathname : hash);
  }
}

function renderDashboardAiPreview(interaction) {
  const target = document.getElementById("dashboardAiPreview");
  if (!target) return;

  if (!interaction) {
    target.innerHTML = `
      <div class="notice">
        <h4>Suggested response</h4>
        <p>Select a request to see triage details.</p>
      </div>
    `;
    return;
  }

  const triage = getAiTriage(interaction);
  target.innerHTML = `
    <div class="notice">
      <h4>Suggested response</h4>
      <p>${escapeHtml(triage.suggestedResponse)}</p>
    </div>
    <div class="notice">
      <h4>Recommended action</h4>
      <p>${escapeHtml(triage.recommendedAction)}</p>
    </div>
    <div class="notice">
      <h4>Best callback time</h4>
      <p>${escapeHtml(triage.bestWindow)}</p>
    </div>
  `;
}

function renderHistoryPreview(interaction) {
  const target = document.getElementById("dashboardHistoryPreview");
  if (!target) return;

  const history = interaction?.customerHistory || [];
  if (!interaction) {
    target.innerHTML = '<div class="subtle">Select a caller to view history.</div>';
    return;
  }
  if (!history.length) {
    target.innerHTML = `<div class="subtle">${escapeHtml(interaction.client)} has no previous requests on file.</div>`;
    return;
  }

  target.innerHTML = history.slice(0, 4).map((item) => `
    <div class="summary-row">
      <span>
        <strong>${escapeHtml(item.reason || "Previous request")}</strong><br>
        <span class="muted">${escapeHtml(item.status || "Unknown")} · ${escapeHtml(item.priority || "Medium")}</span>
      </span>
      <strong>${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ""}</strong>
    </div>
  `).join("");
}

function renderMetrics(analytics) {
  const totals = analytics?.totals || store.getAnalytics().totals;
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText("metricMissedToday", totals.today ?? 0);
  setText("metricMissedHint", `${totals.callbackRequests || 0} total requests`);
  setText("metricPending", totals.pending ?? 0);
  setText("metricPendingHint", `${totals.urgent || 0} urgent follow-ups`);
  setText("metricAvgRating", totals.avgRating ? Number(totals.avgRating).toFixed(1) : "-");
  setText("metricReviewsHint", `${totals.reviews || 0} reviews`);
  setText("metricCompleted", totals.completed ?? 0);
  setText("metricCompletedHint", `${totals.cancelled || 0} cancelled`);
  setText("analyticsTotal", totals.callbackRequests ?? 0);
  setText("analyticsUrgent", totals.urgent ?? 0);
  setText("analyticsAttachments", (totals.withPicture || 0) + (totals.withVoice || 0));
  setText("analyticsAttachmentsHint", `${totals.withPicture || 0} pictures · ${totals.withVoice || 0} voice memos`);
  setText("analyticsRepeat", totals.repeatCallers ?? 0);
}

function renderTable() {
  const searchInput = document.getElementById("searchInput");
  const filterSelect = document.getElementById("filterSelect");
  const list = document.getElementById("requestList");
  const body = document.getElementById("interactionTable");
  if (!list && !body) return;

  const q = (searchInput?.value || "").toLowerCase().trim();
  const filter = filterSelect?.value || "all";
  if (filterSelect) filterSelect.classList.toggle("filter-active", filter !== "all");

  const rows = getInteractions().filter((item) => {
    const blob = `${item.client} ${item.phone} ${item.issue} ${item.id}`.toLowerCase();
    const matchSearch = blob.includes(q);
    if (!matchSearch) return false;
    if (filter === "all") return true;
    if (filter === "urgent") return Boolean(item.urgent) || item.priority === "High";
    if (filter === "repeat") return Boolean(item.repeatCaller);
    return item.priority.toLowerCase() === filter || item.status.toLowerCase().includes(filter);
  });

  if (!rows.length) {
    const empty = '<div class="subtle">No requests match this filter. Try Simulate missed call or open the customer form.</div>';
    if (list) list.innerHTML = empty;
    if (body) body.innerHTML = `<tr><td>${empty}</td></tr>`;
    renderDashboardAiPreview(null);
    renderHistoryPreview(null);
    return;
  }

  if (list) {
    list.innerHTML = rows.map((item) => `
      <article class="notice request-card ${priorityRowClass(item.priority)}" data-id="${escapeHtml(item.id)}" role="button" tabindex="0">
        <div class="request-card-top">
          <div>
            <strong class="caller-name">${escapeHtml(item.client)}</strong>
            <div class="subtle">${escapeHtml(item.phone)}</div>
          </div>
          <div>
            <span class="badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span>
          </div>
        </div>
        <div>${escapeHtml(item.issue)}</div>
        <div class="request-card-meta">
          <div>
            <span class="badge ${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span>
            ${item.urgent ? '<span class="badge badge-urgent">Urgent</span>' : ""}
            ${item.repeatCaller ? '<span class="badge">Repeat</span>' : ""}
            ${item.picture ? '<span class="badge">Photo</span>' : ""}
            ${item.voiceMemo ? '<span class="badge">Voice</span>' : ""}
          </div>
          <div class="subtle">${escapeHtml(item.assignedTo)} · ${escapeHtml(item.lastActivity)}</div>
        </div>
      </article>
    `).join("");
  }

  if (body) {
    body.innerHTML = rows.map((item) => `
      <tr class="clickable-row request-card ${priorityRowClass(item.priority)}" data-id="${escapeHtml(item.id)}">
        <td>
          <strong class="caller-name">${escapeHtml(item.client)}</strong>
          <div class="subtle">${escapeHtml(item.phone)}</div>
          <div class="subtle">${escapeHtml(item.issue)}</div>
        </td>
      </tr>
    `).join("");
  }

  const activeInteraction = getInteractions().find((item) => item.id === activeInteractionId) || rows[0] || null;
  if (activeInteraction && !activeInteractionId) activeInteractionId = activeInteraction.id;
  renderDashboardAiPreview(activeInteraction);
  renderHistoryPreview(activeInteraction);
}

function renderMixChart(containerId, data = {}, colorMap = {}) {
  const target = document.getElementById(containerId);
  if (!target) return;
  const entries = Object.entries(data);
  if (!entries.length) {
    target.innerHTML = '<div class="subtle">No data yet.</div>';
    return;
  }
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  const colors = ["swatch-blue", "swatch-violet", "swatch-amber", "swatch-rose", "swatch-teal"];
  target.innerHTML = entries.map(([label, value], index) => `
    <div class="pie-item">
      <div class="pie-left">
        <span class="swatch ${colorMap[label] || colors[index % colors.length]}"></span>
        ${escapeHtml(label)}
      </div>
      <strong>${Math.round((value / total) * 100)}%</strong>
    </div>
  `).join("");
}

function renderCharts(analytics = latestAnalytics || store.getAnalytics()) {
  const missedChart = document.getElementById("missedChart");
  const weekly = analytics.weekly || [];
  if (missedChart) {
    const maxMissed = Math.max(1, ...weekly.map((d) => Math.max(d.missed || 0, d.callbacks || 0)));
    missedChart.innerHTML = weekly.map((d) => `
      <div class="bar-row">
        <strong>${escapeHtml(d.day)}</strong>
        <div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${((d.missed || 0) / maxMissed) * 100}%"></div>
          </div>
          <div class="bar-track" style="margin-top:6px;">
            <div class="bar-fill alt" style="width:${((d.callbacks || 0) / maxMissed) * 100}%"></div>
          </div>
        </div>
        <div>${d.missed || 0}/${d.callbacks || 0}</div>
      </div>
    `).join("");
  }

  renderMixChart("statusMixChart", analytics.byStatus || {}, {
    Completed: "swatch-blue",
    Scheduled: "swatch-violet",
    "Awaiting Response": "swatch-amber",
    Escalated: "swatch-rose",
    Cancelled: "swatch-rose"
  });
  renderMixChart("priorityMixChart", analytics.byPriority || {}, {
    High: "swatch-rose",
    Medium: "swatch-amber",
    Low: "swatch-blue"
  });
}

function renderAnalytics(analytics = latestAnalytics || store.getAnalytics()) {
  latestAnalytics = analytics;
  renderMetrics(analytics);
  renderCharts(analytics);
}

function renderBusinessAlerts(notifications = []) {
  const target = document.getElementById("businessAlertsFeed");
  if (!target) return;
  if (!notifications.length) {
    target.innerHTML = '<div class="subtle">No business alerts yet.</div>';
    return;
  }
  target.innerHTML = notifications.slice(0, 5).map((item) => `
    <div class="summary-row">
      <span>
        <strong>${escapeHtml(item.subject || "Business Alert")}</strong><br>
        <span class="muted">${escapeHtml(item.message || "")}</span>
      </span>
      <strong>${escapeHtml(item.status || "ready")}</strong>
    </div>
  `).join("");
}

function renderReviews(reviews) {
  const feed = document.getElementById("reviewsFeed");
  const summary = document.getElementById("reviewsSummary");
  const list = reviews || store.getReviews();
  if (!feed) return;

  if (!list.length) {
    feed.innerHTML = '<div class="subtle">No reviews yet.</div>';
    if (summary) summary.textContent = "No reviews yet.";
    return;
  }

  const avg = list.reduce((sum, review) => sum + Number(review.rating || 0), 0) / list.length;
  if (summary) summary.textContent = `${list.length} reviews · average ${avg.toFixed(1)} / 5`;
  feed.innerHTML = list.slice(0, 12).map((review) => `
    <div class="summary-row">
      <span>
        <strong>${escapeHtml(review.fullName || "Anonymous")} · ${escapeHtml(review.rating)}/5</strong><br>
        <span class="muted">${escapeHtml(review.comment || "")}</span>
      </span>
      <strong>${review.createdAt ? new Date(review.createdAt).toLocaleDateString() : ""}</strong>
    </div>
  `).join("");
}

function renderList(containerId, items, emptyText, formatter) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items?.length) {
    container.innerHTML = `<div class="subtle">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.innerHTML = items.map(formatter).join("");
}

function renderAttachments(interaction) {
  const container = document.getElementById("drawerAttachments");
  if (!container) return;
  const parts = [];
  if (interaction.picture) {
    parts.push(`<div class="notice"><h4>Picture</h4><img class="drawer-media" src="${interaction.picture}" alt="Customer picture" /></div>`);
  }
  if (interaction.voiceMemo) {
    parts.push(`<div class="notice"><h4>Voice memo</h4><audio class="drawer-audio" controls src="${interaction.voiceMemo}"></audio></div>`);
  }
  container.innerHTML = parts.length ? parts.join("") : '<div class="subtle">No picture or voice memo attached.</div>';
}

function renderAiPanel(interaction) {
  const aiPanel = document.getElementById("drawerAiPanel");
  if (!aiPanel) return;
  const triage = getAiTriage(interaction);
  aiPanel.innerHTML = `
    <div class="notice">
      <div class="ai-chip ${triage.escalate ? "ai-urgent" : ""}">${escapeHtml(triage.sentiment)} - ${triage.urgency}% urgency</div>
      <h4 style="margin-top:12px;">Summary</h4>
      <p>${escapeHtml(triage.summary)}</p>
    </div>
    <div class="notice"><h4>Recommended action</h4><p>${escapeHtml(triage.recommendedAction)}</p></div>
    <div class="notice"><h4>Suggested response</h4><p>${escapeHtml(triage.suggestedResponse)}</p></div>
    <div class="notice"><h4>Best callback window</h4><p>${escapeHtml(triage.bestWindow)}</p></div>
  `;
}

function openDrawer(id) {
  const interaction = getInteractions().find((item) => item.id === id);
  const drawer = document.getElementById("detailDrawer");
  if (!interaction || !drawer) return;

  activeInteractionId = id;
  document.getElementById("drawerClientName").textContent = interaction.client;
  document.getElementById("drawerClientMeta").textContent =
    `${interaction.id} · ${interaction.channel} · ${interaction.status}${interaction.urgent ? " · Urgent" : ""}`;

  const panel = drawer.querySelector(".drawer-panel");
  if (panel) {
    panel.classList.remove("priority-high", "priority-medium", "priority-low");
    panel.classList.add(priorityRowClass(interaction.priority));
  }

  renderAttachments(interaction);
  renderList("drawerCustomerHistory", interaction.customerHistory || [], "No previous requests for this customer.", (entry) => `
    <div class="notice">
      <h4>${escapeHtml(entry.reason || "Previous request")}</h4>
      <p>${escapeHtml(entry.status || "Unknown")} · ${escapeHtml(entry.priority || "Medium")}${entry.createdAt ? ` · ${new Date(entry.createdAt).toLocaleString()}` : ""}</p>
    </div>
  `);
  renderList("drawerHistory", interaction.history || [], "No callback history yet.", (entry) => `<div class="notice"><p>${escapeHtml(entry)}</p></div>`);
  renderList("drawerStaffNotes", interaction.staffNotes || [], "No staff notes yet.", (note) => `
    <div class="notice">
      <h4>${escapeHtml(note.author || "Staff")} · ${note.createdAt ? new Date(note.createdAt).toLocaleString() : ""}</h4>
      <p>${escapeHtml(note.text || "")}</p>
    </div>
  `);
  renderList("drawerNotes", interaction.notes || [], "No notes yet.", (note) => `<div class="notice"><p>${escapeHtml(note)}</p></div>`);
  renderList("drawerMessages", interaction.messages || [], "No messages sent yet.", (msg) => `
    <div class="notice"><h4>${escapeHtml(msg.type || "Message")}</h4><p>${escapeHtml(msg.text || "")}</p></div>
  `);
  renderAiPanel(interaction);
  renderDashboardAiPreview(interaction);
  renderHistoryPreview(interaction);
  drawer.classList.remove("hidden");
}

function closeDrawer() {
  document.getElementById("detailDrawer")?.classList.add("hidden");
}

async function refreshActiveDrawer() {
  if (!activeInteractionId) return;
  const stillOpen = !document.getElementById("detailDrawer")?.classList.contains("hidden");
  if (stillOpen) openDrawer(activeInteractionId);
}

async function handleStaffAction(action) {
  if (!activeInteractionId) return;
  try {
    let interaction = null;
    if (await callbackApi.isAvailable()) {
      if (action === "urgent") interaction = (await callbackApi.markUrgent(activeInteractionId)).interaction;
      if (action === "complete") interaction = (await callbackApi.completeCallbackRequest(activeInteractionId)).interaction;
      if (action === "cancel") interaction = (await callbackApi.cancelCallbackRequest(activeInteractionId)).interaction;
      if (interaction) store.saveServerInteraction(interaction);
    } else {
      if (action === "urgent") interaction = store.markUrgent(activeInteractionId);
      if (action === "complete") interaction = store.completeInteraction(activeInteractionId);
      if (action === "cancel") interaction = store.cancelInteraction(activeInteractionId);
    }
    renderTable();
    await refreshActiveDrawer();
    await syncAnalytics();
    showStatus("Request updated.");
  } catch (error) {
    console.error(error);
    showStatus("Unable to update this request right now.", "error");
  }
}

function loadSettingsForm(settings = store.getSettings()) {
  const map = {
    settingBusinessName: settings.businessName || "",
    settingHours: settings.businessHoursLabel || "",
    settingResponseTime: settings.responseTimeLabel || "",
    settingBuffer: settings.bufferMinutes || 15,
    settingAutoResponse: settings.autoResponseTemplate || ""
  };
  Object.entries(map).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
  const escalation = document.getElementById("settingEscalation");
  const staffAccess = document.getElementById("settingStaffAccess");
  const dailyEmails = document.getElementById("settingDailyEmails");
  if (escalation) escalation.checked = Boolean(settings.escalationAlerts);
  if (staffAccess) staffAccess.checked = Boolean(settings.staffAccessControls);
  if (dailyEmails) dailyEmails.checked = Boolean(settings.dailySummaryEmails);
  updateMessagePreview(settings);
}

function collectSettingsFromForm() {
  return {
    businessName: document.getElementById("settingBusinessName")?.value.trim() || "Demo Business",
    businessHoursLabel: document.getElementById("settingHours")?.value.trim() || "Mon-Fri, 8:00 AM - 6:00 PM",
    responseTimeLabel: document.getElementById("settingResponseTime")?.value.trim() || "Usually within 15 minutes during business hours",
    bufferMinutes: Number(document.getElementById("settingBuffer")?.value || 15),
    autoResponseTemplate: document.getElementById("settingAutoResponse")?.value.trim() || "",
    escalationAlerts: Boolean(document.getElementById("settingEscalation")?.checked),
    staffAccessControls: Boolean(document.getElementById("settingStaffAccess")?.checked),
    dailySummaryEmails: Boolean(document.getElementById("settingDailyEmails")?.checked)
  };
}

function updateMessagePreview(settings = collectSettingsFromForm()) {
  const preview = document.getElementById("messagePreview");
  if (!preview) return;
  const link = `${callbackApi.baseUrl}/book.html?request=demo-token`;
  preview.innerHTML = `
    <h4>${escapeHtml(settings.businessName || "Your business")}</h4>
    <p>${escapeHtml(settings.autoResponseTemplate || "Sorry we missed your call.")}</p>
    <p class="subtle">Example link: ${escapeHtml(link)}</p>
    <p class="subtle">Expected response: ${escapeHtml(settings.responseTimeLabel || "")}</p>
  `;
}

async function saveSettings(event) {
  event.preventDefault();
  if (!auth.isLoggedIn()) {
    setMessage("settingsMessage", "Sign in to save admin settings.", "error");
    updateAuthUI();
    return;
  }
  const settings = collectSettingsFromForm();
  try {
    if (!(await callbackApi.isAvailable())) {
      setMessage("settingsMessage", "Server is required to save locked admin settings. Run node server.js", "error");
      return;
    }
    const result = await callbackApi.saveSettings(settings);
    store.saveSettings(result.settings || settings);
    loadSettingsForm(settings);
    setMessage("settingsMessage", "Settings saved. Customer form and alerts will use these values.", "success");
    showStatus("Admin settings saved.");
  } catch (error) {
    console.error(error);
    setMessage("settingsMessage", error.message || "Could not save settings.", "error");
    updateAuthUI();
  }
}

function resetStaffForm() {
  editingStaffId = null;
  document.getElementById("staffEditId").value = "";
  document.getElementById("staffName").value = "";
  document.getElementById("staffRole").value = "Staff";
  document.getElementById("staffStatus").value = "Active";
  document.getElementById("staffSubmitBtn").textContent = "Add staff member";
  setMessage("staffMessage", "", "success");
  document.getElementById("staffMessage").className = "message";
}

function renderStaffList(staff = store.getStaff()) {
  const list = document.getElementById("staffList");
  if (!list) return;
  if (!staff.length) {
    list.innerHTML = '<div class="subtle">No staff members yet.</div>';
    return;
  }
  list.innerHTML = staff.map((member) => `
    <div class="staff-row" data-staff-id="${escapeHtml(member.id)}">
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <div class="subtle">${escapeHtml(member.role)}</div>
      </div>
      <div class="actions">
        <span class="badge">${escapeHtml(member.status)}</span>
        <button class="btn btn-secondary" type="button" data-action="edit-staff" data-id="${escapeHtml(member.id)}">Edit</button>
        <button class="btn btn-danger" type="button" data-action="delete-staff" data-id="${escapeHtml(member.id)}">Remove</button>
      </div>
    </div>
  `).join("");
}

async function saveStaffMember(event) {
  event.preventDefault();
  if (!auth.isLoggedIn()) {
    setMessage("staffMessage", "Sign in to manage staff.", "error");
    updateAuthUI();
    return;
  }
  const payload = {
    id: editingStaffId || undefined,
    name: document.getElementById("staffName")?.value.trim() || "",
    role: document.getElementById("staffRole")?.value || "Staff",
    status: document.getElementById("staffStatus")?.value || "Active"
  };
  if (!payload.name) {
    setMessage("staffMessage", "Name is required.", "error");
    return;
  }

  try {
    if (!(await callbackApi.isAvailable())) {
      setMessage("staffMessage", "Server is required to manage locked staff settings.", "error");
      return;
    }
    const result = await callbackApi.saveStaff(payload);
    store.saveStaff(result.staff || [], { silent: true });
    renderStaffList(result.staff || []);
    resetStaffForm();
    setMessage("staffMessage", "Staff member saved.", "success");
    showStatus("Staff list updated.");
  } catch (error) {
    console.error(error);
    setMessage("staffMessage", error.message || "Could not save staff member.", "error");
    updateAuthUI();
  }
}

async function editStaff(id) {
  const member = store.getStaff().find((item) => item.id === id);
  if (!member) return;
  editingStaffId = member.id;
  document.getElementById("staffEditId").value = member.id;
  document.getElementById("staffName").value = member.name;
  document.getElementById("staffRole").value = member.role;
  document.getElementById("staffStatus").value = member.status;
  document.getElementById("staffSubmitBtn").textContent = "Update staff member";
  activateTab("admin");
}

async function deleteStaff(id) {
  if (!auth.isLoggedIn()) {
    showStatus("Sign in to manage staff.", "error");
    updateAuthUI();
    return;
  }
  if (!window.confirm("Remove this staff member?")) return;
  try {
    if (!(await callbackApi.isAvailable())) {
      showStatus("Server is required to manage locked staff settings.", "error");
      return;
    }
    const result = await callbackApi.deleteStaff(id);
    store.saveStaff(result.staff || [], { silent: true });
    renderStaffList(result.staff || []);
    if (editingStaffId === id) resetStaffForm();
    showStatus("Staff member removed.");
  } catch (error) {
    console.error(error);
    showStatus(error.message || "Could not remove staff member.", "error");
    updateAuthUI();
  }
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const email = document.getElementById("adminEmail")?.value.trim() || "";
  const password = document.getElementById("adminPassword")?.value || "";
  try {
    if (!(await callbackApi.isAvailable())) {
      setMessage("adminLoginMessage", "Server is not running. Start it with: node server.js", "error");
      return;
    }
    const result = await callbackApi.login({ email, password });
    setMessage("adminLoginMessage", `Welcome back, ${result.account.businessName}.`, "success");
    document.getElementById("adminPassword").value = "";
    updateAuthUI();
    loadSettingsForm();
    renderStaffList();
    showStatus("Admin unlocked.");
  } catch (error) {
    setMessage("adminLoginMessage", error.message || "Login failed.", "error");
  }
}

async function handleLogout() {
  await callbackApi.logout();
  updateAuthUI();
  showStatus("Logged out. Admin is locked.");
  activateTab("admin");
}

async function simulateMissedCall() {
  const settings = store.getSettings();
  const phone = `(555) ${String(Math.floor(100 + Math.random() * 900))}-${String(Math.floor(1000 + Math.random() * 9000))}`;

  try {
    if (await callbackApi.isAvailable()) {
      const result = await callbackApi.createMissedCall({
        callerPhone: phone,
        businessPhone: "(555) 010-9000",
        businessName: settings.businessName || "Demo Business"
      });
      const url = result.missedCall?.callbackUrl || `book.html?request=${result.missedCall?.token}`;
      showStatus(`Missed call created for ${phone}. Opening customer form...`);
      window.setTimeout(() => {
        window.location.href = url.includes("http") ? url : `book.html?request=${result.missedCall.token}`;
      }, 700);
      return;
    }

    // Offline fallback: create a local request directly
    store.createBooking({
      fullName: "Sample Caller",
      phone,
      reason: "I missed your call and need help",
      details: "Created from Simulate Missed Call",
      urgent: false,
      priority: "Medium"
    });
    renderTable();
    showStatus(`Local sample request created for ${phone}.`);
  } catch (error) {
    console.error(error);
    showStatus("Could not simulate a missed call.", "error");
  }
}

async function syncAnalytics() {
  try {
    if (await callbackApi.isAvailable()) {
      const { analytics } = await callbackApi.getAnalytics();
      latestAnalytics = analytics;
      renderAnalytics(analytics);
      return;
    }
  } catch (error) {
    console.warn("Analytics sync unavailable", error);
  }
  renderAnalytics(store.getAnalytics());
}

async function syncBackend() {
  try {
    if (!(await callbackApi.isAvailable())) {
      renderAnalytics(store.getAnalytics());
      renderReviews();
      loadSettingsForm();
      renderStaffList();
      return;
    }

    const { interactions } = await callbackApi.getInteractions();
    if (interactions?.length) store.mergeInteractions(interactions);

    const { notifications } = await callbackApi.getNotifications();
    renderBusinessAlerts(notifications || []);

    const { reviews } = await callbackApi.getReviews();
    if (reviews) store.saveReviews(reviews);
    renderReviews(reviews || store.getReviews());

    const { settings } = await callbackApi.getSettings();
    if (settings) store.saveSettings(settings, { silent: true });
    loadSettingsForm(settings || store.getSettings());

    const { staff } = await callbackApi.getStaff();
    if (staff) store.saveStaff(staff, { silent: true });
    renderStaffList(staff || store.getStaff());

    await syncAnalytics();
    renderTable();
  } catch (error) {
    console.warn("Backend sync unavailable", error);
    renderAnalytics(store.getAnalytics());
    renderReviews();
  }
}

function setupEventHandlers() {
  document.addEventListener("click", async (event) => {
    const navBtn = event.target.closest("[data-nav]");
    if (navBtn) {
      event.preventDefault();
      activateTab(navBtn.dataset.nav);
      return;
    }

    const actionBtn = event.target.closest("[data-action]");
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === "simulate-missed-call") return simulateMissedCall();
      if (action === "refresh-data") return syncBackend().then(() => showStatus("Data refreshed."));
      if (action === "logout") return handleLogout();
      if (action === "preview-message") {
        if (!auth.isLoggedIn()) {
          setMessage("adminLoginMessage", "Sign in to preview and edit admin settings.", "error");
          return;
        }
        updateMessagePreview();
        setMessage("settingsMessage", "Message preview updated below.", "success");
        return;
      }
      if (action === "reset-staff-form") return resetStaffForm();
      if (action === "edit-staff") return editStaff(actionBtn.dataset.id);
      if (action === "delete-staff") return deleteStaff(actionBtn.dataset.id);
      if (action === "mark-urgent") return handleStaffAction("urgent");
      if (action === "mark-complete") return handleStaffAction("complete");
      if (action === "cancel-request") return handleStaffAction("cancel");
    }

    const row = event.target.closest("#requestList .request-card, #interactionTable .clickable-row");
    if (row?.dataset.id) {
      activeInteractionId = row.dataset.id;
      openDrawer(activeInteractionId);
    }
  });

  document.getElementById("requestList")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".request-card");
    if (!card?.dataset.id) return;
    event.preventDefault();
    activeInteractionId = card.dataset.id;
    openDrawer(activeInteractionId);
  });

  document.getElementById("closeDrawerBtn")?.addEventListener("click", closeDrawer);
  document.getElementById("detailDrawer")?.addEventListener("click", (event) => {
    if (event.target.id === "detailDrawer") closeDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  document.getElementById("searchInput")?.addEventListener("input", renderTable);
  document.getElementById("filterSelect")?.addEventListener("change", renderTable);

  document.getElementById("settingsForm")?.addEventListener("submit", saveSettings);
  document.getElementById("staffForm")?.addEventListener("submit", saveStaffMember);
  document.getElementById("adminLoginForm")?.addEventListener("submit", handleAdminLogin);
  window.addEventListener("cf:auth-changed", updateAuthUI);

  document.getElementById("staffNoteForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeInteractionId) return;
    const author = document.getElementById("staffNoteAuthor")?.value.trim() || "Staff";
    const text = document.getElementById("staffNoteText")?.value.trim() || "";
    if (!text) return;
    try {
      if (await callbackApi.isAvailable()) {
        const result = await callbackApi.addStaffNote(activeInteractionId, { author, text });
        store.saveServerInteraction(result.interaction);
      } else {
        store.addStaffNote(activeInteractionId, { author, text });
      }
      document.getElementById("staffNoteText").value = "";
      renderTable();
      await refreshActiveDrawer();
      showStatus("Staff note saved.");
    } catch (error) {
      console.error(error);
      showStatus("Unable to save staff note.", "error");
    }
  });

  document.getElementById("reviewForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      fullName: document.getElementById("reviewName")?.value.trim() || "Anonymous",
      phone: document.getElementById("reviewPhone")?.value.trim() || "",
      rating: Number(document.getElementById("reviewRating")?.value || 5),
      comment: document.getElementById("reviewComment")?.value.trim() || ""
    };
    try {
      if (await callbackApi.isAvailable()) {
        const result = await callbackApi.createReview(payload);
        const reviews = store.getReviews();
        store.saveReviews([result.review, ...reviews.filter((item) => item.id !== result.review.id)]);
      } else {
        store.addReview(payload);
      }
      setMessage("reviewMessage", "Thanks for your review.", "success");
      event.target.reset();
      renderReviews();
      await syncAnalytics();
    } catch (error) {
      console.error(error);
      setMessage("reviewMessage", "Unable to save your review right now.", "error");
    }
  });

  window.addEventListener("cms:interactions-updated", () => {
    renderTable();
    renderAnalytics(store.getAnalytics());
  });
  window.addEventListener("cms:reviews-updated", () => {
    renderReviews();
    renderAnalytics(store.getAnalytics());
  });
  window.addEventListener("cms:settings-updated", (event) => {
    loadSettingsForm(event.detail || store.getSettings());
  });
  window.addEventListener("cms:staff-updated", () => renderStaffList());
  window.addEventListener("hashchange", () => {
    const hash = (window.location.hash || "").replace("#", "") || "dashboard";
    activateTab(hash);
  });
}

function bootApp() {
  setupEventHandlers();
  renderTable();
  renderAnalytics(store.getAnalytics());
  renderBusinessAlerts();
  renderReviews();
  resetStaffForm();
  updateAuthUI();
  refreshAuthStatus();

  const hash = (window.location.hash || "").replace("#", "") || "dashboard";
  activateTab(hash);

  syncBackend();
  window.setInterval(syncBackend, 10000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootApp);
} else {
  bootApp();
}
