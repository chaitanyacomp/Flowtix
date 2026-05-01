const { prisma } = require("../utils/prisma");

const METADATA_MAX_KEYS = 40;

/**
 * @param {unknown} v
 * @returns {import("@prisma/client").Prisma.InputJsonValue | undefined}
 */
function sanitizeMetadata(v) {
  if (v == null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) return undefined;
  /** @type {Record<string, unknown>} */
  const out = {};
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    if (n >= METADATA_MAX_KEYS) break;
    if (typeof k !== "string" || !k) continue;
    const key = k.slice(0, 64);
    if (val == null) {
      out[key] = null;
    } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      out[key] = val;
    } else if (val instanceof Date && !Number.isNaN(val.getTime())) {
      out[key] = val.toISOString();
    } else {
      out[key] = String(val).slice(0, 256);
    }
    n += 1;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * @param {import("express").Request["user"]} user
 */
function pickUserNameSnapshot(user) {
  if (!user || typeof user !== "object") return null;
  const name = typeof user.name === "string" ? user.name.trim() : "";
  if (name) return name.slice(0, 256);
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (email) return email.slice(0, 256);
  return null;
}

/**
 * @param {import("express").Request["user"]} user
 */
function pickUserId(user) {
  const id = user?.userId;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

/**
 * Business activity row. Never throws to callers — failures are swallowed (console in non-production).
 * @param {{
 *   tx?: import("@prisma/client").Prisma.TransactionClient,
 *   user?: import("express").Request["user"],
 *   module: string,
 *   entityType: string,
 *   entityId?: number | null,
 *   docNo?: string | null,
 *   action: string,
 *   subAction?: string | null,
 *   message: string,
 *   reason?: string | null,
 *   metadata?: Record<string, unknown> | null,
 * }} args
 */
async function logActivity(args) {
  const {
    tx,
    user,
    module,
    entityType,
    entityId = null,
    docNo = null,
    action,
    subAction = null,
    message,
    reason = null,
    metadata = null,
  } = args;

  const client = tx || prisma;
  const meta = sanitizeMetadata(metadata);
  const reasonStr = reason != null && String(reason).trim() ? String(reason).trim().slice(0, 8000) : null;

  try {
    /** @type {import("@prisma/client").Prisma.ActivityLogCreateInput} */
    const data = {
      userId: pickUserId(user),
      userNameSnapshot: pickUserNameSnapshot(user),
      module: String(module).slice(0, 64),
      entityType: String(entityType).slice(0, 64),
      entityId: entityId == null || !Number.isFinite(Number(entityId)) ? null : Number(entityId),
      docNo: docNo == null ? null : String(docNo).trim().slice(0, 64) || null,
      action: String(action).slice(0, 64),
      subAction: subAction == null ? null : String(subAction).slice(0, 64),
      message: String(message).slice(0, 512),
      reason: reasonStr,
      createdByRole: user?.role != null ? String(user.role).slice(0, 32) : null,
    };
    if (meta !== undefined) {
      data.metadataJson = meta;
    }
    await client.activityLog.create({ data });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("[activityLog] write failed:", e?.message || e);
    }
  }
}

module.exports = { logActivity, sanitizeMetadata };
