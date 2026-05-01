/**
 * QC rollup helpers for reporting and other modules (e.g. production). Dispatch posting is **not** capped
 * by QC-approved totals: {@link assertDispatchAllowedForSoItem} enforces SO-line FIFO headroom + stock or replacement pool.
 *
 * sumQcAcceptedForSoItem: active QcEntry.acceptedQty for WOs on this SO+FG + adjustment QC rows.
 *
 * Dispatch-ready qty and the WO sufficiency guard use this rollup (when QC exists for the SO+item) with
 * usable on-hand — see reportMetrics.getSoItemDispatchShipCap / buildDispatchableQtyBySalesOrderLineId.
 *
 * Physical FG: assertSufficientStockForQtyOut (stockService) uses the full stock ledger — same on-hand as
 * GET /dispatch/sales-orders onHand. **REPLACEMENT** dispatch is capped by both the return-QC pool and **USABLE**
 * on-hand (dispatch still posts from USABLE only); see {@link getSoItemDispatchShipCap} for the pool leg.
 */

const { STOCK_EPS, assertSufficientStockForQtyOut, getItemStockQty } = require("./stockService");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const {
  remainingDispatchCapacityForSoItem,
  netDispatchedByItemId,
  DISPATCH_ALLOC_MODE,
} = require("./salesOrderDispatchAllocation");
const { getSoItemDispatchShipCap } = require("./reportMetrics");

function formatQtyForMessage(n) {
  const v = Math.max(0, Number(n));
  if (Number.isNaN(v)) return "0";
  const rounded = Math.round(v * 1000) / 1000;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return String(rounded);
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function sumQcAcceptedForSoItem(db, salesOrderId, itemId) {
  const [prodAgg, adjAgg] = await Promise.all([
    db.qcEntry.aggregate({
      where: {
        ...QC_ENTRY_ACTIVE_WHERE,
        production: {
          workOrderLine: {
            fgItemId: itemId,
            workOrder: { salesOrderId },
          },
        },
      },
      _sum: { acceptedQty: true },
    }),
    db.stockAdjustmentQcEntry.aggregate({
      where: { reversedAt: null, salesOrderId, itemId },
      _sum: { acceptedQty: true },
    }),
  ]);
  return Number(prodAgg._sum.acceptedQty ?? 0) + Number(adjAgg._sum.acceptedQty ?? 0);
}

/**
 * Map key "soId:itemId" -> total QC accepted (active QC only).
 * @param {import('@prisma/client').PrismaClient} db
 */
/**
 * Replacement SO lines: gross QC pool from linked customer return (matches customer-return list / QC report),
 * not global usable on-hand and not production QcEntry on this SO.
 *
 * @param {import('@prisma/client').PrismaClient} db
 * @param {Array<{ id: number; orderType: string; customerReturnId: number | null | undefined; lines?: { itemId: number }[] }>} salesOrders
 * @param {Map<string, number>} qcAcceptedMap from {@link buildQcAcceptedMap}
 * @returns {Promise<Map<string, number>>} key `${soId}:${itemId}` → gross pool
 */
async function buildReplacementReturnQcGrossBySoItemKey(db, salesOrders, qcAcceptedMap) {
  const repSos = (salesOrders || []).filter((s) => s.orderType === "REPLACEMENT" && s.customerReturnId != null);
  const returnIds = [...new Set(repSos.map((s) => s.customerReturnId).filter((x) => x != null))];
  if (!returnIds.length) return new Map();

  const retRows = await db.customerReturn.findMany({
    where: { id: { in: returnIds } },
    select: { id: true, itemId: true, returnedQty: true, status: true, reversedAt: true },
  });
  const returnById = new Map(retRows.map((r) => [r.id, r]));

  /** @type {Map<string, number>} */
  const out = new Map();
  for (const so of repSos) {
    const crId = so.customerReturnId;
    if (crId == null) continue;
    const r = returnById.get(crId);
    if (!r || r.reversedAt != null) continue;
    const k = `${so.id}:${r.itemId}`;
    const adj = qcAcceptedMap.get(k) ?? 0;
    const returnQty = Number(r.returnedQty ?? 0);
    let gross = adj;
    if (r.status === "APPROVED_TO_STOCK") gross = Math.max(gross, returnQty);
    const rounded = Math.round(gross * 1000) / 1000;
    out.set(k, rounded);
    // Single-line replacement: if legacy rows have return.itemId ≠ SO line itemId, still key gross by the line item.
    const lines = so.lines || [];
    if (lines.length === 1) {
      const onlyId = lines[0].itemId;
      const kLine = `${so.id}:${onlyId}`;
      if (kLine !== k) out.set(kLine, rounded);
    }
  }
  return out;
}

async function buildQcAcceptedMap(db) {
  const [prodRows, adjRows] = await Promise.all([
    db.qcEntry.findMany({
      where: { ...QC_ENTRY_ACTIVE_WHERE },
      select: {
        acceptedQty: true,
        production: {
          select: {
            workOrderLine: {
              select: {
                fgItemId: true,
                workOrder: { select: { salesOrderId: true } },
              },
            },
          },
        },
      },
    }),
    db.stockAdjustmentQcEntry.findMany({
      where: { reversedAt: null },
      select: { acceptedQty: true, salesOrderId: true, itemId: true },
    }),
  ]);
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const r of prodRows) {
    const wol = r.production?.workOrderLine;
    if (!wol?.workOrder) continue;
    const soId = wol.workOrder.salesOrderId;
    const fgId = wol.fgItemId;
    const k = `${soId}:${fgId}`;
    map.set(k, (map.get(k) || 0) + Number(r.acceptedQty));
  }
  for (const r of adjRows) {
    const k = `${r.salesOrderId}:${r.itemId}`;
    map.set(k, (map.get(k) || 0) + Number(r.acceptedQty));
  }
  return map;
}

