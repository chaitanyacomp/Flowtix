const bcrypt = require("bcryptjs");
const { prisma: defaultPrisma } = require("../utils/prisma");
const auditLog = require("./auditLog");

const USER_ROLES = ["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "PRODUCTION_MANAGER", "QA"];
const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

function httpError(message, statusCode = 400, code = "BAD_REQUEST") {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Count active ADMIN users, optionally excluding one user id.
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} [excludeUserId]
 */
async function countActiveAdmins(db, excludeUserId) {
  return db.user.count({
    where: {
      role: "ADMIN",
      isActive: true,
      ...(excludeUserId != null ? { id: { not: excludeUserId } } : {}),
    },
  });
}

/**
 * Guards for PATCH / deactivate / demote — exported for unit tests.
 * @param {{
 *   actorUserId: number,
 *   target: { id: number, role: string, isActive: boolean },
 *   patch: { role?: string, isActive?: boolean },
 *   otherActiveAdminCount: number,
 * }} args
 */
function assertUserUpdateGuards({ actorUserId, target, patch, otherActiveAdminCount }) {
  const nextRole = patch.role !== undefined ? patch.role : target.role;
  const nextActive = patch.isActive !== undefined ? patch.isActive : target.isActive;
  const isSelf = Number(actorUserId) === Number(target.id);

  if (isSelf && patch.isActive === false) {
    throw httpError("You cannot deactivate your own account.", 400, "CANNOT_DEACTIVATE_SELF");
  }

  const targetIsActiveAdmin = target.role === "ADMIN" && target.isActive;
  const wouldLoseActiveAdmin =
    targetIsActiveAdmin && (nextRole !== "ADMIN" || nextActive === false);

  if (wouldLoseActiveAdmin && otherActiveAdminCount < 1) {
    throw httpError(
      "Cannot demote or deactivate the last active administrator.",
      400,
      "LAST_ACTIVE_ADMIN",
    );
  }
}

/**
 * Guards for password reset — exported for unit tests.
 * @param {{ actorUserId: number, targetUserId: number }} args
 */
function assertPasswordResetGuards({ actorUserId, targetUserId }) {
  if (Number(actorUserId) === Number(targetUserId)) {
    throw httpError(
      "You cannot reset your own password here. Ask another administrator.",
      400,
      "CANNOT_RESET_OWN_PASSWORD",
    );
  }
}

/**
 * @param {object} [opts]
 * @param {typeof defaultPrisma} [opts.prisma]
 */
function createAdminUserService(opts = {}) {
  const db = opts.prisma || defaultPrisma;

  async function listUsers({ q, role, active } = {}) {
    const where = {};
    if (role) {
      if (!USER_ROLES.includes(role)) {
        throw httpError("Invalid role filter.", 400, "INVALID_ROLE");
      }
      where.role = role;
    }
    if (active === true || active === false) {
      where.isActive = active;
    }
    const query = typeof q === "string" ? q.trim() : "";
    if (query) {
      where.OR = [
        { email: { contains: query } },
        { name: { contains: query } },
      ];
    }

    const rows = await db.user.findMany({
      where,
      select: USER_PUBLIC_SELECT,
      orderBy: [{ role: "asc" }, { name: "asc" }, { id: "asc" }],
      take: 500,
    });
    return rows.map(toPublicUser);
  }

  /**
   * @param {{
   *   email: string,
   *   name: string,
   *   role: string,
   *   password: string,
   *   isActive?: boolean,
   *   actorUserId: number,
   *   actorRole: string,
   *   ipAddress?: string,
   *   userAgent?: string,
   * }} input
   */
  async function createUser(input) {
    const email = String(input.email || "").trim().toLowerCase();
    const name = String(input.name || "").trim();
    const role = String(input.role || "").trim().toUpperCase();
    const password = String(input.password || "");
    const isActive = input.isActive === undefined ? true : Boolean(input.isActive);

    if (!email) throw httpError("Email is required.", 400, "VALIDATION");
    if (!name) throw httpError("Name is required.", 400, "VALIDATION");
    if (!USER_ROLES.includes(role)) throw httpError("Invalid role.", 400, "INVALID_ROLE");
    if (password.length < 6) {
      throw httpError("Password must be at least 6 characters.", 400, "VALIDATION");
    }

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw httpError("A user with this email already exists.", 409, "DUPLICATE_EMAIL");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const created = await db.$transaction(async (tx) => {
      const row = await tx.user.create({
        data: { email, name, role, passwordHash, isActive },
        select: USER_PUBLIC_SELECT,
      });
      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.USER,
        entityId: String(row.id),
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        summary: `Created user ${row.email} (${row.role})`,
        payload: { email: row.email, role: row.role, isActive: row.isActive },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      return row;
    });

    return toPublicUser(created);
  }

  /**
   * @param {{
   *   userId: number,
   *   patch: { name?: string, role?: string, isActive?: boolean },
   *   actorUserId: number,
   *   actorRole: string,
   *   ipAddress?: string,
   *   userAgent?: string,
   * }} input
   */
  async function updateUser(input) {
    const userId = Number(input.userId);
    if (!Number.isInteger(userId) || userId < 1) {
      throw httpError("Invalid user id.", 400, "INVALID_ID");
    }

    const patch = {};
    if (input.patch.name !== undefined) {
      const name = String(input.patch.name).trim();
      if (!name) throw httpError("Name cannot be empty.", 400, "VALIDATION");
      patch.name = name;
    }
    if (input.patch.role !== undefined) {
      const role = String(input.patch.role).trim().toUpperCase();
      if (!USER_ROLES.includes(role)) throw httpError("Invalid role.", 400, "INVALID_ROLE");
      patch.role = role;
    }
    if (input.patch.isActive !== undefined) {
      patch.isActive = Boolean(input.patch.isActive);
    }

    if (Object.keys(patch).length === 0) {
      throw httpError("No changes provided.", 400, "VALIDATION");
    }

    const updated = await db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      });
      if (!target) throw httpError("User not found.", 404, "NOT_FOUND");

      const otherActiveAdminCount = await countActiveAdmins(tx, target.id);
      assertUserUpdateGuards({
        actorUserId: input.actorUserId,
        target,
        patch,
        otherActiveAdminCount,
      });

      const row = await tx.user.update({
        where: { id: userId },
        data: patch,
        select: USER_PUBLIC_SELECT,
      });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.USER,
        entityId: String(row.id),
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        summary: `Updated user ${row.email}`,
        payload: {
          before: { name: target.name, role: target.role, isActive: target.isActive },
          after: { name: row.name, role: row.role, isActive: row.isActive },
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return row;
    });

    return toPublicUser(updated);
  }

  /**
   * @param {{
   *   userId: number,
   *   password: string,
   *   actorUserId: number,
   *   actorRole: string,
   *   ipAddress?: string,
   *   userAgent?: string,
   * }} input
   */
  async function resetPassword(input) {
    const userId = Number(input.userId);
    if (!Number.isInteger(userId) || userId < 1) {
      throw httpError("Invalid user id.", 400, "INVALID_ID");
    }
    const password = String(input.password || "");
    if (password.length < 6) {
      throw httpError("Password must be at least 6 characters.", 400, "VALIDATION");
    }

    assertPasswordResetGuards({
      actorUserId: input.actorUserId,
      targetUserId: userId,
    });

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      if (!target) throw httpError("User not found.", 404, "NOT_FOUND");

      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
        select: { id: true },
      });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.USER,
        entityId: String(target.id),
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        summary: `Reset password for user ${target.email}`,
        payload: { passwordReset: true },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return { id: target.id, email: target.email };
    });

    return { success: true, id: result.id, email: result.email };
  }

  return {
    listUsers,
    createUser,
    updateUser,
    resetPassword,
  };
}

const defaultService = createAdminUserService();

module.exports = {
  USER_ROLES,
  USER_PUBLIC_SELECT,
  toPublicUser,
  countActiveAdmins,
  assertUserUpdateGuards,
  assertPasswordResetGuards,
  createAdminUserService,
  listUsers: defaultService.listUsers,
  createUser: defaultService.createUser,
  updateUser: defaultService.updateUser,
  resetPassword: defaultService.resetPassword,
};
