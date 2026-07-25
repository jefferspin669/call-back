const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4174);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_HOST = process.env.PUBLIC_HOST || "127.0.0.1";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://${PUBLIC_HOST}:${PORT}`;
const BUSINESS_NAME = process.env.BUSINESS_NAME || "Demo Business";
const BUSINESS_ALERT_PHONE = process.env.BUSINESS_ALERT_PHONE || "(555) 010-9000";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "callback-store.json");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const ROOT_DIR = __dirname;
const MAX_BODY_BYTES = 12_000_000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const REMEMBER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const defaultSettings = {
  businessName: BUSINESS_NAME,
  businessHoursLabel: "Mon-Fri, 8:00 AM - 6:00 PM",
  responseTimeLabel: "Usually within 15 minutes during business hours",
  autoResponseTemplate: "Sorry we missed your call. Tap your secure link to tell us why you called and request a callback.",
  escalationAlerts: true,
  staffAccessControls: true,
  dailySummaryEmails: true,
  workingDays: [1, 2, 3, 4, 5],
  startHour: 8,
  endHour: 18,
  bufferMinutes: 15
};

const defaultStaff = [
  { id: "STAFF-1", name: "Maya Reynolds", role: "Manager", status: "Active" },
  { id: "STAFF-2", name: "Noah Green", role: "Staff", status: "Active" },
  { id: "STAFF-3", name: "Alex Chen", role: "Staff", status: "On Call" }
];

const initialData = {
  missedCalls: [],
  callbackRequests: [],
  businessNotifications: [],
  smsOutbox: [],
  reviews: [],
  staffNotes: [],
  settings: defaultSettings,
  staff: defaultStaff,
  sessions: []
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".webm": "audio/webm",
  ".wav": "audio/wav"
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    // Migrate any accounts already saved in the main store.
    let migrated = [];
    try {
      if (fs.existsSync(DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        if (Array.isArray(parsed.accounts)) migrated = parsed.accounts;
      }
    } catch {
      migrated = [];
    }
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: migrated }, null, 2));
  }
}

