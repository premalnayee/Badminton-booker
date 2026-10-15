# Project Guidance

## Project

- Badminton Booker is a private Node.js/Express dashboard that checks Hills Road STC badminton availability and can email booking alerts.
- The intended hosting platform is Azure. For Azure infrastructure or deployment work, use Azure tools and current Azure best practices; do not assume Render is the target. The Azure hosting service has not been selected, so explain relevant options and tradeoffs before introducing service-specific infrastructure.
- The app requires Node.js 20 or newer. Use `npm install` for local setup, `npm start` to run it, and `npm test` for the Node built-in test suite.

## Structure and Conventions

- `server.js` owns the Express server, Basic authentication, HTTP routes, and email delivery. Keep secrets in environment variables; see `.env.example`.
- `src/availability.js` contains the timetable API integration, UK date/time handling, and availability rules. Its tests are in `src/availability.test.js`.
- `public/` contains the static dashboard (`index.html`, `app.js`, and `style.css`); the server serves it directly.
- Preserve the existing CommonJS style and Node built-in test runner unless a change requires otherwise.
- The `/health` endpoint is intentionally public for hosting health checks; the dashboard and API routes require Basic authentication.

## Hosting Considerations

- The server listens on `process.env.PORT` and `0.0.0.0`, and `/health` returns a JSON health response.
- Configure `APP_PASSWORD` for every deployed environment. Email alerts also require `RESEND_API_KEY` and a verified `FROM_EMAIL`; never commit real credentials.
- Availability checks run from the open browser dashboard every 30 minutes. Do not describe this as a reliable background scheduler.
- Notification deduplication is held in process memory. If selecting Azure hosting or scaling settings, account for restarts and multiple instances; use durable shared storage only if the requirements call for it.
- See [README.md](README.md) for current behavior and local setup. Its deployment section currently describes Render; the project hosting goal is Azure, so update that documentation only when explicitly working on deployment documentation.