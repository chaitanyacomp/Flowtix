/**
 * Phase 3E — REGULAR production RM consumption preview, variance snapshot, actual ISSUE driver.
 */

const { prisma } = require("../utils/prisma");
const { aggregateRmDemandForFgLines, round3 } = require("./bomExplosionService");
const {
  getWorkOrderProductionLocationIds,
} = require("./productionRmReadinessService");
const { getItemStockQty, STOCK_EPS, assertSufficientStockForQtyOut } = require("./stockService");
const { qtyToNumber } = require("./rmPurchaseHelpers");

const RM_CONSUMPTION_WARN_PCT = 0.05;
/** Max RM shortage (Kg) allowed at production approval due to batch vs WO rounding drift. */
const RM_CONSUMPTION_ROUNDING_TOLERANCE_KG = 0.01;

function assessRmConsumptionShortage(available, actualQty) {
  const avail = round3(n(available));
  const actual = round3(n(actualQty));
  if (actual <= avail + STOCK_EPS) {
    return { blocked: false, shortage: 0, withinTolerance: false };
  }
  const shortage = round3(actual - avail);
  if (shortage <= RM_CONSUMPTION_ROUNDING_TOLERANCE_KG + STOCK_EPS) {
    return { blocked: false, shortage, withinTolerance: true };
  }
  return { blocked: true, shortage, withinTolerance: false };
}

function roundingToleranceWarningMessage(shortage, unit = "Kg") {
  const u = String(unit || "Kg").trim() || "Kg";
  return `Allowed due to rounding tolerance: shortage ${round3(shortage)} ${u}`;
}

const CONSUMPTION_TYPES = new Set([
  "NORMAL",
  "EXTRA_PROCESS_LOSS",
  "LOWER_USAGE",
  "REWORK_RESERVED",
]);

function n(v) {
  return qtyToNumber(v);
}

