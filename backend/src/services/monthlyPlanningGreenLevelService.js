/**
 * Phase 3 — FG Green Level base & zone calculation (read-only).
 *
 * Base Qty = MAX(monthly schedule totals) over the last 6 months before the anchor period,
 * sourced from LOCKED NO_QTY Requirement Sheets only.
 *
 * Zone qtys = Base × Item Master Green/Yellow/Red % (Green defaults to 100%).
 */

const { prisma } = require("../utils/prisma");
const { normalizePeriodKey, MonthlyPlanningError } = require("./monthlyPlanningService");
const { pickLatestLockedSheets } = require("./monthlyPlanningRsSuggestionsService");
const { computeGlobalNoQtyUsablePlanningBreakdownByItem } = require("./noQtyUsablePlanningService");

const STOCK_SCOPE = "GLOBAL_USABLE_FREE_SURPLUS";

const DEFAULT_GREEN_PERCENT = 100;
const DEFAULT_YELLOW_PERCENT = 80;
const DEFAULT_RED_PERCENT = 50;
const HISTORY_MONTH_COUNT = 6;

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function parsePeriodParts(periodKey) {
  const normalized = normalizePeriodKey(periodKey);
  const match = /^(\d{4})-(\d{2})$/.exec(normalized);
  if (!match) {
    throw new MonthlyPlanningError("INVALID_PERIOD", "periodKey must be YYYY-MM.", 422);
  }
  return { year: Number(match[1]), month: Number(match[2]), key: normalized };
}

