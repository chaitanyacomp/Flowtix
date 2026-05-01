const { prisma } = require("../utils/prisma");
const { getItemStockQty, usableStockDisplayQty } = require("./stockService");
const { effectiveQtyPerUnit } = require("./bomUtils");

/**
 * RM requirements for fulfilling SO FG lines (manufacturing gap = orderQty - current FG stock).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function rmCheckForSalesOrder(soId, db = prisma) {
  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    include: { lines: { include: { item: true } } },
  });
  if (!so) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }

  const fgLines = [];
  const rmNeeded = new Map();

  for (const line of so.lines) {
    const item = line.item;
    if (item.itemType !== "FG") {
      fgLines.push({
        lineId: line.id,
        fgItemId: line.itemId,
        fgName: item.itemName,
        orderQty: Number(line.qty),
        fgStock: 0,
        toProduce: 0,
        note: "Not an FG item",
      });
      continue;
    }

    // Source of truth: usable stock balance only (same as Stock Overview / summary-buckets USABLE).
    // Full ledger includes offsets from reversals; never treat negative ledger as available cover.
    const fgStockRaw = await getItemStockQty(line.itemId, db, { stockBucket: "USABLE" });
    const fgStock = usableStockDisplayQty(fgStockRaw);
    const orderQty = Number(line.qty);
    const toProduce = Math.max(0, orderQty - fgStock);

    fgLines.push({
      lineId: line.id,
      fgItemId: line.itemId,
      fgName: item.itemName,
      orderQty,
      fgStock,
      toProduce,
    });

    if (toProduce <= 0) continue;

    const bom = await db.bom.findUnique({
      where: { fgItemId: line.itemId },
      include: { lines: true },
    });
    if (!bom) continue;

    for (const bl of bom.lines) {
      const eff = effectiveQtyPerUnit(bl.baseQty, bl.wastagePercent);
      const rmQty = eff * toProduce;
      rmNeeded.set(bl.rmItemId, (rmNeeded.get(bl.rmItemId) || 0) + rmQty);
    }
  }

  const rmIds = [...rmNeeded.keys()];
  const rmItems = rmIds.length ? await db.item.findMany({ where: { id: { in: rmIds } } }) : [];

  const rmSummary = [];
  for (const [rmItemId, requiredQty] of rmNeeded) {
    const availableRaw = await getItemStockQty(rmItemId, db, { stockBucket: "USABLE" });
    const availableQty = usableStockDisplayQty(availableRaw);
    const shortage = Math.max(0, requiredQty - availableQty);
    rmSummary.push({
      rmItemId,
      itemName: rmItems.find((i) => i.id === rmItemId)?.itemName ?? `#${rmItemId}`,
      requiredQty: Math.round(requiredQty * 1000) / 1000,
      availableQty,
      shortage: Math.round(shortage * 1000) / 1000,
      enough: availableQty + 1e-6 >= requiredQty,
    });
  }

  const allRmEnough = rmSummary.length === 0 || rmSummary.every((r) => r.enough);
  const allFgEnough = fgLines.filter((f) => !f.note).every((f) => f.toProduce === 0);

  return { fgLines, rmSummary, allRmEnough, allFgEnough };
}

module.exports = { rmCheckForSalesOrder };
