const EMAIL_KEY = "badminton-booker-email";
const SENT_KEY = "badminton-booker-notified-slots";
const POLL_INTERVAL = 30 * 60 * 1000;
const BOOKING_URL = "https://hillsroad.legendonlineservices.co.uk/";

const emailForm = document.querySelector("#email-form");
const emailInput = document.querySelector("#email");
const emailMessage = document.querySelector("#email-message");
const setupWarning = document.querySelector("#setup-warning");
const slotsElement = document.querySelector("#slots");
const lastChecked = document.querySelector("#last-checked");
const connectionState = document.querySelector("#connection-state");
const checkNowButton = document.querySelector("#check-now");

emailInput.value = localStorage.getItem(EMAIL_KEY) || "";
let checking = false;

emailForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!emailInput.reportValidity()) return;
  localStorage.setItem(EMAIL_KEY, email);
  emailMessage.textContent = `Email saved for ${email}. Checking for bookable courts now…`;
  checkAvailability(false);
});

checkNowButton.addEventListener("click", () => checkAvailability(true));

async function getJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "The request failed.");
  }
  return result;
}

async function checkAvailability(showFailure) {
  if (checking) return;
  checking = true;
  checkNowButton.disabled = true;
  connectionState.textContent = "Checking…";

  try {
    const [result, status] = await Promise.all([
      getJson("/api/availability"),
      getJson("/api/status"),
    ]);
    setupWarning.hidden = status.mailConfigured;
    renderSlots(result.targets);
    lastChecked.textContent = `Last checked ${new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(result.checkedAt))} · next check in 30 minutes`;
    connectionState.textContent = "Connected";
    await notifyForAvailableSlots(result.targets);
  } catch (error) {
    connectionState.textContent = "Connection issue";
    lastChecked.textContent = error.message;
    if (showFailure) emailMessage.textContent = "Could not check the timetable. Please try again.";
  } finally {
    checking = false;
    checkNowButton.disabled = false;
  }
}

function renderSlots(targets) {
  const now = Date.now();
  slotsElement.replaceChildren();

  for (const target of targets) {
    const card = document.createElement("article");
    card.className = "slot-card";
    const dateLabel = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date(`${target.date}T12:00:00Z`));

    const details = document.createElement("div");
    const date = document.createElement("p");
    date.className = "slot-date";
    date.textContent = dateLabel;
    const time = document.createElement("p");
    time.className = "slot-time";
    time.textContent = "Badminton · 6:00–7:00pm";
    details.append(date, time);

    const action = document.createElement("div");
    action.className = "slot-action";
    const state = document.createElement("span");
    state.className = "slot-state";

    if (target.canBook) {
      state.classList.add("available");
      state.textContent = `${target.availableSlots} ${target.availableSlots === 1 ? "court" : "courts"} available`;
      action.append(state, makeBookingLink());
    } else if (target.availableSlots > 0) {
      state.classList.add("unknown");
      state.textContent = `Available · opens ${formatOpening(target.date, now)}`;
      action.append(state);
    } else if (target.availableSlots === 0) {
      state.classList.add("full");
      state.textContent = "No courts available";
      action.append(state);
    } else {
      state.classList.add("unknown");
      state.textContent = "Not listed yet";
      action.append(state);
    }

    card.append(details, action);
    slotsElement.append(card);
  }
}

function makeBookingLink() {
  const link = document.createElement("a");
  link.className = "book-link";
  link.href = BOOKING_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Book a court";
  return link;
}

function formatOpening(date, now) {
  const [year, month, day] = date.split("-").map(Number);
  const dateAtSix = new Date(Date.UTC(year, month - 1, day, 18));
  const daysUntil = Math.max(1, Math.ceil((dateAtSix.getTime() - now) / 86400000) - 7);
  return `in ${daysUntil} ${daysUntil === 1 ? "day" : "days"}`;
}

async function notifyForAvailableSlots(targets) {
  const email = localStorage.getItem(EMAIL_KEY);
  if (!email) return;

  const currentEmail = email.toLowerCase();
  const activeKeys = new Set(
    targets
      .filter((target) => target.canBook && target.slotId)
      .map((target) => `${target.date}:${target.slotId}:${currentEmail}`),
  );
  const storedKeys = JSON.parse(localStorage.getItem(SENT_KEY) || "[]");
  const notified = new Set(
    storedKeys.filter((key) => !key.endsWith(`:${currentEmail}`) || activeKeys.has(key)),
  );
  localStorage.setItem(SENT_KEY, JSON.stringify([...notified]));

  for (const target of targets) {
    if (!target.canBook || !target.slotId) continue;
    const key = `${target.date}:${target.slotId}:${email.toLowerCase()}`;
    if (notified.has(key)) continue;

    try {
      const result = await getJson("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, date: target.date, slotId: target.slotId }),
      });
      if (result.sent || result.alreadySent) {
        notified.add(key);
        localStorage.setItem(SENT_KEY, JSON.stringify([...notified]));
        emailMessage.textContent = `Email alert sent to ${email} for ${target.date} at 6pm.`;
      }
    } catch (error) {
      emailMessage.textContent = error.message;
    }
  }
}

function refreshEmailMessage() {
  const email = localStorage.getItem(EMAIL_KEY);
  if (email) {
    emailMessage.textContent = `Alerts will be sent to ${email} while this page is open.`;
  }
}

refreshEmailMessage();
checkAvailability(false);
window.setInterval(() => checkAvailability(false), POLL_INTERVAL);
