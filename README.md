# Missed Call Callback System

This project has a professional client request page, staff dashboard, and a local API that simulates the real missed-call workflow.

## Run locally

Start the static site:

```powershell
python -m http.server 4174 --bind 127.0.0.1
```

Start the callback API:

```powershell
C:\Users\PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe server.js
```

Open:

- Client request page: `http://127.0.0.1:4174/book.html`
- Staff dashboard: `http://127.0.0.1:4174/index.html`
- API health check: `http://127.0.0.1:8787/health`
- SMS outbox: `http://127.0.0.1:8787/api/outbox`
- Business alerts: `http://127.0.0.1:8787/api/notifications`

## Flow

1. Phone provider posts a missed call to `POST /api/missed-call`.
2. The API creates a secure request token and callback link.
3. The API returns the SMS text that would be sent to the caller.
4. Caller opens the link and submits name, phone, reason, and details.
5. The API records the callback request and business notification.
6. The API records simulated SMS outbox entries for the caller and business.
7. The dashboard syncs API interactions and business alerts into the staff queue.

## Simulate a missed call

```powershell
$body = @{
  callerPhone = "(555) 777-0199"
  businessPhone = "(555) 010-9000"
  businessName = "Demo Business"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8787/api/missed-call `
  -ContentType "application/json" `
  -Body $body
```

Use the returned `callbackUrl` as the text-message link.

## Production note

The API currently simulates SMS and business alerts. That keeps local testing safe and avoids sending real customer data to a third-party provider. To send live SMS, connect a provider such as Twilio on the server side after choosing the business phone number, destination rules, consent language, and data-retention policy.
