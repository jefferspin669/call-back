const STORAGE_KEYS = {
  interactions: "cms_interactions",
  settings: "cms_settings",
  activity: "cms_activity",
  reviews: "cms_reviews",
  staffNotes: "cms_staff_notes",
  staff: "cms_staff"
};

const defaultInteractions = [
  {
    id: "INT-1001",
    client: "Ava Johnson",
    phone: "(312) 555-0119",
    channel: "Missed Call",
    priority: "High",
    urgent: true,
    status: "Awaiting Response",
    assignedTo: "Maya",
    lastActivity: "3 min ago",
    issue: "Requested urgent callback about billing",
    repeatCaller: true,
    picture: null,
    voiceMemo: null,
    customerHistory: [
      {
        id: "INT-0988",
        reason: "Billing question",
        status: "Completed",
        priority: "Medium",
        createdAt: "2026-07-10T15:20:00.000Z"
      }
    ],
    staffNotes: [
      {
        id: "NOTE-1",
        author: "Maya",
        text: "Previous callback attempt missed. Call back ASAP.",
        createdAt: "2026-07-20T14:10:00.000Z"
      }
    ],
    notes: [
      "Client asked for urgent help with billing discrepancy.",
      "Previous callback attempt missed."
    ],
    messages: [
      { type: "SMS", text: "Sorry we missed your call. Tap the secure link to tell us why you called." }
    ],
    history: [
      "Missed call logged",
      "Auto-response text sent",
      "Repeat caller identified from previous requests"
    ],
    createdAt: "2026-07-20T14:05:00.000Z"
  },
  {
    id: "INT-1002",
    client: "Liam Carter",
    phone: "(773) 555-0142",
    channel: "Missed Call Form",
    priority: "Medium",
    urgent: false,
    status: "Scheduled",
    assignedTo: "Noah",
    lastActivity: "11 min ago",
    issue: "Needs help booking a service appointment",
    repeatCaller: false,
    picture: null,
    voiceMemo: null,
    customerHistory: [],
    staffNotes: [],
    notes: [
      "Client prefers afternoon callbacks.",
      "Preferred callback: Wednesday, July 8, 2026 at 2:30 PM"
    ],
    messages: [
      { type: "SMS", text: "Your callback request was received. We will call you at your preferred time." },
      { type: "Business Alert", text: "Liam Carter requested a callback for service appointment help." }
    ],
    history: [
      "Missed call text link opened",
      "Callback request submitted",
      "Preferred callback time selected"
    ],
    booking: {
      date: "2026-07-08",
      time: "14:30",
      timezone: "America/Chicago"
    },
    createdAt: "2026-07-20T13:55:00.000Z"
  }
];

const defaultSettings = {
  businessName: "Demo Business",
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

const defaultActivity = [
  {
    label: "System",
    value: "Dashboard initialized.",
    at: new Date().toISOString()
  }
];

const defaultReviews = [
  {
    id: "REV-1001",
    fullName: "Ava Johnson",
    phone: "(312) 555-0119",
    rating: 5,
    comment: "Callback was fast and helpful.",
    createdAt: "2026-07-18T16:00:00.000Z"
  }
];

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function isRepeatCaller(interactions, phone, excludeId = null) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return interactions.some(
    (item) => item.id !== excludeId && normalizePhone(item.phone) === normalized
  );
}

function getCustomerHistory(interactions, phone, excludeId = null) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  return interactions
    .filter((item) => normalizePhone(item.phone) === normalized && item.id !== excludeId)
    .map((item) => ({
      id: item.id,
      reason: item.issue || item.reason,
      status: item.status,
      priority: item.priority,
      createdAt: item.createdAt,
      details: item.details || "",
      dateLabel: item.booking?.date || item.dateLabel,
      timeLabel: item.booking?.time || item.timeLabel
    }));
}

