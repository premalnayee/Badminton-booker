const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

const DEFAULT_COMPACTION_INTERVAL_MS = 30_000;

function createLogger({
  logFile = process.env.LOG_FILE || path.join("logs", "app.log"),
  compactionIntervalMs = DEFAULT_COMPACTION_INTERVAL_MS,
  writeToConsole = true,
} = {}) {
  if (!Number.isFinite(compactionIntervalMs) || compactionIntervalMs <= 0) {
    throw new Error("The log compaction interval must be a positive number.");
  }

  const resolvedLogFile = path.resolve(logFile);

  let lastLine;
  let repeatCount = 0;
  let repeatWindowStartedAt;
  let closed = false;
  let directoryReady = false;

  function writeLine(level, message) {
    const line = `${new Date().toISOString()} ${level} ${message}\n`;
    if (!directoryReady) {
      fs.mkdirSync(path.dirname(resolvedLogFile), { recursive: true });
      directoryReady = true;
    }
    fs.appendFileSync(resolvedLogFile, line, "utf8");
    if (writeToConsole) {
      const output = level === "ERROR" ? process.stderr : process.stdout;
      output.write(line);
    }
  }

  function flushRepeats() {
    if (!lastLine || repeatCount === 0) return;
    const elapsedSeconds = Math.max(
      1,
      Math.round((Date.now() - repeatWindowStartedAt) / 1000),
    );
    writeLine(
      lastLine.level,
      `Previous line repeated ${repeatCount} more times over ${elapsedSeconds}s: ${lastLine.message}`,
    );
    repeatCount = 0;
    repeatWindowStartedAt = Date.now();
  }

  function log(level, values) {
    if (closed) throw new Error("Cannot write to a closed logger.");
    const message = util.format(...values);
    if (lastLine?.level === level && lastLine.message === message) {
      repeatCount += 1;
      return;
    }

    flushRepeats();
    writeLine(level, message);
    lastLine = { level, message };
    repeatWindowStartedAt = Date.now();
  }

  const interval = setInterval(flushRepeats, compactionIntervalMs);
  interval.unref();

  return {
    info: (...values) => log("INFO", values),
    warn: (...values) => log("WARN", values),
    error: (...values) => log("ERROR", values),
    close() {
      if (closed) return;
      clearInterval(interval);
      flushRepeats();
      closed = true;
    },
  };
}

module.exports = { createLogger };
