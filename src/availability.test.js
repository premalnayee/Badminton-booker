const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addDays,
  getTargets,
  getUtcFromUkLocal,
  isBookableWithinWindow,
} = require("./availability");

test("adds calendar days across month and year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("selects only Wednesday and Thursday dates", () => {
  assert.deepEqual(getTargets("2026-10-12", 4), [
    { date: "2026-10-14", time: "18:00" },
    { date: "2026-10-15", time: "18:00" },
  ]);
});

test("converts Hills Road local booking time to UTC in summer and winter", () => {
  assert.equal(
    getUtcFromUkLocal("2026-07-15", "18:00").toISOString(),
    "2026-07-15T17:00:00.000Z",
  );
  assert.equal(
    getUtcFromUkLocal("2026-12-16", "18:00").toISOString(),
    "2026-12-16T18:00:00.000Z",
  );
});

test("eligibility is limited to the next seven days", () => {
  const now = new Date("2026-10-10T17:00:00.000Z");
  assert.equal(isBookableWithinWindow("2026-10-14", "18:00", now), true);
  assert.equal(isBookableWithinWindow("2026-10-18", "18:00", now), false);
});
