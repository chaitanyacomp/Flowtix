/**
 * Phase 3C — REGULAR WO production gated on PMR/MIN issued RM at production locations.
 * NO_QTY flows are unchanged.
 */

const { prisma } = require("../utils/prisma");
const { aggregateRmDemandForFgLines, round3 } = require("./bomExplosionService");
const { approvedBomWhere, approvedBomOrderBy } = require("./bomStatus");
const { getItemStockQty, STOCK_EPS, assertSufficientStockForQtyOut } = require("./stockService");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const {
  getWorkOrderProductionLocationIdsForReturn,
  loadGrossIssuedByWorkOrder,
  loadNetConsumedAtProduction,
  loadReturnedByWorkOrder,
} = require("./materialReturnService");

const SUBMITTED_PMR_STATUSES = ["REQUESTED", "PARTIALLY_ISSUED", "FULLY_ISSUED"];
const PRODUCTION_QTY_EPS = 1e-6;

/** @typedef {'NO_PMR'|'PMR_DRAFT_ONLY'|'WAITING_STORE_ISSUE'|'PARTIAL_READY'|'FULLY_ISSUED_READY'} ReadinessGate */

function n(v) {
  return qtyToNumber(v);
}

function floorFgQty(rmAvailable, perUnitFg) {
  if (!(perUnitFg > STOCK_EPS)) return Infinity;
  return Math.floor((Math.max(0, rmAvailable) + STOCK_EPS) / perUnitFg);
}

function productionQtyExceedsRmAllowed({ producedQty, productionAllowedNowQty, otherUnapprovedQty = 0 }) {
  const qty = n(producedQty);
  const allowed = n(productionAllowedNowQty);
  const reserved = n(otherUnapprovedQty);
  return reserved + qty > allowed + Math.max(STOCK_EPS, PRODUCTION_QTY_EPS);
}

async function loadOtherUnapprovedProductionQty(tx, workOrderLineId, excludeProductionId) {
  const where = {
    workOrderLineId,
    workflowStatus: { not: "APPROVED" },
  };
  if (excludeProductionId != null) {
    where.id = { not: excludeProductionId };
  }
  const agg = await tx.productionEntry.aggregate({
    where,
    _sum: { producedQty: true },
  });
  return n(agg._sum.producedQty);
}

/**
 * Production / WIP destination locations used for this WO via PMR-linked MINs.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function getWorkOrderProductionLocationIds(db, workOrderId) {
  const notes = await db.materialIssueNote.findMany({
    where: {
      workOrderId,
      productionMaterialRequestId: { not: null },
    },
    select: { toLocationId: true },
  });
  return [...new Set(notes.map((m) => m.toLocationId).filter((id) => Number.isFinite(id)))];
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function sumStockAtLocations(db, itemId, locationIds) {
  if (!locationIds.length) return 0;
  let total = 0;
  for (const locId of locationIds) {
    total += await getItemStockQty(itemId, db, { stockBucket: "USABLE", locationId: locId });
  }
  return Math.max(0, total);
}

/**
 * RM net consumed (ISSUE qtyOut − reversal qtyIn) at production locations for approved batches.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function loadConsumedRmAtProductionForWorkOrder(db, workOrderId, locationIds) {
  return loadNetConsumedAtProduction(db, workOrderId, locationIds);
}

/**
 * Per-unit FG RM demand (qty per 1 FG) via approved BOM explosion.
 * @returns {Promise<Map<number, number>>}
 */
