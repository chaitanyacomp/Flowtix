const { prisma } = require("../utils/prisma");
const { usableStockDisplayQty } = require("./stockService");
const {
  classifyPlanningZone,
  resolveOrderWiseBoundariesFromLegacyDbFields,
  resolveProductWiseBoundariesFromItem,
} = require("./planningThresholds");

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

function zoneRank(z) {
  if (z === "RED") return 1;
  if (z === "YELLOW") return 2;
  if (z === "GREEN") return 3;
  if (z === "EXCESS") return 4;
  return 9;
}

function computeGapPercent(req, stock) {
  const r = n(req);
  if (!(r > 0)) return null;
  return round2(((r - n(stock)) / r) * 100);
}

function computeSuggestedWo(req, stock) {
  const sug = n(req) - n(stock);
  return sug > 0 ? round3(sug) : 0;
}

/**
 * Keep the same semantics as Requirement Sheet UI:
 * - Only NO_QTY sales orders
 * - Latest version per (SO + periodKey)
 * - Ignore requirementQty = 0
 * - Suggested WO never negative; excess -> suggested 0 and zone EXCESS
 *
 * This service computes stock/gap/suggested live from current stock ledger,
 * using latest-sheet requirement quantities as the demand signal.
 */
async function getPlanningDashboard() {
  const stockRows = await prisma.stockTransaction.groupBy({
    by: ["itemId"],
    // Stock math must include reversed originals; reversal rows offset them.
    where: { stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const stockByItemId = new Map(
    stockRows.map((r) => [r.itemId, n(r._sum.qtyIn) - n(r._sum.qtyOut)]),
  );

  // NO_QTY only; active cycle only (currentCycleId) and not closed SO.
  const sheets = await prisma.requirementSheet.findMany({
    where: {
      salesOrder: { orderType: "NO_QTY", internalStatus: { not: "COMPLETED" } },
    },
    include: {
      salesOrder: {
        include: {
          customer: true,
          po: { include: { customer: true } },
          currentCycle: { select: { id: true, status: true } },
        },
      },
      lines: { include: { item: true } },
    },
  });

  // latest by (salesOrderId + cycleId + periodKey) under current ACTIVE cycle only
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

  const orderWiseRows = [];
  let redCount = 0;
  let yellowCount = 0;
  let greenCount = 0;
  let excessCount = 0;

  for (const s of latestByKey.values()) {
    const customerName =
      s.salesOrder?.customer?.name ??
      s.salesOrder?.po?.customer?.name ??
      "—";

    for (const l of s.lines || []) {
      if (!l.item || l.item.itemType !== "FG") continue;
      const req = n(l.requirementQty);
      if (!(req > 0)) continue;

      const { redBoundaryPercent, yellowBoundaryPercent } = resolveOrderWiseBoundariesFromLegacyDbFields(
        l.item.planningGapGreenThresholdPercent,
        l.item.planningGapYellowThresholdPercent,
      );

      let stock = 0;
      let gapPercent = null;
      let suggestedWoQty = 0;

      if (s.status === "LOCKED") {
        // LOCKED sheets: snapshot may predate display rules — align with operational USABLE (floor at 0).
        stock = usableStockDisplayQty(n(l.availableStockQtySnapshot));
        gapPercent = computeGapPercent(req, stock);
        suggestedWoQty = computeSuggestedWo(req, stock);
      } else {
        // DRAFT sheets use live stock (same ledger filter as requirement sheet / dashboard).
        stock = usableStockDisplayQty(stockByItemId.get(l.itemId) ?? 0);
        gapPercent = computeGapPercent(req, stock);
        suggestedWoQty = computeSuggestedWo(req, stock);
      }

      // enforce excess semantics always
      const computedZone = classifyPlanningZone(gapPercent, redBoundaryPercent, yellowBoundaryPercent);
      const colorZone = computedZone === "EXCESS" ? "EXCESS" : computedZone;
      if (colorZone === "EXCESS") suggestedWoQty = 0;
      if (suggestedWoQty < 0) suggestedWoQty = 0;

      if (colorZone === "RED") redCount += 1;
      else if (colorZone === "YELLOW") yellowCount += 1;
      else if (colorZone === "EXCESS") excessCount += 1;
      else greenCount += 1;

      orderWiseRows.push({
        itemId: l.itemId,
        itemName: l.item.itemName,
        customerName,
        requirementQty: round3(req),
        stockQty: round3(stock),
        gapPercent,
        suggestedWoQty: round3(suggestedWoQty),
        colorZone,
      });
    }
  }

  orderWiseRows.sort((a, b) => {
    const zr = zoneRank(a.colorZone) - zoneRank(b.colorZone);
    if (zr !== 0) return zr;
    // Higher gap first (treat null as -inf so it sinks)
    return n(b.gapPercent) - n(a.gapPercent);
  });

  // Product-wise aggregation (FG item): sum requirementQty across active NO_QTY cycles (latest sheets only).
  const itemAgg = new Map();
  const itemMeta = new Map(); // itemId -> product-wise meta (thresholds + legacy gap columns)
  for (const r of orderWiseRows) {
    const prev = itemAgg.get(r.itemId) ?? 0;
    itemAgg.set(r.itemId, prev + n(r.requirementQty));
  }
  // Capture thresholds from any sheet line seen (best-effort; consistent in Item master).
  for (const s of latestByKey.values()) {
    for (const l of s.lines || []) {
      if (!l.item || l.item.itemType !== "FG") continue;
      if (!itemMeta.has(l.itemId)) {
        itemMeta.set(l.itemId, {
          itemName: l.item.itemName,
          redThresholdPercent: l.item.redThresholdPercent ?? null,
          yellowThresholdPercent: l.item.yellowThresholdPercent ?? null,
          legacyPlanningGapRedBoundaryPercent: l.item.planningGapGreenThresholdPercent ?? null,
          legacyPlanningGapYellowBoundaryPercent: l.item.planningGapYellowThresholdPercent ?? null,
          bufferPct: l.item.planningBufferPercent ?? null,
          minimumStockQty: l.item.minimumStockQty ?? null,
        });
      }
    }
  }

  const productWiseRows = [];
  let pRed = 0;
  let pYellow = 0;
  let pGreen = 0;
  let pExcess = 0;
  for (const [itemId, totalReq0] of itemAgg.entries()) {
    const totalReq = round3(totalReq0);
    const stock = round3(usableStockDisplayQty(stockByItemId.get(itemId) ?? 0));
    const meta = itemMeta.get(itemId);
    const minStockFloor = meta?.minimumStockQty != null ? n(meta.minimumStockQty) : null;
    const baseReq = round3(Math.max(totalReq, minStockFloor != null && Number.isFinite(minStockFloor) ? minStockFloor : 0));
    const bufferPct = meta?.bufferPct != null ? n(meta.bufferPct) : 0;
    const bufferedReq = round3(baseReq * (1 + Math.max(0, bufferPct) / 100));
    const rawGap = round3(bufferedReq - stock);
    const gapQty = rawGap > 0 ? rawGap : 0;
    const gapPercent = baseReq > 0 ? round2((gapQty / baseReq) * 100) : 0;

    const { redBoundaryPercent, yellowBoundaryPercent } = resolveProductWiseBoundariesFromItem(meta);

    const zone = classifyPlanningZone(rawGap < 0 ? -1 : gapPercent, redBoundaryPercent, yellowBoundaryPercent);
    let suggestedWoQty = round3(gapQty);
    const colorZone = zone === "EXCESS" ? "EXCESS" : zone;
    if (colorZone === "EXCESS") suggestedWoQty = 0;

    if (colorZone === "RED") pRed += 1;
    else if (colorZone === "YELLOW") pYellow += 1;
    else if (colorZone === "EXCESS") pExcess += 1;
    else pGreen += 1;

    productWiseRows.push({
      itemId,
      itemName: meta?.itemName ?? `Item #${itemId}`,
      totalRequirementQty: totalReq,
      availableStockQty: stock,
      gapQty: round3(gapQty),
      gapPercent,
      suggestedWoQty,
      colorZone,
    });
  }
  productWiseRows.sort((a, b) => {
    const zr = zoneRank(a.colorZone) - zoneRank(b.colorZone);
    if (zr !== 0) return zr;
    return n(b.gapQty) - n(a.gapQty);
  });

  return {
    orderWise: {
      items: orderWiseRows,
      summary: { redCount, yellowCount, greenCount, excessCount },
    },
    productWise: {
      items: productWiseRows,
      summary: { redCount: pRed, yellowCount: pYellow, greenCount: pGreen, excessCount: pExcess },
    },
  };
}

module.exports = { getPlanningDashboard };

