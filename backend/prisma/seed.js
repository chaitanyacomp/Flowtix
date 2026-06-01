const bcrypt = require("bcryptjs");
const { PrismaClient } = require("./generated/client");
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
  await ensureIndiaStatesSeeded();
  await ensureDefaultUnitsSeeded();

  await upsertUser({ email: "admin@test.com", name: "Admin", role: "ADMIN", password: "123456" });
  await upsertUser({ email: "store@test.com", name: "Store", role: "STORE", password: "123456" });
  await upsertUser({ email: "purchase@test.com", name: "Purchase", role: "PURCHASE", password: "123456" });
  await upsertUser({ email: "production@test.com", name: "Production", role: "PRODUCTION", password: "123456" });
  await upsertUser({ email: "qa@test.com", name: "QA", role: "QA", password: "123456" });

  await backfillLegacyStateLinks();
  await backfillLegacyItemUnitLinks();

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
  console.log("Seed completed (Phase 2 roles: ADMIN, STORE, PURCHASE, PRODUCTION, QA).");
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
