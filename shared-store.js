const STORAGE_KEYS = {
  interactions: "cms_interactions",
  settings: "cms_settings",
  activity: "cms_activity"
};

const defaultInteractions = [
  {
    id: "INT-1001",
    client: "Ava Johnson",
    phone: "(312) 555-0119",
    channel: "Missed Call",
    priority: "High",
    status: "Awaiting Response",
    assignedTo: "Maya",
    lastActivity: "3 min ago",
    issue: "Requested urgent callback about billing",
    repeatCaller: true,
    notes: [
      "Client asked for urgent help with billing discrepancy.",
      "Previous callback attempt missed."
    ],
    messages: [
      { type: "SMS", text: "Sorry we missed your call. Tap the secure link to tell us why you called." }
    ],
    history: [
      "Missed call logged",
      "Auto-response text sent"
    ]
  },
  {
    id: "INT-1002",
    client: "Liam Carter",
    phone: "(773) 555-0142",
    channel: "Missed Call Form",
    priority: "Medium",
    status: "Scheduled",
    assignedTo: "Noah",
    lastActivity: "11 min ago",
    issue: "Needs help booking a service appointment",
    repeatCaller: false,
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
    }
  }
];

const defaultSettings = {
  businessHoursLabel: "Mon-Fri, 8:00 AM - 6:00 PM",
  workingDays: [1, 2, 3, 4, 5],
  startHour: 8,
  endHour: 18,
  bufferMinutes: 15
};

const defaultActivity = [
  {
    label: "System",
    value: "Dashboard initialized.",
    at: new Date().toISOString()
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
    });
    this.saveInteractions(merged);
    return merged;
  },

  getSettings() {
    return readJson(STORAGE_KEYS.settings, defaultSettings);
  },

  saveSettings(data) {
    writeJson(STORAGE_KEYS.settings, data);
    window.dispatchEvent(new CustomEvent("cms:settings-updated"));
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

  createBooking(payload) {
    const interactions = this.getInteractions();
    const hasPreferredSlot = Boolean(payload.date && payload.time);
    const notes = [
      payload.reason || "No reason provided.",
      payload.details ? `Details: ${payload.details}` : null,
      payload.email ? `Email: ${payload.email}` : null,
      hasPreferredSlot ? `Preferred callback: ${payload.dateLabel} at ${payload.timeLabel}` : "No preferred callback time selected."
    ].filter(Boolean);

    const newItem = {
      id: `INT-${Date.now()}`,
      client: payload.fullName,
      phone: payload.phone,
      channel: "Missed Call Form",
      priority: payload.priority || "Medium",
      status: hasPreferredSlot ? "Scheduled" : "Awaiting Response",
      assignedTo: "Unassigned",
      lastActivity: "Just now",
      issue: payload.reason || "Callback requested",
      repeatCaller: false,
      notes,
      messages: [
        { type: "SMS", text: "Sorry we missed your call. Your callback request was received." },
        {
          type: "Business Alert",
          text: hasPreferredSlot
            ? `${payload.fullName} requested a callback about "${payload.reason}" and prefers ${payload.dateLabel} at ${payload.timeLabel}.`
            : `${payload.fullName} requested a callback about "${payload.reason}".`
        }
      ],
      history: [
        "Missed call text link opened",
        "Callback request submitted",
        "Business notification created"
      ],
      booking: {
        date: payload.date,
        time: payload.time,
        timezone: payload.timezone
      }
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
        issue: `Preferred callback changed to ${payload.dateLabel} at ${payload.timeLabel}`,
        lastActivity: "Just now",
        booking: {
          date: payload.date,
          time: payload.time,
          timezone: payload.timezone
        },
        history: [...(item.history || []), "Preferred callback time changed"],
        messages: [
          ...(item.messages || []),
          { type: "SMS", text: `Your preferred callback time was changed to ${payload.dateLabel} at ${payload.timeLabel}.` }
        ]
      };
    });

    this.saveInteractions(interactions);
    this.addActivity("Callback request", `Preferred time changed for ${id}.`);
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
  }
};
