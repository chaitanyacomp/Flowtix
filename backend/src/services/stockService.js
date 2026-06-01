const { prisma } = require("../utils/prisma");
const { resolveLocationReadScope, defaultStockTxnLocationData } = require("./locationService");

/** Tolerance for decimal qty comparisons (ledger uses Decimal strings). */
const STOCK_EPS = 1e-6;

/**
 * User-facing / planning USABLE qty: same floor as Stock Summary (never show negative on-hand).
 * Raw ledger can be negative from timing/reversal edge cases; planning must not treat that as extra cover.
 */
function usableStockDisplayQty(raw) {
  const x = Number(raw);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, x);
}

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Build Prisma where for stock reads (item + bucket + optional location scope).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function buildStockTxnWhere(db, itemId, opts = {}) {
  const bucket = opts?.stockBucket;
  const qcRejectedDispositionId = opts?.qcRejectedDispositionId;
  const excludeReversed = Boolean(opts?.excludeReversed);
  const locationScope = await resolveLocationReadScope(db, {
    locationId: opts?.locationId,
    allLocations: opts?.allLocations,
  });

  return {
    itemId,
    ...(bucket ? { stockBucket: bucket } : {}),
    ...(qcRejectedDispositionId ? { qcRejectedDispositionId } : {}),
    ...(excludeReversed ? { reversedAt: null } : {}),
    ...locationScope,
  };
}

/** @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db */
async function getItemStockQty(itemId, db = prisma, opts = {}) {
  const rows = await db.stockTransaction.aggregate({
    where: await buildStockTxnWhere(db, itemId, opts),
    _sum: { qtyIn: true, qtyOut: true },
  });
  const qtyIn = rows._sum.qtyIn || 0;
  const qtyOut = rows._sum.qtyOut || 0;
  return Number(qtyIn) - Number(qtyOut);
}

/** Usable on-hand at default location scope (RM Store + legacy null). */
async function getUsableItemStockQty(itemId, db = prisma, opts = {}) {
  return getItemStockQty(itemId, db, { stockBucket: "USABLE", ...opts });
}

/**
 * Bulk USABLE stock by item at default location scope (replaces duplicated groupBy helpers).
 * @returns {Promise<Map<number, number>>}
 */
async function loadStockByItemIdUsableMap(db = prisma, opts = {}) {
  const locationScope = await resolveLocationReadScope(db, {
    locationId: opts?.locationId,
    allLocations: opts?.allLocations,
  });
  const stockRows = await db.stockTransaction.groupBy({
    by: ["itemId"],
    where: { stockBucket: "USABLE", ...locationScope },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return new Map(stockRows.map((r) => [r.itemId, n(r._sum.qtyIn) - n(r._sum.qtyOut)]));
}

/**
 * Bulk stock by item and bucket at default location scope.
 * @returns {Promise<Map<number, Record<string, number>>>}
 */
async function loadStockBucketsByItemIdMap(db = prisma, opts = {}) {
  const locationScope = await resolveLocationReadScope(db, {
    locationId: opts?.locationId,
    allLocations: opts?.allLocations,
  });
  const rows = await db.stockTransaction.groupBy({
    by: ["itemId", "stockBucket"],
    where: locationScope,
    _sum: { qtyIn: true, qtyOut: true },
  });
  const byItem = new Map();
  for (const r of rows) {
    const qty = n(r._sum.qtyIn) - n(r._sum.qtyOut);
    if (!byItem.has(r.itemId)) {
      byItem.set(r.itemId, { USABLE: 0, QC_HOLD: 0, QC_PENDING: 0, REWORK: 0, SCRAP: 0 });
    }
    const b = byItem.get(r.itemId);
    if (r.stockBucket in b) b[r.stockBucket] = qty;
  }
  return byItem;
}

const EMPTY_STOCK_BUCKETS = () => ({ USABLE: 0, QC_HOLD: 0, QC_PENDING: 0, REWORK: 0, SCRAP: 0 });

/**
 * Stock Summary rows: ledger buckets plus RM items with low-stock policy configured but no transactions.
 * Aligns with dashboard `rmStockAlert` (Item master `minStockLevel` vs USABLE qty).
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @returns {Promise<Array<{ itemId: number; item: { id: number; itemName: string; itemType: string; unit: string }; usableQty: number; qcHoldQty: number; qcPendingQty: number; reworkQty: number; scrapQty: number }>>}
 */
async function buildStockSummaryBucketsRows(db = prisma, opts = {}) {
  const bucketsByItemId = await loadStockBucketsByItemIdMap(db, opts);

  const rmWithLowStockPolicy = await db.item.findMany({
    where: { itemType: "RM", minStockLevel: { gt: 0 } },
    select: { id: true, itemName: true, itemType: true, unit: true },
  });

  const itemIdSet = new Set([...bucketsByItemId.keys(), ...rmWithLowStockPolicy.map((i) => i.id)]);
  const itemIds = [...itemIdSet];
  const items = itemIds.length
    ? await db.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, itemName: true, itemType: true, unit: true },
      })
    : [];
  const itemsById = new Map(items.map((i) => [i.id, i]));

  return itemIds
    .map((itemId) => {
      const item = itemsById.get(itemId);
      if (!item) return null;
      const b = bucketsByItemId.get(itemId) || EMPTY_STOCK_BUCKETS();
      return {
        itemId,
        item,
        usableQty: usableStockDisplayQty(b.USABLE),
        qcHoldQty: b.QC_HOLD,
        qcPendingQty: b.QC_PENDING,
        reworkQty: b.REWORK,
        scrapQty: b.SCRAP,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.itemId || 0) - (a.itemId || 0));
}

