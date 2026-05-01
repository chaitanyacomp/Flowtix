const dotenv = require("dotenv");

dotenv.config();

const { prisma } = require("../src/utils/prisma");

async function main() {
  const soId = 10;
  const rows = await prisma.activityLog.findMany({
    where: { module: "DISPATCH", metadataJson: { path: "$.salesOrderId", equals: soId } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, message: true, module: true, metadataJson: true },
  });
  // eslint-disable-next-line no-console
  console.log("ROWS_LEN", rows.length);
  // eslint-disable-next-line no-console
  console.log("ROWS", rows);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

