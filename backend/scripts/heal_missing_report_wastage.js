/**
 * One-time heal: post missing RM_WASTAGE for confirmed Production Report lines
 * where scrapWasteQty remains as PRODUCTION USABLE (e.g. HDPE WO-26-0001 / NO_QTY).
 *
 * Usage: node scripts/heal_missing_report_wastage.js [--dry-run] [--work-order-id=463]
 */
const { prisma } = require("../src/utils/prisma");
const { createMaterialWastageNote } = require("../src/services/materialWastageService");
const { resolveSuggestedRmReturnLocations } = require("../src/services/materialReturnService");
const { qtyToNumber } = require("../src/services/rmPurchaseHelpers");
const { round3 } = require("../src/services/bomExplosionService");

const EPS = 1e-6;
const dryRun = process.argv.includes("--dry-run");
const woArg = process.argv.find((a) => a.startsWith("--work-order-id="));
const onlyWoId = woArg ? Number(woArg.split("=")[1]) : null;

function n(v) {
  return qtyToNumber(v);
}

(async () => {
  const reports = await prisma.productionWorkOrderReport.findMany({
    where: {
      status: "CONFIRMED",
      ...(onlyWoId ? { workOrderId: onlyWoId } : {}),
    },
    include: {
      lines: true,
      returnPendings: { select: { itemId: true, status: true } },
    },
  });

  let posted = 0;
  let skipped = 0;
  for (const report of reports) {
    const openReturnItems = new Set(
      (report.returnPendings || [])
        .filter((p) => p.status === "PENDING")
        .map((p) => p.itemId),
    );
    for (const line of report.lines || []) {
      const scrapQty = round3(n(line.scrapWasteQty));
      if (scrapQty <= EPS) continue;
      if (openReturnItems.has(line.itemId)) {
        console.log(`skip WO ${report.workOrderId} item ${line.itemId}: open return pending`);
        skipped += 1;
        continue;
      }
      const existing = await prisma.materialWastageNote.findFirst({
        where: { workOrderId: report.workOrderId, itemId: line.itemId },
        select: { id: true, docNo: true, qty: true },
      });
      if (existing) {
        console.log(`skip WO ${report.workOrderId} item ${line.itemId}: MWN ${existing.docNo} already exists`);
        skipped += 1;
        continue;
      }
      const locs = await resolveSuggestedRmReturnLocations(prisma, {
        workOrderId: report.workOrderId,
        itemId: line.itemId,
      });
      const fromLocationId = locs?.suggestedFromLocationId;
      if (!fromLocationId) {
        console.log(`skip WO ${report.workOrderId} item ${line.itemId}: no production location`);
        skipped += 1;
        continue;
      }
      console.log(
        `${dryRun ? "DRY " : ""}post wastage WO ${report.workOrderId} item ${line.itemId} qty ${scrapQty} fromLoc ${fromLocationId}`,
      );
      if (!dryRun) {
        const note = await createMaterialWastageNote(
          {
            workOrderId: report.workOrderId,
            fromLocationId,
            itemId: line.itemId,
            qty: scrapQty,
            reason: "PROCESS_LOSS",
            remarks: `Heal: finalized Production Report wastage not previously posted to stock.`,
          },
          {},
        );
        console.log(`  -> ${note.docNo}`);
        posted += 1;
      }
    }
  }
  console.log({ dryRun, posted, skipped });
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch (_) {}
  process.exit(1);
});