function calcVariance(standardQty, actualQty) {
  const standard = n(standardQty);
  const actual = n(actualQty);
  const varianceQty = round3(actual - standard);
  const variancePercent =
    standard > STOCK_EPS ? round3((varianceQty / standard) * 100) : null;
  return { varianceQty, variancePercent };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function sumStockAtProductionLocations(db, itemId, locationIds) {
  if (!locationIds.length) return 0;
  let total = 0;
  for (const locId of locationIds) {
    total += await getItemStockQty(itemId, db, { stockBucket: "USABLE", locationId: locId });
  }
  return Math.max(0, total);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function buildStandardRmMapForBatch(db, { fgItemId, producedQty }) {
  const { rmNeeded, missingChildBoms } = await aggregateRmDemandForFgLines(db, [
    { fgItemId, fgQty: n(producedQty), bomMissing: false },
  ]);
  if (missingChildBoms.length) {
    const err = new Error("Approved child BOM missing for SFG components.");
    err.code = "BOM_CHILD_MISSING";
    err.statusCode = 400;
    throw err;
  }
  return rmNeeded;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function loadDraftProductionEntryForConsumption(db, productionEntryId) {
  const prod = await db.productionEntry.findUnique({
    where: { id: productionEntryId },
    include: {
      workOrderLine: {
        include: {
          fgItem: { select: { id: true, itemName: true, unit: true } },
          workOrder: {
            include: { salesOrder: { select: { orderType: true, docNo: true } } },
          },
        },
      },
    },
  });
  if (!prod) {
    const err = new Error("Production entry not found");
    err.statusCode = 404;
    throw err;
  }
  if (prod.workflowStatus !== "DRAFT") {
    const err = new Error("RM consumption preview is only available for draft production batches.");
    err.statusCode = 409;
    throw err;
  }
  const orderType = prod.workOrderLine?.workOrder?.salesOrder?.orderType;
  const isRegular = orderType != null && orderType !== "NO_QTY";
  return { prod, isRegular };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function buildRmConsumptionPreview(db, productionEntryId) {
  const { prod, isRegular } = await loadDraftProductionEntryForConsumption(db, productionEntryId);
  if (!isRegular) {
    return { skipped: true, reason: "NO_QTY" };
  }

  const wol = prod.workOrderLine;
  const wo = wol.workOrder;
  const standardMap = await buildStandardRmMapForBatch(db, {
    fgItemId: wol.fgItemId,
    producedQty: prod.producedQty,
  });
  const prodLocIds = await getWorkOrderProductionLocationIds(db, wo.id);

  const itemIds = [...standardMap.keys()];
  const items = itemIds.length
    ? await db.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, itemName: true, unit: true },
      })
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  const lines = [];
  for (const itemId of [...itemIds].sort((a, b) => a - b)) {
    const standardQty = round3(n(standardMap.get(itemId)));
    if (standardQty <= STOCK_EPS) continue;
    const availableAtProduction = round3(
      await sumStockAtProductionLocations(db, itemId, prodLocIds),
    );
    lines.push({
      itemId,
      itemName: itemById.get(itemId)?.itemName ?? `Item #${itemId}`,
      unit: itemById.get(itemId)?.unit ?? "",
      standardQty,
      suggestedActualQty: standardQty,
      availableAtProduction,
    });
  }

  return {
    productionEntryId: prod.id,
    producedQty: n(prod.producedQty),
    workOrderId: wo.id,
    workOrderNo: wo.docNo,
    fgItemId: wol.fgItemId,
    fgItemName: wol.fgItem?.itemName ?? "",
    fgUnit: wol.fgItem?.unit ?? "",
    warnThresholdPercent: RM_CONSUMPTION_WARN_PCT * 100,
    roundingToleranceKg: RM_CONSUMPTION_ROUNDING_TOLERANCE_KG,
    lines,
  };
}

/**
 * @param {Array<{ itemId: number, actualQty: number, remarks?: string | null, consumptionType?: string | null }> | undefined} inputLines
 * @param {Map<number, number>} standardMap
 */
function mergeActualWithStandard(inputLines, standardMap) {
  const byItem = new Map();
  if (inputLines?.length) {
    for (const ln of inputLines) {
      byItem.set(ln.itemId, ln);
    }
  }

  /** @type {Array<{ itemId: number, standardQty: number, actualQty: number, remarks: string | null, consumptionType: string | null }>} */
  const merged = [];
  for (const [itemId, standardQty] of standardMap) {
    const standard = round3(n(standardQty));
    if (standard <= STOCK_EPS) continue;
    const input = byItem.get(itemId);
    const actual = input != null ? round3(n(input.actualQty)) : standard;
    merged.push({
      itemId,
      standardQty: standard,
      actualQty: actual,
      remarks: input?.remarks?.trim() || null,
      consumptionType:
        input?.consumptionType && CONSUMPTION_TYPES.has(String(input.consumptionType))
          ? String(input.consumptionType)
          : null,
    });
  }

  if (inputLines?.length) {
    for (const ln of inputLines) {
      if (!standardMap.has(ln.itemId)) {
        const err = new Error(`Item #${ln.itemId} is not part of the standard BOM consumption for this batch.`);
        err.statusCode = 400;
        throw err;
      }
    }
  }

  return merged;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ workOrderId: number, lines: ReturnType<typeof mergeActualWithStandard> }} params
 */
async function validateActualConsumptionForApproval(tx, { workOrderId, lines }) {
  const prodLocIds = await getWorkOrderProductionLocationIds(tx, workOrderId);
  if (!prodLocIds.length) {
    const err = new Error(
      "Production blocked: no material has been issued to a production location for this work order.",
    );
    err.code = "PRODUCTION_RM_NO_PRODUCTION_STOCK";
    err.statusCode = 409;
    throw err;
  }

  /** @type {string[]} */
  const warnings = [];

  for (const ln of lines) {
    if (ln.actualQty <= STOCK_EPS) {
      const err = new Error(`Actual used must be positive for item #${ln.itemId}.`);
      err.statusCode = 400;
      throw err;
    }

    const available = await sumStockAtProductionLocations(tx, ln.itemId, prodLocIds);
    const shortageCheck = assessRmConsumptionShortage(available, ln.actualQty);
    if (shortageCheck.blocked) {
      const item = await tx.item.findUnique({
        where: { id: ln.itemId },
        select: { itemName: true },
      });
      const err = new Error(
        `Actual used exceeds available RM at production for ${item?.itemName || `item #${ln.itemId}`} (available: ${round3(available)}, requested: ${ln.actualQty}).`,
      );
      err.statusCode = 409;
      err.code = "PRODUCTION_RM_INSUFFICIENT";
      throw err;
    }
    if (shortageCheck.withinTolerance) {
      const item = await tx.item.findUnique({
        where: { id: ln.itemId },
        select: { itemName: true, unit: true },
      });
      warnings.push(
        roundingToleranceWarningMessage(shortageCheck.shortage, item?.unit ?? "Kg"),
      );
    }

    const warnAt = ln.standardQty * (1 + RM_CONSUMPTION_WARN_PCT);
    if (ln.actualQty > warnAt + STOCK_EPS) {
      const item = await tx.item.findUnique({
        where: { id: ln.itemId },
        select: { itemName: true },
      });
      warnings.push(
        `${item?.itemName || `Item #${ln.itemId}`}: consumption exceeds standard by more than ${RM_CONSUMPTION_WARN_PCT * 100}%.`,
      );
    }
  }

  return { warnings, prodLocIds };
}

