/**
 * FT-DEP-001 Batch 2 — production file logging (extends console; does not replace it).
 * Writes: startup.log, application.log, error.log under logsDir.
 */
const fs = require("fs");
const path = require("path");

/** @type {{ logsDir: string, started: boolean } | null} */
let state = null;

function stamp() {
  return new Date().toISOString();
}

function appendLine(filePath, line) {
  try {
    fs.appendFileSync(filePath, line + "\n", "utf8");
  } catch {
    // Never throw from logging — console remains available.
  }
}

function formatArgs(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

/**
 * @param {string} logsDir
 * @returns {{ startupLog: string, applicationLog: string, errorLog: string }}
 */
function initRuntimeLogging(logsDir) {
  fs.mkdirSync(logsDir, { recursive: true });
  const startupLog = path.join(logsDir, "startup.log");
  const applicationLog = path.join(logsDir, "application.log");
  const errorLog = path.join(logsDir, "error.log");
  state = { logsDir, started: true };

  const orig = {
    log: console.log.bind(console),
    info: console.info ? console.info.bind(console) : console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args) => {
    orig.log(...args);
    appendLine(applicationLog, `${stamp()} [INFO] ${formatArgs(args)}`);
  };
  console.info = (...args) => {
    orig.info(...args);
    appendLine(applicationLog, `${stamp()} [INFO] ${formatArgs(args)}`);
  };
  console.warn = (...args) => {
    orig.warn(...args);
    appendLine(applicationLog, `${stamp()} [WARN] ${formatArgs(args)}`);
    appendLine(errorLog, `${stamp()} [WARN] ${formatArgs(args)}`);
  };
  console.error = (...args) => {
    orig.error(...args);
    appendLine(applicationLog, `${stamp()} [ERROR] ${formatArgs(args)}`);
    appendLine(errorLog, `${stamp()} [ERROR] ${formatArgs(args)}`);
  };

  return { startupLog, applicationLog, errorLog, _orig: orig };
}

/**
 * Write to startup.log (and console via original log if available).
 * @param {string} message
 * @param {{ startupLog?: string, _orig?: { log: Function } }} [handles]
 */
function writeStartup(message, handles) {
  const line = `${stamp()} ${message}`;
  if (handles?._orig?.log) handles._orig.log(message);
  else console.log(message);
  if (handles?.startupLog) appendLine(handles.startupLog, line);
  else if (state) appendLine(path.join(state.logsDir, "startup.log"), line);
}

module.exports = {
  initRuntimeLogging,
  writeStartup,
};
