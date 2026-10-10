const API_URL = "https://hillsroad.legendonlineservices.co.uk/enterprise/BookingsCentre/SportsHallTimeTable";
const TIME_ZONE = "Europe/London";
const ukDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getUkDate(date = new Date()) {
  const parts = Object.fromEntries(
    ukDateTimeFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date, amount) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function getUtcFromUkLocal(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const intendedUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = intendedUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      ukDateTimeFormatter.formatToParts(new Date(guess))
        .map(({ type, value }) => [type, Number(value)]),
    );
    const representedUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    guess += intendedUtc - representedUtc;
  }

  return new Date(guess);
}

function isBookableWithinWindow(date, time, now = new Date()) {
  const slotStart = getUtcFromUkLocal(date, time);
  const remainingMilliseconds = slotStart.getTime() - now.getTime();
  return remainingMilliseconds >= 0 && remainingMilliseconds <= 7 * 24 * 60 * 60 * 1000;
}

function getTargets(startDate, numberOfDays) {
  const targets = [];
  for (let offset = 0; offset < numberOfDays; offset += 1) {
    const date = addDays(startDate, offset);
    const [year, month, day] = date.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday === 3 || weekday === 4) {
      targets.push({ date, time: "18:00" });
    }
  }
  return targets;
}

async function loadAvailability(startDate, endDate) {
  const start = getUtcFromUkLocal(startDate, "00:00:00");
  const end = getUtcFromUkLocal(endDate, "23:59:59");
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    Activities: "41",
    BookingFacilities: "1",
    Start: start.toISOString(),
    End: end.toISOString(),
  }).toString();

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Booking availability API returned ${response.status}.`);
  }

  const payload = await response.json();
  const rows = payload?.SportsHallActivitySnapshots?.flatMap(
    (snapshot) => snapshot?.SportsHallTimetableRows ?? [],
  );
  if (!Array.isArray(rows)) {
    throw new Error("Booking availability API returned an unexpected response.");
  }

  return rows
    .filter((row) => typeof row.StartTime === "string"
      && row.StartTime.slice(11, 16) === "18:00")
    .map((row) => ({
      date: row.StartTime.slice(0, 10),
      slotId: Number(row.SlotId),
      availableSlots: Number(row.AvailableSlots),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && Number.isSafeInteger(row.slotId)
      && Number.isFinite(row.availableSlots));
}

module.exports = {
  addDays,
  getTargets,
  getUkDate,
  getUtcFromUkLocal,
  isBookableWithinWindow,
  loadAvailability,
};
