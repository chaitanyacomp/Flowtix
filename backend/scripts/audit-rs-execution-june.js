require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { prisma } = require("../src/utils/prisma");
const { getRequirementSheetExecutionSummary } = require("../src/services/requirementSheetExecutionService");

(async () => {
  const sheets = await prisma.requirementSheet.findMany({
    where: { periodKey: "2026-06", status: "LOCKED", salesOrder: { orderType: "NO_QTY" } },
    include: {
      salesOrder: { select: { id: true, docNo: true, currentCycleId: true } },
      lines: { include: { item: { select: { itemName: true } } } },
    },
    orderBy: { id: "asc" },
  });
  console.log("June LOCKED NO_QTY sheets:", sheets.length);
  for (const s of sheets) {
    console.log("\n=== RS", s.docNo, "id=", s.id, "SO=", s.salesOrder?.docNo, "soId=", s.salesOrderId, "cycle=", s.salesOrder?.currentCycleId);
    const summary = await getRequirementSheetExecutionSummary(prisma, s.id);
    const out = {
      readiness: summary.readiness,
      totals: summary.totals,
      procurement: summary.procurement,
      procurementProgress: summary.procurementProgress,
      rmReadinessSummary: summary.rmReadiness.summary,
      rmReadinessLines: summary.rmReadiness.lines,
      placement: {
        status: summary.placement.status,
        reason: summary.placement.reason,
        canPlace: summary.placement.canPlace,
        summary: summary.placement.summary,
        lines: summary.placement.lines.map((l) => ({
          itemName: l.itemName,
          rsDemandQty: l.rsDemandQty,
          woPlacedQty: l.woPlacedQty,
          rsBalanceQty: l.rsBalanceQty,
          suggestedExecutableQty: l.suggestedExecutableQty,
          status: l.status,
          reason: l.reason,
        })),
      },
      existingWoCount: summary.existingWoSummary.length,
      existingWoSummary: summary.existingWoSummary,
      workOrders: summary.workOrders,
    };
    console.log(JSON.stringify(out, null, 2));
  }

  const pp = await prisma.item.findFirst({ where: { itemName: { contains: "PP" } }, select: { id: true, itemName: true } });
  if (pp) {
    const stock = await prisma.stockSummary.findFirst({ where: { itemId: pp.id } });
    console.log("\nPP stock summary:", pp, stock ? { freeQty: String(stock.freeQty), reservedQty: String(stock.reservedQty) } : "none");
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
