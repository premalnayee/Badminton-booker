require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { chromium } = require("playwright");
const {
  getUkDate,
  getUtcFromUkLocal,
} = require("../src/availability");
const { createLogger } = require("../src/logger");
const {
  buildBookingRequest,
  getAvailableRows,
  getRequestedTargets,
  isTargetBookable,
  parseMaxAutoBookings,
  serializeBookingRequest,
} = require("../src/booking-assistant");

const SITE_ORIGIN = "https://hillsroad.legendonlineservices.co.uk";
const BOOKING_CENTRE_URL = `${SITE_ORIGIN}/enterprise/bookingscentre/index`;
const BASKET_URL = `${SITE_ORIGIN}/enterprise/universalbasket/summary`;
const POLL_INTERVAL_MS = 1_000;
const PROFILE_DIRECTORY = path.resolve(".booking-helper-profile");
const STATE_FILE = path.join(PROFILE_DIRECTORY, "booking-state.json");
const TIME_ZONE = "Europe/London";
const logger = createLogger();

function parseRequestedOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const separator = args[index].indexOf("=");
    const option = separator < 0 ? args[index] : args[index].slice(0, separator);
    let value = separator < 0 ? args[index + 1] : args[index].slice(separator + 1);
    if (separator < 0) index += 1;

    if (!["--date", "--time"].includes(option)
      || !value
      || value.startsWith("--")
      || options[option]) {
      throw new Error(
        "Usage: npm run booking:assist -- [--date YYYY-MM-DD] [--time HH:MM].",
      );
    }
    options[option] = value;
  }
  return {
    requestedDate: options["--date"],
    requestedTime: options["--time"] || "18:00",
  };
}

function getPortalCredentials(environment = process.env) {
  const email = environment.HILLS_ROAD_EMAIL;
  const password = environment.HILLS_ROAD_PASSWORD;
  if (!email && !password) return null;
  if (typeof email !== "string" || !email.trim()
    || typeof password !== "string" || !password) {
    throw new Error(
      "Set both HILLS_ROAD_EMAIL and HILLS_ROAD_PASSWORD to enable automatic sign-in.",
    );
  }
  return { email, password };
}

function formatTarget(target) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(getUtcFromUkLocal(target.date, target.time))
    + ` at ${target.time}`;
}

async function signInToPortal(page, terminal, credentials) {
  await page.goto(BOOKING_CENTRE_URL, { waitUntil: "domcontentloaded" });
  if (!new URL(page.url()).pathname.endsWith("/account/login")) return;

  if (!credentials) {
    await terminal.question(
      "Sign in to Hills Road in the browser window. Press Enter here when signed in: ",
    );
  } else {
    await page.locator('[data-test-id="login-email"]').fill(credentials.email);
    await page.locator('[data-test-id="login-password"]').fill(credentials.password);
    await page.locator('[data-test-id="login-submit"]').click();

    try {
      await page.waitForFunction(
        () => !location.pathname.endsWith("/account/login"),
        null,
        { timeout: 15_000 },
      );
    } catch (error) {
      if (error.name !== "TimeoutError") throw error;

      const loginError = (
        await page.locator('[data-test-id="login-error-alert"]').textContent()
      )?.trim();
      if (loginError) {
        throw new Error(`Hills Road rejected the login: ${loginError}`);
      }

      await terminal.question(
        "Automatic sign-in did not finish. Complete any additional sign-in steps "
        + "in the browser, then press Enter here: ",
      );
    }
  }

  await page.goto(BOOKING_CENTRE_URL, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname.endsWith("/account/login")) {
    throw new Error(
      "Hills Road is still showing its login page. Check your credentials and try again.",
    );
  }
}

async function readState() {
  try {
    const state = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
    if (state.version !== 1 || typeof state.targets !== "object" || !state.targets) {
      throw new Error("The booking assistant state file has an unsupported format.");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, targets: {} };
    }
    throw error;
  }
}