/**
 * USABLE on-hand grouped by item + location (all locations; null → unassigned bucket).
 * @returns {Promise<Array<{ itemId: number; locationId: number | null; qty: number }>>}
 */
async function loadStockUsableByItemAndLocation(db = prisma) {
  const rows = await db.stockTransaction.groupBy({
    by: ["itemId", "locationId"],
    where: { stockBucket: "USABLE" },
    _sum: { qtyIn: true, qtyOut: true },
  });
  return rows.map((r) => ({
    itemId: r.itemId,
    locationId: r.locationId,
    qty: Math.max(0, n(r._sum.qtyIn) - n(r._sum.qtyOut)),
  }));
}

/**
 * Current on-hand plus a proposed net change (qtyIn − qtyOut) must not go below zero.
 * @param {import('@prisma/client').Prisma.TransactionClient} db
 */
async function assertNonNegativeStockAfterNetChange(db, itemId, netInMinusOut, message, opts = {}) {
  const bucket = opts?.stockBucket ?? "USABLE";
  const onHand = await getItemStockQty(itemId, db, { stockBucket: bucket, locationId: opts?.locationId });
  const after = onHand + Number(netInMinusOut);
  if (after < -STOCK_EPS) {
    const err = new Error(
      message ||
        `Stock cannot go negative for item #${itemId}. Current: ${onHand}, net change: ${netInMinusOut}.`,
    );
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Before recording a stock-out, ensure ledger has enough on-hand.
 * @param {import('@prisma/client').Prisma.TransactionClient} db
 */
async function assertSufficientStockForQtyOut(db, itemId, qtyOut, messagePrefix, opts = {}) {
  const bucket = opts?.stockBucket ?? "USABLE";
  const onHand = await getItemStockQty(itemId, db, {
    stockBucket: bucket,
    locationId: opts?.locationId,
    ...(opts?.qcRejectedDispositionId ? { qcRejectedDispositionId: opts.qcRejectedDispositionId } : {}),
    ...(opts?.excludeReversed ? { excludeReversed: true } : {}),
  });
  const q = Number(qtyOut);
  if (onHand - q < -STOCK_EPS) {
    const err = new Error(
      `${messagePrefix ? `${messagePrefix.trim()} ` : ""}Available: ${onHand}, required out: ${q}.`,
    );
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Mandatory gate before posting DISPATCH qtyOut from USABLE.
 * @param {import('@prisma/client').Prisma.TransactionClient} db
 */
async function assertUsableStockBeforeDispatchOut(db, itemId, dispatchQty, opts = {}) {
  const usable = await getItemStockQty(itemId, db, { stockBucket: "USABLE", locationId: opts?.locationId });
  const q = Number(dispatchQty);
  if (usable + STOCK_EPS < q) {
    const err = new Error(`Insufficient usable stock for dispatch. Available: ${usable}, required: ${q}.`);
    err.statusCode = 400;
    throw err;
  }
}

async function createStockTxn({ itemId, transactionType, refId, qtyIn, qtyOut, date, locationId }, db = prisma) {
  const loc =
    locationId != null
      ? { locationId }
      : await defaultStockTxnLocationData(db);
  return db.stockTransaction.create({
    data: {
      itemId,
      ...loc,
      transactionType,
      refId,
      stockBucket: "USABLE",
      qtyIn: qtyIn ?? 0,
      qtyOut: qtyOut ?? 0,
      date: date ?? new Date(),
    },
  });
}

module.exports = {
  STOCK_EPS,
  usableStockDisplayQty,
  buildStockTxnWhere,
  getItemStockQty,
  getUsableItemStockQty,
  loadStockByItemIdUsableMap,
  loadStockBucketsByItemIdMap,
  buildStockSummaryBucketsRows,
  loadStockUsableByItemAndLocation,
  createStockTxn,
  assertNonNegativeStockAfterNetChange,
  assertSufficientStockForQtyOut,
  assertUsableStockBeforeDispatchOut,
};
