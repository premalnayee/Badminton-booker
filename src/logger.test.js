const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createLogger } = require("./logger");

test("logger appends messages and compacts consecutive duplicates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "badminton-booker-logs-"));
  const logFile = path.join(directory, "nested", "app.log");
  const logger = createLogger({ logFile, writeToConsole: false });

  try {
    logger.info("Checking availability");
    logger.info("Checking availability");
    logger.info("Checking availability");
    logger.warn("Availability check failed");
    logger.close();

    const entries = fs.readFileSync(logFile, "utf8").trim().split("\n");
    assert.equal(entries.length, 3);
    assert.match(entries[0], /INFO Checking availability$/);
    assert.match(entries[1], /INFO Previous line repeated 2 more times over \d+s: Checking availability$/);
    assert.match(entries[2], /WARN Availability check failed$/);
  } finally {
    logger.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("logger rejects invalid compaction intervals", () => {
  assert.throws(
    () => createLogger({ compactionIntervalMs: 0 }),
    /compaction interval must be a positive number/,
  );
});
