const bcrypt = require("bcryptjs");

/**
 * Verifies the CURRENT authenticated admin user's password.
 * Throws a user-facing error with statusCode when invalid.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ userId: number; password: unknown }} input
 */
async function assertAdminPassword(db, input) {
  const userId = Number(input?.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    const err = new Error("Invalid admin password");
    err.statusCode = 401;
    throw err;
  }
  const password = String(input?.password ?? "");
  if (!password) {
    const err = new Error("Invalid admin password");
    err.statusCode = 401;
    throw err;
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, passwordHash: true },
  });
  if (!user || !user.isActive || user.role !== "ADMIN") {
    const err = new Error("Invalid admin password");
    err.statusCode = 401;
    throw err;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const err = new Error("Invalid admin password");
    err.statusCode = 401;
    throw err;
  }
}

/**
 * Verifies that the provided password matches ANY active admin account.
 * Returns the matched admin user id when ok.
 *
 * Use this when the actor is not necessarily ADMIN (e.g. STORE preparing sensitive action).
 * Do NOT log the password.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ password: unknown }} input
 */
async function assertAnyAdminPassword(db, input) {
  const password = String(input?.password ?? "");
  if (!password) {
    const err = new Error("Invalid admin password");
    err.statusCode = 401;
    throw err;
  }

  const admins = await db.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true, passwordHash: true },
  });
  for (const a of admins) {
    // bcrypt.compare is safe; do not log failures.
    // eslint-disable-next-line no-await-in-loop
    const ok = await bcrypt.compare(password, a.passwordHash);
    if (ok) return a.id;
  }

  const err = new Error("Invalid admin password");
  err.statusCode = 401;
  throw err;
}

module.exports = { assertAdminPassword, assertAnyAdminPassword };

