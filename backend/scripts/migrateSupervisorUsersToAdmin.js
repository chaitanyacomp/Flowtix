/**
 * One-shot data migration: convert any existing User rows with role = SUPERVISOR
 * into role = ADMIN.
 *
 * Phase 1 of the workflow ownership cleanup retires the SUPERVISOR role from the
 * application (frontend + backend `requireRole` arrays). Existing SUPERVISOR users
 * would otherwise be locked out of every protected route.
 *
 * The Prisma `UserRole` enum is intentionally NOT modified in this phase, so the
 * legacy value can still exist in the database — but no user should hold it after
 * running this script.
 *
 * USAGE:
 *   node backend/scripts/migrateSupervisorUsersToAdmin.js          # dry-run by default
 *   node backend/scripts/migrateSupervisorUsersToAdmin.js --apply  # perform the update
 *
 * The script is idempotent: re-running it after `--apply` reports zero affected rows.
 */

const { PrismaClient } = require("../src/prismaClientPackage");

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  const candidates = await prisma.user.findMany({
    where: { role: "SUPERVISOR" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { id: "asc" },
  });

  if (candidates.length === 0) {
    console.log("No users with role=SUPERVISOR found. Nothing to migrate.");
    return;
  }

  console.log(`Found ${candidates.length} SUPERVISOR user(s):`);
  for (const u of candidates) {
    console.log(`  - id=${u.id}  email=${u.email}  name=${u.name ?? "—"}`);
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to convert SUPERVISOR → ADMIN.");
    return;
  }

  const result = await prisma.user.updateMany({
    where: { role: "SUPERVISOR" },
    data: { role: "ADMIN" },
  });
  console.log(`\nUpdated ${result.count} user(s): SUPERVISOR → ADMIN.`);
}

main()
  .catch((err) => {
    console.error("migrateSupervisorUsersToAdmin failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
