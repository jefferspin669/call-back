import { callbackApi } from "./api-client.js";
import { store } from "./shared-store.js";

const businessRules = {
  workingDays: [1, 2, 3, 4, 5],
  startHour: 8,
  endHour: 18,
  slotMinutes: 30,
  bufferMinutes: 15,
  blockedDates: []
};

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let currentMonth = new Date();
currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);

let selectedDate = null;
let selectedSlot = null;
let bookingState = null;
let requestToken = null;
let pictureData = null;
let voiceMemoData = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const dashboardEvents = [
  {
    label: "System",
    value: "Callback request page loaded and waiting for caller details.",
    at: new Date().toISOString()
  },
  {
    label: "Timezone",
    value: `Detected timezone: ${userTimezone}`,
    at: new Date().toISOString()
  }
];

function pad(num) {
  return String(num).padStart(2, "0");
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateLong(date) {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function formatTimeLabel(hour, minute) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isSameDay(a, b) {
  return (
    a &&
    b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isPastDate(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function isWorkingDay(date) {
  return businessRules.workingDays.includes(date.getDay());
}

function getReservedSlots(date) {
  const map = {
    [toIsoDate(new Date())]: ["10:00", "11:30"]
  };

  const dateKey = toIsoDate(date);
  const dynamicTuesday = date.getDay() === 2 ? ["09:00", "14:00"] : [];
  const dynamicThursday = date.getDay() === 4 ? ["08:30", "13:30", "16:00"] : [];

  return [...(map[dateKey] || []), ...dynamicTuesday, ...dynamicThursday];
}

function generateSlots(date) {
  if (!isWorkingDay(date) || isPastDate(date)) return [];

  const slots = [];
  const reserved = getReservedSlots(date);
  const now = new Date();
  const sameAsToday = isSameDay(date, now);

  for (let hour = businessRules.startHour; hour < businessRules.endHour; hour++) {
    for (let minute = 0; minute < 60; minute += businessRules.slotMinutes) {
      const slotDate = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        hour,
        minute,
        0,
        0
      );

      const slotKey = `${pad(hour)}:${pad(minute)}`;
      const afterBuffer = slotDate.getTime() > now.getTime() + businessRules.bufferMinutes * 60000;
      const isReserved = reserved.includes(slotKey);

      if ((!sameAsToday || afterBuffer) && !isReserved) {
        slots.push({
          key: slotKey,
          label: formatTimeLabel(hour, minute),
          disabled: false
        });
      }
    }
  }

  return slots;
}

function updateSummary() {
  const summaryDate = document.getElementById("summaryDate");
  const summaryTime = document.getElementById("summaryTime");

  if (summaryDate) summaryDate.textContent = selectedDate ? formatDateLong(selectedDate) : "Not selected";
  if (summaryTime) summaryTime.textContent = selectedSlot ? selectedSlot.label : "Not selected";
}

function addDashboardEvent(label, value) {
  dashboardEvents.unshift({
    label,
    value,
    at: new Date().toISOString()
  });

  renderDashboardFeed();
}

function renderDashboardFeed() {
  const feed = document.getElementById("dashboardFeed");
  if (!feed) return;

  feed.innerHTML = dashboardEvents.slice(0, 8).map((item) => `
    <div class="summary-row">
      <span>
        <strong>${item.label}</strong><br>
        <span class="muted">${item.value}</span>
      </span>
      <strong>${new Date(item.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>
    </div>
  `).join("");
}

function setMessage(text, type = "success") {
  const box = document.getElementById("messageBox");
  if (!box) return;

  box.className = `message ${type}`;
  box.textContent = text;
}

function clearMessage() {
  const box = document.getElementById("messageBox");
  if (!box) return;

  box.className = "message";
  box.textContent = "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function updateAttachmentPreviews() {
  const picturePreview = document.getElementById("picturePreview");
  const voicePreview = document.getElementById("voicePreview");
  const pictureStatus = document.getElementById("pictureStatus");
  const voiceStatus = document.getElementById("voiceStatus");

  if (picturePreview) {
    if (pictureData) {
      picturePreview.innerHTML = `<img src="${pictureData}" alt="Attached picture preview" />`;
      if (pictureStatus) pictureStatus.textContent = "Picture attached";
    } else {
      picturePreview.innerHTML = '<div class="subtle">No picture attached.</div>';
      if (pictureStatus) pictureStatus.textContent = "Optional";
    }
  }

  if (voicePreview) {
    if (voiceMemoData) {
      voicePreview.innerHTML = `<audio controls src="${voiceMemoData}"></audio>`;
      if (voiceStatus) voiceStatus.textContent = "Voice memo attached";
    } else {
      voicePreview.innerHTML = '<div class="subtle">No voice memo attached.</div>';
      if (voiceStatus) voiceStatus.textContent = "Optional";
    }
  }
}

async function onPictureSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setMessage("Please choose an image file.", "error");
    return;
  }

  if (file.size > 4_500_000) {
    setMessage("Please choose a picture under 4.5 MB.", "error");
    return;
  }

  pictureData = await fileToDataUrl(file);
  updateAttachmentPreviews();
  addDashboardEvent("Attachment", "Customer attached a picture to the request.");
}

async function startVoiceRecording() {
  clearMessage();

  if (!navigator.mediaDevices?.getUserMedia) {
    setMessage("Voice recording is not supported in this browser. You can still send the request.", "error");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    isRecording = true;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      voiceMemoData = await fileToDataUrl(blob);
      updateAttachmentPreviews();
      addDashboardEvent("Attachment", "Customer attached a voice memo.");
      stream.getTracks().forEach((track) => track.stop());
      isRecording = false;
      updateRecordButton();
    };

    mediaRecorder.start();
    updateRecordButton();
    setMessage("Recording voice memo... tap Stop when finished.", "success");
  } catch (error) {
    console.error(error);
    setMessage("Unable to access the microphone. You can still send the request without a voice memo.", "error");
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }
}

function clearVoiceMemo() {
  voiceMemoData = null;
  updateAttachmentPreviews();
  updateRecordButton();
}

function clearPicture() {
  pictureData = null;
  const input = document.getElementById("pictureInput");
  if (input) input.value = "";
  updateAttachmentPreviews();
}

function updateRecordButton() {
  const recordBtn = document.getElementById("recordVoiceBtn");
  if (!recordBtn) return;
  recordBtn.textContent = isRecording ? "Stop recording" : "Record voice memo";
  recordBtn.classList.toggle("btn-danger", isRecording);
  recordBtn.classList.toggle("btn-secondary", !isRecording);
}

function renderCustomerHistory(history = []) {
  const target = document.getElementById("customerHistoryFeed");
  if (!target) return;

  if (!history.length) {
    target.innerHTML = '<div class="subtle">No previous requests for this phone number.</div>';
    return;
  }

  target.innerHTML = history.slice(0, 5).map((item) => `
    <div class="summary-row">
      <span>
        <strong>${item.reason || "Previous request"}</strong><br>
        <span class="muted">${item.status || "Unknown"} · ${item.priority || "Medium"}</span>
      </span>
      <strong>${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ""}</strong>
    </div>
  `).join("");
}

function renderCalendar() {
  const title = document.getElementById("monthTitle");
  const grid = document.getElementById("calendarGrid");

  if (!title || !grid) return;

  title.textContent = `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
  const startOffset = firstDay.getDay();
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
  const startDate = new Date(firstDay);

  startDate.setDate(firstDay.getDate() - startOffset);

  let html = "";

  weekdayNames.forEach((day) => {
    html += `<div class="day-name">${day}</div>`;
  });

  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(startDate);
    cellDate.setDate(startDate.getDate() + i);

    const inMonth = cellDate.getMonth() === currentMonth.getMonth();
    const past = isPastDate(cellDate);
    const working = isWorkingDay(cellDate);
    const disabled = past || !working;
    const slots = generateSlots(cellDate);
    const availableCount = slots.length;

    const classes = [
      "day",
      !inMonth ? "outside" : "",
      disabled ? "disabled" : "",
      isSameDay(cellDate, new Date()) ? "today" : "",
      selectedDate && isSameDay(cellDate, selectedDate) ? "selected" : ""
    ].filter(Boolean).join(" ");

    html += `
      <button type="button" class="${classes}" ${disabled ? "disabled" : ""} data-date="${toIsoDate(cellDate)}">
        <span class="day-num">${cellDate.getDate()}</span>
        <span class="day-meta">${availableCount} slots</span>
      </button>
    `;
  }

  grid.innerHTML = html;

  grid.querySelectorAll(".day[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDate = new Date(`${btn.dataset.date}T12:00:00`);
      selectedSlot = null;
      updateSummary();
      renderCalendar();
      renderSlots();
      addDashboardEvent("Client", `Selected callback date ${formatDateLong(selectedDate)}.`);
    });
  });
}

function renderSlots() {
  const slotGrid = document.getElementById("slotGrid");
  const label = document.getElementById("selectedDateLabel");

  if (!slotGrid || !label) return;

  if (!selectedDate) {
    label.textContent = "Select a date to view available times.";
    slotGrid.innerHTML = `
      <div class="notice">
        <strong>No date selected</strong>
        <p>Choose a day from the calendar to display open callback times.</p>
      </div>
    `;
    return;
  }

  const slots = generateSlots(selectedDate);
  label.textContent = `${formatDateLong(selectedDate)} - ${slots.length} slot${slots.length === 1 ? "" : "s"} available`;

  if (!slots.length) {
    slotGrid.innerHTML = `
      <div class="notice">
        <strong>No open slots</strong>
        <p>Try another day. This date may be outside business hours or fully booked.</p>
      </div>
    `;
    return;
  }

  slotGrid.innerHTML = slots.map((slot) => `
    <button type="button" class="slot ${selectedSlot && selectedSlot.key === slot.key ? "selected" : ""}" data-slot="${slot.key}">
      ${slot.label}
    </button>
  `).join("");

  slotGrid.querySelectorAll(".slot[data-slot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedSlot = slots.find((s) => s.key === btn.dataset.slot) || null;
      updateSummary();
      renderSlots();
      addDashboardEvent("Client", `Selected callback time ${selectedSlot.label}.`);
    });
  });
}

function getBookingPayload() {
  const fullName = document.getElementById("fullName")?.value.trim() || "";
  const phone = document.getElementById("phone")?.value.trim() || "";
  const email = document.getElementById("email")?.value.trim() || "";
  const reason = document.getElementById("reason")?.value.trim() || "";
  const details = document.getElementById("details")?.value.trim() || "";
  const urgentChecked = Boolean(document.getElementById("urgentToggle")?.checked);
  const hasPreferredSlot = Boolean(selectedDate && selectedSlot);
  const triageText = `${reason} ${details}`.toLowerCase();
  const urgentFromText = ["urgent", "asap", "emergency", "immediately", "angry", "frustrated"].some((word) =>
    triageText.includes(word)
  );
  const urgent = urgentChecked || urgentFromText;

  return {
    fullName,
    phone,
    email,
    details,
    reason,
    token: requestToken,
    timezone: userTimezone,
    date: hasPreferredSlot ? toIsoDate(selectedDate) : null,
    time: hasPreferredSlot ? selectedSlot.key : null,
    dateLabel: hasPreferredSlot ? formatDateLong(selectedDate) : "No preferred date",
    timeLabel: hasPreferredSlot ? selectedSlot.label : "No preferred time",
    startsAt: hasPreferredSlot ? `${toIsoDate(selectedDate)}T${selectedSlot.key}:00` : null,
    status: hasPreferredSlot ? "scheduled" : "awaiting",
    urgent,
    priority: urgent ? "High" : "Medium",
    picture: pictureData,
    voiceMemo: voiceMemoData
  };
}

async function createCallbackRequest(payload) {
  if (!(await callbackApi.isAvailable())) {
    return {
      source: "local",
      interaction: store.createBooking(payload)
    };
  }

  const result = await callbackApi.createCallbackRequest(payload);
  store.saveServerInteraction(result.interaction);
  return {
    source: "server",
    interaction: result.interaction,
    notification: result.businessNotification
  };
}

function updateStatusChips({ sms = "Pending", calendar = "Pending" } = {}) {
  const smsEl = document.getElementById("summarySms");
  const calendarEl = document.getElementById("summaryCalendar");

  if (smsEl) smsEl.textContent = sms;
  if (calendarEl) calendarEl.textContent = calendar;
}

async function fakeDelay(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function onBookingSubmit(event) {
  event.preventDefault();
  clearMessage();

  if (isRecording) {
    setMessage("Stop the voice recording before sending your request.", "error");
    return;
  }

  const payload = getBookingPayload();

  if (!payload.fullName || !payload.phone || !payload.reason) {
    setMessage("Name, phone number, and reason for calling are required.", "error");
    return;
  }

  updateStatusChips({ sms: "Sending...", calendar: "Alerting..." });

  try {
    await fakeDelay();

    const result = await createCallbackRequest(payload);
    const createdItem = result.interaction;

    bookingState = {
      bookingId: createdItem.id,
      ...payload
    };

    updateStatusChips({ sms: "Sent", calendar: "Alert sent" });

    addDashboardEvent("Callback request", `Created ${createdItem.id} for ${payload.fullName}.`);
    addDashboardEvent(
      "Business alert",
      result.source === "server"
        ? `Backend notification ready for staff: ${payload.reason}.`
        : `Staff notified locally: ${payload.reason}.`
    );
    if (payload.urgent) addDashboardEvent("Priority", "Request marked as urgent.");
    if (payload.picture) addDashboardEvent("Attachment", "Picture included with request.");
    if (payload.voiceMemo) addDashboardEvent("Attachment", "Voice memo included with request.");
    addDashboardEvent("SMS", `Confirmation text sent for ${createdItem.id}.`);
    addDashboardEvent("Dashboard", "Staff dashboard refreshed with latest callback request.");

    renderCustomerHistory(createdItem.customerHistory || store.getCustomerHistory(payload.phone, createdItem.id));

    setMessage("Your callback request was sent. The business now has your details and reason for calling.", "success");
  } catch (error) {
    console.error(error);
    updateStatusChips({ sms: "Failed", calendar: "Failed" });
    setMessage("Something went wrong while sending your callback request. Please try again.", "error");
  }
}

async function onReschedule() {
  clearMessage();

  if (!bookingState) {
    setMessage("Send a callback request first, then you can change the preferred time.", "error");
    return;
  }

  const payload = getBookingPayload();

  if (!selectedDate || !selectedSlot) {
    setMessage("Choose a new preferred date and time before changing it.", "error");
    return;
  }

  try {
    await fakeDelay();

    let interaction = null;
    if (await callbackApi.isAvailable()) {
      const result = await callbackApi.rescheduleCallbackRequest(bookingState.bookingId, payload);
      interaction = result.interaction;
      store.saveServerInteraction(interaction);
    } else {
      interaction = store.rescheduleInteraction(bookingState.bookingId, payload);
    }

    bookingState = { ...bookingState, ...payload };

    updateStatusChips({ sms: "Sent", calendar: "Alert sent" });

    addDashboardEvent(
      "Callback request",
      `Preferred callback time changed to ${payload.dateLabel} at ${payload.timeLabel}.`
    );
    addDashboardEvent("Dashboard", "Staff dashboard refreshed with updated callback preference.");

    setMessage(`Preferred callback time changed to ${payload.dateLabel} at ${payload.timeLabel}.`, "success");
  } catch (error) {
    console.error(error);
    setMessage("Unable to change this callback time right now.", "error");
  }
}

async function onCancel() {
  clearMessage();

  if (!bookingState) {
    setMessage("There is no callback request to cancel yet.", "error");
    return;
  }

  try {
    await fakeDelay();

    if (await callbackApi.isAvailable()) {
      const result = await callbackApi.cancelCallbackRequest(bookingState.bookingId);
      store.saveServerInteraction(result.interaction);
    } else {
      store.cancelInteraction(bookingState.bookingId);
    }

    updateStatusChips({ sms: "Cancelled", calendar: "Alert sent" });

    addDashboardEvent("Callback request", `Request ${bookingState.bookingId} was cancelled.`);
    addDashboardEvent("Dashboard", "Staff dashboard refreshed with cancelled callback request.");

    setMessage(`Callback request ${bookingState.bookingId} cancelled successfully.`, "success");
  } catch (error) {
    console.error(error);
    setMessage("Unable to cancel this callback request right now.", "error");
  }
}

async function loadHistoryForPhone(phone) {
  if (!phone) {
    renderCustomerHistory([]);
    return;
  }

  try {
    if (await callbackApi.isAvailable()) {
      const result = await callbackApi.getCustomerHistory(phone);
      renderCustomerHistory(result.history || []);
      if (result.repeatCaller) {
        addDashboardEvent("Customer history", "Previous requests found for this phone number.");
      }
      return;
    }
  } catch (error) {
    console.warn("Customer history API unavailable", error);
  }

  renderCustomerHistory(store.getCustomerHistory(phone));
}

function applySettings() {
  const settings = store.getSettings();

  businessRules.workingDays = settings.workingDays;
  businessRules.startHour = settings.startHour;
  businessRules.endHour = settings.endHour;
  businessRules.bufferMinutes = settings.bufferMinutes;

  const timezoneInput = document.getElementById("timezone");
  const timezoneText = document.getElementById("timezoneText");
  const timezonePill = document.getElementById("timezonePill");
  const hoursPill = document.getElementById("hoursPill");
  const businessNameLabel = document.getElementById("businessNameLabel");
  const responseTimeLabel = document.getElementById("responseTimeLabel");

  if (timezoneInput) timezoneInput.value = userTimezone;
  if (timezoneText) timezoneText.textContent = userTimezone;
  if (timezonePill) timezonePill.textContent = `Timezone: ${userTimezone}`;
  if (hoursPill) hoursPill.textContent = `Business hours: ${settings.businessHoursLabel}`;
  if (businessNameLabel && !businessNameLabel.dataset.locked) {
    businessNameLabel.textContent = settings.businessName || "Demo Business";
  }
  if (responseTimeLabel) {
    responseTimeLabel.textContent = settings.responseTimeLabel
      || `Usually within ${settings.bufferMinutes || 15} minutes during business hours`;
  }
}

async function applyMissedCallContext() {
  requestToken = callbackApi.getRequestToken();
  if (!requestToken || !(await callbackApi.isAvailable())) return;

  try {
    const { missedCall, customerHistory = [], repeatCaller } = await callbackApi.getMissedCall(requestToken);
    const phoneInput = document.getElementById("phone");
    const businessNameLabel = document.getElementById("businessNameLabel");

    if (phoneInput && missedCall?.callerPhone && !phoneInput.value) {
      phoneInput.value = missedCall.callerPhone;
    }
    if (businessNameLabel && missedCall?.businessName) {
      businessNameLabel.textContent = missedCall.businessName;
      businessNameLabel.dataset.locked = "true";
    }
    addDashboardEvent("Missed call", `Loaded secure request link for ${missedCall.callerPhone}.`);
    renderCustomerHistory(customerHistory);
    if (repeatCaller) {
      addDashboardEvent("Customer history", "Returning caller detected from previous requests.");
    }
  } catch (error) {
    addDashboardEvent("Missed call", "Secure request link could not be loaded. The form still works.");
  }
}

function setupEventListeners() {
  const prevMonthBtn = document.getElementById("prevMonthBtn");
  const nextMonthBtn = document.getElementById("nextMonthBtn");
  const bookingForm = document.getElementById("bookingForm");
  const rescheduleBtn = document.getElementById("rescheduleBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const pictureInput = document.getElementById("pictureInput");
  const clearPictureBtn = document.getElementById("clearPictureBtn");
  const recordVoiceBtn = document.getElementById("recordVoiceBtn");
  const clearVoiceBtn = document.getElementById("clearVoiceBtn");
  const phoneInput = document.getElementById("phone");

  if (prevMonthBtn) {
    prevMonthBtn.addEventListener("click", () => {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
      renderCalendar();
    });
  }

  if (nextMonthBtn) {
    nextMonthBtn.addEventListener("click", () => {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
      renderCalendar();
    });
  }

  if (bookingForm) bookingForm.addEventListener("submit", onBookingSubmit);
  if (rescheduleBtn) rescheduleBtn.addEventListener("click", onReschedule);
  if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
  if (pictureInput) pictureInput.addEventListener("change", onPictureSelected);
  if (clearPictureBtn) clearPictureBtn.addEventListener("click", clearPicture);
  if (recordVoiceBtn) {
    recordVoiceBtn.addEventListener("click", () => {
      if (isRecording) stopVoiceRecording();
      else startVoiceRecording();
    });
  }
  if (clearVoiceBtn) clearVoiceBtn.addEventListener("click", clearVoiceMemo);
  if (phoneInput) {
    phoneInput.addEventListener("blur", () => loadHistoryForPhone(phoneInput.value.trim()));
  }

  window.addEventListener("cms:settings-updated", () => {
    applySettings();
    renderCalendar();
    renderSlots();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  applySettings();
  setupEventListeners();
  applyMissedCallContext();
  renderCalendar();
  renderSlots();
  renderDashboardFeed();
  renderCustomerHistory([]);
  updateAttachmentPreviews();
  updateSummary();
  updateStatusChips();
  updateRecordButton();
});
