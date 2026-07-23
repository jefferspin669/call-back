import { callbackApi } from "./js/api-client.js";
import { store } from "./js/shared-store.js";
import { getAiTriage } from "./ai-triage.js";

const analyticsData = [
  { day: "Mon", missed: 12, callbacks: 9 },
  { day: "Tue", missed: 18, callbacks: 15 },
  { day: "Wed", missed: 15, callbacks: 13 },
  { day: "Thu", missed: 22, callbacks: 17 },
  { day: "Fri", missed: 16, callbacks: 14 },
  { day: "Sat", missed: 9, callbacks: 8 },
  { day: "Sun", missed: 5, callbacks: 4 }
];

const responseTimeData = [
  { hour: "8a", time: 4 },
  { hour: "10a", time: 6 },
  { hour: "12p", time: 7 },
  { hour: "2p", time: 5 },
  { hour: "4p", time: 8 },
  { hour: "6p", time: 3 }
];

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
  "Caller submitted name, reason, and preferred callback details.",
  "Staff queue updated with priority, notes, and recommended next action.",
  "Dashboard metrics refreshed automatically."
];

let demoStep = 0;
let activeInteractionId = null;

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
      <p>${triage.suggestedResponse}</p>
    </div>
    <div class="notice">
      <h4>Recommended action</h4>
      <p>${triage.recommendedAction}</p>
    </div>
    <div class="notice">
      <h4>Best callback time</h4>
      <p>${triage.bestWindow}</p>
    </div>
  `;
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
    const matchFilter =
      filter === "all" ||
      item.priority.toLowerCase() === filter ||
      item.status.toLowerCase().includes(filter);

    return matchSearch && matchFilter;
  });

  body.innerHTML = rows.map((item) => `
    <tr class="clickable-row" data-id="${item.id}">
      <td>
        <strong>${item.client}</strong>
        <div class="subtle">${item.phone}</div>
        <div class="subtle">${item.issue}</div>
      </td>
      <td>${item.channel}</td>
      <td>
        <span class="badge ${priorityClass(item.priority)}">${item.priority}</span>
        ${item.repeatCaller ? '<span class="badge">Repeat Caller</span>' : ""}
      </td>
      <td><span class="badge ${statusClass(item.status)}">${item.status}</span></td>
      <td>${item.assignedTo}</td>
      <td>${item.lastActivity}</td>
    </tr>
  `).join("");

  body.querySelectorAll(".clickable-row").forEach((row) => {
    row.addEventListener("click", () => {
      activeInteractionId = row.dataset.id;
      openDrawer(activeInteractionId);
    });
  });

  const activeInteraction = getInteractions().find((item) => item.id === activeInteractionId) || rows[0] || null;
  renderDashboardAiPreview(activeInteraction);
}

function renderCharts() {
  const missedChart = document.getElementById("missedChart");
  const responseChart = document.getElementById("responseChart");

  if (missedChart) {
    const maxMissed = Math.max(...analyticsData.map((d) => d.missed));
    missedChart.innerHTML = analyticsData.map((d) => `
      <div class="bar-row">
        <strong>${d.day}</strong>
        <div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(d.missed / maxMissed) * 100}%"></div>
          </div>
          <div class="bar-track" style="margin-top:6px;">
            <div class="bar-fill alt" style="width:${(d.callbacks / maxMissed) * 100}%"></div>
          </div>
        </div>
        <div>${d.missed}/${d.callbacks}</div>
      </div>
    `).join("");
  }

  if (responseChart) {
    const maxTime = Math.max(...responseTimeData.map((d) => d.time));
    responseChart.innerHTML = responseTimeData.map((d) => `
      <div class="line-chart-row">
        <strong>${d.hour}</strong>
        <div class="dot-line" style="--pct:${(d.time / maxTime) * 100}%"></div>
        <div>${d.time}m</div>
      </div>
    `).join("");
  }
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
        <strong>${item.subject || "Business Alert"}</strong><br>
        <span class="muted">${item.message || ""}</span>
      </span>
      <strong>${item.status || "ready"}</strong>
    </div>
  `).join("");
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));

      tab.classList.add("active");
      const target = document.getElementById(tab.dataset.tab);
      if (target) target.classList.add("active");
    });
  });
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
        <div class="step-title">${label}</div>
      </div>
    `).join("");
  }

  if (timeline) {
    timeline.innerHTML = simTimeline.map((item, index) => `
      <div class="timeline-item t${index + 1} ${index <= demoStep ? "active" : ""}">
        ${item}
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
        ${triage.sentiment} - ${triage.urgency}% urgency
      </div>
      <h4 style="margin-top:12px;">Summary</h4>
      <p>${triage.summary}</p>
    </div>

    <div class="notice">
      <h4>Recommended action</h4>
      <p>${triage.recommendedAction}</p>
    </div>

    <div class="notice">
      <h4>Suggested response</h4>
      <p>${triage.suggestedResponse}</p>
    </div>

    <div class="notice">
      <h4>Best callback window</h4>
      <p>${triage.bestWindow}</p>
    </div>
  `;
}

function renderList(containerId, items, emptyText, formatter) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items || !items.length) {
    container.innerHTML = `<div class="subtle">${emptyText}</div>`;
    return;
  }

  container.innerHTML = items.map(formatter).join("");
}

function openDrawer(id) {
  const interaction = getInteractions().find((item) => item.id === id);
  const drawer = document.getElementById("detailDrawer");
  if (!interaction || !drawer) return;

  const clientName = document.getElementById("drawerClientName");
  const clientMeta = document.getElementById("drawerClientMeta");

  if (clientName) clientName.textContent = interaction.client;
  if (clientMeta) clientMeta.textContent = `${interaction.id} - ${interaction.channel} - ${interaction.status}`;

  renderList(
    "drawerHistory",
    interaction.history || [],
    "No callback history yet.",
    (entry) => `<div class="notice"><p>${entry}</p></div>`
  );

  renderList(
    "drawerNotes",
    interaction.notes || [],
    "No notes yet.",
    (note) => `<div class="notice"><p>${note}</p></div>`
  );

  renderList(
    "drawerMessages",
    interaction.messages || [],
    "No messages sent yet.",
    (msg) => `
      <div class="notice">
        <h4>${msg.type || "Message"}</h4>
        <p>${msg.text || ""}</p>
      </div>
    `
  );

  renderAiPanel(interaction);
  renderDashboardAiPreview(interaction);
  drawer.classList.remove("hidden");
}

function closeDrawer() {
  const drawer = document.getElementById("detailDrawer");
  if (drawer) drawer.classList.add("hidden");
}

function setupDrawer() {
  const closeBtn = document.getElementById("closeDrawerBtn");
  const drawer = document.getElementById("detailDrawer");

  if (closeBtn) closeBtn.addEventListener("click", closeDrawer);

  if (drawer) {
    drawer.addEventListener("click", (event) => {
      if (event.target === drawer) closeDrawer();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });
}

function setupFilters() {
  const searchInput = document.getElementById("searchInput");
  const filterSelect = document.getElementById("filterSelect");

  if (searchInput) searchInput.addEventListener("input", renderTable);
  if (filterSelect) filterSelect.addEventListener("change", renderTable);
}

function setupStoreListeners() {
  window.addEventListener("cms:interactions-updated", renderTable);
}

async function syncBackendInteractions() {
  if (!(await callbackApi.isAvailable())) return;

  try {
    const { interactions } = await callbackApi.getInteractions();
    if (interactions?.length) {
      store.mergeInteractions(interactions);
    }
    const { notifications } = await callbackApi.getNotifications();
    renderBusinessAlerts(notifications || []);
  } catch (error) {
    console.warn("Backend sync unavailable", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupFilters();
  setupDrawer();
  renderTable();
  renderCharts();
  renderBusinessAlerts();
  renderDemo();
  resetClientFlow();
  setupStoreListeners();
  syncBackendInteractions();
  window.setInterval(syncBackendInteractions, 10000);

  window.goClientStep = goClientStep;
  window.resetClientFlow = resetClientFlow;
  window.advanceDemo = advanceDemo;
});
