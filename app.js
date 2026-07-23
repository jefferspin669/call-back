import { callbackApi } from "./js/api-client.js";
import { store } from "./js/shared-store.js";
import { getAiTriage } from "./js/ai-triage.js";

const simLabels = [
  "Customer calls business",
  "Call is missed",
  "Text link is sent",
  "Caller submits details",
  "Staff queue updates",
  "Analytics refresh"
];

const simTimeline = [
  "Incoming call from Ava Johnson",
  "Call missed. Callback workflow started.",
  "Text sent: Sorry we missed your call. Tap here to request a callback.",
  "Caller submitted name, reason, picture/voice, and preferred callback details.",
  "Staff queue updated with priority, notes, history, and recommended next action.",
  "Dashboard metrics and reviews refreshed automatically."
];

let demoStep = 0;
let activeInteractionId = null;
let latestAnalytics = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusClass(status) {
  if (status === "Awaiting Response") return "status-awaiting";
  if (status === "Scheduled") return "status-scheduled";
  if (status === "In Progress") return "status-progress";
  if (status === "Escalated") return "status-escalated";
  if (status === "Completed") return "status-completed";
  if (status === "Cancelled") return "status-cancelled";
  return "";
}

function priorityClass(priority) {
  if (priority === "High") return "badge-high";
  if (priority === "Medium") return "badge-medium";
  return "badge-low";
}

function getInteractions() {
  return store.getInteractions();
}

function activateTab(tabName) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === tabName));
  if (tabName === "analytics") renderAnalytics();
  if (tabName === "reviews") renderReviews();
}

