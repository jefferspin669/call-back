export function getAiTriage(interaction) {
  const text = `${interaction.issue} ${(interaction.notes || []).join(" ")}`.toLowerCase();

  let sentiment = "Neutral";
  let urgency = 45;
  let recommendedAction = "Send confirmation and keep in normal callback queue.";
  let response = "Hi, thanks for reaching out. We received your request and will follow up shortly.";
  let bestWindow = "2:00 PM - 4:00 PM";
  let escalate = false;

  if (interaction.repeatCaller) urgency += 20;
  if (interaction.priority === "High") urgency += 20;
  if (interaction.status === "Escalated") urgency += 20;

  if (text.includes("urgent") || text.includes("asap") || text.includes("immediately") || text.includes("emergency")) {
    urgency += 15;
    sentiment = "Urgent";
    recommendedAction = "Prioritize callback within 10 minutes.";
    response = "Sorry we missed your call. Your request has been prioritized and a team member will contact you shortly.";
    bestWindow = "Next available slot";
  }

  if (text.includes("billing") || text.includes("charged") || text.includes("payment")) {
    recommendedAction = "Route to billing-trained staff member.";
  }

  if (text.includes("angry") || text.includes("frustrated") || text.includes("complaint")) {
    sentiment = "Frustrated";
    urgency += 10;
    escalate = true;
    recommendedAction = "Manager review recommended before callback.";
    response = "Sorry for the frustration. We flagged your case for priority follow-up.";
  }

  if (urgency >= 80) escalate = true;

  return {
    summary: interaction.issue || "Client requested callback support.",
    sentiment,
    urgency: Math.min(urgency, 100),
    recommendedAction,
    suggestedResponse: response,
    bestWindow,
    escalate
  };
}
