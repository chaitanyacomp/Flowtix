/**
 * Phase 2 — optional post-migration email normalization.
 *
 * Primary user/role migration runs in prisma migration:
 *   prisma/migrations/20260529180000_phase2_role_structure/migration.sql
 *
 * USAGE (after `npx prisma migrate deploy`):
 *   node backend/scripts/migratePhase2Roles.js
 */

const { PrismaClient } = require("../src/prismaClientPackage");

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  console.log(`Users (${users.length}):`);
  for (const u of users) {
    console.log(`  id=${u.id}  ${u.email}  role=${u.role}  active=${u.isActive ? "yes" : "no"}`);
  }
}

main()
  .catch((err) => {
    console.error("migratePhase2Roles failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