export const store = {
  getInteractions() {
    return readJson(STORAGE_KEYS.interactions, defaultInteractions);
  },

  saveInteractions(data) {
    writeJson(STORAGE_KEYS.interactions, data);
    window.dispatchEvent(new CustomEvent("cms:interactions-updated"));
  },

  mergeInteractions(incoming = []) {
    const existing = this.getInteractions();
    const seen = new Set();
    const merged = [...incoming, ...existing].filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).map((item) => ({
      ...item,
      repeatCaller: isRepeatCaller([...incoming, ...existing], item.phone, item.id),
      customerHistory: item.customerHistory?.length
        ? item.customerHistory
        : getCustomerHistory([...incoming, ...existing], item.phone, item.id),
      staffNotes: item.staffNotes || [],
      urgent: Boolean(item.urgent || item.priority === "High" && /urgent|asap|emergency/i.test(`${item.issue} ${(item.notes || []).join(" ")}`))
    }));
    this.saveInteractions(merged);
    return merged;
  },

  getSettings() {
    return { ...defaultSettings, ...readJson(STORAGE_KEYS.settings, {}) };
  },

  saveSettings(data, { silent = false } = {}) {
    const next = { ...this.getSettings(), ...data };
    writeJson(STORAGE_KEYS.settings, next);
    window.dispatchEvent(new CustomEvent("cms:settings-updated", { detail: next }));
    if (!silent) this.addActivity("Settings", "Business settings updated.");
    return next;
  },

  getStaff() {
    return readJson(STORAGE_KEYS.staff, defaultStaff);
  },

  saveStaff(list, { silent = false } = {}) {
    writeJson(STORAGE_KEYS.staff, list);
    window.dispatchEvent(new CustomEvent("cms:staff-updated"));
    if (!silent) this.addActivity("Staff", "Staff list updated.");
    return list;
  },

  upsertStaff(member) {
    const staff = this.getStaff();
    if (member.id) {
      const next = staff.map((item) => (item.id === member.id ? { ...item, ...member } : item));
      this.saveStaff(next, { silent: true });
      this.addActivity("Staff", `Updated ${member.name}.`);
      return next.find((item) => item.id === member.id);
    }

    const created = {
      id: `STAFF-${Date.now()}`,
      name: member.name,
      role: member.role || "Staff",
      status: member.status || "Active"
    };
    const next = [created, ...staff];
    this.saveStaff(next, { silent: true });
    this.addActivity("Staff", `Added ${created.name}.`);
    return created;
  },

  removeStaff(id) {
    const next = this.getStaff().filter((item) => item.id !== id);
    this.saveStaff(next, { silent: true });
    this.addActivity("Staff", `Removed staff member ${id}.`);
    return next;
  },

  getActivity() {
    return readJson(STORAGE_KEYS.activity, defaultActivity);
  },

  addActivity(label, value) {
    const items = this.getActivity();
    items.unshift({
      label,
      value,
      at: new Date().toISOString()
    });
    writeJson(STORAGE_KEYS.activity, items);
    window.dispatchEvent(new CustomEvent("cms:activity-updated"));
  },

  getReviews() {
    return readJson(STORAGE_KEYS.reviews, defaultReviews);
  },

  saveReviews(reviews) {
    writeJson(STORAGE_KEYS.reviews, reviews);
    window.dispatchEvent(new CustomEvent("cms:reviews-updated"));
  },

  addReview(payload) {
    const reviews = this.getReviews();
    const review = {
      id: `REV-${Date.now()}`,
      requestId: payload.requestId || null,
      fullName: payload.fullName || "Anonymous",
      phone: payload.phone || "",
      rating: Number(payload.rating),
      comment: payload.comment || "",
      createdAt: new Date().toISOString()
    };
    reviews.unshift(review);
    this.saveReviews(reviews);
    this.addActivity("Review", `${review.fullName} left a ${review.rating}-star review.`);
    return review;
  },

  getCustomerHistory(phone, excludeId = null) {
    return getCustomerHistory(this.getInteractions(), phone, excludeId);
  },

  createBooking(payload) {
    const interactions = this.getInteractions();
    const hasPreferredSlot = Boolean(payload.date && payload.time);
    const notes = [
      payload.reason || "No reason provided.",
      payload.details ? `Details: ${payload.details}` : null,
      payload.email ? `Email: ${payload.email}` : null,
      payload.urgent ? "Marked urgent by customer" : null,
      hasPreferredSlot ? `Preferred callback: ${payload.dateLabel} at ${payload.timeLabel}` : "No preferred callback time selected."
    ].filter(Boolean);

    const history = [
      "Missed call text link opened",
      "Callback request submitted",
      "Business notification created"
    ];
    if (payload.urgent) history.push("Customer marked request as urgent");
    if (payload.picture) history.push("Customer attached a picture");
    if (payload.voiceMemo) history.push("Customer attached a voice memo");

    const newItem = {
      id: `INT-${Date.now()}`,
      client: payload.fullName,
      phone: payload.phone,
      email: payload.email || "",
      channel: "Missed Call Form",
      priority: payload.priority || (payload.urgent ? "High" : "Medium"),
      urgent: Boolean(payload.urgent),
      status: hasPreferredSlot ? "Scheduled" : "Awaiting Response",
      assignedTo: "Unassigned",
      lastActivity: "Just now",
      issue: payload.reason || "Callback requested",
      repeatCaller: isRepeatCaller(interactions, payload.phone),
      picture: payload.picture || null,
      voiceMemo: payload.voiceMemo || null,
      customerHistory: getCustomerHistory(interactions, payload.phone),
      staffNotes: [],
      notes,
      messages: [
        {
          type: "SMS",
          text: payload.urgent
            ? "Sorry we missed your call. Your urgent callback request was received and prioritized."
            : "Sorry we missed your call. Your callback request was received."
        },
        {
          type: "Business Alert",
          text: hasPreferredSlot
            ? `${payload.fullName} requested a callback about "${payload.reason}" and prefers ${payload.dateLabel} at ${payload.timeLabel}.`
            : `${payload.fullName} requested a callback about "${payload.reason}".`
        }
      ],
      history: isRepeatCaller(interactions, payload.phone)
        ? [...history, "Repeat caller identified from previous requests"]
        : history,
      booking: {
        date: payload.date,
        time: payload.time,
        timezone: payload.timezone
      },
      createdAt: new Date().toISOString()
    };

    interactions.unshift(newItem);
    this.saveInteractions(interactions);
    this.addActivity("Callback request", `New missed-call request from ${payload.fullName}.`);
    return newItem;
  },

  saveServerInteraction(interaction) {
    if (!interaction) return null;
    this.mergeInteractions([interaction]);
    this.addActivity("Callback request", `Business notified for ${interaction.client}.`);
    return interaction;
  },

  rescheduleInteraction(id, payload) {
    const interactions = this.getInteractions().map((item) => {
      if (item.id !== id) return item;

      return {
        ...item,
        status: "Scheduled",
        issue: item.issue,
        lastActivity: "Just now",
        booking: {
          date: payload.date,
          time: payload.time,
          timezone: payload.timezone
        },
        history: [...(item.history || []), `Preferred callback time changed to ${payload.dateLabel} at ${payload.timeLabel}`],
        messages: [
          ...(item.messages || []),
          { type: "SMS", text: `Your preferred callback time was changed to ${payload.dateLabel} at ${payload.timeLabel}.` }
        ]
      };
    });

    this.saveInteractions(interactions);
    this.addActivity("Callback request", `Preferred time changed for ${id}.`);
    return interactions.find((item) => item.id === id) || null;
  },

  cancelInteraction(id) {
    const interactions = this.getInteractions().map((item) => {
      if (item.id !== id) return item;

      return {
        ...item,
        status: "Cancelled",
        lastActivity: "Just now",
        history: [...(item.history || []), "Callback request cancelled"],
        messages: [
          ...(item.messages || []),
          { type: "SMS", text: "Your callback request has been cancelled." }
        ]
      };
    });

    this.saveInteractions(interactions);
    this.addActivity("Callback request", `Callback request ${id} cancelled.`);
    return interactions.find((item) => item.id === id) || null;
  },

  markUrgent(id) {
    const interactions = this.getInteractions().map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        urgent: true,
        priority: "High",
        lastActivity: "Just now",
        history: [...(item.history || []), "Marked as urgent"]
      };
    });
    this.saveInteractions(interactions);
    this.addActivity("Callback request", `Request ${id} marked urgent.`);
    return interactions.find((item) => item.id === id) || null;
  },

  completeInteraction(id) {
    const interactions = this.getInteractions().map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        status: "Completed",
        lastActivity: "Just now",
        history: [...(item.history || []), "Callback marked completed"]
      };
    });
    this.saveInteractions(interactions);
    this.addActivity("Callback request", `Request ${id} completed.`);
    return interactions.find((item) => item.id === id) || null;
  },

  addStaffNote(id, payload) {
    const note = {
      id: `NOTE-${Date.now()}`,
      author: payload.author || "Staff",
      text: payload.text,
      createdAt: new Date().toISOString()
    };

    const interactions = this.getInteractions().map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        lastActivity: "Just now",
        staffNotes: [note, ...(item.staffNotes || [])],
        notes: [...(item.notes || []), `[${note.author}] ${note.text}`],
        history: [...(item.history || []), `Staff note added by ${note.author}`]
      };
    });

    this.saveInteractions(interactions);
    this.addActivity("Staff note", `${note.author} added a note on ${id}.`);
    return { note, interaction: interactions.find((item) => item.id === id) || null };
  },

  getAnalytics() {
    const interactions = this.getInteractions();
    const reviews = this.getReviews();
    const byStatus = {};
    const byPriority = {};
    let urgent = 0;
    let withPicture = 0;
    let withVoice = 0;

    interactions.forEach((item) => {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1;
      byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
      if (item.urgent || item.priority === "High") urgent += 1;
      if (item.picture) withPicture += 1;
      if (item.voiceMemo) withVoice += 1;
    });

    const avgRating = reviews.length
      ? Number((reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length).toFixed(2))
      : 0;

    return {
      totals: {
        missedCalls: interactions.length,
        callbackRequests: interactions.length,
        pending: interactions.filter((item) => !["Completed", "Cancelled"].includes(item.status)).length,
        urgent,
        completed: byStatus.Completed || 0,
        cancelled: byStatus.Cancelled || 0,
        scheduled: byStatus.Scheduled || 0,
        today: interactions.filter((item) => (item.createdAt || "").startsWith(new Date().toISOString().slice(0, 10))).length,
        withPicture,
        withVoice,
        reviews: reviews.length,
        avgRating,
        repeatCallers: interactions.filter((item) => item.repeatCaller).length
      },
      byStatus,
      byPriority,
      weekly: [
        { day: "Mon", missed: 12, callbacks: Math.max(1, interactions.length) },
        { day: "Tue", missed: 18, callbacks: Math.max(1, Math.round(interactions.length * 0.8)) },
        { day: "Wed", missed: 15, callbacks: Math.max(1, Math.round(interactions.length * 0.7)) },
        { day: "Thu", missed: 22, callbacks: Math.max(1, Math.round(interactions.length * 0.9)) },
        { day: "Fri", missed: 16, callbacks: Math.max(1, Math.round(interactions.length * 0.75)) },
        { day: "Sat", missed: 9, callbacks: Math.max(1, Math.round(interactions.length * 0.4)) },
        { day: "Sun", missed: 5, callbacks: Math.max(1, Math.round(interactions.length * 0.3)) }
      ],
      recentReviews: reviews.slice(0, 5)
    };
  }
};