/**
 * Guards against duplicate immutable consumption snapshots.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} productionEntryId
 */
async function assertProductionEntryConsumptionSnapshotNotExists(tx, productionEntryId) {
  const id = Number(productionEntryId);
  const snapshotCount = await tx.productionEntryRmConsumption.count({
    where: { productionEntryId: id },
  });
  if (snapshotCount > 0) {
    const err = new Error("Production consumption snapshot already exists for this batch.");
    err.statusCode = 409;
    err.code = "PRODUCTION_LEDGER_ALREADY_POSTED";
    throw err;
  }
}

/**
 * Guards against duplicate ledger posting on production entry approval.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} productionEntryId
 */
async function assertProductionEntryLedgerNotPosted(tx, productionEntryId) {
  const id = Number(productionEntryId);
  await assertProductionEntryConsumptionSnapshotNotExists(tx, id);
  const issueCount = await tx.stockTransaction.count({
    where: {
      refId: id,
      transactionType: "ISSUE",
      qtyOut: { gt: 0 },
    },
  });
  if (issueCount > 0) {
    const err = new Error("Production ledger already posted for this batch.");
    err.statusCode = 409;
    err.code = "PRODUCTION_LEDGER_ALREADY_POSTED";
    throw err;
  }
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function persistProductionEntryRmConsumption(tx, productionEntryId, lines) {
  await assertProductionEntryConsumptionSnapshotNotExists(tx, productionEntryId);
  for (const ln of lines) {
    const { varianceQty, variancePercent } = calcVariance(ln.standardQty, ln.actualQty);
    await tx.productionEntryRmConsumption.create({
      data: {
        productionEntryId,
        itemId: ln.itemId,
        standardQty: String(ln.standardQty),
        actualQty: String(ln.actualQty),
        varianceQty: String(varianceQty),
        variancePercent: variancePercent != null ? String(variancePercent) : null,
        consumptionType: ln.consumptionType ?? undefined,
        remarks: ln.remarks,
      },
    });
  }
}

/**
 * Resolve standard + actual lines for REGULAR approval.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ fgItemId: number, producedQty: unknown, workOrderId: number, consumptionLines?: Array<{ itemId: number, actualQty: number, remarks?: string | null, consumptionType?: string | null }> }} params
 */
async function resolveConsumptionForRegularApproval(tx, params) {
  const standardMap = await buildStandardRmMapForBatch(tx, {
    fgItemId: params.fgItemId,
    producedQty: params.producedQty,
  });
  const lines = mergeActualWithStandard(params.consumptionLines, standardMap);
  const { warnings } = await validateActualConsumptionForApproval(tx, {
    workOrderId: params.workOrderId,
    lines,
  });
  const actualQtyByItemId = new Map(lines.map((l) => [l.itemId, l.actualQty]));
  return { lines, warnings, actualQtyByItemId };
}

/**
 * Posts RM consumption ledger (stock ISSUE + immutable snapshot) for an approved production batch.
 * Caller must have validated gate G1 and entry approvability first.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function postProductionEntryLedgerOnApproval(
  tx,
  {
    productionId,
    prod,
    isRegular,
    consumptionLines,
  },
) {
  const wol = prod.workOrderLine;
  const fgItemId = wol.fgItemId;
  const producedQtyNum = n(prod.producedQty);
  const workOrderId = wol.workOrderId;

  await assertProductionEntryLedgerNotPosted(tx, productionId);

  const { approvedBomWhere, approvedBomOrderBy } = require("./bomStatus");
  const { effectiveQtyPerUnit } = require("./bomUtils");
  const {
    issueRmForApprovedProductionFromPmrLocations,
    issueRmStockForProductionBatchAtProductionLocations,
    getWorkOrderProductionLocationIds,
  } = require("./productionRmReadinessService");
  const { aggregateRmDemandForFgLines } = require("./bomExplosionService");

  const bomPre = await tx.bom.findFirst({
    where: approvedBomWhere(fgItemId),
    orderBy: approvedBomOrderBy,
    include: { lines: true },
  });
  if (!bomPre || !bomPre.lines?.length) {
    const bomErr = new Error("BOM_MISSING");
    bomErr.code = "BOM_MISSING";
    bomErr.statusCode = 400;
    throw bomErr;
  }

  /** @type {{ itemId: number; stockBefore: number; stockAfter?: number }[]} */
  const rmStock = [];
  if (isRegular) {
    const prodLocIds = await getWorkOrderProductionLocationIds(tx, workOrderId);
    const { rmNeeded } = await aggregateRmDemandForFgLines(tx, [
      { fgItemId, fgQty: producedQtyNum, bomMissing: false },
    ]);
    for (const [rmItemId] of rmNeeded) {
      let before = 0;
      for (const locId of prodLocIds) {
        before += await getItemStockQty(rmItemId, tx, { stockBucket: "USABLE", locationId: locId });
      }
      rmStock.push({ itemId: rmItemId, stockBefore: before });
    }
  } else {
    for (const line of bomPre.lines) {
      const perUnit = effectiveQtyPerUnit(
        line.baseQtyPerFg ?? line.baseQty,
        line.wastagePercent,
        line.qcAllowancePercent,
      );
      if (perUnit * producedQtyNum <= STOCK_EPS) continue;
      rmStock.push({
        itemId: line.rmItemId,
        stockBefore: await getItemStockQty(line.rmItemId, tx),
      });
    }
  }

  let bomFound = false;
  /** @type {string[]} */
  let consumptionWarnings = [];
  if (isRegular) {
    const resolved = await resolveConsumptionForRegularApproval(tx, {
      fgItemId,
      producedQty: prod.producedQty,
      workOrderId,
      consumptionLines,
    });
    consumptionWarnings = resolved.warnings;
    bomFound = await issueRmStockForProductionBatchAtProductionLocations(tx, {
      productionId,
      workOrderId,
      actualQtyByItemId: resolved.actualQtyByItemId,
      roundingToleranceKg: RM_CONSUMPTION_ROUNDING_TOLERANCE_KG,
    });
    await persistProductionEntryRmConsumption(tx, productionId, resolved.lines);
  } else {
    bomFound = await issueRmForApprovedProductionFromPmrLocations(tx, {
      productionId,
      workOrderId,
      fgItemId,
      producedQty: prod.producedQty,
    });
  }

  for (const row of rmStock) {
    if (isRegular) {
      const prodLocIds = await getWorkOrderProductionLocationIds(tx, workOrderId);
      let after = 0;
      for (const locId of prodLocIds) {
        after += await getItemStockQty(row.itemId, tx, { stockBucket: "USABLE", locationId: locId });
      }
      row.stockAfter = after;
    } else {
      row.stockAfter = await getItemStockQty(row.itemId, tx);
    }
  }

  return { bomFound, consumptionWarnings, rmStock, fgItemId, producedQtyNum, workOrderId, wol };
}

module.exports = {
  RM_CONSUMPTION_WARN_PCT,
  RM_CONSUMPTION_ROUNDING_TOLERANCE_KG,
  assessRmConsumptionShortage,
  roundingToleranceWarningMessage,
  buildRmConsumptionPreview,
  resolveConsumptionForRegularApproval,
  assertProductionEntryConsumptionSnapshotNotExists,
  assertProductionEntryLedgerNotPosted,
  postProductionEntryLedgerOnApproval,
  persistProductionEntryRmConsumption,
  buildStandardRmMapForBatch,
  calcVariance,
};
