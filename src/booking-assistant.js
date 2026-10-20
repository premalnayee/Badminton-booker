const {
  addDays,
  getTargets,
  getUtcFromUkLocal,
  isBookableWithinWindow,
} = require("./availability");

const TIME_ZONE = "Europe/London";

function parseMaxAutoBookings(value = process.env.MAX_AUTO_BOOKINGS) {
  const configuredValue = value === undefined || value === "" ? "2" : String(value);
  if (!/^[12]$/.test(configuredValue)) {
    throw new Error("MAX_AUTO_BOOKINGS must be set to 1 or 2.");
  }
  return Number(configuredValue);
}

function getRequestedTargets(startDate, requestedDate, requestedTime = "18:00") {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(requestedTime)) {
    throw new Error("The requested time must be in 24-hour HH:MM format.");
  }

  if (!requestedDate) {
    return getTargets(startDate, 8).map((target) => ({
      ...target,
      time: requestedTime,
    }));
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    || addDays(requestedDate, 0) !== requestedDate) {
    throw new Error("The requested date must be a valid date in YYYY-MM-DD format.");
  }

  if (requestedDate < startDate) {
    throw new Error("The requested date must be today or a future date.");
  }
  return [{ date: requestedDate, time: requestedTime }];
}

function getAvailableRows(rows, target) {
  return rows
    .filter((row) => row.StartTime?.slice(0, 10) === target.date
      && row.StartTime.slice(11, 16) === target.time
      && Number(row.AvailableSlots) > 0
      && Number.isSafeInteger(Number(row.SlotId)))
    .sort((left, right) => Number(left.SlotId) - Number(right.SlotId));
}

function getUkLocalTimestamp(date, time) {
  const utcDate = getUtcFromUkLocal(date, time);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(utcDate).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatBookingDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  const weekdayDate = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: TIME_ZONE,
  }).format(weekdayDate);
  const monthName = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: TIME_ZONE,
  }).format(weekdayDate);
  const ordinal = day % 100 >= 11 && day % 100 <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  return `${weekday}, ${monthName} ${day}${ordinal} ${year}`;
}

function buildBookingRequest(target, rows, selectedRow, selectedCourt) {
  const availableRows = getAvailableRows(rows, target);
  const chosenRow = selectedRow || availableRows[0];
  if (!chosenRow || !availableRows.some((row) => row.SlotId === chosenRow.SlotId)) {
    throw new Error("No current available court was found for the selected date and time.");
  }

  if (chosenRow.ResourceLocationSelectionEnabled && !selectedCourt) {
    throw new Error("This slot requires a court selection, but no available court was returned.");
  }

  const startTime = getUkLocalTimestamp(target.date, target.time);
  const availableSlots = availableRows.reduce(
    (total, row) => total + Number(row.AvailableSlots),
    0,
  );
  const request = {
    ActivityId: chosenRow.ActivityId,
    ActivityName: chosenRow.ActivityName,
    ProductId: chosenRow.ProductId,
    Date: formatBookingDate(target.date),
    StartTime: startTime,
    Time: startTime,
    MultiLocation: availableRows.length > 1,
    Duration: chosenRow.Duration,
    FacilityId: chosenRow.FacilityId,
    FacilityName: chosenRow.FacilityName,
    AvailableSlots: availableSlots,
    ResourceLocationSelectionEnabled: Boolean(chosenRow.ResourceLocationSelectionEnabled),
    Locations: availableRows,
    AddedToBasket: false,
    Text: `${availableSlots} Slots`,
    SlotId: chosenRow.SlotId,
  };

  if (request.MultiLocation) {
    request.FacilityId = chosenRow.FacilityId;
    request.FacilityName = chosenRow.FacilityName;
  }

  if (selectedCourt) {
    request.SelectedCourts = selectedCourt.SectorReference;
    request.ResourceLocation = selectedCourt.SectorName
      || selectedCourt.SectorNames?.join(" & ");
  }

  return request;
}

function serializeBookingRequest(request) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request)) {
    if (key === "Locations" && Array.isArray(value)) {
      value.forEach((location, index) => {
        for (const [locationKey, locationValue] of Object.entries(location)) {
          if (locationValue !== undefined && locationValue !== null) {
            params.append(
              `Locations[${index}][${locationKey}]`,
              String(locationValue),
            );
          }
        }
      });
    } else if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  }
  return params;
}

function isTargetBookable(target, now = new Date()) {
  return isBookableWithinWindow(target.date, target.time, now);
}

module.exports = {
  buildBookingRequest,
  getAvailableRows,
  getRequestedTargets,
  isTargetBookable,
  formatBookingDate,
  parseMaxAutoBookings,
  serializeBookingRequest,
};
