# CallbackFlow

Recover missed calls, collect caller details, and manage follow-up from one staff workspace.

## Start

```bash
npm start
```

or

```bash
bash start.sh
```

or

```bash
node server.js
```

Then open **exactly**:

- Staff home: [http://127.0.0.1:4174/](http://127.0.0.1:4174/)
- Customer form: [http://127.0.0.1:4174/book.html](http://127.0.0.1:4174/book.html)
- Admin: [http://127.0.0.1:4174/#admin](http://127.0.0.1:4174/#admin)

One server hosts both the website and the API.

If the app says the server is offline, you are probably opening a local HTML file (`file://`). Always open the `http://127.0.0.1:4174/` URL after starting the server.

## What you can do

- Browse the callback queue with urgent priority cues
- Open a request to leave staff notes and mark urgent / complete / cancelled
- Create a business account and lock Admin behind login
- Save admin business settings and manage staff (signed-in only)
- Simulate a missed call and send a customer request with picture or voice memo
- Track analytics and collect reviews

## Business accounts

1. Open [http://127.0.0.1:4174/signup.html](http://127.0.0.1:4174/signup.html)
2. Create an account for your business
3. Open Admin and sign in to unlock settings

Business accounts are saved in `data/accounts.json` and are **not deleted on logout**.
Use **Remember me** to keep your email filled in and stay signed in longer on that device.

Admin settings and staff changes require a valid login session.

## Important

Open the app through the server URL above. Opening the HTML file directly (`file://`) will break the buttons.
