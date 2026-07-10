const { prisma } = require("../src/utils/prisma");

async function main() {
  const keys = Object.keys(prisma).filter((k) => !k.startsWith("_") && !k.startsWith("$"));
  console.log(keys.slice(0, 40).join(","));
  console.log("salesOrder", typeof prisma.salesOrder);
  console.log("carryForwardPending", typeof prisma.carryForwardPending);
  console.log("recoveryAllocation", typeof prisma.recoveryAllocation);
  console.log("noQtySoWaiver", typeof prisma.noQtySoWaiver);
  const n = await prisma.salesOrder.count();
  console.log("salesOrder.count", n);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
