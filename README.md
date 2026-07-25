# CallbackFlow

Recover missed calls, collect caller details, and manage follow-up from one staff workspace.

## Run (one command)

```bash
node server.js
```

Then open:

- Home / staff queue: `http://127.0.0.1:4174/`
- Customer form: `http://127.0.0.1:4174/book.html`
- Admin: `http://127.0.0.1:4174/#admin`
- Analytics: `http://127.0.0.1:4174/#analytics`
- Reviews: `http://127.0.0.1:4174/#reviews`
- Health: `http://127.0.0.1:4174/health`

The server serves both the website and the API on the same port.

## What works

### Staff home
- Queue with search + filters
- Priority left borders and urgent badges
- Request drawer with history, attachments, notes, and quick actions
- Simulate Missed Call button
- Working Admin, Analytics, and Reviews tabs

### Admin
- Save business settings (name, hours, response time, auto-response, toggles)
- Preview customer message
- Add / edit / remove staff

### Customer form
- Friendly missed-call messaging
- Business name, expected response time, privacy note
- Picture + voice memo
- Mark urgent, reschedule, cancel
- Customer history by phone

## Simulate a missed call

Use the **Simulate Missed Call** button on the home page, or:

```bash
curl -X POST http://127.0.0.1:4174/api/missed-call \
  -H "Content-Type: application/json" \
  -d '{"callerPhone":"(555) 777-0199","businessPhone":"(555) 010-9000","businessName":"Demo Business"}'
```

Open the returned `callbackUrl`.
