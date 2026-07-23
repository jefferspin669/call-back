const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://127.0.0.1:4174";
const BUSINESS_NAME = process.env.BUSINESS_NAME || "Demo Business";
const BUSINESS_ALERT_PHONE = process.env.BUSINESS_ALERT_PHONE || "(555) 010-9000";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "callback-store.json");

const initialData = {
  missedCalls: [],
  callbackRequests: [],
  businessNotifications: [],
  smsOutbox: []
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    return { ...initialData, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
  } catch {
    return { ...initialData };
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function makeToken() {
  return crypto.randomBytes(18).toString("hex");
}

function normalizePhone(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function getPriority(reason, details) {
  const text = `${reason || ""} ${details || ""}`.toLowerCase();
  return ["urgent", "asap", "emergency", "immediately", "angry", "frustrated"].some((word) => text.includes(word))
    ? "High"
    : "Medium";
}

function toInteraction(callbackRequest) {
  const hasPreferredSlot = Boolean(callbackRequest.date && callbackRequest.time);

  return {
    id: callbackRequest.id,
    client: callbackRequest.fullName,
    phone: callbackRequest.phone,
    channel: "Missed Call Form",
    priority: callbackRequest.priority,
    status: hasPreferredSlot ? "Scheduled" : "Awaiting Response",
    assignedTo: "Unassigned",
    lastActivity: "Just now",
    issue: callbackRequest.reason,
    repeatCaller: false,
    notes: [
      callbackRequest.reason,
      callbackRequest.details ? `Details: ${callbackRequest.details}` : null,
      callbackRequest.email ? `Email: ${callbackRequest.email}` : null,
      hasPreferredSlot
        ? `Preferred callback: ${callbackRequest.dateLabel} at ${callbackRequest.timeLabel}`
        : "No preferred callback time selected."
    ].filter(Boolean),
    messages: [
      { type: "SMS", text: callbackRequest.confirmationText },
      { type: "Business Alert", text: callbackRequest.businessAlertText }
    ],
    history: [
      "Missed call text link opened",
      "Callback request submitted",
      "Business notification created"
    ],
    booking: {
      date: callbackRequest.date,
      time: callbackRequest.time,
      timezone: callbackRequest.timezone
    }
  };
}

function createBusinessNotification(callbackRequest) {
  const preferred = callbackRequest.date && callbackRequest.time
    ? ` Preferred callback: ${callbackRequest.dateLabel} at ${callbackRequest.timeLabel}.`
    : "";

  return {
    id: makeId("NTF"),
    requestId: callbackRequest.id,
    channel: "Business Alert",
    recipient: BUSINESS_ALERT_PHONE,
    subject: "New missed-call callback request",
    message: `${callbackRequest.fullName} (${callbackRequest.phone}) needs a callback. Reason: ${callbackRequest.reason}.${preferred}`,
    status: "simulated_ready",
    createdAt: nowIso()
  };
}

function createSmsOutboxItem({ to, body, type, relatedId }) {
  return {
    id: makeId("SMS"),
    to,
    body,
    type,
    relatedId,
    provider: "simulation",
    status: "simulated_ready",
    createdAt: nowIso()
  };
}

function createMissedCall(payload) {
  const token = makeToken();
  const callerPhone = normalizePhone(payload.callerPhone || payload.From || payload.from);
  const businessPhone = normalizePhone(payload.businessPhone || payload.To || payload.to);
  const callbackUrl = `${PUBLIC_BASE_URL}/book.html?request=${token}`;

  return {
    id: makeId("CALL"),
    token,
    callerPhone,
    businessPhone,
    businessName: payload.businessName || BUSINESS_NAME,
    callbackUrl,
    smsText: `Sorry we missed your call. Tell us why you called and request a callback: ${callbackUrl}`,
    status: "sms_ready",
    createdAt: nowIso()
  };
}

function createCallbackRequest(payload, missedCall) {
  const priority = getPriority(payload.reason, payload.details);
  const request = {
    id: makeId("INT"),
    missedCallId: missedCall?.id || null,
    token: payload.token || missedCall?.token || null,
    fullName: String(payload.fullName || "").trim(),
    phone: normalizePhone(payload.phone || missedCall?.callerPhone),
    email: String(payload.email || "").trim(),
    reason: String(payload.reason || "").trim(),
    details: String(payload.details || "").trim(),
    timezone: payload.timezone || "UTC",
    date: payload.date || null,
    time: payload.time || null,
    dateLabel: payload.dateLabel || "No preferred date",
    timeLabel: payload.timeLabel || "No preferred time",
    startsAt: payload.startsAt || null,
    priority,
    createdAt: nowIso()
  };

  request.confirmationText = "Sorry we missed your call. Your callback request was received.";
  request.businessAlertText = `${request.fullName} requested a callback about "${request.reason}".`;

  return request;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "callback-system",
      publicBaseUrl: PUBLIC_BASE_URL,
      smsMode: "simulation"
    });
  }

  if (req.method === "GET" && url.pathname === "/api/interactions") {
    const data = readStore();
    return sendJson(res, 200, {
      interactions: data.callbackRequests.map(toInteraction),
      callbackRequests: data.callbackRequests
    });
  }

  if (req.method === "GET" && url.pathname === "/api/notifications") {
    const data = readStore();
    return sendJson(res, 200, { notifications: data.businessNotifications });
  }

  if (req.method === "GET" && url.pathname === "/api/outbox") {
    const data = readStore();
    return sendJson(res, 200, { smsOutbox: data.smsOutbox });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/request/")) {
    const token = decodeURIComponent(url.pathname.replace("/api/request/", ""));
    const data = readStore();
    const missedCall = data.missedCalls.find((item) => item.token === token);
    if (!missedCall) return notFound(res);
    return sendJson(res, 200, { missedCall });
  }

  if (req.method === "POST" && url.pathname === "/api/missed-call") {
    const payload = await readBody(req);
    const callerPhone = normalizePhone(payload.callerPhone || payload.From || payload.from);
    if (!callerPhone) return sendJson(res, 400, { error: "callerPhone is required" });

    const data = readStore();
    const missedCall = createMissedCall(payload);
    const sms = createSmsOutboxItem({
      to: missedCall.callerPhone,
      body: missedCall.smsText,
      type: "missed_call_auto_response",
      relatedId: missedCall.id
    });
    data.missedCalls.unshift(missedCall);
    data.smsOutbox.unshift(sms);
    writeStore(data);

    return sendJson(res, 201, {
      missedCall,
      sms
    });
  }

  if (req.method === "POST" && url.pathname === "/api/callback-requests") {
    const payload = await readBody(req);
    if (!payload.fullName || !payload.phone || !payload.reason) {
      return sendJson(res, 400, { error: "fullName, phone, and reason are required" });
    }

    const data = readStore();
    const missedCall = payload.token
      ? data.missedCalls.find((item) => item.token === payload.token)
      : null;
    const callbackRequest = createCallbackRequest(payload, missedCall);
    const notification = createBusinessNotification(callbackRequest);
    const confirmationSms = createSmsOutboxItem({
      to: callbackRequest.phone,
      body: callbackRequest.confirmationText,
      type: "caller_confirmation",
      relatedId: callbackRequest.id
    });
    const businessAlertSms = createSmsOutboxItem({
      to: notification.recipient,
      body: notification.message,
      type: "business_alert",
      relatedId: callbackRequest.id
    });
    data.callbackRequests.unshift(callbackRequest);
    data.businessNotifications.unshift(notification);
    data.smsOutbox.unshift(businessAlertSms, confirmationSms);
    writeStore(data);

    return sendJson(res, 201, {
      callbackRequest,
      interaction: toInteraction(callbackRequest),
      businessNotification: notification,
      sms: {
        callerConfirmation: confirmationSms,
        businessAlert: businessAlertSms
      }
    });
  }

  return notFound(res);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message || "Server error" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Callback API listening on http://${HOST}:${PORT}`);
  console.log(`Client links will use ${PUBLIC_BASE_URL}`);
});
