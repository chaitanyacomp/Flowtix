const { AuditAction, AuditEntityType, UserRole } = require("../prismaClientPackage");

const ALLOWED_ACTIONS = new Set(Object.values(AuditAction));
const ALLOWED_ENTITY_TYPES = new Set(Object.values(AuditEntityType));
const ALLOWED_USER_ROLES = new Set(Object.values(UserRole));

const SUMMARY_MAX = 512;
const REASON_MAX = 512;
const ENTITY_ID_MAX = 64;
const ACTOR_ROLE_MAX = 32;

/**
 * @typedef {object} AuditWriteInput
 * @property {keyof typeof AuditAction} action
 * @property {keyof typeof AuditEntityType} entityType
 * @property {string} [entityId] Required unless entityType is USER_SESSION.
 * @property {number} [actorUserId]
 * @property {string} [actorRole] Normalized to trimmed uppercase; optional.
 * @property {string} summary Non-empty after trim (all business/session rows).
 * @property {object|null} [payload] Optional JSON; omit or pass `null` for no structured detail.
 * @property {string} [reason]
 * @property {string} [ipAddress]
 * @property {string} [userAgent]
 */

/**
 * @param {unknown} tx
 */
function assertTransactionClient(tx) {
  if (!tx || typeof tx.auditLog?.create !== "function") {
    throw new Error("auditLog.write: transaction client must support auditLog.create (use prisma or $transaction callback client)");
  }
}

/**
 * @param {string|undefined|null} role
 * @returns {string|null}
 */
function normalizeActorRole(role) {
  if (role === undefined || role === null) return null;
  const s = String(role).trim().toUpperCase();
  if (s === "") return null;
  if (s.length > ACTOR_ROLE_MAX) {
    throw new Error(`auditLog.write: actorRole exceeds ${ACTOR_ROLE_MAX} characters after trim`);
  }
  if (!ALLOWED_USER_ROLES.has(s)) {
    throw new Error("auditLog.write: actorRole must be a known UserRole");
  }
  return s;
}

/**
 * Minimal validation — throws Error with a short message so callers can map to 400/500.
 * @param {AuditWriteInput} input
 */
function validateInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("auditLog.write: input must be an object");
  }

  const { action, entityType, entityId, summary, payload, reason, ipAddress, userAgent } = input;

  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error(`auditLog.write: invalid action`);
  }
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    throw new Error(`auditLog.write: invalid entityType`);
  }

  if (entityType !== AuditEntityType.USER_SESSION) {
    if (entityId === undefined || entityId === null || String(entityId).trim() === "") {
      throw new Error("auditLog.write: entityId is required for this entityType");
    }
    if (String(entityId).length > ENTITY_ID_MAX) {
      throw new Error(`auditLog.write: entityId exceeds ${ENTITY_ID_MAX} characters`);
    }
  }

  if (typeof summary !== "string") {
    throw new Error("auditLog.write: summary is required");
  }
  const summaryTrimmed = summary.trim();
  if (summaryTrimmed === "") {
    throw new Error("auditLog.write: summary is required");
  }
  if (summaryTrimmed.length > SUMMARY_MAX) {
    throw new Error(`auditLog.write: summary exceeds ${SUMMARY_MAX} characters`);
  }

  if (payload !== undefined && payload !== null && typeof payload !== "object") {
    throw new Error("auditLog.write: payload must be a plain object, null, or omitted");
  }

  if (reason !== undefined && reason !== null) {
    if (typeof reason !== "string" || reason.length > REASON_MAX) {
      throw new Error(`auditLog.write: reason must be a string up to ${REASON_MAX} characters`);
    }
  }

  normalizeActorRole(input.actorRole);

  if (ipAddress !== undefined && ipAddress !== null && typeof ipAddress !== "string") {
    throw new Error("auditLog.write: ipAddress must be a string when provided");
  }
  if (userAgent !== undefined && userAgent !== null && typeof userAgent !== "string") {
    throw new Error("auditLog.write: userAgent must be a string when provided");
  }

  const { actorUserId } = input;
  if (actorUserId !== undefined && actorUserId !== null) {
    if (typeof actorUserId !== "number" || !Number.isInteger(actorUserId) || actorUserId < 1) {
      throw new Error("auditLog.write: actorUserId must be a positive integer when provided");
    }
  }
}

/**
 * Insert one audit row. Pass the same Prisma transaction client used for the business write
 * so the audit commits or rolls back with it.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} tx
 * @param {AuditWriteInput} input
 * @returns {Promise<{ id: number }>}
 */
async function write(tx, input) {
  assertTransactionClient(tx);
  validateInput(input);

  const entityType = input.entityType;
  const entityId =
    entityType === AuditEntityType.USER_SESSION ? input.entityId ?? null : String(input.entityId).trim();

  const summaryTrimmed = input.summary.trim();

  /** @type {import("@prisma/client").Prisma.JsonValue | undefined} */
  let payloadValue;
  if (input.payload === undefined) {
    payloadValue = undefined;
  } else if (input.payload === null) {
    payloadValue = null;
  } else {
    payloadValue = input.payload;
  }

  const row = await tx.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId,
      actorUserId: input.actorUserId ?? null,
      actorRole: normalizeActorRole(input.actorRole),
      summary: summaryTrimmed,
      ...(payloadValue === undefined ? {} : { payload: payloadValue }),
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    select: { id: true },
  });

  return row;
}

module.exports = {
  write,
  validateInput,
  normalizeActorRole,
  assertTransactionClient,
  AuditAction,
  AuditEntityType,
  ALLOWED_ACTIONS,
  ALLOWED_ENTITY_TYPES,
};
