/**
 * Phase 2 — Read-only NO_QTY Requirement Sheet → MPRS suggestion bridge.
 *
 * Reads LOCKED requirement sheets only. Never writes RS, cycles, WOs, or procurement.
 */

const { prisma } = require("../utils/prisma");
const { normalizePeriodKey, MonthlyPlanningError } = require("./monthlyPlanningService");

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function sheetDedupeKey(sheet) {
  const soId = sheet.salesOrderId;
  const cycleId = sheet.cycleId == null ? "null" : String(sheet.cycleId);
  return `${soId}:${cycleId}:${sheet.periodKey}`;
}

/**
 * Keep highest version per (salesOrderId, cycleId, periodKey).
 */
function pickLatestLockedSheets(sheets) {
  const byKey = new Map();
  for (const sheet of sheets || []) {
    const key = sheetDedupeKey(sheet);
    const prev = byKey.get(key);
    if (!prev || n(sheet.version) > n(prev.version)) {
      byKey.set(key, sheet);
    }
  }
  return [...byKey.values()];
}

function lineProductionRequirement(ln) {
  const scheduleQty = round3(n(ln.requirementQty));
  const carryForwardQty = round3(ln.shortfallQtySnapshot != null ? n(ln.shortfallQtySnapshot) : 0);
  const fromSnapshot =
    ln.suggestedWoQtySnapshot != null ? round3(n(ln.suggestedWoQtySnapshot)) : null;
  const productionRequirementQty =
    fromSnapshot != null ? fromSnapshot : round3(scheduleQty + carryForwardQty);
  return { scheduleQty, carryForwardQty, productionRequirementQty };
}

function toSourceEntry(sheet, ln) {
  const { scheduleQty, carryForwardQty, productionRequirementQty } = lineProductionRequirement(ln);
  return {
    requirementSheetId: sheet.id,
    requirementSheetDocNo: sheet.docNo ?? null,
    salesOrderId: sheet.salesOrderId,
    salesOrderDocNo: sheet.salesOrder?.docNo ?? null,
    cycleId: sheet.cycleId ?? null,
    cycleNo: sheet.cycle?.cycleNo ?? null,
    requirementQty: scheduleQty,
    shortfallQtySnapshot: carryForwardQty,
    suggestedWoQtySnapshot: productionRequirementQty,
  };
}

/**
 * @param {{ db?: object; periodKey: string }} opts
 * @returns {Promise<{ periodKey: string; sheetCount: number; items: Array<object> }>}
 */
async function getRsSuggestionsForPeriod({ db = prisma, periodKey } = {}) {
  const normalized = normalizePeriodKey(periodKey);

  const rawSheets = await db.requirementSheet.findMany({
    where: {
      status: "LOCKED",
      periodKey: normalized,
      salesOrder: { orderType: "NO_QTY" },
    },
    include: {
      salesOrder: { select: { id: true, docNo: true, orderType: true } },
      cycle: { select: { id: true, cycleNo: true } },
      lines: {
        include: {
          item: { select: { id: true, itemName: true, itemType: true, unit: true } },
        },
      },
    },
    orderBy: [{ salesOrderId: "asc" }, { version: "desc" }],
  });

  const sheets = pickLatestLockedSheets(rawSheets);
  const byItem = new Map();

  for (const sheet of sheets) {
    for (const ln of sheet.lines || []) {
      if (ln.item?.itemType && ln.item.itemType !== "FG") continue;
      const itemId = ln.itemId;
      const { scheduleQty, carryForwardQty, productionRequirementQty } = lineProductionRequirement(ln);
      const source = toSourceEntry(sheet, ln);

      if (!byItem.has(itemId)) {
        byItem.set(itemId, {
          itemId,
          itemName: ln.item?.itemName ?? null,
          unit: ln.item?.unit ?? null,
          scheduleQty: 0,
          carryForwardQty: 0,
          productionRequirementQty: 0,
          sources: [],
        });
      }
      const bucket = byItem.get(itemId);
      bucket.scheduleQty = round3(bucket.scheduleQty + scheduleQty);
      bucket.carryForwardQty = round3(bucket.carryForwardQty + carryForwardQty);
      bucket.productionRequirementQty = round3(bucket.productionRequirementQty + productionRequirementQty);
      bucket.sources.push(source);
    }
  }

  const items = [...byItem.values()].sort((a, b) =>
    String(a.itemName ?? "").localeCompare(String(b.itemName ?? "")),
  );

  return {
    periodKey: normalized,
    sheetCount: sheets.length,
    items,
  };
}

module.exports = {
  getRsSuggestionsForPeriod,
  pickLatestLockedSheets,
  lineProductionRequirement,
  sheetDedupeKey,
  MonthlyPlanningError,
};
