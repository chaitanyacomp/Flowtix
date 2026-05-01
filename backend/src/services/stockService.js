const { prisma } = require("../utils/prisma");

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

/** @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db */
async function getItemStockQty(itemId, db = prisma, opts = {}) {
  const bucket = opts?.stockBucket;
  const qcRejectedDispositionId = opts?.qcRejectedDispositionId;
  const excludeReversed = Boolean(opts?.excludeReversed);
  const rows = await db.stockTransaction.aggregate({
    where: {
      itemId,
      ...(bucket ? { stockBucket: bucket } : {}),
      ...(qcRejectedDispositionId ? { qcRejectedDispositionId } : {}),
      ...(excludeReversed ? { reversedAt: null } : {}),
    },
    _sum: { qtyIn: true, qtyOut: true },
  });
  const qtyIn = rows._sum.qtyIn || 0;
  const qtyOut = rows._sum.qtyOut || 0;
  return Number(qtyIn) - Number(qtyOut);
}

/** Usable on-hand only (single-bucket read; excludes QC_HOLD, REWORK, SCRAP). */
async function getUsableItemStockQty(itemId, db = prisma) {
  return getItemStockQty(itemId, db, { stockBucket: "USABLE" });
}

/**
 * Current on-hand plus a proposed net change (qtyIn − qtyOut) must not go below zero.
 * @param {import('@prisma/client').Prisma.TransactionClient} db
 */
async function assertNonNegativeStockAfterNetChange(db, itemId, netInMinusOut, message, opts = {}) {
  const bucket = opts?.stockBucket ?? "USABLE";
  const onHand = await getItemStockQty(itemId, db, { stockBucket: bucket });
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
 * @param {string} [messagePrefix] — optional; final text includes available vs required amounts.
 */
async function assertSufficientStockForQtyOut(db, itemId, qtyOut, messagePrefix, opts = {}) {
  const bucket = opts?.stockBucket ?? "USABLE";
  const onHand = await getItemStockQty(itemId, db, {
    stockBucket: bucket,
    ...(opts?.qcRejectedDispositionId ? { qcRejectedDispositionId: opts.qcRejectedDispositionId } : {}),
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
 * Mandatory gate before posting DISPATCH qtyOut from USABLE: full USABLE ledger net
 * (same principle as stock summary: original + reversal rows both count; `reversedAt` is audit-only).
 * @param {import('@prisma/client').Prisma.TransactionClient} db
 */
async function assertUsableStockBeforeDispatchOut(db, itemId, dispatchQty) {
  const usable = await getItemStockQty(itemId, db, { stockBucket: "USABLE" });
  const q = Number(dispatchQty);
  if (usable + STOCK_EPS < q) {
    const err = new Error(`Insufficient stock for dispatch. Available: ${usable}, required: ${q}.`);
    err.statusCode = 400;
    throw err;
  }
}

async function createStockTxn({ itemId, transactionType, refId, qtyIn, qtyOut, date }, db = prisma) {
  return db.stockTransaction.create({
    data: {
      itemId,
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
  getItemStockQty,
  getUsableItemStockQty,
  createStockTxn,
  assertNonNegativeStockAfterNetChange,
  assertSufficientStockForQtyOut,
  assertUsableStockBeforeDispatchOut,
};
