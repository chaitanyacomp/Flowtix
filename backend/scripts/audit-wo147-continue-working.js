/**
 * One-off: loads DB via Prisma and runs getContinueWorkingRows with DASHBOARD_AUDIT_WO147=1
 * so filter/queue audit lines print to stdout; mirrors /api/dashboard/continue-working audit payload.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

process.env.DASHBOARD_AUDIT_WO147 = "1";

const { prisma } = require("../src/utils/prisma");
const {
  getContinueWorkingRows,
  logAuditWo147ContinueWorkingRows,
} = require("../src/services/dashboardQueueSnapshots");

(async () => {
  const rows = await getContinueWorkingRows({ limit: 100 });
  logAuditWo147ContinueWorkingRows(rows);
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch (_) {
    // ignore
  }
  process.exit(1);
});
