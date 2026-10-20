const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildBookingRequest,
  formatBookingDate,
  getAvailableRows,
  getRequestedTargets,
  parseMaxAutoBookings,
  serializeBookingRequest,
} = require("./booking-assistant");
const {
  getPortalCredentials,
  parseRequestedDate,
} = require("../scripts/booking-assistant");

test("MAX_AUTO_BOOKINGS defaults to two and only accepts one or two", () => {
  assert.equal(parseMaxAutoBookings(undefined), 2);
  assert.equal(parseMaxAutoBookings("1"), 1);
  assert.equal(parseMaxAutoBookings("2"), 2);
  assert.throws(() => parseMaxAutoBookings("0"), /must be set to 1 or 2/);
  assert.throws(() => parseMaxAutoBookings("3"), /must be set to 1 or 2/);
});

test("optional date argument accepts both supported CLI formats", () => {
  assert.equal(parseRequestedDate([]), undefined);
  assert.equal(parseRequestedDate(["--date", "2026-10-22"]), "2026-10-22");
  assert.equal(parseRequestedDate(["--date=2026-10-22"]), "2026-10-22");
  assert.throws(() => parseRequestedDate(["--unknown"]), /Usage:/);
});

test("Hills Road login credentials are optional but must be configured together", () => {
  assert.equal(getPortalCredentials({}), null);
  assert.deepEqual(
    getPortalCredentials({
      HILLS_ROAD_EMAIL: "player@example.com",
      HILLS_ROAD_PASSWORD: "example-password",
    }),
    { email: "player@example.com", password: "example-password" },
  );
  assert.throws(
    () => getPortalCredentials({ HILLS_ROAD_EMAIL: "player@example.com" }),
    /Set both HILLS_ROAD_EMAIL and HILLS_ROAD_PASSWORD/,
  );
  assert.throws(
    () => getPortalCredentials({ HILLS_ROAD_PASSWORD: "example-password" }),
    /Set both HILLS_ROAD_EMAIL and HILLS_ROAD_PASSWORD/,
  );
});

test("requested dates must be Wednesday or Thursday", () => {
  assert.deepEqual(getRequestedTargets("2026-10-15", "2026-10-22"), [
    { date: "2026-10-22", time: "18:00" },
  ]);
  assert.throws(
    () => getRequestedTargets("2026-10-15", "2026-10-23"),
    /Wednesday or Thursday/,
  );
  assert.throws(
    () => getRequestedTargets("2026-10-15", "2026-02-30"),
    /valid date/,
  );
  assert.throws(
    () => getRequestedTargets("2026-10-15", "2026-10-14"),
    /today or a future date/,
  );
});

test("availability selection includes only matching available courts", () => {
  const rows = [
    { StartTime: "2026-10-22T18:00:00", SlotId: 10, AvailableSlots: 2 },
    { StartTime: "2026-10-22T18:00:00", SlotId: 11, AvailableSlots: 0 },
    { StartTime: "2026-10-22T19:00:00", SlotId: 12, AvailableSlots: 3 },
    { StartTime: "2026-10-23T18:00:00", SlotId: 13, AvailableSlots: 1 },
  ];

  assert.deepEqual(
    getAvailableRows(rows, { date: "2026-10-22", time: "18:00" })
      .map((row) => row.SlotId),
    [10],
  );
});

test("booking requests retain site slot data and serialize nested locations", () => {
  const target = { date: "2026-10-22", time: "18:00" };
  const row = {
    SlotId: 492755,
    FacilityId: 1,
    FacilityName: "Hills Road STC",
    ActivityId: 41,
    ActivityName: "Badminton",
    AvailableSlots: 2,
    StartTime: "2026-10-22T18:00:00",
    ProductId: 512,
    Duration: 60,
    ResourceLocationSelectionEnabled: false,
  };

  const request = buildBookingRequest(target, [row], row);
  const params = serializeBookingRequest(request);

  assert.equal(request.StartTime, "2026-10-22T18:00:00");
  assert.equal(request.Date, "Thursday, October 22nd 2026");
  assert.equal(request.SlotId, 492755);
  assert.equal(params.get("Locations[0][SlotId]"), "492755");
  assert.equal(params.get("ResourceLocationSelectionEnabled"), "false");
});

test("booking dates use the portal's English ordinal date format", () => {
  assert.equal(formatBookingDate("2026-10-21"), "Wednesday, October 21st 2026");
  assert.equal(formatBookingDate("2026-10-22"), "Thursday, October 22nd 2026");
  assert.equal(formatBookingDate("2026-10-23"), "Friday, October 23rd 2026");
  assert.equal(formatBookingDate("2026-10-11"), "Sunday, October 11th 2026");
});