async function writeState(state) {
  const temporaryFile = `${STATE_FILE}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
  });
  await fs.rename(temporaryFile, STATE_FILE);
}

async function fetchTimetable(page, startDate, endDate) {
  const start = getUtcFromUkLocal(startDate, "00:00:00").toISOString();
  const end = getUtcFromUkLocal(endDate, "23:59:59").toISOString();

  return page.evaluate(async ({ requestStart, requestEnd }) => {
    const url = new URL("/enterprise/BookingsCentre/SportsHallTimeTable", location.origin);
    url.search = new URLSearchParams({
      Activities: "41",
      BookingFacilities: "1",
      Start: requestStart,
      End: requestEnd,
    }).toString();

    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Hills Road timetable request failed (${response.status}).`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Hills Road returned a non-JSON timetable response. Sign in again and retry.");
    }

    const rows = payload?.SportsHallActivitySnapshots?.flatMap(
      (snapshot) => snapshot?.SportsHallTimetableRows ?? [],
    );
    if (!Array.isArray(rows)) {
      throw new Error("Hills Road returned an unexpected timetable response.");
    }
    return rows;
  }, { requestStart: start, requestEnd: end });
}

async function fetchResourceChoices(page, rows, target) {
  const models = rows.map((row) => ({
    SlotId: row.SlotId,
    FacilityId: row.FacilityId,
    ActivityId: row.ActivityId,
    StartTime: `${target.date} ${target.time}:00`,
    Duration: row.Duration,
  }));

  return page.evaluate(async (requestModels) => {
    const response = await fetch("/enterprise/BookingsCentre/GetResourceLocation", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ models: requestModels }),
    });
    if (!response.ok) {
      throw new Error(`Hills Road court lookup failed (${response.status}).`);
    }
    return response.json();
  }, models);
}

function getResourceChoices(payload, slotId) {
  if (!Array.isArray(payload)) {
    throw new Error("Hills Road returned an unexpected court-selection response.");
  }

  const choices = payload
    .filter((item) => item.SlotId === undefined || item.SlotId === slotId)
    .flatMap((item) => item.AvailableCourts ?? [])
    .filter((court) => court?.SectorReference !== undefined
      && (court.SectorName || Array.isArray(court.SectorNames)));
  const unique = new Map(
    choices.map((court) => [String(court.SectorReference), court]),
  );
  return [...unique.values()];
}

