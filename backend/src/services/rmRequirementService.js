/**
 * RM shortage rows for purchase planning — same WO+BOM demand as RM risk, but **usable** bucket only.
 */

const { prisma } = require("../utils/prisma");
const { effectiveQtyPerUnit } = require("./bomUtils");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { getWoLineRemainingProductionQty } = require("./reportMetrics");
const { getUsableItemStockQty } = require("./stockService");

const QUEUE_EPS = 1e-6;

/**
 * @returns {Promise<{ itemId: number; itemName: string; requiredQty: number; usableQty: number; shortage: number; suggested: number }[]>}
 */
async function getRmRequirementShortagesUsable() {
  const workOrders = await prisma.workOrder.findMany({
    where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      lines: { include: { fgItem: true }, orderBy: { id: "asc" } },
    },
  });

  const lineIds = workOrders.flatMap((w) => w.lines.map((l) => l.id));
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(prisma, lineIds);

  const boms = await prisma.bom.findMany({
    include: { lines: true },
  });
  const bomByFgId = new Map(boms.map((b) => [b.fgItemId, b]));

  const rmNeeded = new Map();
  for (const wo of workOrders) {
    for (const line of wo.lines) {
      const requiredQty = Number(line.qty);
      const approvedProduced = producedByLineId.get(line.id) ?? 0;
      const balance = getWoLineRemainingProductionQty(requiredQty, approvedProduced);
      if (balance <= QUEUE_EPS) continue;
      const bom = bomByFgId.get(line.fgItemId);
      if (!bom) continue;
      for (const bl of bom.lines) {
        const perUnit = effectiveQtyPerUnit(bl.baseQty, bl.wastagePercent);
        const add = perUnit * balance;
        rmNeeded.set(bl.rmItemId, (rmNeeded.get(bl.rmItemId) || 0) + add);
      }
    }
  }

  const rmIds = [...rmNeeded.keys()];
  if (rmIds.length === 0) return [];

  const rmItems = await prisma.item.findMany({
    where: { id: { in: rmIds }, itemType: "RM" },
  });
  const rmItemById = new Map(rmItems.map((i) => [i.id, i]));

  const rows = [];
  for (const rmId of rmIds) {
    const item = rmItemById.get(rmId);
    if (!item) continue;
    const requiredQty = rmNeeded.get(rmId) ?? 0;
    const usableQty = await getUsableItemStockQty(rmId, prisma);
    const shortage = Math.max(0, requiredQty - usableQty);
    if (shortage <= QUEUE_EPS) continue;
    rows.push({
      itemId: rmId,
      itemName: item.itemName,
      requiredQty: Math.round(requiredQty * 1000) / 1000,
      usableQty: Math.round(usableQty * 1000) / 1000,
      shortage: Math.round(shortage * 1000) / 1000,
      suggested: Math.round(shortage * 1000) / 1000,
    });
  }

  rows.sort((a, b) => b.shortage - a.shortage);
  return rows;
}

module.exports = { getRmRequirementShortagesUsable };
