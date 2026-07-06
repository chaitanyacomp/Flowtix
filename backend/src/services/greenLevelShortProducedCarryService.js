/**
 * Green Level — short-produced carry from closed stock-replenishment WOs into planning.
 *
 * REGULAR / NO_QTY carry-forward uses CarryForwardPending + RS shortfallQtySnapshot.
 * GL uses ProductionShortfallResolution (CARRY_FORWARD) and merges into green shortage
 * without double-counting stock already reflected in free FG surplus.
 */

const { prisma } = require("../utils/prisma");
const { GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");

const EPS = 1e-6;

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function round3(value) {
  return Math.round(n(value) * 1000) / 1000;
}

/**
 * Merge stock-based green shortage with carried short-produced qty from closed GL WOs.
 * When free FG already meets the green target (stock gap 0), carry is not applied —
 * replenishment or other stock movement has absorbed the shortfall.
 * Otherwise uses max() so the same gap is not counted twice in stock and carry.
 */
function resolveGreenShortageForPlanning(stockBasedShortage, shortProducedCarryQty) {
  const stock = round3(n(stockBasedShortage));
  const carry = round3(n(shortProducedCarryQty));
  if (stock <= EPS) return 0;
  return round3(Math.max(stock, carry));
}

/**
 * shortProducedQty per FG item from completed GL WOs closed with CARRY_FORWARD.
 * @returns {Promise<Map<number, number>>}
 */
async function loadGreenLevelShortProducedCarryByItem(db = prisma) {
  const rows = await db.productionShortfallResolution.findMany({
    where: {
      resolutionType: "CARRY_FORWARD",
      workOrder: {
        sourceType: GREEN_LEVEL_WO_SOURCE_TYPE,
        status: { in: ["COMPLETED", "CLOSED_WITH_SHORTFALL"] },
        productionExecution: { is: { executionStatus: "COMPLETED" } },
      },
    },
    select: {
      remainderQty: true,
      workOrderLine: { select: { fgItemId: true } },
    },
  });

  const out = new Map();
  for (const row of rows) {
    const itemId = Number(row.workOrderLine?.fgItemId ?? 0);
    if (!(itemId > 0)) continue;
    const qty = round3(n(row.remainderQty));
    if (qty <= EPS) continue;
    out.set(itemId, round3((out.get(itemId) ?? 0) + qty));
  }
  return out;
}

module.exports = {
  resolveGreenShortageForPlanning,
  loadGreenLevelShortProducedCarryByItem,
};