async function loadRmPerFgUnit(db, fgItemId) {
  const bom = await db.bom.findFirst({
    where: approvedBomWhere(fgItemId),
    orderBy: approvedBomOrderBy,
    select: { id: true },
  });
  if (!bom) return { perUnit: new Map(), missingChildBoms: [], bomMissing: true };
  const { rmNeeded, missingChildBoms } = await aggregateRmDemandForFgLines(db, [
    { fgItemId, fgQty: 1, bomMissing: false },
  ]);
  return { perUnit: rmNeeded, missingChildBoms, bomMissing: false };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function loadSubmittedPmrsForWorkOrder(db, workOrderId) {
  return db.productionMaterialRequest.findMany({
    where: {
      workOrderId,
      status: { in: SUBMITTED_PMR_STATUSES },
    },
    include: {
      lines: { include: { item: { select: { id: true, itemName: true, unit: true } } } },
      materialIssueNotes: { select: { id: true, docNo: true, toLocationId: true, createdAt: true } },
    },
    orderBy: { id: "desc" },
  });
}

function resolveReadinessGate(pmrs, totalIssued) {
  if (!pmrs.length) {
    return { gate: /** @type {ReadinessGate} */ ("NO_PMR"), hasDraftOnly: false };
  }
  if (totalIssued <= STOCK_EPS) {
    return { gate: "WAITING_STORE_ISSUE", hasDraftOnly: false };
  }
  const allFull = pmrs.every((p) => p.status === "FULLY_ISSUED");
  return {
    gate: allFull ? "FULLY_ISSUED_READY" : "PARTIAL_READY",
    hasDraftOnly: false,
  };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function buildProductionRmReadiness(db, workOrderLineId) {
  const wol = await db.workOrderLine.findUnique({
    where: { id: workOrderLineId },
    include: {
      fgItem: { select: { id: true, itemName: true, unit: true } },
      workOrder: {
        include: { salesOrder: { select: { id: true, orderType: true, docNo: true } } },
      },
    },
  });
  if (!wol) {
    const err = new Error("Work order line not found");
    err.statusCode = 404;
    throw err;
  }

  const wo = wol.workOrder;
  const woQty = n(wol.qty);
  const fgItemId = wol.fgItemId;
  const fgName = wol.fgItem?.itemName ?? `Item #${fgItemId}`;
  const fgUnit = wol.fgItem?.unit ?? "";

  const draftPmrs = await db.productionMaterialRequest.count({
    where: { workOrderId: wo.id, status: "DRAFT" },
  });
  const submittedPmrs = await loadSubmittedPmrsForWorkOrder(db, wo.id);

  const grossIssuedByItem = await loadGrossIssuedByWorkOrder(db, wo.id);
  const issuedByItem = grossIssuedByItem;
  const totalIssued = [...issuedByItem.values()].reduce((s, v) => s + v, 0);

  let gateInfo;
  if (!submittedPmrs.length) {
    gateInfo = {
      gate: draftPmrs > 0 ? /** @type {ReadinessGate} */ ("PMR_DRAFT_ONLY") : "NO_PMR",
      hasDraftOnly: draftPmrs > 0,
    };
  } else {
    gateInfo = resolveReadinessGate(submittedPmrs, totalIssued);
  }

  const { rmNeeded: requiredForWo, missingChildBoms, bomMissing } = await (async () => {
    const bom = await db.bom.findFirst({ where: approvedBomWhere(fgItemId), orderBy: approvedBomOrderBy });
    if (!bom) return { rmNeeded: new Map(), missingChildBoms: [], bomMissing: true };
    return aggregateRmDemandForFgLines(db, [{ fgItemId, fgQty: woQty, bomMissing: false }]);
  })();

  const { perUnit, missingChildBoms: perUnitMissing, bomMissing: perUnitBomMissing } =
    await loadRmPerFgUnit(db, fgItemId);

  const prodLocIds = await getWorkOrderProductionLocationIds(db, wo.id);
  const prodLocIdsForStock = await getWorkOrderProductionLocationIdsForReturn(db, wo.id);
  const stockLocIds = prodLocIdsForStock.length ? prodLocIdsForStock : prodLocIds;
  const consumedMap = await loadConsumedRmAtProductionForWorkOrder(db, wo.id, stockLocIds);
  const returnedMap = await loadReturnedByWorkOrder(db, wo.id);

  const itemIds = new Set([
    ...requiredForWo.keys(),
    ...issuedByItem.keys(),
    ...perUnit.keys(),
  ]);

  const items = itemIds.size
    ? await db.item.findMany({
        where: { id: { in: [...itemIds] } },
        select: { id: true, itemName: true, unit: true },
      })
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  /** @type {Array<Record<string, unknown>>} */
  const rmLines = [];
  let maxProducibleQty = woQty;
  let hasRmRows = false;

  for (const itemId of [...itemIds].sort((a, b) => a - b)) {
    const perFg = n(perUnit.get(itemId));
    if (!(perFg > STOCK_EPS)) continue;
    hasRmRows = true;
    const required = n(requiredForWo.get(itemId));
    const grossIssued = n(issuedByItem.get(itemId));
    const returned = n(returnedMap.get(itemId));
    const netIssued = round3(Math.max(0, grossIssued - returned));
    const onHand = await sumStockAtLocations(db, itemId, stockLocIds);
    const alreadyConsumed = n(consumedMap.get(itemId));
    const logicalAvailable = round3(Math.max(0, grossIssued - alreadyConsumed - returned));
    const available = round3(Math.min(onHand, logicalAvailable > STOCK_EPS ? logicalAvailable : onHand));
    const returnableQty = round3(Math.max(0, Math.min(grossIssued - alreadyConsumed - returned, onHand)));
    const canSupport = floorFgQty(available, perFg);
    if (canSupport < maxProducibleQty) maxProducibleQty = canSupport;

    let status = "OK";
    if (grossIssued <= STOCK_EPS) status = "NOT_ISSUED";
    else if (available + STOCK_EPS < perFg) status = "SHORT";
    else if (available + STOCK_EPS < required - alreadyConsumed) status = "PARTIAL";

    rmLines.push({
      rmItemId: itemId,
      rmItemName: itemById.get(itemId)?.itemName ?? `Item #${itemId}`,
      unit: itemById.get(itemId)?.unit ?? "",
      requiredForWo: round3(required),
      issuedToProduction: round3(grossIssued),
      netIssuedToProduction: netIssued,
      alreadyConsumed: round3(alreadyConsumed),
      returnedToStore: round3(returned),
      returnableQty,
      availableInProduction: round3(available),
      onHandAtProduction: round3(onHand),
      canSupportFgQty: canSupport === Infinity ? 0 : canSupport,
      status,
      perUnitRm: round3(perFg),
    });
  }

  if (!hasRmRows || bomMissing || perUnitBomMissing) {
    maxProducibleQty = 0;
  }

  maxProducibleQty = Math.max(0, Math.floor(maxProducibleQty));

  const agg = await db.productionEntry.aggregate({
    where: { workOrderLineId },
    _sum: { producedQty: true },
  });
  const draftAndApproved = n(agg._sum.producedQty);
  const unapprovedAgg = await db.productionEntry.aggregate({
    where: { workOrderLineId, workflowStatus: { not: "APPROVED" } },
    _sum: { producedQty: true },
  });
  const unapprovedProduced = n(unapprovedAgg._sum.producedQty);
  const approvedAgg = await db.productionEntry.aggregate({
    where: { workOrderLineId, workflowStatus: "APPROVED" },
    _sum: { producedQty: true },
  });
  const approvedProduced = n(approvedAgg._sum.producedQty);
  const woRemaining = Math.max(0, woQty - approvedProduced);
  const maxAdditionalQty = Math.max(0, Math.min(woRemaining, maxProducibleQty - unapprovedProduced));

  const latestPmr = submittedPmrs[0] ?? null;

  return {
    workOrderId: wo.id,
    workOrderLineId: wol.id,
    workOrderNo: wo.docNo,
    salesOrderNo: wo.salesOrder?.docNo ?? null,
    fgItemId,
    fgItemName: fgName,
    fgUnit,
    woQty,
    woRemainingQty: round3(woRemaining),
    approvedProducedQty: round3(approvedProduced),
    draftAndApprovedQty: round3(draftAndApproved),
    unapprovedProducedQty: round3(unapprovedProduced),
    gate: gateInfo.gate,
    hasDraftPmr: draftPmrs > 0,
    productionAllowedNowQty: maxProducibleQty,
    maxAdditionalQty,
    productionLocationIds: prodLocIds,
    bomMissing: bomMissing || perUnitBomMissing,
    missingChildBoms: [...(missingChildBoms || []), ...(perUnitMissing || [])].filter(
      (m, i, arr) => arr.findIndex((x) => x.sfgItemId === m.sfgItemId) === i,
    ),
    pmrCount: submittedPmrs.length,
    latestPmrId: latestPmr?.id ?? null,
    latestPmrDocNo: latestPmr?.docNo ?? null,
    rmLines,
    /** Backend flags for future dashboard use */
    flags: {
      waitingForMaterialRequest: gateInfo.gate === "NO_PMR" || gateInfo.gate === "PMR_DRAFT_ONLY",
      waitingForStoreIssue: gateInfo.gate === "WAITING_STORE_ISSUE",
      readyForProduction:
        gateInfo.gate === "PARTIAL_READY" || gateInfo.gate === "FULLY_ISSUED_READY",
      partiallyReady: gateInfo.gate === "PARTIAL_READY",
    },
  };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function assertRegularProductionRmReadiness(tx, {
  workOrderLineId,
  producedQty,
  excludeProductionId,
}) {
  const readiness = await buildProductionRmReadiness(tx, workOrderLineId);
  const qty = n(producedQty);
  if (qty <= STOCK_EPS) {
    const err = new Error("Production quantity must be positive.");
    err.statusCode = 400;
    throw err;
  }

  if (readiness.bomMissing) {
    const err = new Error("BOM_MISSING");
    err.code = "BOM_MISSING";
    err.statusCode = 400;
    throw err;
  }

  if (readiness.missingChildBoms?.length) {
    const err = new Error("Approved child BOM missing for SFG components.");
    err.code = "BOM_CHILD_MISSING";
    err.statusCode = 400;
    throw err;
  }

  if (readiness.gate === "NO_PMR" || readiness.gate === "PMR_DRAFT_ONLY") {
    const err = new Error(
      "Production blocked: material request not raised. Create and submit a PMR before starting production.",
    );
    err.code = "PRODUCTION_RM_NO_PMR";
    err.statusCode = 409;
    throw err;
  }

  if (readiness.gate === "WAITING_STORE_ISSUE") {
    const err = new Error(
      "Production blocked: material requested, waiting for Store issue to production location.",
    );
    err.code = "PRODUCTION_RM_WAITING_ISSUE";
    err.statusCode = 409;
    throw err;
  }

  const otherUnapprovedQty = await loadOtherUnapprovedProductionQty(tx, workOrderLineId, excludeProductionId);
  const maxAllowed = readiness.productionAllowedNowQty;
  if (
    productionQtyExceedsRmAllowed({
      producedQty: qty,
      productionAllowedNowQty: maxAllowed,
      otherUnapprovedQty,
    })
  ) {
    const fmt = (x) => (Number.isInteger(x) ? String(x) : Number(x).toFixed(3));
    const err = new Error(
      `Production blocked: issued RM can support only ${fmt(maxAllowed)} qty for this work order.`,
    );
    err.code = "PRODUCTION_RM_INSUFFICIENT";
    err.statusCode = 409;
    err.readiness = readiness;
    throw err;
  }

  return readiness;
}

/**
 * Issue RM from production/WIP locations (REGULAR only). Posts actualQty per item (Phase 3E).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ productionId: number, workOrderId: number, actualQtyByItemId: Map<number, number> | Record<number, number> }} params
 */
async function issueRmStockForProductionBatchAtProductionLocations(
  tx,
  { productionId, workOrderId, actualQtyByItemId, roundingToleranceKg = 0 },
) {
  const tolerance = Math.max(0, n(roundingToleranceKg));
  const prodLocIds = await getWorkOrderProductionLocationIds(tx, workOrderId);
  if (!prodLocIds.length) {
    const err = new Error(
      "Production blocked: no material has been issued to a production location for this work order.",
    );
    err.code = "PRODUCTION_RM_NO_PRODUCTION_STOCK";
    err.statusCode = 409;
    throw err;
  }

  const entries =
    actualQtyByItemId instanceof Map
      ? [...actualQtyByItemId.entries()]
      : Object.entries(actualQtyByItemId || {}).map(([k, v]) => [Number(k), v]);

  for (const [rmItemId, rmQtyOut] of entries) {
    const qtyOut = n(rmQtyOut);
    if (qtyOut <= STOCK_EPS) continue;
    let remaining = qtyOut;
    const locBalances = [];
    for (const locId of prodLocIds) {
      const bal = await getItemStockQty(rmItemId, tx, { stockBucket: "USABLE", locationId: locId });
      if (bal > STOCK_EPS) locBalances.push({ locId, bal });
    }
    locBalances.sort((a, b) => b.bal - a.bal);

    for (const { locId, bal } of locBalances) {
      if (remaining <= STOCK_EPS) break;
      const take = Math.min(remaining, bal);
      if (take <= STOCK_EPS) continue;
      await assertSufficientStockForQtyOut(
        tx,
        rmItemId,
        take,
        `Insufficient RM at production location for item #${rmItemId}.`,
        { stockBucket: "USABLE", locationId: locId },
      );
      await tx.stockTransaction.create({
        data: {
          itemId: rmItemId,
          locationId: locId,
          transactionType: "ISSUE",
          refId: productionId,
          stockBucket: "USABLE",
          qtyIn: "0",
          qtyOut: String(take),
        },
      });
      remaining -= take;
    }

    if (remaining > STOCK_EPS) {
      if (tolerance > STOCK_EPS && remaining <= tolerance + STOCK_EPS) {
        const locId = locBalances[0]?.locId ?? prodLocIds[0];
        await tx.stockTransaction.create({
          data: {
            itemId: rmItemId,
            locationId: locId,
            transactionType: "ISSUE",
            refId: productionId,
            stockBucket: "USABLE",
            qtyIn: "0",
            qtyOut: String(remaining),
          },
        });
        remaining = 0;
      } else {
        const err = new Error(
          `Insufficient raw material at production location for production (item #${rmItemId}, short: ${remaining}).`,
        );
        err.statusCode = 409;
        err.code = "PRODUCTION_RM_INSUFFICIENT";
        throw err;
      }
    }
  }
  return true;
}

/**
 * Reverse production RM issues at the same production locations as original ISSUE rows.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function returnRmStockForProductionBatchFromProductionLocations(tx, { productionId }) {
  const issues = await tx.stockTransaction.findMany({
    where: {
      refId: productionId,
      transactionType: "ISSUE",
      stockBucket: "USABLE",
      qtyOut: { gt: 0 },
      locationId: { not: null },
    },
  });
  const touchedRmItemIds = [];
  for (const row of issues) {
    const qty = n(row.qtyOut);
    if (qty <= STOCK_EPS) continue;
    touchedRmItemIds.push(row.itemId);
    await tx.stockTransaction.create({
      data: {
        itemId: row.itemId,
        locationId: row.locationId,
        transactionType: "ISSUE",
        refId: productionId,
        stockBucket: "USABLE",
        qtyIn: String(qty),
        qtyOut: "0",
      },
    });
  }
  return { touchedRmItemIds: [...new Set(touchedRmItemIds)] };
}

/**
 * Attach Phase 3C gate fields to REGULAR production-queue rows (dashboard / workspace).
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {Array<{ orderType?: string | null, workOrderLineId?: number }>} rows
 */
async function attachRmReadinessToProductionQueueRows(db, rows) {
  const targets = rows.filter(
    (r) => r.orderType !== "NO_QTY" && Number(r.workOrderLineId) > 0,
  );
  await Promise.all(
    targets.map(async (row) => {
      try {
        const snap = await buildProductionRmReadiness(db, row.workOrderLineId);
        row.rmReadinessGate = snap.gate;
        row.rmProductionAllowedNowQty = snap.productionAllowedNowQty;
        row.rmReadyForProduction = Boolean(
          snap.flags?.readyForProduction && snap.productionAllowedNowQty > STOCK_EPS,
        );
      } catch {
        row.rmReadinessGate = "NO_PMR";
        row.rmProductionAllowedNowQty = 0;
        row.rmReadyForProduction = false;
      }
    }),
  );
  return rows;
}

module.exports = {
  SUBMITTED_PMR_STATUSES,
  floorFgQty,
  productionQtyExceedsRmAllowed,
  resolveReadinessGate,
  getWorkOrderProductionLocationIds,
  buildProductionRmReadiness,
  assertRegularProductionRmReadiness,
  issueRmStockForProductionBatchAtProductionLocations,
  returnRmStockForProductionBatchFromProductionLocations,
  attachRmReadinessToProductionQueueRows,
};
