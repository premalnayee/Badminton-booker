const crypto = require("node:crypto");
require("dotenv").config();
const express = require("express");

const {
  addDays,
  getTargets,
  getUkDate,
  getUtcFromUkLocal,
  isBookableWithinWindow,
  loadAvailability,
} = require("./src/availability");

const app = express();
const port = Number(process.env.PORT) || 3000;
const sitePassword = process.env.APP_PASSWORD;
const sentNotifications = new Map();
const notificationsInFlight = new Set();

if (!sitePassword) {
  throw new Error("APP_PASSWORD must be set before starting the server.");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

function isEqualSecret(candidate, expected) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

app.use((req, res, next) => {
  if (req.path === "/health") {
    next();
    return;
  }

  const authorization = req.get("authorization") || "";
  const encodedCredentials = authorization.match(/^Basic\s+(.+)$/i)?.[1];
  if (encodedCredentials) {
    const credentials = Buffer.from(encodedCredentials, "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    const username = separator >= 0 ? credentials.slice(0, separator) : "";
    const password = separator >= 0 ? credentials.slice(separator + 1) : "";
    if (username === "booker" && isEqualSecret(password, sitePassword)) {
      next();
      return;
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Badminton Booker", charset="UTF-8"');
  res.status(401).send("Sign in to your badminton booking monitor.");
});

app.use(express.static("public", { index: "index.html" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/status", (_req, res) => {
  res.json({
    mailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.FROM_EMAIL),
    pollIntervalMinutes: 30,
    timezone: "Europe/London",
  });
});

app.get("/api/availability", async (_req, res, next) => {
  try {
    const today = getUkDate();
    const endDate = addDays(today, 27);
    const slots = await loadAvailability(today, endDate);
    const now = new Date();
    const targets = getTargets(today, 28).map((target) => {
      const slot = slots.find((item) => item.date === target.date);
      const availableSlots = slot?.availableSlots ?? null;
      return {
        ...target,
        slotId: slot?.slotId ?? null,
        availableSlots,
        canBook: availableSlots > 0
          && isBookableWithinWindow(target.date, target.time, now),
      };
    });
    pruneSentNotifications(targets);

    res.json({
      checkedAt: now.toISOString(),
      targets,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/notify", async (req, res, next) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const slotId = Number(req.body?.slotId);
    const date = typeof req.body?.date === "string" ? req.body.date : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    if (!Number.isSafeInteger(slotId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "The requested booking slot is invalid." });
      return;
    }
    if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) {
      res.status(503).json({
        error: "Email is not configured yet. Add RESEND_API_KEY and FROM_EMAIL to the service environment.",
      });
      return;
    }

    const notificationKey = `${date}:${slotId}:${email.toLowerCase()}`;
    if (sentNotifications.has(notificationKey)) {
      res.json({ sent: false, alreadySent: true });
      return;
    }
    if (notificationsInFlight.has(notificationKey)) {
      res.status(409).json({ error: "An alert for this slot is already being sent." });
      return;
    }

    notificationsInFlight.add(notificationKey);
    try {
      const currentSlots = await loadAvailability(date, date);
      const slot = currentSlots.find((item) => item.slotId === slotId);
      const target = getTargets(date, 1).find((item) => item.date === date);
      if (!target
        || !slot
        || slot.availableSlots < 1
        || !isBookableWithinWindow(date, target.time, new Date())) {
        res.status(409).json({
          error: "That slot is no longer available to book. The schedule has been refreshed.",
        });
        return;
      }

      await sendAvailabilityEmail(email, date, target.time);
      sentNotifications.set(notificationKey, { date, slotId });
      res.json({ sent: true });
    } finally {
      notificationsInFlight.delete(notificationKey);
    }
  } catch (error) {
    next(error);
  }
});

function pruneSentNotifications(targets) {
  const activeSlots = new Set(
    targets
      .filter((target) => target.canBook && target.availableSlots > 0 && target.slotId)
      .map((target) => `${target.date}:${target.slotId}:`),
  );

  for (const [key, slot] of sentNotifications) {
    if (!activeSlots.has(`${slot.date}:${slot.slotId}:`)) {
      sentNotifications.delete(key);
    }
  }
}

async function sendAvailabilityEmail(email, date, time) {
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(getUtcFromUkLocal(date, time));
  const bookingUrl = "https://hillsroad.legendonlineservices.co.uk/";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL,
      to: [email],
      subject: `Badminton at 6pm is available on ${dateLabel}`,
      text: `A bookable badminton slot is available at Hills Road STC for ${dateLabel} at ${time}.\n\nBook it here: ${bookingUrl}`,
      html: `<p>A bookable badminton slot is available at Hills Road STC for <strong>${dateLabel} at ${time}</strong>.</p><p><a href="${bookingUrl}">Open the Hills Road booking site</a> to book it.</p>`,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Email provider returned ${response.status}: ${details}`);
  }
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "The request failed. Please try again shortly." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Badminton Booker listening on port ${port}`);
});
