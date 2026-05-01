const bcrypt = require("bcryptjs");
const { prisma } = require("./prisma");

/** If no admin@test.com exists, create one so first-time setups can log in after migrate. */
async function ensureDefaultAdmin() {
  const email = "admin@test.com";
  try {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return;
    const passwordHash = await bcrypt.hash("123456", 10);
    await prisma.user.create({
      data: {
        email,
        name: "Admin",
        passwordHash,
        role: "ADMIN",
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log("[auth] Seeded default user admin@test.com (password: 123456)");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[auth] ensureDefaultAdmin:", err?.message || err);
  }
}

module.exports = { ensureDefaultAdmin };