function periodKeyFromParts(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(year, month, delta) {
  let m = month + delta;
  let y = year;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

/**
 * Six calendar months immediately before the anchor period (anchor excluded).
 * @param {string} anchorPeriodKey
 * @returns {string[]}
 */
function getLast6PeriodKeysBefore(anchorPeriodKey) {
  const { year, month } = parsePeriodParts(anchorPeriodKey);
  const keys = [];
  for (let i = HISTORY_MONTH_COUNT; i >= 1; i -= 1) {
    const p = shiftMonth(year, month, -i);
    keys.push(periodKeyFromParts(p.year, p.month));
  }
  return keys;
}

/**
 * @param {Map<number, Map<string, number>>} monthlyByItem
 * @param {string[]} historyPeriodKeys
 * @returns {Map<number, number>}
 */
function computeGreenBaseByItem(monthlyByItem, historyPeriodKeys) {
  const baseByItem = new Map();
  for (const [itemId, monthMap] of monthlyByItem.entries()) {
    let maxMonthly = 0;
    for (const pk of historyPeriodKeys) {
      const total = round3(n(monthMap.get(pk)));
      if (total > maxMonthly) maxMonthly = total;
    }
    baseByItem.set(itemId, round3(maxMonthly));
  }
  return baseByItem;
}

function resolveZonePercents(item) {
  const yellowRaw = item?.yellowThresholdPercent;
  const redRaw = item?.redThresholdPercent;
  const yellowPercent =
    yellowRaw != null && Number.isFinite(n(yellowRaw)) && n(yellowRaw) > 0
      ? round3(n(yellowRaw))
      : DEFAULT_YELLOW_PERCENT;
  const redPercent =
    redRaw != null && Number.isFinite(n(redRaw)) && n(redRaw) > 0
      ? round3(n(redRaw))
      : DEFAULT_RED_PERCENT;
  return {
    greenPercent: DEFAULT_GREEN_PERCENT,
    yellowPercent,
    redPercent,
  };
}

/**
 * @param {number} baseQty
 * @param {{ greenPercent: number; yellowPercent: number; redPercent: number }} percents
 */
function computeZoneQuantities(baseQty, percents) {
  const base = round3(n(baseQty));
  const greenPercent = percents.greenPercent;
  const yellowPercent = percents.yellowPercent;
  const redPercent = percents.redPercent;
  return {
    baseQty: base,
    greenPercent,
    yellowPercent,
    redPercent,
    greenQty: round3((base * greenPercent) / 100),
    yellowQty: round3((base * yellowPercent) / 100),
    redQty: round3((base * redPercent) / 100),
  };
}

/**
 * Aggregate locked RS schedule qty by FG item + periodKey (customer schedule only).
 * @param {Array<object>} sheets deduped locked sheets
 */
function aggregateMonthlyScheduleTotals(sheets) {
  /** @type {Map<number, Map<string, number>>} */
  const monthlyByItem = new Map();

  for (const sheet of sheets || []) {
    const periodKey = sheet.periodKey;
    if (!periodKey) continue;
    for (const ln of sheet.lines || []) {
      if (ln.item?.itemType && ln.item.itemType !== "FG") continue;
      const itemId = ln.itemId;
      const scheduleQty = round3(n(ln.requirementQty));
      if (!monthlyByItem.has(itemId)) monthlyByItem.set(itemId, new Map());
      const monthMap = monthlyByItem.get(itemId);
      monthMap.set(periodKey, round3(n(monthMap.get(periodKey)) + scheduleQty));
    }
  }

  return monthlyByItem;
}

/**
 * @param {number} greenQty
 * @param {number} freeFgStock
 */
function shortageForGreenTarget(greenQty, freeFgStock) {
  return round3(Math.max(0, n(greenQty) - n(freeFgStock)));
}

/**
 * @param {number} freeFgStock
 * @param {number} greenQty
 * @param {number} yellowQty
 * @param {number} redQty
 * @returns {"GREEN"|"YELLOW"|"RED"|"CRITICAL"|null}
 */
function classifyGreenLevelStatus(freeFgStock, greenQty, yellowQty, redQty) {
  const free = n(freeFgStock);
  const green = n(greenQty);
  const yellow = n(yellowQty);
  const red = n(redQty);
  if (!(green > 0)) return null;
  if (free >= green) return "GREEN";
  if (free >= yellow) return "YELLOW";
  if (free >= red) return "RED";
  return "CRITICAL";
}

/**
 * @param {{ db?: object; periodKey?: string; anchorPeriodKey?: string; loadGlobalStockBreakdown?: Function }} opts
 */
async function getGreenLevels({
  db = prisma,
  periodKey,
  anchorPeriodKey,
  loadGlobalStockBreakdown = computeGlobalNoQtyUsablePlanningBreakdownByItem,
} = {}) {
  const anchor = normalizePeriodKey(anchorPeriodKey ?? periodKey);
  const historyPeriodKeys = getLast6PeriodKeysBefore(anchor);

  const rawSheets = await db.requirementSheet.findMany({
    where: {
      status: "LOCKED",
      periodKey: { in: historyPeriodKeys },
      salesOrder: { orderType: "NO_QTY" },
    },
    include: {
      lines: {
        include: {
          item: {
            select: {
              id: true,
              itemName: true,
              itemType: true,
              unit: true,
              redThresholdPercent: true,
              yellowThresholdPercent: true,
            },
          },
        },
      },
    },
    orderBy: [{ salesOrderId: "asc" }, { version: "desc" }],
  });

  const sheets = pickLatestLockedSheets(rawSheets);
  const monthlyByItem = aggregateMonthlyScheduleTotals(sheets);
  const baseByItem = computeGreenBaseByItem(monthlyByItem, historyPeriodKeys);

  const fgItems = await db.item.findMany({
    where: { itemType: "FG" },
    select: {
      id: true,
      itemName: true,
      unit: true,
      redThresholdPercent: true,
      yellowThresholdPercent: true,
    },
    orderBy: { itemName: "asc" },
  });

  const stockBreakdownByItem = await loadGlobalStockBreakdown(db);

  const items = fgItems.map((item) => {
    const percents = resolveZonePercents(item);
    const baseQty = baseByItem.get(item.id) ?? 0;
    const zones = computeZoneQuantities(baseQty, percents);
    const monthMap = monthlyByItem.get(item.id);
    const monthlyScheduleTotals = {};
    if (monthMap) {
      for (const pk of historyPeriodKeys) {
        if (monthMap.has(pk)) monthlyScheduleTotals[pk] = round3(n(monthMap.get(pk)));
      }
    }
    const stock = stockBreakdownByItem.get(item.id);
    const freeFgStock = round3(n(stock?.freeSurplusUsableQty ?? 0));
    const greenTarget = zones.greenQty;
    return {
      itemId: item.id,
      itemName: item.itemName,
      unit: item.unit ?? null,
      ...zones,
      monthlyScheduleTotals,
      freeFgStock,
      shortageForGreenTarget: shortageForGreenTarget(greenTarget, freeFgStock),
      status: classifyGreenLevelStatus(freeFgStock, greenTarget, zones.yellowQty, zones.redQty),
      totalUsableFgStock: round3(n(stock?.totalUsableQty ?? 0)),
      reservedNormalDispatchQty: round3(n(stock?.reservedForNormalDispatchQty ?? 0)),
      reservedNoQtyDispatchQty: round3(n(stock?.reservedForActiveNoQtyDispatchQty ?? 0)),
    };
  });

  return {
    anchorPeriodKey: anchor,
    historyPeriodKeys,
    stockScope: STOCK_SCOPE,
    itemCount: items.length,
    itemsWithHistory: items.filter((i) => i.baseQty > 0).length,
    itemsWithStatus: items.filter((i) => i.status != null).length,
    items,
  };
}

module.exports = {
  DEFAULT_GREEN_PERCENT,
  DEFAULT_YELLOW_PERCENT,
  DEFAULT_RED_PERCENT,
  HISTORY_MONTH_COUNT,
  getLast6PeriodKeysBefore,
  aggregateMonthlyScheduleTotals,
  computeGreenBaseByItem,
  computeZoneQuantities,
  resolveZonePercents,
  shortageForGreenTarget,
  classifyGreenLevelStatus,
  STOCK_SCOPE,
  getGreenLevels,
  MonthlyPlanningError,
};