async function addToBasket(page, request) {
  const query = serializeBookingRequest(request).toString();
  return page.evaluate(async (queryString) => {
    const response = await fetch(
      `/enterprise/BookingsCentre/BookSportsHallSlot?${queryString}`,
      {
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Hills Road could not add the court to the basket (${response.status}).`);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The add-to-basket result could not be confirmed. Check the basket before retrying.");
    }
    return result;
  }, query);
}

async function monitorAndAdd(page, requestedTargets, maxBookings, state) {
  const activeTargets = requestedTargets.filter((target) => isTargetBookable(target));
  if (!activeTargets.length) {
    return { added: 0, waiting: true };
  }
  for (const target of activeTargets) {
    const key = `${target.date}T${target.time}`;
    const targetState = state.targets[key] || { added: 0, pending: false, usedCourts: [] };
    if (targetState.pending) {
      throw new Error(
        `A previous add for ${formatTarget(target)} has an uncertain result. `
        + "Check the Hills Road basket. If no court was added, set this target's "
        + "`pending` value to false in .booking-helper-profile/booking-state.json "
        + "before restarting.",
      );
    }
    if (targetState.added >= maxBookings) continue;
    const rows = await fetchTimetable(page, target.date, target.date);

    let addedThisRun = 0;
    while (targetState.added < maxBookings) {
      const currentRows = getAvailableRows(rows, target);
      if (!currentRows.length) break;

      const selectedRow = currentRows[0];
      let selectedCourt;

      if (selectedRow.ResourceLocationSelectionEnabled) {
        const courtResponse = await fetchResourceChoices(page, currentRows, target);
        const courts = getResourceChoices(courtResponse, selectedRow.SlotId).filter(
          (court) => !targetState.usedCourts.includes(String(court.SectorReference)),
        );
        selectedCourt = courts[0];
        if (!selectedCourt) {
          if (addedThisRun) return { added: addedThisRun, target };
          throw new Error(
            `A court is available on ${formatTarget(target)}, but the portal did not return a selectable court.`,
          );
        }
      }

      const request = buildBookingRequest(target, currentRows, selectedRow, selectedCourt);
      targetState.pending = true;
      state.targets[key] = targetState;
      await writeState(state);

      let result;
      try {
        result = await addToBasket(page, request);
      } catch (error) {
        await writeState(state);
        throw new Error(
          `${error.message} The outcome may be uncertain; check the basket before retrying.`,
        );
      }
      if (result?.Success !== true) {
        targetState.pending = false;
        state.targets[key] = targetState;
        await writeState(state);
        throw new Error(result?.Message || "Hills Road did not confirm that the court was added.");
      }

      targetState.pending = false;
      targetState.added += 1;
      if (selectedCourt) {
        targetState.usedCourts.push(String(selectedCourt.SectorReference));
      }
      state.targets[key] = targetState;
      await writeState(state);
      addedThisRun += 1;
      logger.info(`Added one court for ${formatTarget(target)}. (${targetState.added}/${maxBookings})`);

      if (targetState.added >= maxBookings) {
        return { added: addedThisRun, target };
      }

      let refreshedRows;
      try {
        refreshedRows = await fetchTimetable(page, target.date, target.date);
      } catch (error) {
        logger.warn(
          `One court was added, but availability could not be checked for a second. ${error.message}`,
        );
        return { added: addedThisRun, target };
      }
      const refreshed = getAvailableRows(refreshedRows, target);
      if (!refreshed.length) {
        return { added: addedThisRun, target };
      }
      rows.splice(0, rows.length, ...refreshedRows);
    }

    if (addedThisRun) {
      return { added: addedThisRun, target };
    }
  }

  return { added: 0, waiting: true };
}

async function main() {
  const maxBookings = parseMaxAutoBookings();
  const { requestedDate, requestedTime } = parseRequestedOptions(process.argv.slice(2));
  const portalCredentials = getPortalCredentials();
  const requestedTargets = getRequestedTargets(
    getUkDate(),
    requestedDate,
    requestedTime,
  );
  if (!requestedTargets.length) {
    throw new Error("No upcoming Wednesday or Thursday target dates were found.");
  }

  const state = await readState();
  const pending = Object.entries(state.targets).find(([, targetState]) => targetState.pending);
  if (pending) {
    throw new Error(
      `The previous add for ${pending[0]} has an uncertain result. `
      + "Check the Hills Road basket. If no court was added, set this target's "
      + "`pending` value to false in .booking-helper-profile/booking-state.json "
      + "before restarting.",
    );
  }

  await fs.mkdir(PROFILE_DIRECTORY, { recursive: true });
  const browserContext = await chromium.launchPersistentContext(PROFILE_DIRECTORY, {
    headless: false,
  });
  const page = browserContext.pages()[0] || await browserContext.newPage();
  const terminal = readline.createInterface({ input: stdin, output: stdout });

  try {
    await signInToPortal(page, terminal, portalCredentials);

    const targetDescription = requestedDate
      ? formatTarget(requestedTargets[0])
      : `Wednesday/Thursday at ${requestedTime}`;
    logger.info(`Monitoring badminton for ${targetDescription}. Limit: ${maxBookings} per date/time.`);
    logger.info("Checks run every second. No checkout or payment will be performed.");

    while (true) {
      const result = await monitorAndAdd(page, requestedTargets, maxBookings, state);
      if (result.added > 0) {
        await page.goto(BASKET_URL, { waitUntil: "domcontentloaded" });
        logger.info(
          `Basket opened for ${formatTarget(result.target)}. `
          + "Complete checkout manually in the browser.",
        );
        await terminal.question("Press Enter after you finish checkout to close the helper: ");
        return;
      }

      logger.info(`No matching court yet. Next check in ${POLL_INTERVAL_MS / 1000} seconds.`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally {
    terminal.close();
    await browserContext.close();
  }
}

if (require.main === module) {
  process.once("exit", () => logger.close());
  main().catch((error) => {
    logger.error(error.message);
    process.exitCode = 1;
  }).finally(() => logger.close());
}

module.exports = {
  getPortalCredentials,
  getResourceChoices,
  parseRequestedOptions,
};
