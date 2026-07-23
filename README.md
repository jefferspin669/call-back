# Missed Call Callback System

This project has a professional client request page, staff dashboard, and a local API that simulates the real missed-call workflow.

## Run locally

Start the static site:

```bash
python3 -m http.server 4174 --bind 127.0.0.1
```

Start the callback API:

```bash
node server.js
```

Open:

- Client request page: `http://127.0.0.1:4174/book.html`
- Staff dashboard: `http://127.0.0.1:4174/index.html`
- Analytics tab: `http://127.0.0.1:4174/index.html#analytics`
- Reviews tab: `http://127.0.0.1:4174/index.html#reviews`
- API health check: `http://127.0.0.1:8787/health`
- SMS outbox: `http://127.0.0.1:8787/api/outbox`
- Business alerts: `http://127.0.0.1:8787/api/notifications`

## Flow

1. Phone provider posts a missed call to `POST /api/missed-call`.
2. The API creates a secure request token and callback link.
3. The API returns the SMS text that would be sent to the caller.
4. Caller opens the link and submits name, phone, reason, optional picture/voice memo, urgency, and preferred time.
5. The API records the callback request, customer history, and business notification.
6. Staff can open the request, leave notes, mark urgent, cancel, complete, and review analytics.
7. Customers can leave a review from the Reviews tab.

## Client request features

- Optional picture attachment
- Optional voice memo recording
- Mark request as urgent
- Reschedule preferred callback time
- Cancel request
- Previous-request history by phone number

## Staff features

- Interaction queue with urgent / repeat-caller filters
- Caller detail drawer with attachments, history, and AI triage
- Staff notes that stay with the customer record
- Analytics page with queue and attachment metrics
- Reviews page for customer feedback

## Simulate a missed call

```bash
curl -X POST http://127.0.0.1:8787/api/missed-call \
  -H "Content-Type: application/json" \
  -d '{"callerPhone":"(555) 777-0199","businessPhone":"(555) 010-9000","businessName":"Demo Business"}'
```

Use the returned `callbackUrl` as the text-message link.

## Production note

The API currently simulates SMS and business alerts. That keeps local testing safe and avoids sending real customer data to a third-party provider. To send live SMS, connect a provider such as Twilio on the server side after choosing the business phone number, destination rules, consent language, and data-retention policy.