function renderDashboardAiPreview(interaction) {
  const target = document.getElementById("dashboardAiPreview");
  if (!target) return;

  if (!interaction) {
    target.innerHTML = `
      <div class="notice">
        <h4>Suggested response</h4>
        <p>Select an interaction to see AI triage details.</p>
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

  setText("metricMissedToday", totals.today ?? totals.missedCalls ?? 0);
  setText("metricMissedHint", `${totals.missedCalls || 0} total missed-call records`);
  setText("metricPending", totals.pending ?? 0);
  setText("metricPendingHint", `${totals.urgent || 0} urgent follow-ups`);
  setText("metricAvgRating", totals.avgRating ? totals.avgRating.toFixed ? totals.avgRating.toFixed(1) : totals.avgRating : "-");
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
  const body = document.getElementById("interactionTable");
  if (!body) return;

  const q = (searchInput?.value || "").toLowerCase().trim();
  const filter = filterSelect?.value || "all";

  const rows = getInteractions().filter((item) => {
    const blob = `${item.client} ${item.phone} ${item.issue} ${item.id}`.toLowerCase();
    const matchSearch = blob.includes(q);
    let matchFilter = filter === "all";

    if (!matchFilter) {
      if (filter === "urgent") matchFilter = Boolean(item.urgent) || item.priority === "High";
      else if (filter === "repeat") matchFilter = Boolean(item.repeatCaller);
      else {
        matchFilter =
          item.priority.toLowerCase() === filter ||
          item.status.toLowerCase().includes(filter);
      }
    }

    return matchSearch && matchFilter;
  });

  body.innerHTML = rows.map((item) => `
    <tr class="clickable-row" data-id="${escapeHtml(item.id)}">
      <td>
        <strong>${escapeHtml(item.client)}</strong>
        <div class="subtle">${escapeHtml(item.phone)}</div>
        <div class="subtle">${escapeHtml(item.issue)}</div>
      </td>
      <td>${escapeHtml(item.channel)}</td>
      <td>
        <span class="badge ${priorityClass(item.priority)}">${escapeHtml(item.priority)}</span>
        ${item.urgent ? '<span class="badge badge-high">Urgent</span>' : ""}
        ${item.repeatCaller ? '<span class="badge">Repeat Caller</span>' : ""}
        ${item.picture ? '<span class="badge">Photo</span>' : ""}
        ${item.voiceMemo ? '<span class="badge">Voice</span>' : ""}
      </td>
      <td><span class="badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
      <td>${escapeHtml(item.assignedTo)}</td>
      <td>${escapeHtml(item.lastActivity)}</td>
    </tr>
  `).join("");

  body.querySelectorAll(".clickable-row").forEach((row) => {
    row.addEventListener("click", () => {
      activeInteractionId = row.dataset.id;
      openDrawer(activeInteractionId);
    });
  });

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
    feed.innerHTML = '<div class="subtle">No reviews yet. Ask customers to rate their callback experience.</div>';
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

function setupTabs() {
  document.querySelectorAll(".tab, .tab-jump, a[data-tab]").forEach((tab) => {
    tab.addEventListener("click", (event) => {
      const tabName = tab.dataset.tab;
      if (!tabName) return;
      if (tab.tagName === "A") event.preventDefault();
      activateTab(tabName);
      if (tabName === "reviews") history.replaceState(null, "", "#reviews");
      else if (tabName === "analytics") history.replaceState(null, "", "#analytics");
      else history.replaceState(null, "", "#");
    });
  });

  const hash = (window.location.hash || "").replace("#", "");
  if (hash && document.getElementById(hash)) activateTab(hash);
}

function setClientStatus(key) {
  const received = document.getElementById("status-received");
  const progress = document.getElementById("status-progress");
  const completed = document.getElementById("status-completed");

  if (received) received.classList.toggle("active", key === "received");
  if (progress) progress.classList.toggle("active", key === "progress");
  if (completed) completed.classList.toggle("active", key === "completed");
}

function goClientStep(step, status) {
  const step1 = document.getElementById("clientStep1");
  const step2 = document.getElementById("clientStep2");
  const step3 = document.getElementById("clientStep3");

  if (step1) step1.classList.toggle("hidden", step !== 1);
  if (step2) step2.classList.toggle("hidden", step !== 2);
  if (step3) step3.classList.toggle("hidden", step !== 3);

  setClientStatus(status);
}

function resetClientFlow() {
  goClientStep(1, "received");
}

function renderDemo() {
  const simSteps = document.getElementById("simSteps");
  const timeline = document.getElementById("timeline");

  if (simSteps) {
    simSteps.innerHTML = simLabels.map((label, index) => `
      <div class="sim-step ${index <= demoStep ? "active" : ""}">
        <div class="step-label">Step ${index + 1}</div>
        <div class="step-title">${escapeHtml(label)}</div>
      </div>
    `).join("");
  }

  if (timeline) {
    timeline.innerHTML = simTimeline.map((item, index) => `
      <div class="timeline-item t${index + 1} ${index <= demoStep ? "active" : ""}">
        ${escapeHtml(item)}
      </div>
    `).join("");
  }
}

function advanceDemo() {
  demoStep = demoStep < simLabels.length - 1 ? demoStep + 1 : 0;
  renderDemo();
}

function renderAiPanel(interaction) {
  const aiPanel = document.getElementById("drawerAiPanel");
  if (!aiPanel) return;

  const triage = getAiTriage(interaction);

  aiPanel.innerHTML = `
    <div class="notice">
      <div class="ai-chip ${triage.escalate ? "ai-urgent" : ""}">
        ${escapeHtml(triage.sentiment)} - ${triage.urgency}% urgency
      </div>
      <h4 style="margin-top:12px;">Summary</h4>
      <p>${escapeHtml(triage.summary)}</p>
    </div>

    <div class="notice">
      <h4>Recommended action</h4>
      <p>${escapeHtml(triage.recommendedAction)}</p>
    </div>

    <div class="notice">
      <h4>Suggested response</h4>
      <p>${escapeHtml(triage.suggestedResponse)}</p>
    </div>

    <div class="notice">
      <h4>Best callback window</h4>
      <p>${escapeHtml(triage.bestWindow)}</p>
    </div>
  `;
}

function renderList(containerId, items, emptyText, formatter) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items || !items.length) {
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
    parts.push(`
      <div class="notice">
        <h4>Picture</h4>
        <img class="drawer-media" src="${interaction.picture}" alt="Customer picture" />
      </div>
    `);
  }
  if (interaction.voiceMemo) {
    parts.push(`
      <div class="notice">
        <h4>Voice memo</h4>
        <audio class="drawer-audio" controls src="${interaction.voiceMemo}"></audio>
      </div>
    `);
  }

  container.innerHTML = parts.length
    ? parts.join("")
    : '<div class="subtle">No picture or voice memo attached.</div>';
}

function openDrawer(id) {
  const interaction = getInteractions().find((item) => item.id === id);
  const drawer = document.getElementById("detailDrawer");
  if (!interaction || !drawer) return;

  activeInteractionId = id;

  const clientName = document.getElementById("drawerClientName");
  const clientMeta = document.getElementById("drawerClientMeta");

  if (clientName) clientName.textContent = interaction.client;
  if (clientMeta) {
    clientMeta.textContent = `${interaction.id} - ${interaction.channel} - ${interaction.status}${interaction.urgent ? " - Urgent" : ""}`;
  }

  renderAttachments(interaction);

  renderList(
    "drawerCustomerHistory",
    interaction.customerHistory || [],
    "No previous requests for this customer.",
    (entry) => `
      <div class="notice">
        <h4>${escapeHtml(entry.reason || "Previous request")}</h4>
        <p>${escapeHtml(entry.status || "Unknown")} · ${escapeHtml(entry.priority || "Medium")}${entry.createdAt ? ` · ${new Date(entry.createdAt).toLocaleString()}` : ""}</p>
      </div>
    `
  );

  renderList(
    "drawerHistory",
    interaction.history || [],
    "No callback history yet.",
    (entry) => `<div class="notice"><p>${escapeHtml(entry)}</p></div>`
  );

  renderList(
    "drawerStaffNotes",
    interaction.staffNotes || [],
    "No staff notes yet.",
    (note) => `
      <div class="notice">
        <h4>${escapeHtml(note.author || "Staff")} · ${note.createdAt ? new Date(note.createdAt).toLocaleString() : ""}</h4>
        <p>${escapeHtml(note.text || "")}</p>
      </div>
    `
  );

  renderList(
    "drawerNotes",
    interaction.notes || [],
    "No notes yet.",
    (note) => `<div class="notice"><p>${escapeHtml(note)}</p></div>`
  );

  renderList(
    "drawerMessages",
    interaction.messages || [],
    "No messages sent yet.",
    (msg) => `
      <div class="notice">
        <h4>${escapeHtml(msg.type || "Message")}</h4>
        <p>${escapeHtml(msg.text || "")}</p>
      </div>
    `
  );

  renderAiPanel(interaction);
  renderDashboardAiPreview(interaction);
  renderHistoryPreview(interaction);
  drawer.classList.remove("hidden");
}

function closeDrawer() {
  const drawer = document.getElementById("detailDrawer");
  if (drawer) drawer.classList.add("hidden");
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
      if (action === "urgent") {
        interaction = (await callbackApi.markUrgent(activeInteractionId)).interaction;
      } else if (action === "complete") {
        interaction = (await callbackApi.completeCallbackRequest(activeInteractionId)).interaction;
      } else if (action === "cancel") {
        interaction = (await callbackApi.cancelCallbackRequest(activeInteractionId)).interaction;
      }
      if (interaction) store.saveServerInteraction(interaction);
    } else if (action === "urgent") {
      interaction = store.markUrgent(activeInteractionId);
    } else if (action === "complete") {
      interaction = store.completeInteraction(activeInteractionId);
    } else if (action === "cancel") {
      interaction = store.cancelInteraction(activeInteractionId);
    }

    renderTable();
    await refreshActiveDrawer();
    await syncAnalytics();
  } catch (error) {
    console.error(error);
    alert("Unable to update this request right now.");
  }
}

function setupDrawer() {
  const closeBtn = document.getElementById("closeDrawerBtn");
  const drawer = document.getElementById("detailDrawer");
  const noteForm = document.getElementById("staffNoteForm");
  const markUrgentBtn = document.getElementById("markUrgentBtn");
  const completeRequestBtn = document.getElementById("completeRequestBtn");
  const cancelRequestBtn = document.getElementById("cancelRequestBtn");

  if (closeBtn) closeBtn.addEventListener("click", closeDrawer);

  if (drawer) {
    drawer.addEventListener("click", (event) => {
      if (event.target === drawer) closeDrawer();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  if (markUrgentBtn) markUrgentBtn.addEventListener("click", () => handleStaffAction("urgent"));
  if (completeRequestBtn) completeRequestBtn.addEventListener("click", () => handleStaffAction("complete"));
  if (cancelRequestBtn) cancelRequestBtn.addEventListener("click", () => handleStaffAction("cancel"));

  if (noteForm) {
    noteForm.addEventListener("submit", async (event) => {
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
      } catch (error) {
        console.error(error);
        alert("Unable to save staff note right now.");
      }
    });
  }
}

function setupFilters() {
  const searchInput = document.getElementById("searchInput");
  const filterSelect = document.getElementById("filterSelect");

  if (searchInput) searchInput.addEventListener("input", renderTable);
  if (filterSelect) filterSelect.addEventListener("change", renderTable);
}

function setupReviewForm() {
  const form = document.getElementById("reviewForm");
  const message = document.getElementById("reviewMessage");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
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

      if (message) {
        message.className = "message success";
        message.textContent = "Thanks for your review.";
      }
      form.reset();
      renderReviews();
      await syncAnalytics();
    } catch (error) {
      console.error(error);
      if (message) {
        message.className = "message error";
        message.textContent = "Unable to save your review right now.";
      }
    }
  });
}

function setupStoreListeners() {
  window.addEventListener("cms:interactions-updated", () => {
    renderTable();
    renderAnalytics(store.getAnalytics());
  });
  window.addEventListener("cms:reviews-updated", () => {
    renderReviews();
    renderAnalytics(store.getAnalytics());
  });
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

async function syncBackendInteractions() {
  if (!(await callbackApi.isAvailable())) {
    renderAnalytics(store.getAnalytics());
    renderReviews();
    return;
  }

  try {
    const { interactions } = await callbackApi.getInteractions();
    if (interactions?.length) {
      store.mergeInteractions(interactions);
    }
    const { notifications } = await callbackApi.getNotifications();
    renderBusinessAlerts(notifications || []);

    const { reviews } = await callbackApi.getReviews();
    if (reviews) store.saveReviews(reviews);
    renderReviews(reviews || store.getReviews());

    await syncAnalytics();
  } catch (error) {
    console.warn("Backend sync unavailable", error);
    renderAnalytics(store.getAnalytics());
    renderReviews();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupFilters();
  setupDrawer();
  setupReviewForm();
  renderTable();
  renderAnalytics(store.getAnalytics());
  renderBusinessAlerts();
  renderReviews();
  renderDemo();
  resetClientFlow();
  setupStoreListeners();
  syncBackendInteractions();
  window.setInterval(syncBackendInteractions, 10000);

  window.goClientStep = goClientStep;
  window.resetClientFlow = resetClientFlow;
  window.advanceDemo = advanceDemo;
});
