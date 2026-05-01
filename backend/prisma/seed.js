const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { ensureIndiaStatesSeeded, backfillLegacyStateLinks } = require("../src/services/stateMaster");
const { ensureDefaultUnitsSeeded, backfillLegacyItemUnitLinks } = require("../src/services/unitMaster");

const prisma = new PrismaClient();

async function upsertUser({ email, name, role, password }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash, isActive: true },
    create: { email, name, role, passwordHash, isActive: true },
  });
}

async function main() {
  // Seed State master first (used by GST/state dropdowns).
  await ensureIndiaStatesSeeded();
  // Seed Units master (used by Items dropdown).
  await ensureDefaultUnitsSeeded();

  await upsertUser({ email: "admin@test.com", name: "Admin", role: "ADMIN", password: "123456" });
  await upsertUser({ email: "sales@test.com", name: "Sales", role: "SALES", password: "123456" });
  await upsertUser({ email: "store@test.com", name: "Store", role: "STORE", password: "123456" });
  await upsertUser({ email: "production@test.com", name: "Production", role: "PRODUCTION", password: "123456" });
  await upsertUser({ email: "qc@test.com", name: "QC", role: "QC", password: "123456" });
  await upsertUser({ email: "supervisor@test.com", name: "Supervisor", role: "SUPERVISOR", password: "123456" });

  // Best-effort backfill for legacy free-text states → stateId.
  await backfillLegacyStateLinks();
  // Best-effort backfill for legacy Item.unit → unitId.
  await backfillLegacyItemUnitLinks();

  // Ensure singleton AppSetting exists with a usable company state (Maharashtra).
  const mh = await prisma.state.findUnique({ where: { stateCode: "27" }, select: { id: true, stateName: true } });
  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: {
      companyState: mh?.stateName ?? "Maharashtra",
      companyStateId: mh?.id ?? null,
    },
    create: {
      id: 1,
      companyState: mh?.stateName ?? "Maharashtra",
      companyStateId: mh?.id ?? null,
    },
  });

  // eslint-disable-next-line no-console
  console.log("Seed completed (users, states, units, app settings). Create customers, items, BOMs in the app.");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
