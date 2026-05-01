const { prisma } = require("../utils/prisma");
const { usableStockDisplayQty } = require("./stockService");

const DEFAULT_CRITICAL_COVERAGE_PERCENT = 50;
const DEFAULT_WARNING_COVERAGE_PERCENT = 80;

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round2(v) {
  return Math.round(n(v) * 100) / 100;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

/**
 * Simple production planning dashboard (factory-friendly):
 * - Requirement: latest active NO_QTY Requirement Sheets (FG only), summed per FG item
 * - Stock: usable stock (USABLE bucket, reversedAt null)
 * - Gap%: stock / requirement * 100
 * - Suggested WO: max(0, requirement - stock)
 * - Status: RED (<50% coverage), YELLOW (<80%), GREEN otherwise
 */
async function getProductionPlanningDashboard() {
  const stockRows = await prisma.stockTransaction.groupBy({
    by: ["itemId"],
    // Stock math must include reversed originals; reversal rows offset them.
    where: { stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const stockByItemId = new Map(stockRows.map((r) => [r.itemId, n(r._sum.qtyIn) - n(r._sum.qtyOut)]));

  // Same sheet selection semantics as existing planning dashboard: NO_QTY only, active cycle only, latest version per key.
  const sheets = await prisma.requirementSheet.findMany({
    where: {
      salesOrder: { orderType: "NO_QTY", internalStatus: { not: "COMPLETED" } },
    },
    include: {
      salesOrder: { include: { currentCycle: { select: { id: true, status: true } } } },
      lines: { include: { item: true } },
    },
  });

  const latestByKey = new Map();
  for (const s of sheets) {
    const so = s.salesOrder;
    const activeCycleId = so?.currentCycleId != null ? Number(so.currentCycleId) : null;
    const sheetCycleId = s.cycleId != null ? Number(s.cycleId) : null;
    const cycleOk = activeCycleId && sheetCycleId && activeCycleId === sheetCycleId && so?.currentCycle?.status === "ACTIVE";
    if (!cycleOk) continue;
    const key = `${s.salesOrderId}:${sheetCycleId}:${s.periodKey ?? ""}`;
    const prev = latestByKey.get(key);
    if (!prev || n(s.version) > n(prev.version)) latestByKey.set(key, s);
  }

  const reqByItemId = new Map();
  const itemMetaByItemId = new Map(); // itemId -> { name, criticalPct, warningPct }
  for (const s of latestByKey.values()) {
    for (const l of s.lines || []) {
      if (!l.item || l.item.itemType !== "FG") continue;
      const req = n(l.requirementQty);
      if (!(req > 0)) continue;
      reqByItemId.set(l.itemId, (reqByItemId.get(l.itemId) || 0) + req);
      if (!itemMetaByItemId.has(l.itemId)) {
        itemMetaByItemId.set(l.itemId, {
          itemName: l.item.itemName,
          criticalPercent:
            l.item.redThresholdPercent == null ? DEFAULT_CRITICAL_COVERAGE_PERCENT : n(l.item.redThresholdPercent),
          warningPercent:
            l.item.yellowThresholdPercent == null ? DEFAULT_WARNING_COVERAGE_PERCENT : n(l.item.yellowThresholdPercent),
        });
      }
    }
  }

  /** @type {Array<{ itemId: number, itemName: string, requirementQty: number, stockQty: number, gapPercent: number, suggestedWoQty: number, status: "RED"|"YELLOW"|"GREEN" }>} */
  const items = [];
  let criticalCount = 0;
  let lowCount = 0;
  let healthyCount = 0;

  for (const [itemId, req0] of reqByItemId.entries()) {
    const requirementQty = round3(req0);
    if (!(requirementQty > 0)) continue;
    const stockQty = round3(usableStockDisplayQty(stockByItemId.get(itemId) ?? 0));
    const gapPercent = round2((stockQty / requirementQty) * 100);
    const suggestedWoQty = round3(Math.max(0, requirementQty - stockQty));

    const meta = itemMetaByItemId.get(itemId);
    const criticalPercent = meta?.criticalPercent ?? DEFAULT_CRITICAL_COVERAGE_PERCENT;
    const warningPercent = meta?.warningPercent ?? DEFAULT_WARNING_COVERAGE_PERCENT;

    let status = "GREEN";
    if (gapPercent < criticalPercent) status = "RED";
    else if (gapPercent < warningPercent) status = "YELLOW";

    if (status === "RED") criticalCount += 1;
    else if (status === "YELLOW") lowCount += 1;
    else healthyCount += 1;

    items.push({
      itemId,
      itemName: meta?.itemName ?? `Item #${itemId}`,
      requirementQty,
      stockQty,
      gapPercent,
      suggestedWoQty,
      status,
    });
  }

  items.sort((a, b) => {
    const r = (x) => (x === "RED" ? 1 : x === "YELLOW" ? 2 : 3);
    const zr = r(a.status) - r(b.status);
    if (zr !== 0) return zr;
    return (b.suggestedWoQty ?? 0) - (a.suggestedWoQty ?? 0);
  });

  return {
    items,
    summary: { criticalCount, lowCount, healthyCount },
  };
}

module.exports = { getProductionPlanningDashboard };

