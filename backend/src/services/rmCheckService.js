const { prisma } = require("../utils/prisma");
const { getItemStockQty, usableStockDisplayQty } = require("./stockService");
const { evaluateWoPrepareReadiness } = require("./materialPlanningService");
const {
  buildRegularSoPlanningSnapshotView,
  resolveSuggestedFgPlanningBufferPercentForSalesOrder,
} = require("./regularSoPlanningSnapshotService");

/**
 * FG gap lines for REGULAR SO work-order prep (order qty vs usable FG stock).
 * RM math is delegated to the material planning engine.
 */
async function computeFgGapLinesForSalesOrder(so, db = prisma) {
  const planning = await buildRegularSoPlanningSnapshotView(so.id, db);
  const planningByLineId = new Map((planning.lines || []).map((line) => [Number(line.lineId), line]));
  const fgLines = [];

  for (const line of so.lines) {
    const item = line.item;
    if (item.itemType !== "FG") {
      fgLines.push({
        lineId: line.id,
        fgItemId: line.itemId,
        fgName: item.itemName,
        customerCommittedQty: Number(line.customerPoQty ?? line.qty),
        orderQty: Number(line.customerPoQty ?? line.qty),
        fgStock: 0,
        toProduce: 0,
        note: "Not an FG item",
      });
      continue;
    }

    const snapshotLine = planningByLineId.get(Number(line.id)) ?? null;
    const fgStockRaw = snapshotLine ? Number(snapshotLine.fgStockAdjustmentQty ?? 0) : await getItemStockQty(line.itemId, db, { stockBucket: "USABLE" });
    const fgStock = usableStockDisplayQty(fgStockRaw);
    const customerCommittedQty = snapshotLine
      ? Number(snapshotLine.customerCommittedQty ?? line.customerPoQty ?? line.qty)
      : Number(line.customerPoQty ?? line.qty);
    const productionBufferPercent = snapshotLine ? Number(snapshotLine.productionBufferPercent ?? 0) : 0;
    const productionBufferQty = snapshotLine
      ? Number(snapshotLine.productionBufferQty ?? 0)
      : Math.ceil((customerCommittedQty * productionBufferPercent) / 100);
    const plannedProductionQty = snapshotLine
      ? Number(snapshotLine.plannedProductionQty ?? customerCommittedQty + productionBufferQty)
      : customerCommittedQty + productionBufferQty;
    const rmPlanningQty = plannedProductionQty;
    const toProduce = plannedProductionQty;

    fgLines.push({
      lineId: line.id,
      fgItemId: line.itemId,
      fgName: item.itemName,
      customerCommittedQty,
      orderQty: customerCommittedQty,
      productionBufferPercent,
      productionBufferQty,
      plannedProductionQty,
      fgStock,
      fgStockAdjustmentQty: fgStock,
      rmPlanningQty,
      toProduce,
    });
  }

  const allFgEnough = fgLines.filter((f) => !f.note).every((f) => Number(f.rmPlanningQty ?? f.toProduce ?? 0) === 0);
  return { fgLines, allFgEnough };
}

/**
 * REGULAR flow RM / material readiness for work-order prepare.
 * @param {number} soId
 * @param {{ planQtyByLineId?: Record<number, number>, planQtyByFgItemId?: Record<number, number> }} [opts]
 */
async function rmCheckForSalesOrder(soId, opts = {}, db = prisma) {
  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    include: { lines: { include: { item: true } } },
  });
  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }

  const { fgLines, allFgEnough } = await computeFgGapLinesForSalesOrder(so, db);
  const suggestedFgPlanningBufferPercent = await resolveSuggestedFgPlanningBufferPercentForSalesOrder(soId, db);
  const readiness = await evaluateWoPrepareReadiness(soId, {
    fgLines,
    planQtyByLineId: opts.planQtyByLineId,
    planQtyByFgItemId: opts.planQtyByFgItemId,
  }, db);

  const rmSummary = readiness.rmSummary.map((r) => ({
    rmItemId: r.rmItemId,
    itemName: r.itemName,
    unit: r.unit,
    requiredQty: r.requiredQty,
    availableQty: r.availableQty,
    shortage: r.shortageQty,
    shortageQty: r.shortageQty,
    status: r.status,
    enough: r.status === "AVAILABLE",
  }));

  return {
    fgLines,
    rmSummary,
    allRmEnough: readiness.materialReadiness.allRmAvailable,
    allFgEnough,
    materialReadiness: readiness.materialReadiness,
    canCreateWorkOrder: readiness.canCreateWorkOrder,
    woBlockReason: readiness.woBlockReason,
    pendingMaterialRequirements: readiness.pendingMaterialRequirements,
    fgSummary: readiness.fgSummary,
    suggestedFgPlanningBufferPercent,
  };
}

module.exports = { rmCheckForSalesOrder, computeFgGapLinesForSalesOrder };
