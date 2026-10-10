# Badminton Booker

A small private dashboard that checks the Hills Road STC timetable for Wednesday and Thursday badminton at 6pm. When the API reports an available slot within the next seven days, the dashboard emails a booking link.

## Free Render setup

1. Create a [Resend](https://resend.com) account, verify a sender address/domain, and create an API key. Resend's free allowance and sender-verification requirements may change.
2. Push this project to a Git repository and create a Render Blueprint from it using `render.yaml`.
3. Set the Blueprint's `APP_PASSWORD` to a long, unique password. Set `RESEND_API_KEY` and `FROM_EMAIL` to the Resend values; `FROM_EMAIL` must be a verified sender.
4. Open the deployed service URL. At the browser sign-in prompt, use username `booker` and the `APP_PASSWORD` you set. Save your notification email in the dashboard.

Render's free web service has no scheduled worker or persistent storage. This version checks every five minutes from the open dashboard, so it can send email only while the page is open and the browser/device and service are reachable. Free services can also spin down while idle, delaying a check until they wake. It is not a guaranteed background alert service. For dependable alerts while the page is closed, upgrade to an always-on scheduled checker and persistent storage.

The app never books automatically; the email and dashboard link take you to the Hills Road site to complete the booking. Availability can change before you finish booking.

## Local development

Requires Node.js 20 or newer.

```powershell
npm install
Copy-Item .env.example .env
```

Set `APP_PASSWORD` in `.env` before starting the server. Email sending also needs `RESEND_API_KEY` and `FROM_EMAIL`.

```powershell
npm start
npm test
```

Open `http://localhost:3000` and sign in with username `booker` and your `APP_PASSWORD`.
