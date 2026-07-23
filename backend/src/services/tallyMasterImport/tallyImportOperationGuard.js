/**
 * In-memory operation guard + progress for Tally master import (preview/apply).
 * Prevents concurrent processing of the same client operation ID.
 */

const TTL_MS = 60 * 60 * 1000;

/**
 * @typedef {{
 *   operationId: string;
 *   kind: "preview" | "apply";
 *   status: "running" | "completed" | "failed";
 *   phase: string;
 *   percent: number | null;
 *   message: string;
 *   filename: string | null;
 *   recordsDetected: number | null;
 *   recordsProcessed: number | null;
 *   stockItemsProcessed: number | null;
 *   stockItemsTotal: number | null;
 *   bytesDecoded: number | null;
 *   bytesTotal: number | null;
 *   sanitizedInvalidRefCount: number | null;
 *   batchIndex: number | null;
 *   batchTotal: number | null;
 *   startedAt: number;
 *   updatedAt: number;
 *   error: string | null;
 * }} TallyImportOperationState
 */

/** @type {Map<string, TallyImportOperationState>} */
const ops = new Map();

function gc() {
  const now = Date.now();
  for (const [k, v] of ops) {
    if (now - v.updatedAt > TTL_MS) ops.delete(k);
  }
}

/**
 * @param {string} operationId
 * @param {"preview" | "apply"} kind
 * @param {string | null} [filename]
 */
function beginOperation(operationId, kind, filename = null) {
  gc();
  const id = String(operationId || "").trim();
  if (!id || id.length > 128) {
    const err = new Error("A valid client operation id is required.");
    err.code = "OPERATION_ID_REQUIRED";
    err.statusCode = 400;
    throw err;
  }
  const existing = ops.get(id);
  if (existing && existing.status === "running") {
    const err = new Error(
      "This import operation is already in progress. Wait for it to finish, or start over with a new operation.",
    );
    err.code = "OPERATION_IN_FLIGHT";
    err.statusCode = 409;
    throw err;
  }
  const now = Date.now();
  /** @type {TallyImportOperationState} */
  const state = {
    operationId: id,
    kind,
    status: "running",
    phase: kind === "preview" ? "receiving" : "importing",
    percent: kind === "preview" ? 5 : 5,
    message: kind === "preview" ? "Receiving upload…" : "Starting import…",
    filename: filename || null,
    recordsDetected: null,
    recordsProcessed: null,
    stockItemsProcessed: null,
    stockItemsTotal: null,
    bytesDecoded: null,
    bytesTotal: null,
    sanitizedInvalidRefCount: null,
    batchIndex: null,
    batchTotal: null,
    startedAt: now,
    updatedAt: now,
    error: null,
  };
  ops.set(id, state);
  return state;
}

/**
 * @param {string} operationId
 * @param {Partial<TallyImportOperationState>} patch
 */
function updateOperation(operationId, patch) {
  const cur = ops.get(String(operationId || ""));
  if (!cur || cur.status !== "running") return null;
  Object.assign(cur, patch, { updatedAt: Date.now() });
  return cur;
}

/**
 * @param {string} operationId
 * @param {"completed" | "failed"} status
 * @param {string | null} [error]
 */
function endOperation(operationId, status, error = null) {
  const cur = ops.get(String(operationId || ""));
  if (!cur) return null;
  cur.status = status;
  cur.updatedAt = Date.now();
  cur.error = error;
  if (status === "completed") {
    cur.percent = 100;
    cur.phase = cur.kind === "preview" ? "preview_ready" : "import_done";
    cur.message = cur.kind === "preview" ? "Preview ready." : "Import finished.";
  }
  return cur;
}

/**
 * @param {string} operationId
 */
function getOperation(operationId) {
  gc();
  return ops.get(String(operationId || "")) || null;
}

/** Test helper */
function _resetForTests() {
  ops.clear();
}

module.exports = {
  beginOperation,
  updateOperation,
  endOperation,
  getOperation,
  _resetForTests,
};
