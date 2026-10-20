# Badminton Booker

A small private dashboard that checks the Hills Road STC timetable for Wednesday and Thursday badminton at 6pm. When the API reports an available slot within the next seven days, the dashboard emails a booking link.

## Free Render setup

1. Create a [Resend](https://resend.com) account, verify a sender address/domain, and create an API key. Resend's free allowance and sender-verification requirements may change.
2. Push this project to a Git repository and create a Render Blueprint from it using `render.yaml`.
3. Set the Blueprint's `APP_PASSWORD` to a long, unique password. Set `RESEND_API_KEY` and `FROM_EMAIL` to the Resend values; `FROM_EMAIL` must be a verified sender.
4. Open the deployed service URL. At the browser sign-in prompt, use username `booker` and the `APP_PASSWORD` you set. Save your notification email in the dashboard.

Render's free web service has no scheduled worker or persistent storage. This version checks every five minutes from the open dashboard, so it can send email only while the page is open and the browser/device and service are reachable. Free services can also spin down while idle, delaying a check until they wake. It is not a guaranteed background alert service. For dependable alerts while the page is closed, upgrade to an always-on scheduled checker and persistent storage.

The app never books automatically; the email and dashboard link take you to the Hills Road site to complete the booking. Availability can change before you finish booking.

## Fast booking assistant

The local booking assistant uses a separate Playwright browser profile and the Hills Road site’s own signed-in session. By default, it watches the upcoming Wednesday and Thursday 6pm badminton slots. You can override the target date and time with `--date` and `--time`, including dates on other weekdays. When a matching slot becomes available, it adds up to `MAX_AUTO_BOOKINGS` entries for that date/time to the basket. It then opens the basket and waits while you check out manually. It never confirms or pays for a booking.

Set `MAX_AUTO_BOOKINGS` in `.env` to `1` or `2` (default `2`). Install the browser once and start the assistant:

```powershell
npm install
npx playwright install chromium
npm run booking:assist
```

To sign in automatically, set `HILLS_ROAD_EMAIL` and `HILLS_ROAD_PASSWORD` in your local `.env` file. The assistant uses them only to fill the Hills Road login form; they are not written to the browser profile or booking state. Leave both unset to sign in manually in the browser. If the portal requires an additional sign-in step, complete it in the browser when prompted. After signing in, confirm in the terminal that monitoring should start. The assistant checks every second while it is running. For the example Saturday slot, run `npm run booking:assist -- --date 2026-10-24 --time 15:00`. Use another future date and 24-hour `HH:MM` time to test a different slot. Starting the assistant before the venue releases slots lets it keep checking across the release time; the computer and browser must remain running and connected. Stop monitoring with Ctrl+C.

The browser profile, including the venue’s session cookie, is stored locally in `.booking-helper-profile/` and ignored by Git. No venue username or password is stored by the assistant. Keep the browser open while you complete checkout. If the assistant reports an uncertain add-to-basket result, check the basket before restarting it to avoid adding a duplicate. Only if no court was added, set that date/time's `pending` value to `false` in `.booking-helper-profile/booking-state.json` before restarting.

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
