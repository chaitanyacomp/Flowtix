const bcrypt = require("bcryptjs");
const { prisma } = require("./prisma");

/** Default role accounts for first-time / packaged installs (create-if-missing only). */
const SEED_USERS = [
  { email: "admin@test.com", name: "Admin", role: "ADMIN" },
  { email: "store@test.com", name: "Store", role: "STORE" },
  { email: "purchase@test.com", name: "Purchase", role: "PURCHASE" },
  { email: "production@test.com", name: "Production", role: "PRODUCTION" },
  { email: "qa@test.com", name: "QA", role: "QA" },
];

const DEFAULT_PASSWORD = "123456";

/**
 * Ensures the five role seed accounts exist. Does not update existing users
 * (password / role / active remain as configured in the DB).
 */
async function ensureRoleSeedUsers() {
  try {
    let passwordHash = null;
    for (const seed of SEED_USERS) {
      const exists = await prisma.user.findUnique({
        where: { email: seed.email },
        select: { id: true },
      });
      if (exists) continue;
      if (!passwordHash) {
        passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
      }
      await prisma.user.create({
        data: {
          email: seed.email,
          name: seed.name,
          passwordHash,
          role: seed.role,
          isActive: true,
        },
      });
      // eslint-disable-next-line no-console
      console.log(`[auth] Seeded default user ${seed.email} (password: ${DEFAULT_PASSWORD})`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[auth] ensureRoleSeedUsers:", err?.message || err);
  }
}

module.exports = { ensureRoleSeedUsers, SEED_USERS };