function readAccounts() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  ensureStore();
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  // Atomic-ish write so accounts are not lost on crash.
  const tempFile = `${ACCOUNTS_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify({ accounts: safeAccounts }, null, 2));
  fs.renameSync(tempFile, ACCOUNTS_FILE);
}

function readStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const merged = { ...initialData, ...parsed };
    // Accounts always come from the durable accounts file.
    merged.accounts = readAccounts();
    // If legacy store still has accounts and durable file is empty, migrate once.
    if (!merged.accounts.length && Array.isArray(parsed.accounts) && parsed.accounts.length) {
      merged.accounts = parsed.accounts;
      writeAccounts(parsed.accounts);
    }
    return merged;
  } catch {
    return { ...initialData, accounts: readAccounts() };
  }
}

function writeStore(data) {
  ensureStore();
  if (Array.isArray(data.accounts)) {
    writeAccounts(data.accounts);
  } else {
    // Never wipe durable accounts if a writer forgot to include them.
    data.accounts = readAccounts();
  }
  // Keep callback data separate from durable accounts.
  const { accounts, ...rest } = data;
  fs.writeFileSync(DATA_FILE, JSON.stringify(rest, null, 2));
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const left = Buffer.from(hash, "hex");
  const right = Buffer.from(expectedHash, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function publicAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    businessName: account.businessName,
    ownerName: account.ownerName,
    email: account.email,
    phone: account.phone || "",
    createdAt: account.createdAt
  };
}

function cleanupSessions(data) {
  const now = Date.now();
  data.sessions = (data.sessions || []).filter((session) => new Date(session.expiresAt).getTime() > now);
  return data.sessions;
}

function createSession(data, accountId, { rememberMe = false } = {}) {
  cleanupSessions(data);
  const ttl = rememberMe ? REMEMBER_SESSION_TTL_MS : SESSION_TTL_MS;
  const session = {
    token: crypto.randomBytes(24).toString("hex"),
    accountId,
    rememberMe: Boolean(rememberMe),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + ttl).toISOString()
  };
  data.sessions = data.sessions || [];
  data.sessions.unshift(session);
  return session;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}

function getSessionAccount(req, data) {
  const token = getBearerToken(req);
  if (!token) return null;
  cleanupSessions(data);
  const session = (data.sessions || []).find((item) => item.token === token);
  if (!session) return null;
  const account = (data.accounts || []).find((item) => item.id === session.accountId);
  if (!account) return null;
  return { session, account };
}

function requireAuth(req, res, data) {
  const auth = getSessionAccount(req, data);
  if (!auth) {
    sendJson(res, 401, { error: "Admin login required" });
    return null;
  }
  return auth;
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-cache",
    "Content-Length": body.length
  });
  res.end(body);
}

function safeStaticPath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const relative = clean === "/" ? "/index.html" : clean;
  const resolved = path.normalize(path.join(ROOT_DIR, relative));
  if (!resolved.startsWith(ROOT_DIR)) return null;
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return null;
  return resolved;
}

function getSettings(data) {
  return { ...defaultSettings, ...(data.settings || {}) };
}

function getStaff(data) {
  return Array.isArray(data.staff) && data.staff.length ? data.staff : defaultStaff;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
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
  return String(value || "").replace(/\D/g, "");
}

function displayPhone(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function getPriority(reason, details, urgentFlag) {
  if (urgentFlag) return "High";
  const text = `${reason || ""} ${details || ""}`.toLowerCase();
  return ["urgent", "asap", "emergency", "immediately", "angry", "frustrated"].some((word) => text.includes(word))
    ? "High"
    : "Medium";
}

function isRepeatCaller(data, phone, excludeId = null) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return data.callbackRequests.some(
    (item) => item.id !== excludeId && normalizePhone(item.phone) === normalized
  );
}

function getCustomerHistory(data, phone, excludeId = null) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  return data.callbackRequests
    .filter((item) => normalizePhone(item.phone) === normalized && item.id !== excludeId)
    .map((item) => ({
      id: item.id,
      reason: item.reason,
      status: item.status,
      priority: item.priority,
      createdAt: item.createdAt,
      details: item.details,
      dateLabel: item.dateLabel,
      timeLabel: item.timeLabel
    }));
}

function getStaffNotesForRequest(data, requestId) {
  return (data.staffNotes || []).filter((note) => note.requestId === requestId);
}

function toInteraction(callbackRequest, data) {
  const hasPreferredSlot = Boolean(callbackRequest.date && callbackRequest.time);
  const status = callbackRequest.status
    || (hasPreferredSlot ? "Scheduled" : "Awaiting Response");
  const staffNotes = getStaffNotesForRequest(data, callbackRequest.id);
  const historyEntries = [
    ...(callbackRequest.history || [
      "Missed call text link opened",
      "Callback request submitted",
      "Business notification created"
    ]),
    ...staffNotes.map((note) => `Staff note (${note.author}): ${note.text}`)
  ];

  return {
    id: callbackRequest.id,
    client: callbackRequest.fullName,
    phone: callbackRequest.phone,
    email: callbackRequest.email || "",
    channel: "Missed Call Form",
    priority: callbackRequest.priority,
    urgent: Boolean(callbackRequest.urgent),
    status,
    assignedTo: callbackRequest.assignedTo || "Unassigned",
    lastActivity: callbackRequest.lastActivity || "Just now",
    issue: callbackRequest.reason,
    repeatCaller: isRepeatCaller(data, callbackRequest.phone, callbackRequest.id),
    picture: callbackRequest.picture || null,
    voiceMemo: callbackRequest.voiceMemo || null,
    customerHistory: getCustomerHistory(data, callbackRequest.phone, callbackRequest.id),
    staffNotes: staffNotes.map((note) => ({
      id: note.id,
      author: note.author,
      text: note.text,
      createdAt: note.createdAt
    })),
    notes: [
      callbackRequest.reason,
      callbackRequest.details ? `Details: ${callbackRequest.details}` : null,
      callbackRequest.email ? `Email: ${callbackRequest.email}` : null,
      callbackRequest.urgent ? "Marked urgent by customer" : null,
      hasPreferredSlot
        ? `Preferred callback: ${callbackRequest.dateLabel} at ${callbackRequest.timeLabel}`
        : "No preferred callback time selected.",
      ...staffNotes.map((note) => `[${note.author}] ${note.text}`)
    ].filter(Boolean),
    messages: [
      { type: "SMS", text: callbackRequest.confirmationText },
      { type: "Business Alert", text: callbackRequest.businessAlertText }
    ],
    history: historyEntries,
    booking: {
      date: callbackRequest.date,
      time: callbackRequest.time,
      timezone: callbackRequest.timezone
    },
    createdAt: callbackRequest.createdAt
  };
}

function createBusinessNotification(callbackRequest) {
  const preferred = callbackRequest.date && callbackRequest.time
    ? ` Preferred callback: ${callbackRequest.dateLabel} at ${callbackRequest.timeLabel}.`
    : "";
  const urgentPrefix = callbackRequest.urgent ? "URGENT: " : "";

  return {
    id: makeId("NTF"),
    requestId: callbackRequest.id,
    channel: "Business Alert",
    recipient: BUSINESS_ALERT_PHONE,
    subject: `${urgentPrefix}New missed-call callback request`,
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

function createMissedCall(payload, data) {
  const token = makeToken();
  const callerPhone = displayPhone(payload.callerPhone || payload.From || payload.from);
  const businessPhone = displayPhone(payload.businessPhone || payload.To || payload.to);
  const settings = getSettings(data || {});
  const callbackUrl = `${PUBLIC_BASE_URL}/book.html?request=${token}`;
  const businessName = payload.businessName || settings.businessName || BUSINESS_NAME;
  const template = settings.autoResponseTemplate || "Sorry we missed your call. Tell us why you called and request a callback.";

  return {
    id: makeId("CALL"),
    token,
    callerPhone,
    businessPhone,
    businessName,
    callbackUrl,
    smsText: `${template} ${callbackUrl}`,
    status: "sms_ready",
    createdAt: nowIso()
  };
}

function createCallbackRequest(payload, missedCall, data) {
  const urgent = Boolean(payload.urgent);
  const priority = getPriority(payload.reason, payload.details, urgent);
  const hasPreferredSlot = Boolean(payload.date && payload.time);
  const request = {
    id: makeId("INT"),
    missedCallId: missedCall?.id || null,
    token: payload.token || missedCall?.token || null,
    fullName: String(payload.fullName || "").trim(),
    phone: displayPhone(payload.phone || missedCall?.callerPhone),
    email: String(payload.email || "").trim(),
    reason: String(payload.reason || "").trim(),
    details: String(payload.details || "").trim(),
    timezone: payload.timezone || "UTC",
    date: payload.date || null,
    time: payload.time || null,
    dateLabel: payload.dateLabel || "No preferred date",
    timeLabel: payload.timeLabel || "No preferred time",
    startsAt: payload.startsAt || null,
    urgent,
    priority,
    status: hasPreferredSlot ? "Scheduled" : "Awaiting Response",
    assignedTo: "Unassigned",
    lastActivity: "Just now",
    picture: payload.picture || null,
    voiceMemo: payload.voiceMemo || null,
    history: [
      "Missed call text link opened",
      "Callback request submitted",
      "Business notification created"
    ],
    createdAt: nowIso()
  };

  if (urgent) request.history.push("Customer marked request as urgent");
  if (payload.picture) request.history.push("Customer attached a picture");
  if (payload.voiceMemo) request.history.push("Customer attached a voice memo");
  if (isRepeatCaller(data, request.phone)) {
    request.history.push("Repeat caller identified from previous requests");
  }

  request.confirmationText = urgent
    ? "Sorry we missed your call. Your urgent callback request was received and prioritized."
    : "Sorry we missed your call. Your callback request was received.";
  request.businessAlertText = `${request.fullName} requested a callback about "${request.reason}".`;

  return request;
}

function findRequest(data, id) {
  return data.callbackRequests.find((item) => item.id === id);
}

function buildAnalytics(data) {
  const requests = data.callbackRequests || [];
  const reviews = data.reviews || [];
  const missedCalls = data.missedCalls || [];
  const today = new Date().toISOString().slice(0, 10);

  const byStatus = {};
  const byPriority = {};
  let urgentCount = 0;
  let withPicture = 0;
  let withVoice = 0;
  let cancelled = 0;
  let scheduled = 0;
  let completed = 0;
  let todayCount = 0;

  requests.forEach((item) => {
    const status = item.status || "Awaiting Response";
    byStatus[status] = (byStatus[status] || 0) + 1;
    byPriority[item.priority || "Medium"] = (byPriority[item.priority || "Medium"] || 0) + 1;
    if (item.urgent || item.priority === "High") urgentCount += 1;
    if (item.picture) withPicture += 1;
    if (item.voiceMemo) withVoice += 1;
    if (status === "Cancelled") cancelled += 1;
    if (status === "Scheduled") scheduled += 1;
    if (status === "Completed") completed += 1;
    if ((item.createdAt || "").startsWith(today)) todayCount += 1;
  });

  const avgRating = reviews.length
    ? Number((reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length).toFixed(2))
    : 0;

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekly = dayLabels.map((day) => ({ day, missed: 0, callbacks: 0 }));
  missedCalls.forEach((call) => {
    const day = new Date(call.createdAt).getDay();
    weekly[day].missed += 1;
  });
  requests.forEach((request) => {
    const day = new Date(request.createdAt).getDay();
    weekly[day].callbacks += 1;
  });

  const orderedWeekly = [1, 2, 3, 4, 5, 6, 0].map((index) => weekly[index]);

  return {
    totals: {
      missedCalls: missedCalls.length,
      callbackRequests: requests.length,
      pending: requests.filter((item) => !["Completed", "Cancelled"].includes(item.status)).length,
      urgent: urgentCount,
      completed,
      cancelled,
      scheduled,
      today: todayCount,
      withPicture,
      withVoice,
      reviews: reviews.length,
      avgRating,
      repeatCallers: requests.filter((item) => isRepeatCaller(data, item.phone, item.id)).length
    },
    byStatus,
    byPriority,
    weekly: orderedWeekly,
    recentReviews: reviews.slice(0, 5)
  };
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
      interactions: data.callbackRequests.map((item) => toInteraction(item, data)),
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

  if (req.method === "GET" && url.pathname === "/api/analytics") {
    const data = readStore();
    return sendJson(res, 200, { analytics: buildAnalytics(data) });
  }

  if (req.method === "GET" && url.pathname === "/api/reviews") {
    const data = readStore();
    return sendJson(res, 200, { reviews: data.reviews || [] });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/customers/") && url.pathname.endsWith("/history")) {
    const phonePart = decodeURIComponent(url.pathname.replace("/api/customers/", "").replace(/\/history$/, ""));
    const data = readStore();
    const history = getCustomerHistory(data, phonePart);
    const notes = (data.staffNotes || []).filter((note) =>
      history.some((item) => item.id === note.requestId)
        || normalizePhone(note.customerPhone || "") === normalizePhone(phonePart)
    );
    return sendJson(res, 200, {
      phone: phonePart,
      history,
      staffNotes: notes,
      repeatCaller: history.length > 0
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/request/")) {
    const token = decodeURIComponent(url.pathname.replace("/api/request/", ""));
    const data = readStore();
    const missedCall = data.missedCalls.find((item) => item.token === token);
    if (!missedCall) return notFound(res);

    const history = getCustomerHistory(data, missedCall.callerPhone);
    return sendJson(res, 200, {
      missedCall,
      customerHistory: history,
      repeatCaller: history.length > 0
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/callback-requests/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/callback-requests/", ""));
    const data = readStore();
    const requestItem = findRequest(data, id);
    if (!requestItem) return notFound(res);
    return sendJson(res, 200, {
      callbackRequest: requestItem,
      interaction: toInteraction(requestItem, data)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/missed-call") {
    const payload = await readBody(req);
    const callerPhone = displayPhone(payload.callerPhone || payload.From || payload.from);
    if (!callerPhone) return sendJson(res, 400, { error: "callerPhone is required" });

    const data = readStore();
    const missedCall = createMissedCall(payload, data);
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
      sms,
      customerHistory: getCustomerHistory(data, missedCall.callerPhone),
      repeatCaller: isRepeatCaller(data, missedCall.callerPhone)
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
    const callbackRequest = createCallbackRequest(payload, missedCall, data);
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
      interaction: toInteraction(callbackRequest, data),
      businessNotification: notification,
      sms: {
        callerConfirmation: confirmationSms,
        businessAlert: businessAlertSms
      }
    });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/callback-requests/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/callback-requests/", ""));
    const payload = await readBody(req);
    const data = readStore();
    const requestItem = findRequest(data, id);
    if (!requestItem) return notFound(res);

    if (payload.action === "cancel") {
      requestItem.status = "Cancelled";
      requestItem.lastActivity = "Just now";
      requestItem.history = [...(requestItem.history || []), "Callback request cancelled"];
      const sms = createSmsOutboxItem({
        to: requestItem.phone,
        body: "Your callback request has been cancelled.",
        type: "caller_cancellation",
        relatedId: requestItem.id
      });
      data.smsOutbox.unshift(sms);
    } else if (payload.action === "reschedule") {
      if (!payload.date || !payload.time) {
        return sendJson(res, 400, { error: "date and time are required to reschedule" });
      }
      requestItem.date = payload.date;
      requestItem.time = payload.time;
      requestItem.dateLabel = payload.dateLabel || payload.date;
      requestItem.timeLabel = payload.timeLabel || payload.time;
      requestItem.startsAt = payload.startsAt || `${payload.date}T${payload.time}:00`;
      requestItem.timezone = payload.timezone || requestItem.timezone;
      requestItem.status = "Scheduled";
      requestItem.lastActivity = "Just now";
      requestItem.history = [
        ...(requestItem.history || []),
        `Preferred callback time changed to ${requestItem.dateLabel} at ${requestItem.timeLabel}`
      ];
      const sms = createSmsOutboxItem({
        to: requestItem.phone,
        body: `Your preferred callback time was changed to ${requestItem.dateLabel} at ${requestItem.timeLabel}.`,
        type: "caller_reschedule",
        relatedId: requestItem.id
      });
      data.smsOutbox.unshift(sms);
    } else if (payload.action === "mark_urgent") {
      requestItem.urgent = true;
      requestItem.priority = "High";
      requestItem.lastActivity = "Just now";
      requestItem.history = [...(requestItem.history || []), "Marked as urgent"];
    } else if (payload.action === "complete") {
      requestItem.status = "Completed";
      requestItem.lastActivity = "Just now";
      requestItem.history = [...(requestItem.history || []), "Callback marked completed"];
    } else if (payload.action === "assign") {
      requestItem.assignedTo = payload.assignedTo || "Unassigned";
      requestItem.lastActivity = "Just now";
      requestItem.history = [...(requestItem.history || []), `Assigned to ${requestItem.assignedTo}`];
    } else {
      return sendJson(res, 400, { error: "Unsupported action" });
    }

    writeStore(data);
    return sendJson(res, 200, {
      callbackRequest: requestItem,
      interaction: toInteraction(requestItem, data)
    });
  }

  if (req.method === "POST" && url.pathname.match(/^\/api\/callback-requests\/[^/]+\/notes$/)) {
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const payload = await readBody(req);
    const text = String(payload.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "text is required" });

    const data = readStore();
    const requestItem = findRequest(data, id);
    if (!requestItem) return notFound(res);

    const note = {
      id: makeId("NOTE"),
      requestId: id,
      customerPhone: requestItem.phone,
      author: String(payload.author || "Staff").trim() || "Staff",
      text,
      createdAt: nowIso()
    };

    data.staffNotes = data.staffNotes || [];
    data.staffNotes.unshift(note);
    requestItem.lastActivity = "Just now";
    requestItem.history = [...(requestItem.history || []), `Staff note added by ${note.author}`];
    writeStore(data);

    return sendJson(res, 201, {
      note,
      interaction: toInteraction(requestItem, data)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/reviews") {
    const payload = await readBody(req);
    const rating = Number(payload.rating);
    const comment = String(payload.comment || "").trim();
    const fullName = String(payload.fullName || "Anonymous").trim() || "Anonymous";

    if (!rating || rating < 1 || rating > 5) {
      return sendJson(res, 400, { error: "rating must be between 1 and 5" });
    }

    const data = readStore();
    const review = {
      id: makeId("REV"),
      requestId: payload.requestId || null,
      fullName,
      phone: displayPhone(payload.phone || ""),
      rating,
      comment,
      createdAt: nowIso()
    };

    data.reviews = data.reviews || [];
    data.reviews.unshift(review);
    writeStore(data);

    return sendJson(res, 201, { review });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    const data = readStore();
    return sendJson(res, 200, {
      hasAccounts: (data.accounts || []).length > 0,
      accountCount: (data.accounts || []).length
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/signup") {
    const payload = await readBody(req);
    const businessName = String(payload.businessName || "").trim();
    const ownerName = String(payload.ownerName || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    const phone = displayPhone(payload.phone || "");
    const password = String(payload.password || "");

    if (!businessName || !ownerName || !email || !password) {
      return sendJson(res, 400, { error: "businessName, ownerName, email, and password are required" });
    }
    if (password.length < 8) {
      return sendJson(res, 400, { error: "Password must be at least 8 characters" });
    }
    if (!email.includes("@")) {
      return sendJson(res, 400, { error: "A valid email is required" });
    }

    const data = readStore();
    data.accounts = data.accounts || [];
    if (data.accounts.some((item) => item.email === email)) {
      return sendJson(res, 409, { error: "An account with this email already exists" });
    }

    const { salt, hash } = hashPassword(password);
    const account = {
      id: makeId("ACCT"),
      businessName,
      ownerName,
      email,
      phone,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: nowIso()
    };

    data.accounts.unshift(account);
    // First account seeds business settings name
    data.settings = {
      ...getSettings(data),
      businessName
    };
    const rememberMe = payload.rememberMe !== false;
    const session = createSession(data, account.id, { rememberMe });
    writeStore(data);

    return sendJson(res, 201, {
      account: publicAccount(account),
      token: session.token,
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const payload = await readBody(req);
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const rememberMe = Boolean(payload.rememberMe);
    if (!email || !password) {
      return sendJson(res, 400, { error: "email and password are required" });
    }

    const data = readStore();
    const account = (data.accounts || []).find((item) => item.email === email);
    if (!account || !verifyPassword(password, account.passwordSalt, account.passwordHash)) {
      return sendJson(res, 401, { error: "Invalid email or password" });
    }

    const session = createSession(data, account.id, { rememberMe });
    writeStore(data);
    return sendJson(res, 200, {
      account: publicAccount(account),
      token: session.token,
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const data = readStore();
    const token = getBearerToken(req);
    data.sessions = (data.sessions || []).filter((item) => item.token !== token);
    writeStore(data);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const data = readStore();
    const auth = getSessionAccount(req, data);
    if (!auth) return sendJson(res, 401, { error: "Admin login required" });
    return sendJson(res, 200, {
      account: publicAccount(auth.account),
      expiresAt: auth.session.expiresAt
    });
  }

  if (req.method === "GET" && url.pathname === "/api/settings") {
    const data = readStore();
    return sendJson(res, 200, { settings: getSettings(data) });
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    const data = readStore();
    if (!requireAuth(req, res, data)) return;
    const payload = await readBody(req);
    data.settings = {
      ...getSettings(data),
      ...payload,
      bufferMinutes: Number(payload.bufferMinutes ?? getSettings(data).bufferMinutes) || 15,
      startHour: Number(payload.startHour ?? getSettings(data).startHour) || 8,
      endHour: Number(payload.endHour ?? getSettings(data).endHour) || 18
    };
    writeStore(data);
    return sendJson(res, 200, { settings: data.settings });
  }

  if (req.method === "GET" && url.pathname === "/api/staff") {
    const data = readStore();
    return sendJson(res, 200, { staff: getStaff(data) });
  }

  if (req.method === "POST" && url.pathname === "/api/staff") {
    const data = readStore();
    if (!requireAuth(req, res, data)) return;
    const payload = await readBody(req);
    const name = String(payload.name || "").trim();
    if (!name) return sendJson(res, 400, { error: "name is required" });

    const staff = getStaff(data);
    let member;

    if (payload.id) {
      const index = staff.findIndex((item) => item.id === payload.id);
      if (index === -1) return notFound(res);
      member = {
        ...staff[index],
        name,
        role: String(payload.role || staff[index].role || "Staff").trim(),
        status: String(payload.status || staff[index].status || "Active").trim()
      };
      staff[index] = member;
    } else {
      member = {
        id: makeId("STAFF"),
        name,
        role: String(payload.role || "Staff").trim(),
        status: String(payload.status || "Active").trim()
      };
      staff.unshift(member);
    }

    data.staff = staff;
    writeStore(data);
    return sendJson(res, payload.id ? 200 : 201, { staff: data.staff, member });
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/staff/")) {
    const data = readStore();
    if (!requireAuth(req, res, data)) return;
    const id = decodeURIComponent(url.pathname.replace("/api/staff/", ""));
    const payload = await readBody(req);
    let staff = getStaff(data);

    if (payload.action === "delete") {
      staff = staff.filter((item) => item.id !== id);
      data.staff = staff;
      writeStore(data);
      return sendJson(res, 200, { staff });
    }

    const index = staff.findIndex((item) => item.id === id);
    if (index === -1) return notFound(res);
    staff[index] = {
      ...staff[index],
      ...payload,
      id
    };
    data.staff = staff;
    writeStore(data);
    return sendJson(res, 200, { staff, member: staff[index] });
  }

  if (req.method === "GET") {
    const filePath = safeStaticPath(url.pathname);
    if (filePath) return sendFile(res, filePath);
  }

  return notFound(res);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, 500, { error: error.message || "Server error" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`CallbackFlow running on http://${HOST}:${PORT}`);
  console.log(`Home: ${PUBLIC_BASE_URL}/`);
  console.log(`Customer form: ${PUBLIC_BASE_URL}/book.html`);
});