/**
 * @param {{ qcAccepted: number; netDispatched: number; requestQty: number }} p
 */
function assertDispatchWithinQcCap({ qcAccepted, netDispatched, requestQty }) {
  const available = qcAccepted - netDispatched;
  if (requestQty > available + STOCK_EPS) {
    const err = new Error(
      `Dispatch exceeds QC-approved quantity. Available for dispatch: ${formatQtyForMessage(available)}`,
    );
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Lock/finalize gate: SO-line FIFO remainder, then usable FG (NORMAL) or min(return-QC pool, usable) (REPLACEMENT).
 * Draft create uses `skipStockCheck: true`.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ soId: number; itemId: number; lineInputs: { id: number; itemId: number; qty: number }[]; dispatchRecords: unknown[]; requestQty: number; orderType?: string | null; customerReturnId?: number | null; lockTraceDispatchId?: number | null }} params
 * @param {{ skipStockCheck?: boolean }} [opts]
 */
async function assertDispatchAllowedForSoItem(tx, params, opts = {}) {
  const { soId, itemId, lineInputs, dispatchRecords, requestQty, orderType, customerReturnId, lockTraceDispatchId } =
    params;
  const skipStockCheck = Boolean(opts.skipStockCheck);
  const bucketRemaining = remainingDispatchCapacityForSoItem(lineInputs, dispatchRecords, itemId);
  if (requestQty > bucketRemaining + STOCK_EPS) {
    const err = new Error(`Dispatch qty exceeds remaining (${bucketRemaining})`);
    err.statusCode = 400;
    throw err;
  }

  if (!skipStockCheck) {
    if (orderType === "REPLACEMENT") {
      const qcAcceptedMap = await buildQcAcceptedMap(tx);
      const soStub = {
        id: soId,
        orderType: "REPLACEMENT",
        customerReturnId: customerReturnId ?? null,
        lines: lineInputs.map((l) => ({ itemId: l.itemId })),
      };
      const replacementGrossMap = await buildReplacementReturnQcGrossBySoItemKey(tx, [soStub], qcAcceptedMap);
      const repKey = `${soId}:${itemId}`;
      let qcGross = qcAcceptedMap.get(repKey) ?? 0;
      if (replacementGrossMap.has(repKey)) {
        qcGross = replacementGrossMap.get(repKey) ?? 0;
      }
      const netOp = netDispatchedByItemId(dispatchRecords || [], DISPATCH_ALLOC_MODE.OPERATIONAL).get(itemId) ?? 0;
      const poolShipCap = getSoItemDispatchShipCap({
        orderType: "REPLACEMENT",
        onHandQty: 0,
        qcAcceptedTotalForSoItem: qcGross,
        netDispatchedOperationalForSoItem: netOp,
      });
      const onHandUsable = Number(await getItemStockQty(itemId, tx, { stockBucket: "USABLE" }));
      const allowedQty = Math.min(poolShipCap, onHandUsable);

      /** Set env `REPLACEMENT_LOCK_TRACE=1` to log pool vs finalize once, then unset. */
      const replacementLockTrace = process.env.REPLACEMENT_LOCK_TRACE === "1";
      if (replacementLockTrace) {
        // eslint-disable-next-line no-console
        console.warn("[REPLACEMENT_LOCK_TRACE]", {
          validationBranch: "REPLACEMENT_MIN_POOL_AND_USABLE",
          dispatchId: lockTraceDispatchId ?? null,
          salesOrderId: soId,
          itemId,
          orderType,
          preparedQty: requestQty,
          onHandUsable,
          replacementPoolGross: qcGross,
          netOperationalDispatched_excludingTraceContext: netOp,
          replacementPoolAvailable: poolShipCap,
          allowedQtyMinPoolAndUsable: allowedQty,
          fifoBucketRemaining: bucketRemaining,
        });
      }

      if (requestQty > allowedQty + STOCK_EPS) {
        const err = new Error(
          `Insufficient stock for dispatch. Available: ${formatQtyForMessage(allowedQty)}, required: ${formatQtyForMessage(requestQty)}.`,
        );
        err.statusCode = 400;
        throw err;
      }
      return;
    }

    await assertSufficientStockForQtyOut(tx, itemId, requestQty, "Insufficient stock for dispatch.");
  }
}

module.exports = {
  sumQcAcceptedForSoItem,
  buildQcAcceptedMap,
  buildReplacementReturnQcGrossBySoItemKey,
  assertDispatchWithinQcCap,
  assertDispatchAllowedForSoItem,
  formatQtyForMessage,
};
