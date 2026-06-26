const express = require("express");
const { z } = require("zod");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { effectiveQtyPerUnit } = require("../services/bomUtils");
const { filterBomLinesForRmIssue } = require("../services/bomComponentService");
const {
  assertSufficientStockForQtyOut,
  assertNonNegativeStockAfterNetChange,
  getItemStockQty,
  getUsableItemStockQty,
  STOCK_EPS,
} = require("../services/stockService");
const auditLog = require("../services/auditLog");
const { logActivity } = require("../services/activityLogService");
const {
  ACTIVITY_MODULES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} = require("../constants/activityLogConstants");
const {
  displayWorkOrderNo,
  displayProductionEntryNo,
  displayQcEntryNo,
  displaySalesOrderNo,
} = require("../utils/docNoLabels");
const { sumQcAcceptedForSoItem } = require("../services/dispatchQcCap");
const { netDispatchedForSoItem, assertWorkOrderAllowsStructuralEdit } = require("../services/transactionalIntegrityGuards");
const {
  remainingDispatchCapacityForSoItem,
  netDispatchedByItemId,
  DISPATCH_ALLOC_MODE,
} = require("../services/salesOrderDispatchAllocation");
const { mapSoLinesToDispatchFifoInputs } = require("../services/regularSoBufferQty");
const { upsertRegularSoPlanningSnapshot } = require("../services/regularSoPlanningSnapshotService");
const {
  ensureSubmittedProductionMaterialRequestForWorkOrder,
} = require("../services/productionMaterialRequestService");
const {
  assertWorkOrderLinesAgainstSalesOrder,
  loadWorkOrderQuantityContext,
  getSalesOrderFgWorkOrderBalances,
  getEligibleSalesOrderIdsForWorkOrder,
  EPS: WO_SO_EPS,
} = require("../services/workOrderSoValidation");
const { lockSalesOrderForUpdate, lockItemForUpdate } = require("../services/dispatchWriteLocks");
const {
  lockWorkOrderLineForUpdate,
  lockProductionEntryForUpdate,
  lockWorkOrderForUpdate,
  lockQcEntryForUpdate,
} = require("../services/productionWriteLocks");
const { QC_ENTRY_ACTIVE_WHERE } = require("../services/qcEntryConstants");
const {
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
  getProductionBatchQcPendingQty,
  getWoLineRemainingProductionQty,
  getSoItemDispatchableReadyQty,
  getSoItemQcApprovedRemainingQty,
  REPORT_QUEUE_EPS,
} = require("../services/reportMetrics");
const {
  assertProductionEntryHasNoQcHistory,
  countAllQcEntriesForProduction,
} = require("../services/productionEntryIntegrity");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("../services/productionMetrics");
const productionRouter = express.Router();
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("../services/docNoService");
const { normalizePositiveCycleId } = require("../utils/cycleIds");
const {
  assertNoQtyWorkOrderExecutionReleased,
  filterNoQtyExecutionReleasedWorkOrders,
} = require("../services/noQtyExecutionBoundaryService");
const { maybeAutoCloseSalesOrderOperationally } = require("../services/salesOrderOperationalAutoClose");
const { approvedBomWhere, approvedBomOrderBy } = require("../services/bomStatus");
const { evaluateWoPrepareReadiness } = require("../services/materialPlanningService");
const { computeFgGapLinesForSalesOrder } = require("../services/rmCheckService");
const {
  buildProductionRmReadiness,
  assertProductionRmReadiness,
  issueRmForApprovedProductionFromPmrLocations,
  issueRmStockForProductionBatchAtProductionLocations,
  returnRmStockForProductionBatchFromProductionLocations,
  getWorkOrderProductionLocationIds,
} = require("../services/productionRmReadinessService");
const { aggregateRmDemandForFgLines } = require("../services/bomExplosionService");
const {
  buildRmConsumptionPreview,
  resolveConsumptionForRegularApproval,
  persistProductionEntryRmConsumption,
  RM_CONSUMPTION_ROUNDING_TOLERANCE_KG,
} = require("../services/productionRmConsumptionService");
const {
  HOLD_REASONS,
  holdWorkOrder,
  resumeWorkOrder,
  closeWorkOrderWithShortfall,
  assertWorkOrderAllowsProduction,
  shouldFreezeStatusSync,
} = require("../services/workOrderLifecycleService");
const {
  BLOCK_REASONS,
  RESOLUTION_REASONS,
  computeExecutionSummary,
  getProductionExecutionSummary,
  assertNoQtyProductionExecutionAllowsProduction,
  blockProductionExecution,
  resumeProductionExecution,
  finishProductionExecution,
  ensureProductionExecutionRecord,
  blockReasonLabel,
} = require("../services/productionExecutionService");

async function assertNoQtyWorkOrderInActiveCycleOrThrow(tx, workOrderId, messagePrefix) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, salesOrderId: true, cycleId: true, status: true },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  const so = await tx.salesOrder.findUnique({
    where: { id: wo.salesOrderId },
    select: { id: true, orderType: true, internalStatus: true, currentCycleId: true },
  });
  if (!so) {
    const err = new Error("Sales order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (so.orderType !== "NO_QTY") return { wo, so }; // regular flows unchanged
  if (so.internalStatus === "COMPLETED" || so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED") {
    const err = new Error("This sales order is closed. Production/QC is view-only.");
    err.statusCode = 409;
    throw err;
  }
  if (wo.status === "COMPLETED" || wo.status === "REJECTED") {
    const err = new Error("This work order is not open for production.");
    err.statusCode = 409;
    throw err;
  }
  /**
   * NO_QTY: allow optional production on this WO's cycle even when {@link SalesOrder.currentCycleId}
   * has advanced (next RS / new cycle). Same RS-on-cycle guard as QC — do not require wo.cycleId === pointer.
   */
  const woCycleId = normalizePositiveCycleId(wo.cycleId);
  if (!woCycleId) {
    const err = new Error("This work order is not linked to a requirement-sheet cycle. Production cannot be recorded.");
    err.statusCode = 409;
    throw err;
  }
  const lockedOnWoCycle = await tx.requirementSheet.findFirst({
    where: { salesOrderId: so.id, cycleId: woCycleId, status: "LOCKED" },
    select: { id: true },
  });
  if (!lockedOnWoCycle) {
    const err = new Error("Requirement Sheet must be locked before production.");
    err.statusCode = 409;
    throw err;
  }
  await assertNoQtyWorkOrderExecutionReleased(tx, workOrderId, "Production");
  return { wo, so };
}

/**
 * NO_QTY only: allow QC on approved batches for the work order's own cycle when that cycle still has a LOCKED RS.
 * Production create/update/approve uses the same per-WO-cycle RS lock rule via {@link assertNoQtyWorkOrderInActiveCycleOrThrow}
 * (no longer requires `wo.cycleId === so.currentCycleId`).
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {number} workOrderId
 */
async function assertNoQtyWorkOrderEligibleForQcOrThrow(tx, workOrderId) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, salesOrderId: true, cycleId: true },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  const so = await tx.salesOrder.findUnique({
    where: { id: wo.salesOrderId },
    select: { id: true, orderType: true, internalStatus: true },
  });
  if (!so) {
    const err = new Error("Sales order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (so.orderType !== "NO_QTY") return;
  if (so.internalStatus === "COMPLETED" || so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED") {
    const err = new Error("This sales order is closed. Production/QC is view-only.");
    err.statusCode = 409;
    throw err;
  }
  const woCycleId = wo.cycleId != null ? Number(wo.cycleId) : null;
  if (!woCycleId || !Number.isFinite(woCycleId) || woCycleId <= 0) {
    const err = new Error("This production batch is not linked to a requirement-sheet cycle. QC cannot be recorded.");
    err.statusCode = 409;
    throw err;
  }
  const lockedSheet = await tx.requirementSheet.findFirst({
    where: { salesOrderId: so.id, cycleId: woCycleId, status: "LOCKED" },
    select: { id: true },
  });
  if (!lockedSheet) {
    const err = new Error("Requirement Sheet must be locked for this cycle before QC can be recorded.");
    err.statusCode = 409;
    throw err;
  }
  await assertNoQtyWorkOrderExecutionReleased(tx, workOrderId, "QC");
}

/**
 * NO_QTY: hide work orders that lack a LOCKED RS on the WO's cycle, or that are not actionable vs SO cycle drift.
 * (Aligned with dashboard {@link filterDashboardActionableWorkOrders}: RS-backed WOs stay visible when
 * {@link SalesOrder.currentCycleId} advanced before the prior-cycle WO finished.)
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {Awaited<ReturnType<import("@prisma/client").PrismaClient["workOrder"]["findMany"]>>} rowsRaw
 */
async function filterNoQtyWorkOrdersForActiveLockedCycle(prisma, rowsRaw) {
  const noQtyKeys = new Set();
  for (const wo of rowsRaw || []) {
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") continue;
    const soId = Number(so.id ?? wo.salesOrderId);
    if (!Number.isFinite(soId) || soId <= 0) continue;
    const pointerCy = normalizePositiveCycleId(so.currentCycleId);
    if (pointerCy != null) noQtyKeys.add(`${soId}:${pointerCy}`);
    const woCy = normalizePositiveCycleId(wo.cycle?.id) ?? normalizePositiveCycleId(wo.cycleId);
    if (woCy != null) noQtyKeys.add(`${soId}:${woCy}`);
  }
  const lockedSheets =
    noQtyKeys.size > 0
      ? await prisma.requirementSheet.findMany({
          where: {
            status: "LOCKED",
            OR: Array.from(noQtyKeys).map((k) => {
              const [soIdStr, cyStr] = String(k).split(":");
              return { salesOrderId: Number(soIdStr), cycleId: Number(cyStr) };
            }),
          },
          select: { salesOrderId: true, cycleId: true },
        })
      : [];
  const lockedKeySet = new Set(lockedSheets.map((s) => `${Number(s.salesOrderId)}:${Number(s.cycleId)}`));
  const filtered = (rowsRaw || []).filter((wo) => {
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") return true;
    if (so.internalStatus === "COMPLETED" || so.internalStatus === "MANUALLY_CLOSED" || so.internalStatus === "CLOSED") {
      return false;
    }
    const pointerCycleId = normalizePositiveCycleId(so.currentCycleId);
    const woCycleId =
      normalizePositiveCycleId(wo.cycle?.id) ?? normalizePositiveCycleId(wo.cycleId);
    if (woCycleId == null) return false;
    if (!lockedKeySet.has(`${so.id}:${woCycleId}`)) return false;

    if (pointerCycleId != null && woCycleId === pointerCycleId) return true;
    if (wo.requirementSheetId != null) return true;
    return wo.cycle?.status === "ACTIVE";
  });
  return filterNoQtyExecutionReleasedWorkOrders(prisma, filtered);
}

const NO_QTY_RS_RECON_EPS = 1e-6;

/**
 * Align NO_QTY WO line qty with RequirementSheetLine.suggestedWoQtySnapshot when the WO target drifted upward.
 * Does not shrink below approved produced qty (manual repair needed if that happens).
 * @param {import("@prisma/client").PrismaClient} prismaClient
 */
async function reconcileNoQtyWoLineQtyWithRsSnapshot(prismaClient, woRowsRaw, { includeCompletedWorkOrders = false } = {}) {
  /** @type {Map<string, Map<number, number>>} */
  const snapMapsBySoCycle = new Map();

  async function loadSnap(soId, cycleId) {
    const key = `${soId}:${cycleId}`;
    if (snapMapsBySoCycle.has(key)) return snapMapsBySoCycle.get(key);
    const sheet = await prismaClient.requirementSheet.findFirst({
      where: { salesOrderId: soId, cycleId, status: "LOCKED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { lines: true },
    });
    const m = new Map();
    for (const ln of sheet?.lines ?? []) {
      const iid = Number(ln.itemId);
      if (!(Number.isFinite(iid) && iid > 0)) continue;
      const raw = ln.suggestedWoQtySnapshot;
      const sug =
        raw != null && typeof raw === "object" && typeof raw.toNumber === "function"
          ? raw.toNumber()
          : Number(raw ?? 0);
      m.set(iid, (m.get(iid) ?? 0) + (Number.isFinite(sug) ? sug : 0));
    }
    snapMapsBySoCycle.set(key, m);
    return m;
  }

  const candidates = [];
  for (const wo of woRowsRaw ?? []) {
    if (!includeCompletedWorkOrders && wo.status === "COMPLETED") continue;
    const so = wo.salesOrder;
    if (!so || so.orderType !== "NO_QTY") continue;
    const cid = wo.cycleId == null ? null : Number(wo.cycleId);
    if (!(cid > 0)) continue;
    for (const l of wo.lines ?? []) {
      const itemId = Number(l.fgItemId);
      if (!(itemId > 0)) continue;
      candidates.push({ wo, line: l, soId: so.id, cycleId: cid, itemId });
    }
  }
  if (!candidates.length) return;

  const lineIds = [...new Set(candidates.map((c) => Number(c.line.id)).filter((x) => Number.isFinite(x) && x > 0))];
  const producedMap =
    lineIds.length === 0 ? new Map() : await getApprovedProducedQtyByWorkOrderLineIds(prismaClient, lineIds);

  for (const { wo, line, soId, cycleId, itemId } of candidates) {
    const snaps = await loadSnap(soId, cycleId);
    const snapNum = Number(snaps.get(itemId) ?? 0);
    if (!(snapNum > NO_QTY_RS_RECON_EPS)) continue;
    const q = Number(line.qty ?? 0);
    const approvedMade = Number(producedMap.get(line.id) ?? 0);
    if (!(q > snapNum + NO_QTY_RS_RECON_EPS)) continue;
    if (approvedMade > snapNum + NO_QTY_RS_RECON_EPS) {
      console.warn("[NO_QTY] RS suggestedWoQtySnapshot below approved produced qty; skipping WO line reconcile", {
        workOrderLineId: line.id,
        workOrderId: wo.id,
        salesOrderId: soId,
        cycleId,
        itemId,
        workOrderQty: q,
        rsSnapshotQty: snapNum,
        approvedProducedQty: approvedMade,
      });
      continue;
    }
    console.warn("[NO_QTY] WO line qty exceeded RS suggestedWoQtySnapshot — correcting downward", {
      workOrderLineId: line.id,
      workOrderId: wo.id,
      salesOrderId: soId,
      cycleId,
      itemId,
      previousQty: q,
      rsSnapshotQty: snapNum,
    });
    await prismaClient.workOrderLine.update({
      where: { id: line.id },
      data: { qty: String(snapNum), plannedQty: String(snapNum) },
    });
    line.qty = String(snapNum);
    line.plannedQty = String(snapNum);
  }
}

/**
 * Replacement / customer-return fulfillment orders must not use the production floor
 * (no work orders, no production batches, no production QC on those batches).
 */
async function assertSalesOrderNotCustomerReturnReplacementProduction(tx, salesOrderId) {
  const so = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true, orderType: true, customerReturnId: true },
  });
  if (!so) {
    const err = new Error("Sales order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (so.orderType === "REPLACEMENT" || so.customerReturnId != null) {
    const err = new Error(
      "Work orders and production batches are not allowed on customer-return replacement sales orders. Fulfillment uses customer-return QC and replacement dispatch only.",
    );
    err.statusCode = 409;
    err.code = "NO_PRODUCTION_ON_CUSTOMER_RETURN_REPLACEMENT_SO";
    throw err;
  }
}

/**
 * Shared enrichment for GET /work-orders (production line metrics; optional pending-only trim).
 * @param {import("@prisma/client").PrismaClient} db
 * @param {Awaited<ReturnType<import("@prisma/client").PrismaClient["workOrder"]["findMany"]>>} rows
 */
async function buildWorkOrderListPayload(db, rows, { pendingOnly, includeWorkOrderLineId }) {
  const lineIds = rows.flatMap((wo) => (wo.lines || []).map((l) => l.id));
  const producedByLineId =
    lineIds.length === 0 ? new Map() : await getApprovedProducedQtyByWorkOrderLineIds(db, lineIds);

  /**
   * Per-line aggregated pending QC qty, derived from approved production entries on the line.
   *
   * Planning & Cycle Planning surfaces use this to distinguish "Production Done" (no remaining
   * production, QC complete) from "QC Pending" (production approved, QC not finalized) — the
   * Work Order `status` flag alone is set to COMPLETED from approved production qty and must
   * not be treated as proof that QC has cleared.
   */
  const pendingQcByLineId = new Map();
  if (lineIds.length > 0) {
    const prodEntries = await db.productionEntry.findMany({
      where: { workOrderLineId: { in: lineIds }, workflowStatus: "APPROVED" },
      select: {
        id: true,
        workOrderLineId: true,
        producedQty: true,
        qcEntries: {
          where: QC_ENTRY_ACTIVE_WHERE,
          select: { acceptedQty: true, rejectedQty: true },
        },
      },
    });
    for (const pe of prodEntries) {
      const lid = Number(pe.workOrderLineId);
      if (!(lid > 0)) continue;
      const producedQty = Number(pe.producedQty ?? 0);
      const acc = sumActiveQcAcceptedQty(pe.qcEntries || []);
      const rej = sumActiveQcRejectedQty(pe.qcEntries || []);
      const pend = getProductionBatchQcPendingQty(producedQty, acc, rej);
      if (pend > REPORT_QUEUE_EPS) {
        pendingQcByLineId.set(lid, (pendingQcByLineId.get(lid) || 0) + pend);
      }
    }
  }

  const mapped = rows.map((wo) => {
    const linesWithMetrics = (wo.lines || []).map((l) => {
      const required = Number(l.qty);
      const usedQty = producedByLineId.get(l.id) ?? 0;
      const remainingQty = Math.max(0, required - usedQty);
      const qcPendingQty = pendingQcByLineId.get(l.id) ?? 0;
      return {
        ...l,
        approvedProducedQty: usedQty,
        remainingQty,
        qcPendingQty,
        hasPendingQc: qcPendingQty > REPORT_QUEUE_EPS,
      };
    });
    const lines = pendingOnly
      ? linesWithMetrics.filter((l) => l.remainingQty > REPORT_QUEUE_EPS || l.id === includeWorkOrderLineId)
      : linesWithMetrics;
    return { ...wo, lines };
  });
  return pendingOnly ? mapped.filter((wo) => (wo.lines || []).length > 0) : mapped;
}

/** Only APPROVED batches count toward WO completion vs planned qty. */
const PE_APPROVED = "APPROVED";
const PE_DRAFT = "DRAFT";
const PROD_TOLERANCE_PCT = 0.05;

/**
 * Sum produced qty on a WO line (draft + approved) for plan-cap checks.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ excludeProductionId?: number }} [opts]
 */
/** @deprecated All order types use {@link assertProductionRmReadiness}. */
async function isRegularProductionWorkOrderLine(tx, workOrderLineId) {
  const wol = await tx.workOrderLine.findUnique({
    where: { id: workOrderLineId },
    select: { workOrder: { select: { salesOrder: { select: { orderType: true } } } } },
  });
  const ot = wol?.workOrder?.salesOrder?.orderType;
  return ot != null && ot !== "NO_QTY";
}

async function sumProducedQtyOnLine(tx, workOrderLineId, opts = {}) {
  const where = { workOrderLineId };
  if (opts.excludeProductionId != null) {
    where.id = { not: opts.excludeProductionId };
  }
  const agg = await tx.productionEntry.aggregate({
    where,
    _sum: { producedQty: true },
  });
  return Number(agg._sum.producedQty ?? 0);
}

/**
 * Post RM ISSUE stock transactions for an approved production batch (BOM explosion).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function issueRmStockForProductionBatch(tx, { productionId, fgItemId, producedQty }) {
  const bom = await tx.bom.findFirst({
    where: approvedBomWhere(fgItemId),
    orderBy: approvedBomOrderBy,
    include: { lines: true },
  });
  if (!bom) return false;
  const issueLines = await filterBomLinesForRmIssue(tx, bom);
  for (const line of issueLines) {
    const perUnit = effectiveQtyPerUnit(line.baseQtyPerFg ?? line.baseQty, line.wastagePercent, line.qcAllowancePercent);
    const rmQtyOut = perUnit * Number(producedQty);
    await assertSufficientStockForQtyOut(
      tx,
      line.rmItemId,
      rmQtyOut,
      `Insufficient raw material stock for production (BOM issue). RM item #${line.rmItemId}, required out: ${rmQtyOut}.`,
    );
    await tx.stockTransaction.create({
      data: {
        itemId: line.rmItemId,
        transactionType: "ISSUE",
        refId: productionId,
        qtyIn: "0",
        qtyOut: String(rmQtyOut),
      },
    });
  }
  return true;
}

/**
 * For NO_QTY production approval: RM lines where on-hand stock is below BOM requirement
 * (same effective qty math as issueRmStockForProductionBatch). Used to return a structured
 * error before any RM issue runs inside the approve transaction.
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} client
 */
async function computeNoQtyRmShortagesForApproval(client, { fgItemId, producedQty }) {
  const bom = await client.bom.findFirst({
    where: approvedBomWhere(fgItemId),
    orderBy: approvedBomOrderBy,
    include: { lines: true },
  });
  if (!bom?.lines?.length) return [];
  const producedQtyNum = Number(producedQty);
  const issueLines = await filterBomLinesForRmIssue(client, bom);
  /** @type {{ rmItemId: number; rmItemName: string; requiredQty: number; availableQty: number; shortageQty: number; unitName: string }[]} */
  const shortages = [];
  const round6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
  for (const line of issueLines) {
    const perUnit = effectiveQtyPerUnit(line.baseQtyPerFg ?? line.baseQty, line.wastagePercent, line.qcAllowancePercent);
    const requiredQty = perUnit * producedQtyNum;
    if (requiredQty <= STOCK_EPS) continue;
    const availableQty = await getItemStockQty(line.rmItemId, client);
    const shortageQty = Math.max(0, requiredQty - availableQty);
    if (shortageQty > STOCK_EPS) {
      const item = await client.item.findUnique({
        where: { id: line.rmItemId },
        select: { itemName: true, unit: true },
      });
      shortages.push({
        rmItemId: line.rmItemId,
        rmItemName: item?.itemName ?? `Item #${line.rmItemId}`,
        requiredQty: round6(requiredQty),
        availableQty: round6(availableQty),
        shortageQty: round6(shortageQty),
        unitName: item?.unit ?? "",
      });
    }
  }
  return shortages;
}

/**
 * Return RM to stock for an approved batch (mirror of issueRmStockForProductionBatch).
 * Uses ISSUE rows with qtyIn only so net ledger cancels the original ISSUE qtyOut rows for this refId.
 * @returns {{ touchedRmItemIds: number[] }}
 */
async function returnRmStockForProductionBatch(tx, { productionId, fgItemId, producedQty }) {
  const bom = await tx.bom.findFirst({
    where: approvedBomWhere(fgItemId),
    orderBy: approvedBomOrderBy,
    include: { lines: true },
  });
  if (!bom) return { touchedRmItemIds: [] };
  const issueLines = await filterBomLinesForRmIssue(tx, bom);
  const touchedRmItemIds = [];
  for (const line of issueLines) {
    const perUnit = effectiveQtyPerUnit(line.baseQtyPerFg ?? line.baseQty, line.wastagePercent, line.qcAllowancePercent);
    const rmQtyIn = perUnit * Number(producedQty);
    if (rmQtyIn <= STOCK_EPS) continue;
    await tx.stockTransaction.create({
      data: {
        itemId: line.rmItemId,
        transactionType: "ISSUE",
        refId: productionId,
        qtyIn: String(rmQtyIn),
        qtyOut: "0",
      },
    });
    touchedRmItemIds.push(line.rmItemId);
  }
  return { touchedRmItemIds };
}

const woIncludeForProductionGuard = {
  lines: { include: { productions: true } },
};

/**
 * Work orders no longer support separate "planned qty".
 * @param {Array<{ fgItemId: number; qty: number }>} lines
 * @returns {{ fgItemId: number; qty: number }[]}
 */
function normalizeWorkOrderLinePayloads(lines) {
  const out = [];
  for (const l of lines) {
    const required = Number(l.qty);
    out.push({ fgItemId: l.fgItemId, qty: required });
  }
  return out;
}

/**
 * Set work order status from summed APPROVED production vs WO line qty (REJECTED unchanged).
 * COMPLETED when every line has producedQty >= qty (within WO_SO_EPS); IN_PROGRESS if any production but not all complete.
 */
async function syncWorkOrderStatusFromProduction(tx, workOrderId) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      lines: { select: { id: true, qty: true } },
      salesOrder: { select: { orderType: true } },
      productionExecution: { select: { executionStatus: true } },
    },
  });
  if (!wo || wo.status === "REJECTED" || !wo.lines.length) return;
  if (shouldFreezeStatusSync(wo.status)) return;

  if (
    wo.salesOrder?.orderType === "NO_QTY" &&
    wo.productionExecution?.executionStatus === "COMPLETED"
  ) {
    if (wo.status !== "COMPLETED") {
      await tx.workOrder.update({ where: { id: workOrderId }, data: { status: "COMPLETED" } });
    }
    return;
  }

  const lineIds = wo.lines.map((l) => l.id);
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);

  let allComplete = true;
  let anyProgress = false;
  for (const line of wo.lines) {
    const required = Number(line.qty);
    const produced = producedByLineId.get(line.id) ?? 0;
    if (produced > WO_SO_EPS) anyProgress = true;
    if (produced + WO_SO_EPS < required) allComplete = false;
  }

  const nextStatus = allComplete ? "COMPLETED" : anyProgress ? "IN_PROGRESS" : "PENDING";
  if (nextStatus !== wo.status) {
    await tx.workOrder.update({ where: { id: workOrderId }, data: { status: nextStatus } });
  }
}

productionRouter.post(
  "/work-orders",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    let parsedWorkOrderBody = null;
    try {
      const schema = z.object({
        salesOrderId: z.number().int(),
        lines: z
          .array(
            z.object({
              fgItemId: z.number().int(),
              qty: z.number().positive(),
            }),
          )
          .min(1),
        fgStockOverride: z
          .object({
            enabled: z.boolean().default(false),
            reason: z.string().optional(),
          })
          .optional(),
        shortfallMode: z.boolean().optional(),
        shortfallBufferPercent: z.number().min(0).max(10).optional(),
      });
      const body = schema.parse(req.body);
      parsedWorkOrderBody = body;
      const normalizedLines = normalizeWorkOrderLinePayloads(body.lines);

      const wo = await prisma.$transaction(async (tx) => {
        await lockSalesOrderForUpdate(tx, body.salesOrderId);
        const soMeta = await tx.salesOrder.findUnique({
          where: { id: body.salesOrderId },
          select: { orderType: true },
        });
        if ((soMeta?.orderType ?? "NORMAL") !== "NO_QTY" && (body.shortfallMode || body.shortfallBufferPercent != null)) {
          await upsertRegularSoPlanningSnapshot(
            {
              salesOrderId: body.salesOrderId,
              bufferPercent: body.shortfallBufferPercent ?? 0,
              createdByUserId: req.user?.userId ?? null,
            },
            tx,
          );
        }
        await assertWorkOrderLinesAgainstSalesOrder(tx, {
          salesOrderId: body.salesOrderId,
          lineRequests: normalizedLines.map((l) => ({ fgItemId: l.fgItemId, qty: l.qty })),
          excludeWorkOrderId: null,
          shortfallMode: body.shortfallMode,
          shortfallBufferPercent: body.shortfallBufferPercent,
        });

        // Dispatch-ready sufficiency: block WO only when dispatchable qty (same basis as Dispatch screen)
        // already covers pending SO operational remainder for that FG. Non-dispatchable usable stock alone must not block.
        const woQtyCtx = await loadWorkOrderQuantityContext(tx, body.salesOrderId, null);
        if (!woQtyCtx) {
          const err = new Error("Sales order not found.");
          err.statusCode = 404;
          throw err;
        }
        const { so: soForWo } = woQtyCtx;
        const orderType = soForWo.orderType ?? "NORMAL";
        if (orderType === "NORMAL" || orderType === "REPLACEMENT") {
          const { fgLines } = await computeFgGapLinesForSalesOrder(soForWo, tx);
          const planQtyByFgItemId = Object.fromEntries(
            normalizedLines.map((l) => [l.fgItemId, l.qty]),
          );
          const materialReady = await evaluateWoPrepareReadiness(
            body.salesOrderId,
            { fgLines, planQtyByFgItemId },
            tx,
          );
          if (!materialReady.canCreateWorkOrder) {
            const err = new Error(
              materialReady.woBlockReason ?? "Material not ready for work order.",
            );
            err.statusCode = 409;
            err.code = "MATERIAL_NOT_READY";
            throw err;
          }
        }
        const lineInputsForDispatch = mapSoLinesToDispatchFifoInputs(soForWo.lines, soForWo.orderType);
        /** @type {Map<number, string>} */
        const fgItemNameById = new Map();
        for (const sl of soForWo.lines) {
          if (sl.item?.itemType === "FG" && !fgItemNameById.has(sl.itemId)) {
            fgItemNameById.set(sl.itemId, sl.item.itemName);
          }
        }
        /** @type {Array<{ itemId: number; itemName: string; pendingSoQty: number; dispatchableQty: number; stockAvailableQty: number; qcAcceptedGross: number; qcApprovedRemaining: number }>} */
        const sufficient = [];
        const uniqItems = Array.from(new Set(normalizedLines.map((l) => l.fgItemId)));
        for (const fgItemId of uniqItems) {
          const pendingSoQty = remainingDispatchCapacityForSoItem(
            lineInputsForDispatch,
            soForWo.dispatch || [],
            fgItemId,
          );
          if (pendingSoQty <= WO_SO_EPS) continue;
          const stockAvailableQty = await getUsableItemStockQty(fgItemId, tx);
          const qcAcceptedGross = await sumQcAcceptedForSoItem(tx, body.salesOrderId, fgItemId);
          const dispatchableQty = getSoItemDispatchableReadyQty({
            orderLineInputs: lineInputsForDispatch,
            dispatchRecords: soForWo.dispatch || [],
            itemId: fgItemId,
            orderType: soForWo.orderType,
            onHandQty: stockAvailableQty,
            qcAcceptedTotalForSoItem: qcAcceptedGross,
          });
          const netOp =
            netDispatchedByItemId(soForWo.dispatch || [], DISPATCH_ALLOC_MODE.OPERATIONAL).get(fgItemId) ?? 0;
          const qcApprovedRemaining = getSoItemQcApprovedRemainingQty(qcAcceptedGross, netOp);
          if (dispatchableQty + STOCK_EPS >= pendingSoQty) {
            sufficient.push({
              itemId: fgItemId,
              itemName: fgItemNameById.get(fgItemId) ?? `Item #${fgItemId}`,
              pendingSoQty,
              dispatchableQty,
              stockAvailableQty,
              qcAcceptedGross,
              qcApprovedRemaining,
            });
          }
        }

        const hasSufficientFg = sufficient.length > 0;
        const isAdmin = req.user?.role === "ADMIN";
        const overrideEnabled = Boolean(body.fgStockOverride?.enabled);
        const overrideReason = typeof body.fgStockOverride?.reason === "string" ? body.fgStockOverride.reason.trim() : "";

        if (hasSufficientFg) {
          if (!isAdmin) {
            const err = new Error(
              "Dispatch-ready stock already covers the remaining order quantity. Contact Admin if override is needed.",
            );
            err.statusCode = 409;
            err.code = "FG_STOCK_SUFFICIENT";
            throw err;
          }
          if (!overrideEnabled) {
            const err = new Error(
              "Dispatch-ready stock already covers the remaining order quantity. Admin override is required to create a work order. Provide an override reason to continue.",
            );
            err.statusCode = 409;
            err.code = "FG_STOCK_SUFFICIENT_ADMIN_OVERRIDE_REQUIRED";
            err.details = { sufficient };
            throw err;
          }
          if (!overrideReason) {
            const err = new Error("Override reason is required.");
            err.statusCode = 400;
            err.code = "FG_STOCK_OVERRIDE_REASON_REQUIRED";
            throw err;
          }
        }

        return tx.workOrder.create({
          data: {
            docNo: await allocateDocNo(tx, { docType: DocType.WORK_ORDER, date: new Date() }),
            salesOrderId: body.salesOrderId,
            status: "PENDING",
            ...(hasSufficientFg && isAdmin && overrideEnabled
              ? {
                  fgStockOverrideReason: overrideReason,
                  fgStockOverrideAt: new Date(),
                  fgStockOverrideByUserId: req.user.userId,
                }
              : {}),
            lines: {
              create: normalizedLines.map((l) => ({
                fgItemId: l.fgItemId,
                qty: String(l.qty),
                plannedQty: String(l.qty),
              })),
            },
          },
          include: { lines: { include: { fgItem: true } }, salesOrder: true, cycle: true },
        });
      });

      const woDoc = displayWorkOrderNo(wo.id, wo.docNo);
      const so = wo.salesOrder;
      await logActivity({
        user: req.user,
        module: ACTIVITY_MODULES.WORK_ORDER,
        entityType: ACTIVITY_ENTITY_TYPES.WORK_ORDER,
        entityId: wo.id,
        docNo: woDoc,
        action: ACTIVITY_ACTIONS.CREATED,
        message: `Work Order ${woDoc} created`,
        metadata: {
          salesOrderId: wo.salesOrderId,
          salesOrderDocNo: so ? displaySalesOrderNo(so.id, so.docNo) : undefined,
          cycleId: wo.cycleId != null ? Number(wo.cycleId) : undefined,
          cycleNo: wo.cycle?.cycleNo != null ? Number(wo.cycle.cycleNo) : undefined,
          lineCount: wo.lines?.length ?? 0,
          totalPlannedQty: (wo.lines || []).reduce((s, l) => s + Number(l.plannedQty ?? l.qty ?? 0), 0) || undefined,
        },
      });

      // Align Material Issue + production-readiness with the WO-level RM demand that
      // RM Control Center already derives from BOM. Regular WO creation now ensures a
      // submitted (store-visible) PMR so the WO appears in the Material Issue "waiting
      // for issue" queue and its RM lines load. Mirrors the post-GRN auto-PMR path.
      // Best-effort: WO creation must never fail because PMR ensure failed.
      if (so && so.orderType !== "NO_QTY") {
        try {
          await ensureSubmittedProductionMaterialRequestForWorkOrder(wo.id, {
            userId: req.user?.userId,
            role: req.user?.role,
          });
        } catch (pmrErr) {
          console.warn(
            `Auto-ensure PMR after WO ${wo.id} creation failed:`,
            pmrErr?.message || pmrErr,
          );
        }
      }

      return res.status(201).json(wo);
    } catch (e) {
      if (!e?.statusCode) {
        console.error("Work Order creation failed", {
          salesOrderId: parsedWorkOrderBody?.salesOrderId ?? req.body?.salesOrderId ?? null,
          lines: parsedWorkOrderBody?.lines ?? req.body?.lines ?? null,
          plannedQty: (parsedWorkOrderBody?.lines ?? req.body?.lines ?? []).map((line) => ({
            fgItemId: line?.fgItemId,
            plannedQty: line?.qty,
          })),
          shortfallMode: parsedWorkOrderBody?.shortfallMode ?? req.body?.shortfallMode ?? null,
          shortfallBufferPercent: parsedWorkOrderBody?.shortfallBufferPercent ?? req.body?.shortfallBufferPercent ?? null,
          errorMessage: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : null,
        });
        return res.status(500).json({
          error: "WORK_ORDER_CREATION_FAILED",
          message: "Work Order creation failed. Please retry or contact admin.",
        });
      }
      return next(e);
    }
  },
);

productionRouter.put(
  "/work-orders/:id",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const schema = z.object({
        salesOrderId: z.number().int().positive(),
        lines: z
          .array(
            z.object({
              fgItemId: z.number().int(),
              qty: z.number().positive(),
            }),
          )
          .min(1),
        shortfallMode: z.boolean().optional(),
        shortfallBufferPercent: z.number().min(0).max(10).optional(),
      });
      const body = schema.parse(req.body);
      const normalizedLines = normalizeWorkOrderLinePayloads(body.lines);

      const updated = await prisma.$transaction(async (tx) => {
        await lockWorkOrderForUpdate(tx, id);
        const woMeta = await assertWorkOrderAllowsStructuralEdit(tx, id);
        if (body.salesOrderId !== woMeta.salesOrderId) {
          const err = new Error(
            "Cannot move a work order to a different sales order. Create a new work order on the target sales order instead.",
          );
          err.statusCode = 400;
          throw err;
        }
        await lockSalesOrderForUpdate(tx, woMeta.salesOrderId);
        const soMeta = await tx.salesOrder.findUnique({
          where: { id: woMeta.salesOrderId },
          select: { orderType: true },
        });
        if ((soMeta?.orderType ?? "NORMAL") !== "NO_QTY" && (body.shortfallMode || body.shortfallBufferPercent != null)) {
          await upsertRegularSoPlanningSnapshot(
            {
              salesOrderId: woMeta.salesOrderId,
              bufferPercent: body.shortfallBufferPercent ?? 0,
              createdByUserId: req.user?.userId ?? null,
            },
            tx,
          );
        }

        await assertWorkOrderLinesAgainstSalesOrder(tx, {
          salesOrderId: body.salesOrderId,
          lineRequests: normalizedLines.map((l) => ({ fgItemId: l.fgItemId, qty: l.qty })),
          excludeWorkOrderId: id,
          shortfallMode: body.shortfallMode,
          shortfallBufferPercent: body.shortfallBufferPercent,
        });
        await tx.workOrderLine.deleteMany({ where: { workOrderId: id } });
        await tx.workOrder.update({
          where: { id },
          data: {
            salesOrderId: body.salesOrderId,
            lines: {
              create: normalizedLines.map((l) => ({
                fgItemId: l.fgItemId,
                qty: String(l.qty),
                plannedQty: String(l.qty),
              })),
            },
          },
        });
        return tx.workOrder.findUnique({
          where: { id },
          include: { lines: { include: { fgItem: true } }, salesOrder: true },
        });
      });
      return res.json(updated);
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.delete(
  "/work-orders/:id",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z.object({ reason: z.string().min(1, "Reason is required.") }).parse(req.body ?? {});
      const reason = body.reason.trim();
      await prisma.$transaction(async (tx) => {
        await lockWorkOrderForUpdate(tx, id);
        await assertWorkOrderAllowsStructuralEdit(tx, id);
        const wo = await tx.workOrder.findUnique({
          where: { id },
          include: { lines: true, salesOrder: true, cycle: true },
        });
        if (!wo) {
          const err = new Error("Work order not found");
          err.statusCode = 404;
          throw err;
        }
        const woDoc = displayWorkOrderNo(wo.id, wo.docNo);
        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.WORK_ORDER,
          entityType: ACTIVITY_ENTITY_TYPES.WORK_ORDER,
          entityId: id,
          docNo: woDoc,
          action: ACTIVITY_ACTIONS.CANCELLED,
          message: `Work Order ${woDoc} cancelled`,
          reason,
          metadata: {
            salesOrderId: wo.salesOrderId,
            salesOrderDocNo: wo.salesOrder ? displaySalesOrderNo(wo.salesOrder.id, wo.salesOrder.docNo) : undefined,
            cycleId: wo.cycleId != null ? Number(wo.cycleId) : undefined,
            cycleNo: wo.cycle?.cycleNo != null ? Number(wo.cycle.cycleNo) : undefined,
            lineCount: wo.lines?.length ?? 0,
            totalPlannedQty: (wo.lines || []).reduce((s, l) => s + Number(l.plannedQty ?? l.qty ?? 0), 0) || undefined,
          },
        });
        await tx.workOrder.delete({ where: { id } });
      });
      return res.status(204).send();
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.post(
  "/work-orders/:id/hold",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          holdReason: z.enum(HOLD_REASONS),
          remarks: z.string().max(500).optional().nullable(),
        })
        .parse(req.body ?? {});
      const updated = await prisma.$transaction(async (tx) => {
        await lockWorkOrderForUpdate(tx, id);
        return holdWorkOrder(tx, id, {
          holdReason: body.holdReason,
          remarks: body.remarks,
          actorUserId: req.user?.userId,
          actorRole: req.user?.role,
        });
      });
      return res.json(updated);
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.post(
  "/work-orders/:id/resume",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const updated = await prisma.$transaction(async (tx) => {
        await lockWorkOrderForUpdate(tx, id);
        return resumeWorkOrder(tx, id, {
          actorUserId: req.user?.userId,
          actorRole: req.user?.role,
        });
      });
      return res.json(updated);
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.post(
  "/work-orders/:id/close-shortfall",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          closureReason: z.string().min(3).max(500),
        })
        .parse(req.body ?? {});
      const result = await prisma.$transaction(async (tx) => {
        await lockWorkOrderForUpdate(tx, id);
        return closeWorkOrderWithShortfall(tx, id, {
          closureReason: body.closureReason,
          actorUserId: req.user?.userId,
          actorRole: req.user?.role,
        });
      });
      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

/** NO_QTY — Production execution status (orthogonal to Work Order lifecycle). */
productionRouter.get(
  "/work-orders/:id/production-execution",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION", "STORE"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const summary = await getProductionExecutionSummary(prisma, id);
      return res.json({
        ...summary,
        blockReasonLabel: summary.blockReason ? blockReasonLabel(summary.blockReason) : null,
        blockReasons: BLOCK_REASONS,
        resolutionReasons: RESOLUTION_REASONS,
      });
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.post(
  "/work-orders/:id/production-execution/block",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          blockReason: z.enum(BLOCK_REASONS),
          remarks: z.string().max(500).optional().nullable(),
        })
        .parse(req.body ?? {});
      const result = await prisma.$transaction(async (tx) => {
        await lockWorkOrderForUpdate(tx, id);
        return blockProductionExecution(tx, id, {
          blockReason: body.blockReason,
          remarks: body.remarks,
          actorUserId: req.user?.userId,
          actorRole: req.user?.role,
        });
      });
      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.post(
  "/work-orders/:id/production-execution/resume",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const result = await prisma.$transaction(async (tx) => {
        await lockWorkOrderForUpdate(tx, id);
        return resumeProductionExecution(tx, id, {
          actorUserId: req.user?.userId,
          actorRole: req.user?.role,
        });
      });
      return res.json(result);
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.post(
  "/work-orders/:id/production-execution/finish",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = z
        .object({
          shortfallOutcome: z.enum(["BLOCK", "CARRY_FORWARD", "WAIVE_BALANCE"]).optional(),
          blockReason: z.enum(BLOCK_REASONS).optional(),
          resolutionReason: z.enum(RESOLUTION_REASONS).optional(),
          remarks: z.string().max(500).optional().nullable(),
        })
        .parse(req.body ?? {});
      const result = await prisma.$transaction(async (tx) => {
        await lockWorkOrderForUpdate(tx, id);
        return finishProductionExecution(
          tx,
          id,
          {
            shortfallOutcome: body.shortfallOutcome,
            blockReason: body.blockReason,
            resolutionReason: body.resolutionReason,
            remarks: body.remarks,
          },
          { actorUserId: req.user?.userId, actorRole: req.user?.role },
        );
      });
      return res.json(result);
    } catch (e) {
      if (e.code === "WO_EXEC_SHORTFALL_REQUIRED" && e.shortfall) {
        return res.status(409).json({
          message: e.message,
          code: e.code,
          shortfall: e.shortfall,
        });
      }
      return next(e);
    }
  },
);

/**
 * Phase 3C — RM readiness for REGULAR production (PMR/MIN → production location stock).
 */
productionRouter.get(
  "/work-order-lines/:workOrderLineId/rm-readiness",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const workOrderLineId = Number(req.params.workOrderLineId);
      if (!Number.isFinite(workOrderLineId) || workOrderLineId <= 0) {
        const err = new Error("Invalid work order line id.");
        err.statusCode = 400;
        throw err;
      }
      const wol = await prisma.workOrderLine.findUnique({
        where: { id: workOrderLineId },
        select: { workOrder: { select: { salesOrder: { select: { orderType: true } } } } },
      });
      if (!wol) {
        const err = new Error("Work order line not found");
        err.statusCode = 404;
        throw err;
      }
      const data = await buildProductionRmReadiness(prisma, workOrderLineId);
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.get(
  "/sales-orders/:salesOrderId/fg-work-order-balance",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const salesOrderId = Number(req.params.salesOrderId);
      if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
        const err = new Error("Invalid sales order id.");
        err.statusCode = 400;
        throw err;
      }
      const rawEx = req.query.excludeWorkOrderId;
      let excludeWorkOrderId = null;
      if (rawEx != null && String(rawEx).trim() !== "") {
        const n = Number(rawEx);
        if (!Number.isFinite(n) || n <= 0) {
          const err = new Error("Invalid excludeWorkOrderId.");
          err.statusCode = 400;
          throw err;
        }
        excludeWorkOrderId = n;
      }
      const payload = await getSalesOrderFgWorkOrderBalances(prisma, {
        salesOrderId,
        excludeWorkOrderId,
      });
      return res.json(payload);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * GET /api/production/eligible-sales-orders-for-wo
 * Returns approved sales orders with at least one FG line having remaining open qty for WO planning.
 * Same rule as assertWorkOrderLinesAgainstSalesOrder (see getEligibleSalesOrderIdsForWorkOrder).
 *
 * Query:
 * - includeSalesOrderId (optional): force-include this SO id (edit-mode continuity).
 */
productionRouter.get(
  "/eligible-sales-orders-for-wo",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const includeRaw = req.query.includeSalesOrderId;
      const includeSalesOrderId =
        includeRaw != null && String(includeRaw).trim() !== "" ? Number(includeRaw) : undefined;

      const ids = await getEligibleSalesOrderIdsForWorkOrder(prisma, { includeSalesOrderId });
      return res.json({ ids });
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * GET /api/production/no-qty-so/:salesOrderId/production-context
 * Provides a small, UI-friendly reason for why production is not available for a NO_QTY SO.
 * Used only for SO-scoped Production navigation (source=no_qty_so).
 */
productionRouter.get(
  "/no-qty-so/:salesOrderId/production-context",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION", "QA"]),
  async (req, res, next) => {
    try {
      const salesOrderId = Number(req.params.salesOrderId);
      if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
        const err = new Error("Invalid Sales Order id.");
        err.statusCode = 400;
        throw err;
      }

      const so = await prisma.salesOrder.findUnique({
        where: { id: salesOrderId },
        select: { id: true, orderType: true, internalStatus: true, currentCycleId: true },
      });
      if (!so) {
        const err = new Error("Sales Order not found.");
        err.statusCode = 404;
        throw err;
      }
      if (so.orderType !== "NO_QTY") {
        const err = new Error("Not a No Qty Sales Order.");
        err.statusCode = 400;
        throw err;
      }

      const woInclude = { lines: { include: { fgItem: true } }, salesOrder: true, cycle: { select: { id: true, cycleNo: true, status: true } } };
      const rawAll = await prisma.workOrder.findMany({
        where: { salesOrderId: so.id, status: { not: "COMPLETED" } },
        orderBy: { id: "desc" },
        include: woInclude,
      });
      const rowsFiltered = await filterNoQtyWorkOrdersForActiveLockedCycle(prisma, rawAll);
      await reconcileNoQtyWoLineQtyWithRsSnapshot(prisma, rowsFiltered || []);
      const payload = await buildWorkOrderListPayload(prisma, rowsFiltered || [], {
        pendingOnly: false,
        includeWorkOrderLineId: undefined,
      });
      const hasPendingLine = (payload || []).some((w) =>
        (w.lines || []).some((l) => {
          const rem =
            l.remainingQty != null ? Number(l.remainingQty) : Math.max(0, Number(l.qty) - Number(l.approvedProducedQty ?? 0));
          return rem > REPORT_QUEUE_EPS;
        }),
      );

      if (hasPendingLine) {
        return res.json({ reason: "HAS_PENDING", message: "" });
      }

      if (!so.currentCycleId) {
        return res.json({
          reason: "NO_ACTIVE_CYCLE",
          message: "No active cycle available for production",
        });
      }

      const lockedSheet = await prisma.requirementSheet.findFirst({
        where: { salesOrderId: so.id, cycleId: so.currentCycleId, status: "LOCKED" },
        select: { id: true },
      });
      if (!lockedSheet) {
        return res.json({
          reason: "REQUIREMENT_NOT_LOCKED",
          message: "Lock Requirement Sheet to start production",
        });
      }

      return res.json({
        reason: "ALL_COMPLETED",
        message: "All production completed for this cycle",
      });
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.get(
  "/work-orders",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const soIdRaw = req.query.salesOrderId;
      const salesOrderId =
        soIdRaw != null && String(soIdRaw).trim() !== "" ? Number(soIdRaw) : null;

      const pendingOnly =
        req.query.pendingOnly === "1" ||
        req.query.pendingOnly === "true" ||
        req.query.pendingOnly === "yes";
      const includeWorkOrderLineIdRaw = req.query.includeWorkOrderLineId;
      const includeWorkOrderLineId =
        includeWorkOrderLineIdRaw != null && String(includeWorkOrderLineIdRaw).trim() !== ""
          ? Number(includeWorkOrderLineIdRaw)
          : undefined;

      const listScope = typeof req.query.listScope === "string" ? req.query.listScope.trim() : "";
      const woInclude = {
        lines: { include: { fgItem: true } },
        salesOrder: true,
        cycle: { select: { id: true, cycleNo: true, status: true } },
      };

      const completedPageRaw = Number(req.query.completedPage ?? req.query.page ?? 1);
      const completedPage = Number.isFinite(completedPageRaw) ? Math.max(1, Math.floor(completedPageRaw)) : 1;
      const limitRaw = Number(req.query.limit ?? 10);
      const completedLimit = Number.isFinite(limitRaw) ? Math.min(15, Math.max(1, Math.floor(limitRaw))) : 10;
      const skip = (completedPage - 1) * completedLimit;

      /** Legacy + Production page: full list (optional pendingOnly trim). */
      if (!listScope) {
        const rowsRaw = await prisma.workOrder.findMany({
          ...(salesOrderId && Number.isFinite(salesOrderId) && salesOrderId > 0 ? { where: { salesOrderId } } : {}),
          orderBy: { id: "desc" },
          include: woInclude,
        });

        // NO_QTY safety: only expose producible WOs for the active cycle (and only after RS is LOCKED).
        const rows = await filterNoQtyWorkOrdersForActiveLockedCycle(prisma, rowsRaw);
        await reconcileNoQtyWoLineQtyWithRsSnapshot(prisma, rows);

        const out = await buildWorkOrderListPayload(prisma, rows, { pendingOnly, includeWorkOrderLineId });
        return res.json(out);
      }

      if (listScope === "nonCompleted") {
        const rowsRaw = await prisma.workOrder.findMany({
          where: { status: { not: "COMPLETED" } },
          orderBy: { id: "desc" },
          include: woInclude,
        });
        const rows = await filterNoQtyWorkOrdersForActiveLockedCycle(prisma, rowsRaw);
        await reconcileNoQtyWoLineQtyWithRsSnapshot(prisma, rows);
        const out = await buildWorkOrderListPayload(prisma, rows, { pendingOnly: false, includeWorkOrderLineId: undefined });
        return res.json(out);
      }

      if (listScope === "completed") {
        const where = { status: "COMPLETED" };
        const [total, rows] = await prisma.$transaction([
          prisma.workOrder.count({ where }),
          prisma.workOrder.findMany({
            where,
            orderBy: { id: "desc" },
            skip,
            take: completedLimit,
            include: woInclude,
          }),
        ]);
        const payload = await buildWorkOrderListPayload(prisma, rows, {
          pendingOnly: false,
          includeWorkOrderLineId: undefined,
        });
        return res.json({ rows: payload, total, page: completedPage, limit: completedLimit });
      }

      if (listScope === "all") {
        const [openRowsRaw, completedTotal, completedSlice] = await prisma.$transaction([
          prisma.workOrder.findMany({
            where: { status: { not: "COMPLETED" } },
            orderBy: { id: "desc" },
            include: woInclude,
          }),
          prisma.workOrder.count({ where: { status: "COMPLETED" } }),
          prisma.workOrder.findMany({
            where: { status: "COMPLETED" },
            orderBy: { id: "desc" },
            skip,
            take: completedLimit,
            include: woInclude,
          }),
        ]);
        const openRows = await filterNoQtyWorkOrdersForActiveLockedCycle(prisma, openRowsRaw);
        await reconcileNoQtyWoLineQtyWithRsSnapshot(prisma, openRows);
        const nonCompleted = await buildWorkOrderListPayload(prisma, openRows, {
          pendingOnly: false,
          includeWorkOrderLineId: undefined,
        });
        const completed = await buildWorkOrderListPayload(prisma, completedSlice, {
          pendingOnly: false,
          includeWorkOrderLineId: undefined,
        });
        return res.json({
          nonCompleted,
          completed,
          completedTotal,
          completedPage,
          completedLimit,
        });
      }

      const err = new Error('Invalid listScope. Use "nonCompleted", "completed", or "all".');
      err.statusCode = 400;
      throw err;
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * GET /production-entries — list batches; qcEntries filtered to active (non-reversed) for rollups.
 * `withoutQc=1`: APPROVED batches with pending QC qty > 0 (QC queue; excludes DRAFT).
 * `excludeNoQty=1` with global `withoutQc=1` (no `salesOrderId`): omit NO_QTY batches — REGULAR production QC workspace only.
 * DRAFT batches are editable on the Production page until approved.
 */
productionRouter.get(
  "/production-entries",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION", "QA"]),
  async (req, res, next) => {
    try {
      const soIdRaw = req.query.salesOrderId;
      const salesOrderId =
        soIdRaw != null && String(soIdRaw).trim() !== "" ? Number(soIdRaw) : null;
      const cycleIdRaw = Number(req.query.cycleId ?? 0);
      const cycleIdFromQuery = Number.isFinite(cycleIdRaw) && cycleIdRaw > 0 ? cycleIdRaw : null;

      const withoutQc = req.query.withoutQc === "1" || req.query.withoutQc === "true";
      const withActiveQc = req.query.withActiveQc === "1" || req.query.withActiveQc === "true";
      let where = {};
      if (withoutQc) {
        where = { workflowStatus: PE_APPROVED };
      } else if (withActiveQc) {
        where = {
          workflowStatus: PE_APPROVED,
          qcEntries: { some: { ...QC_ENTRY_ACTIVE_WHERE } },
        };
      }
      if (salesOrderId && Number.isFinite(salesOrderId) && salesOrderId > 0) {
        const soPeek = await prisma.salesOrder.findUnique({
          where: { id: salesOrderId },
          select: { orderType: true, currentCycleId: true },
        });
        if (soPeek?.orderType === "NO_QTY") {
          const effectiveCycleId =
            cycleIdFromQuery ?? (soPeek.currentCycleId != null ? Number(soPeek.currentCycleId) : null);
          if (effectiveCycleId) {
            where = {
              ...where,
              workOrderLine: { workOrder: { salesOrderId, cycleId: effectiveCycleId } },
            };
          } else {
            where = { ...where, workOrderLine: { workOrder: { salesOrderId } } };
          }
        } else if (cycleIdFromQuery) {
          where = {
            ...where,
            workOrderLine: {
              workOrder: {
                salesOrderId,
                OR: [
                  { cycleId: cycleIdFromQuery },
                  { cycleId: null, requirementSheet: { cycleId: cycleIdFromQuery } },
                ],
              },
            },
          };
        } else {
          where = { ...where, workOrderLine: { workOrder: { salesOrderId } } };
        }
      } else if (
        withoutQc &&
        (req.query.excludeNoQty === "1" || req.query.excludeNoQty === "true")
      ) {
        /** Global REGULAR production-QC workspace: never mix NO_QTY cycle batches into the same list. */
        where = {
          ...where,
          workOrderLine: {
            workOrder: {
              salesOrder: {
                is: { orderType: { not: "NO_QTY" } },
              },
            },
          },
        };
      }
      const rows = await prisma.productionEntry.findMany({
        where,
        orderBy: { id: "desc" },
        include: {
          workOrderLine: {
            include: {
              workOrder: {
                include: {
                  salesOrder: { select: { orderType: true } },
                  cycle: { select: { id: true, cycleNo: true, status: true } },
                },
              },
              fgItem: true,
            },
          },
          qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
        },
      });
      const enriched = rows.map((row) => {
        const producedQty = Number(row.producedQty);
        const qcAcceptedQty = sumActiveQcAcceptedQty(row.qcEntries);
        const qcRejectedQty = sumActiveQcRejectedQty(row.qcEntries);
        const qcPendingQty = getProductionBatchQcPendingQty(producedQty, qcAcceptedQty, qcRejectedQty);
        const orderType = row.workOrderLine?.workOrder?.salesOrder?.orderType;
        return {
          ...row,
          ...(orderType != null ? { orderType } : {}),
          qcAcceptedQty,
          qcRejectedQty,
          qcPendingQty,
        };
      });
      if (withoutQc) {
        return res.json(enriched.filter((row) => row.qcPendingQty > REPORT_QUEUE_EPS));
      }
      return res.json(enriched);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * POST /production-entries — create a DRAFT batch (no RM stock issue). Approve via POST .../approve to issue RM and enable QC.
 */
productionRouter.post(
  "/production-entries",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const schema = z.object({
        workOrderLineId: z.number().int(),
        producedQty: z.number().positive(),
        /** Optional ISO date or YYYY-MM-DD; defaults to now if omitted */
        date: z.union([z.string(), z.undefined()]).optional(),
      });
      const body = schema.parse(req.body);

      let entryDate;
      if (body.date != null && String(body.date).trim() !== "") {
        const d = new Date(body.date);
        if (Number.isNaN(d.getTime())) {
          const err = new Error("Invalid production date.");
          err.statusCode = 400;
          throw err;
        }
        entryDate = d;
      }

      const result = await prisma.$transaction(async (tx) => {
        await lockWorkOrderLineForUpdate(tx, body.workOrderLineId);

        const wol = await tx.workOrderLine.findUnique({
          where: { id: body.workOrderLineId },
          include: { workOrder: true, fgItem: true },
        });
        if (!wol) {
          const err = new Error("Work order line not found");
          err.statusCode = 404;
          throw err;
        }
        if (!wol.workOrder) {
          const err = new Error("Production requires a valid work order.");
          err.statusCode = 400;
          throw err;
        }
        if (wol.workOrder.salesOrderId == null) {
          const err = new Error("Production requires a work order linked to a sales order.");
          err.statusCode = 400;
          throw err;
        }

        await assertSalesOrderNotCustomerReturnReplacementProduction(tx, wol.workOrder.salesOrderId);

        // NO_QTY: production allowed only for the active cycle and only after RS is locked.
        await assertNoQtyWorkOrderInActiveCycleOrThrow(tx, wol.workOrderId, "This work order");
        await assertWorkOrderAllowsProduction(tx, wol.workOrderId);
        await assertNoQtyProductionExecutionAllowsProduction(tx, wol.workOrderId);

        const alreadyProduced = await sumProducedQtyOnLine(tx, wol.id);
        const lineQty = Number(wol.qty);
        const allowedMaxQty = lineQty * (1 + PROD_TOLERANCE_PCT);
        const remainingProducible = Math.max(0, allowedMaxQty - alreadyProduced);
        if (body.producedQty > remainingProducible + WO_SO_EPS) {
          const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(3));
          const err = new Error(
            `Total produced quantity cannot exceed the allowed tolerance for this WO line (WO Qty + 5%). WO Qty: ${fmt(lineQty)}. Already recorded (draft + approved): ${fmt(alreadyProduced)}. Maximum additional quantity now: ${fmt(remainingProducible)}.`,
          );
          err.statusCode = 409;
          throw err;
        }

        await assertProductionRmReadiness(tx, {
          workOrderLineId: wol.id,
          producedQty: body.producedQty,
        });

        const prod = await tx.productionEntry.create({
          data: {
            docNo: await allocateDocNo(tx, { docType: DocType.PRODUCTION_ENTRY, date: entryDate ?? new Date() }),
            workOrderLineId: wol.id,
            producedQty: String(body.producedQty),
            workflowStatus: PE_DRAFT,
            ...(entryDate ? { date: entryDate } : {}),
          },
        });

        const woAfter = await tx.workOrder.findUnique({ where: { id: wol.workOrderId } });
        return { wo: woAfter ?? wol.workOrder, prod, draft: true };
      });

      return res.status(201).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.put(
  "/production-entries/:id",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const schema = z.object({
        producedQty: z.number().positive(),
        date: z.union([z.string(), z.undefined()]).optional(),
      });
      const body = schema.parse(req.body);

      let entryDate;
      if (body.date != null && String(body.date).trim() !== "") {
        const d = new Date(body.date);
        if (Number.isNaN(d.getTime())) {
          const err = new Error("Invalid production date.");
          err.statusCode = 400;
          throw err;
        }
        entryDate = d;
      }

      const updated = await prisma.$transaction(async (tx) => {
        await lockProductionEntryForUpdate(tx, id);
        const existing = await tx.productionEntry.findUnique({
          where: { id },
          include: { workOrderLine: { include: { workOrder: true } } },
        });
        if (!existing) {
          const err = new Error("Production entry not found");
          err.statusCode = 404;
          throw err;
        }
        if (existing.workflowStatus !== PE_DRAFT) {
          const err = new Error(
            "Only draft production batches can be edited. Approved batches are locked; use QC reversal or a controlled correction path if available.",
          );
          err.statusCode = 409;
          throw err;
        }
        await assertProductionEntryHasNoQcHistory(tx, id);

        await lockWorkOrderLineForUpdate(tx, existing.workOrderLineId);
        const wol = await tx.workOrderLine.findUnique({
          where: { id: existing.workOrderLineId },
          include: { workOrder: true },
        });
        if (!wol?.workOrder) {
          const err = new Error("Work order line not found");
          err.statusCode = 404;
          throw err;
        }

        await assertNoQtyWorkOrderInActiveCycleOrThrow(tx, wol.workOrderId, "This work order");
        await assertWorkOrderAllowsProduction(tx, wol.workOrderId);
        await assertNoQtyProductionExecutionAllowsProduction(tx, wol.workOrderId);

        const others = await sumProducedQtyOnLine(tx, wol.id, { excludeProductionId: id });
        const lineQty = Number(wol.qty);
        const allowedMaxQty = lineQty * (1 + PROD_TOLERANCE_PCT);
        const remaining = Math.max(0, allowedMaxQty - others);
        if (body.producedQty > remaining + WO_SO_EPS) {
          const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(3));
          const err = new Error(
            `Produced quantity cannot exceed the allowed tolerance for this WO line (WO Qty + 5%). WO Qty: ${fmt(lineQty)}. Other batches on this line: ${fmt(others)}. Maximum for this batch: ${fmt(remaining)}.`,
          );
          err.statusCode = 409;
          throw err;
        }

        await assertProductionRmReadiness(tx, {
          workOrderLineId: wol.id,
          producedQty: body.producedQty,
          excludeProductionId: id,
        });

        return tx.productionEntry.update({
          where: { id },
          data: {
            producedQty: String(body.producedQty),
            ...(entryDate ? { date: entryDate } : {}),
          },
          include: {
            workOrderLine: { include: { workOrder: true, fgItem: true } },
            qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
          },
        });
      });

      return res.json(updated);
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.delete(
  "/production-entries/:id",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      await prisma.$transaction(async (tx) => {
        await lockProductionEntryForUpdate(tx, id);
        const existing = await tx.productionEntry.findUnique({
          where: { id },
          include: { workOrderLine: true },
        });
        if (!existing) {
          const err = new Error("Production entry not found");
          err.statusCode = 404;
          throw err;
        }
        if (existing.workflowStatus !== PE_DRAFT) {
          const err = new Error(
            "Only draft production batches can be deleted. Approved batches are locked for traceability.",
          );
          err.statusCode = 409;
          throw err;
        }
        await assertProductionEntryHasNoQcHistory(tx, id);

        const woId = existing.workOrderLine.workOrderId;
        await tx.productionEntry.delete({ where: { id } });
        await lockWorkOrderForUpdate(tx, woId);
        await syncWorkOrderStatusFromProduction(tx, woId);
      });
      return res.status(204).send();
    } catch (e) {
      return next(e);
    }
  },
);

const rmConsumptionLineSchema = z.object({
  itemId: z.number().int().positive(),
  actualQty: z.number().positive(),
  remarks: z.string().max(500).optional().nullable(),
  consumptionType: z
    .enum(["NORMAL", "EXTRA_PROCESS_LOSS", "LOWER_USAGE", "REWORK_RESERVED"])
    .optional()
    .nullable(),
});

const approveProductionEntrySchema = z.object({
  consumptionLines: z.array(rmConsumptionLineSchema).optional(),
});

/**
 * REGULAR only: standard BOM RM lines + available qty for consumption review before approve.
 */
productionRouter.get(
  "/production-entries/:id/rm-consumption-preview",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        const err = new Error("Invalid production entry id");
        err.statusCode = 400;
        throw err;
      }
      const data = await buildRmConsumptionPreview(prisma, id);
      return res.json(data);
    } catch (e) {
      return next(e);
    }
  },
);

/**
 * Approve a draft batch: issue RM per BOM, lock row, sync WO status. Not allowed if any QC history exists.
 */
productionRouter.post(
  "/production-entries/:id/approve",
  requireAuth,
  requireRole(["ADMIN", "PRODUCTION"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const body = approveProductionEntrySchema.parse(req.body ?? {});

      const result = await prisma.$transaction(async (tx) => {
        await lockProductionEntryForUpdate(tx, id);
        const prod = await tx.productionEntry.findUnique({
          where: { id },
          include: {
            workOrderLine: {
              include: {
                workOrder: {
                  include: { salesOrder: { select: { orderType: true } } },
                },
                fgItem: true,
              },
            },
          },
        });
        if (!prod) {
          const err = new Error("Production entry not found");
          err.statusCode = 404;
          throw err;
        }
        if (prod.workflowStatus !== PE_DRAFT) {
          const err = new Error("This production batch is already approved.");
          err.statusCode = 409;
          throw err;
        }
        const qcAny = await countAllQcEntriesForProduction(tx, id);
        if (qcAny > 0) {
          const err = new Error("Cannot approve a batch that already has QC history.");
          err.statusCode = 409;
          throw err;
        }

        const wol = prod.workOrderLine;
        await assertNoQtyWorkOrderInActiveCycleOrThrow(tx, wol.workOrderId, "This work order");
        await assertWorkOrderAllowsProduction(tx, wol.workOrderId);
        await assertNoQtyProductionExecutionAllowsProduction(tx, wol.workOrderId);
        await lockWorkOrderLineForUpdate(tx, wol.id);

        const others = await sumProducedQtyOnLine(tx, wol.id, { excludeProductionId: id });
        const woQty = Number(wol.qty);
        const allowedMaxQty = woQty * (1 + PROD_TOLERANCE_PCT);
        if (others + Number(prod.producedQty) > allowedMaxQty + WO_SO_EPS) {
          const err = new Error(
            "Cannot approve: total produced quantity would exceed the allowed tolerance for this WO line (WO Qty + 5%). Edit the draft quantity first.",
          );
          err.statusCode = 409;
          throw err;
        }

        const fgItemId = wol.fgItemId;
        const producedQtyNum = Number(prod.producedQty);
        const orderType = wol.workOrder?.salesOrder?.orderType;
        const isRegular = orderType != null && orderType !== "NO_QTY";

        await assertProductionRmReadiness(tx, {
          workOrderLineId: wol.id,
          producedQty: prod.producedQty,
          excludeProductionId: id,
        });

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
          const prodLocIds = await getWorkOrderProductionLocationIds(tx, wol.workOrderId);
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
            const perUnit = effectiveQtyPerUnit(line.baseQtyPerFg ?? line.baseQty, line.wastagePercent, line.qcAllowancePercent);
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
            workOrderId: wol.workOrderId,
            consumptionLines: body.consumptionLines,
          });
          consumptionWarnings = resolved.warnings;
          bomFound = await issueRmStockForProductionBatchAtProductionLocations(tx, {
            productionId: prod.id,
            workOrderId: wol.workOrderId,
            actualQtyByItemId: resolved.actualQtyByItemId,
            roundingToleranceKg: RM_CONSUMPTION_ROUNDING_TOLERANCE_KG,
          });
          await persistProductionEntryRmConsumption(tx, prod.id, resolved.lines);
        } else {
          bomFound = await issueRmForApprovedProductionFromPmrLocations(tx, {
            productionId: prod.id,
            workOrderId: wol.workOrderId,
            fgItemId,
            producedQty: prod.producedQty,
          });
        }

        for (const row of rmStock) {
          if (isRegular) {
            const prodLocIds = await getWorkOrderProductionLocationIds(tx, wol.workOrderId);
            let after = 0;
            for (const locId of prodLocIds) {
              after += await getItemStockQty(row.itemId, tx, { stockBucket: "USABLE", locationId: locId });
            }
            row.stockAfter = after;
          } else {
            row.stockAfter = await getItemStockQty(row.itemId, tx);
          }
        }

        await tx.productionEntry.update({
          where: { id },
          data: { workflowStatus: PE_APPROVED },
        });

        const woBefore = await tx.workOrder.findUnique({
          where: { id: wol.workOrderId },
          select: { status: true, salesOrderId: true },
        });
        await lockWorkOrderForUpdate(tx, wol.workOrderId);
        if (!isRegular) {
          await ensureProductionExecutionRecord(tx, wol.workOrderId);
        }
        await syncWorkOrderStatusFromProduction(tx, wol.workOrderId);
        const woAfter = await tx.workOrder.findUnique({
          where: { id: wol.workOrderId },
          select: { status: true, salesOrderId: true },
        });

        /** @type {Record<string, unknown>} */
        const auditPayload = {
          snapshot: {
            workOrderId: wol.workOrderId,
            workOrderLineId: wol.id,
            salesOrderId: woAfter?.salesOrderId ?? woBefore?.salesOrderId ?? wol.workOrder.salesOrderId,
            producedQty: producedQtyNum,
            fgItemId,
            fgItemName: wol.fgItem?.itemName,
            bomIssued: bomFound,
          },
          changes: {
            productionEntry: {
              workflowStatus: { from: PE_DRAFT, to: PE_APPROVED },
            },
          },
        };
        if (rmStock.length) {
          auditPayload.rmStock = rmStock.map((r) => ({
            itemId: r.itemId,
            stockBefore: r.stockBefore,
            stockAfter: r.stockAfter,
          }));
        }
        if (woBefore && woAfter && woBefore.status !== woAfter.status) {
          auditPayload.changes = {
            ...auditPayload.changes,
            workOrder: {
              status: { from: woBefore.status, to: woAfter.status },
            },
          };
        }

        await auditLog.write(tx, {
          action: auditLog.AuditAction.APPROVE,
          entityType: auditLog.AuditEntityType.PRODUCTION_ENTRY,
          entityId: String(id),
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: `Production batch #${id} approved (WO ${wol.workOrderId})`,
          payload: auditPayload,
        });

        const woFull = await tx.workOrder.findUnique({
          where: { id: wol.workOrderId },
          include: { cycle: true, salesOrder: true },
        });
        const prodAfter = await tx.productionEntry.findUnique({
          where: { id },
          include: {
            workOrderLine: { include: { workOrder: { include: { cycle: true } }, fgItem: true } },
            qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
          },
        });
        const woHead = prodAfter?.workOrderLine?.workOrder;
        const peDoc = displayProductionEntryNo(id, prodAfter?.docNo);
        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.PRODUCTION,
          entityType: ACTIVITY_ENTITY_TYPES.PRODUCTION_ENTRY,
          entityId: id,
          docNo: peDoc,
          action: ACTIVITY_ACTIONS.FINALIZED,
          message: `Production Entry ${peDoc} posted`,
          metadata: {
            workOrderId: wol.workOrderId,
            workOrderDocNo: displayWorkOrderNo(wol.workOrderId, woHead?.docNo),
            itemId: fgItemId,
            itemName: wol.fgItem?.itemName,
            qty: producedQtyNum,
            cycleId: woHead?.cycleId != null ? Number(woHead.cycleId) : undefined,
            cycleNo: woHead?.cycle?.cycleNo != null ? Number(woHead.cycle.cycleNo) : undefined,
          },
        });
        if (woBefore && woAfter && woAfter.status === "COMPLETED" && woBefore.status !== "COMPLETED") {
          const wdoc = displayWorkOrderNo(wol.workOrderId, woFull?.docNo);
          await logActivity({
            tx,
            user: req.user,
            module: ACTIVITY_MODULES.WORK_ORDER,
            entityType: ACTIVITY_ENTITY_TYPES.WORK_ORDER,
            entityId: wol.workOrderId,
            docNo: wdoc,
            action: ACTIVITY_ACTIONS.CLOSED,
            message: `Work Order ${wdoc} closed`,
            metadata: {
              salesOrderId: woFull?.salesOrderId,
              salesOrderDocNo: woFull?.salesOrder ? displaySalesOrderNo(woFull.salesOrder.id, woFull.salesOrder.docNo) : undefined,
              cycleId: woFull?.cycleId != null ? Number(woFull.cycleId) : undefined,
              cycleNo: woFull?.cycle?.cycleNo != null ? Number(woFull.cycle.cycleNo) : undefined,
            },
          });
        }
        const operationalSoId = woAfter?.salesOrderId ?? woBefore?.salesOrderId ?? wol.workOrder.salesOrderId;
        if (operationalSoId != null) {
          await maybeAutoCloseSalesOrderOperationally(tx, operationalSoId, {
            actorUserId: req.user?.userId,
            actorRole: req.user?.role,
            reason: "Production approval completed the remaining operational work.",
          });
        }
        return { wo: woFull ?? wol.workOrder, prod: prodAfter, bomFound, consumptionWarnings };
      });

      return res.status(200).json(result);
    } catch (e) {
      const isBomMissing =
        (e && typeof e === "object" && "code" in e && e.code === "BOM_MISSING") ||
        (e instanceof Error && e.message === "BOM_MISSING");
      if (isBomMissing) {
        return res.status(400).json({
          error: "BOM_MISSING",
          message: "BOM is required before production. RM consumption cannot be calculated.",
        });
      }
      return next(e);
    }
  },
);

/**
 * Reverse approval: return RM per BOM, set batch back to DRAFT, sync WO. Blocked if any QC row exists for this batch.
 */
productionRouter.post(
  "/production-entries/:id/reverse",
  requireAuth,
  requireRole(["ADMIN"], "Only Admin can reverse approved production batches."),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const schema = z.object({
        reason: z.string().min(1, "Reason is required."),
      });
      const body = schema.parse(req.body);
      const reasonTrim = body.reason.trim();

      const result = await prisma.$transaction(async (tx) => {
        await lockProductionEntryForUpdate(tx, id);
        const prod = await tx.productionEntry.findUnique({
          where: { id },
          include: { workOrderLine: { include: { workOrder: true, fgItem: true } } },
        });
        if (!prod) {
          const err = new Error("Production entry not found");
          err.statusCode = 404;
          throw err;
        }
        if (prod.workflowStatus !== PE_APPROVED) {
          const err = new Error(
            prod.workflowStatus === PE_DRAFT
              ? "This batch is not approved; nothing to reverse."
              : "This production batch cannot be reversed.",
          );
          err.statusCode = 409;
          throw err;
        }

        await assertProductionEntryHasNoQcHistory(tx, id);

        const wol = prod.workOrderLine;
        await lockWorkOrderLineForUpdate(tx, wol.id);
        const fgItemId = wol.fgItemId;
        const producedQty = Number(prod.producedQty);

        const bomPre = await tx.bom.findFirst({
          where: approvedBomWhere(fgItemId),
    orderBy: approvedBomOrderBy,
          include: { lines: true },
        });
        /** @type {{ itemId: number; stockBefore: number; stockAfter?: number }[]} */
        const rmStock = [];
        if (bomPre?.lines?.length) {
          for (const line of bomPre.lines) {
            const perUnit = effectiveQtyPerUnit(line.baseQtyPerFg ?? line.baseQty, line.wastagePercent, line.qcAllowancePercent);
            if (perUnit * producedQty <= STOCK_EPS) continue;
            rmStock.push({
              itemId: line.rmItemId,
              stockBefore: await getItemStockQty(line.rmItemId, tx),
            });
          }
        }

        const soType = await tx.salesOrder.findUnique({
          where: { id: wol.workOrder.salesOrderId },
          select: { orderType: true },
        });
        const locIssueCount = await tx.stockTransaction.count({
          where: {
            refId: prod.id,
            transactionType: "ISSUE",
            locationId: { not: null },
            qtyOut: { gt: 0 },
          },
        });
        if (locIssueCount > 0) {
          await returnRmStockForProductionBatchFromProductionLocations(tx, { productionId: prod.id });
        } else {
          await returnRmStockForProductionBatch(tx, {
            productionId: prod.id,
            fgItemId,
            producedQty: prod.producedQty,
          });
        }

        for (const row of rmStock) {
          row.stockAfter = await getItemStockQty(row.itemId, tx);
        }

        await tx.productionEntry.update({
          where: { id },
          data: { workflowStatus: PE_DRAFT },
        });

        const woBefore = await tx.workOrder.findUnique({
          where: { id: wol.workOrderId },
          select: { status: true },
        });
        await lockWorkOrderForUpdate(tx, wol.workOrderId);
        await syncWorkOrderStatusFromProduction(tx, wol.workOrderId);
        const woAfter = await tx.workOrder.findUnique({
          where: { id: wol.workOrderId },
          select: { status: true },
        });

        /** @type {Record<string, unknown>} */
        const auditPayload = {
          reversedOf: {
            entityType: auditLog.AuditEntityType.PRODUCTION_ENTRY,
            entityId: String(id),
          },
          reason: reasonTrim,
          snapshot: {
            workOrderLineId: wol.id,
            workOrderId: wol.workOrderId,
            fgItemId,
            producedQty,
            ...(rmStock.length ? { rmStock } : {}),
          },
          changes: {
            productionEntry: {
              workflowStatus: { from: PE_APPROVED, to: PE_DRAFT },
            },
          },
        };

        if (woBefore && woAfter && woBefore.status !== woAfter.status) {
          auditPayload.changes = {
            ...auditPayload.changes,
            workOrder: {
              status: { from: woBefore.status, to: woAfter.status },
            },
          };
        }

        await auditLog.write(tx, {
          action: auditLog.AuditAction.REVERSE,
          entityType: auditLog.AuditEntityType.PRODUCTION_ENTRY,
          entityId: String(id),
          actorUserId: req.user.userId,
          actorRole: req.user.role,
          summary: `Production batch #${id} approval reversed (WO ${wol.workOrderId})`,
          payload: auditPayload,
          reason: reasonTrim,
        });

        const prodAfter = await tx.productionEntry.findUnique({
          where: { id },
          include: {
            workOrderLine: { include: { workOrder: { include: { cycle: true } }, fgItem: true } },
            qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
          },
        });
        const woRv = prodAfter?.workOrderLine?.workOrder;
        const peDocRv = displayProductionEntryNo(id, prodAfter?.docNo);
        await logActivity({
          tx,
          user: req.user,
          module: ACTIVITY_MODULES.PRODUCTION,
          entityType: ACTIVITY_ENTITY_TYPES.PRODUCTION_ENTRY,
          entityId: id,
          docNo: peDocRv,
          action: ACTIVITY_ACTIONS.REVERSED,
          message: `Production Entry ${peDocRv} reversed`,
          reason: reasonTrim,
          metadata: {
            workOrderId: wol.workOrderId,
            workOrderDocNo: displayWorkOrderNo(wol.workOrderId, woRv?.docNo),
            itemId: fgItemId,
            itemName: wol.fgItem?.itemName,
            qty: producedQty,
            cycleId: woRv?.cycleId != null ? Number(woRv.cycleId) : undefined,
            cycleNo: woRv?.cycle?.cycleNo != null ? Number(woRv.cycle.cycleNo) : undefined,
          },
        });
        const woOut = await tx.workOrder.findUnique({ where: { id: wol.workOrderId } });
        return { wo: woOut ?? wol.workOrder, prod: prodAfter };
      });

      return res.status(200).json(result);
    } catch (e) {
      return next(e);
    }
  },
);

productionRouter.post("/qc-entries", requireAuth, requireRole(["ADMIN", "QA"]), async (req, res, next) => {
  try {
    const schema = z.object({
      productionId: z.number().int(),
      /** Units inspected this posting; must be ≤ pending QC for the batch. Accepted = checked − rejected (server-side). */
      checkedQty: z.number().positive(),
      rejectedQty: z.number().nonnegative(),
      /** Required when rejectedQty is positive: current stock state for rejected units. */
      rejectedStockBucket: z.enum(["USABLE", "QC_HOLD", "REWORK", "SCRAP"]).optional(),
      /** Optional split routing for rejected qty (rework follows existing REWORK workflow via QC_HOLD ownership). */
      rejectedSplit: z
        .object({
          reworkQty: z.number().nonnegative(),
          holdQty: z.number().nonnegative(),
          scrapQty: z.number().nonnegative(),
        })
        .optional(),
      reason: z.string().optional(),
      scrapReusable: z.boolean().default(false),
    });
    const body = schema.parse(req.body);

    const qc = await prisma.$transaction(async (tx) => {
      await lockProductionEntryForUpdate(tx, body.productionId);

      const prod = await tx.productionEntry.findUnique({
        where: { id: body.productionId },
        include: {
          workOrderLine: { include: { workOrder: { include: { cycle: true } }, fgItem: true } },
          qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
        },
      });
      if (!prod) {
        const err = new Error("Production entry not found");
        err.statusCode = 404;
        throw err;
      }
      if (prod.workflowStatus !== PE_APPROVED) {
        const err = new Error(
          "Quality control can only be recorded for approved production batches. Approve the batch on the Production page first.",
        );
        err.statusCode = 400;
        throw err;
      }

      // NO_QTY: QC on approved batches follows the batch WO cycle + locked RS for that cycle (rolling SO pointer may advance).
      if (prod.workOrderLine?.workOrderId) {
        await assertNoQtyWorkOrderEligibleForQcOrThrow(tx, prod.workOrderLine.workOrderId);
      }

      const producedQty = Number(prod.producedQty);
      const priorAccepted = sumActiveQcAcceptedQty(prod.qcEntries);
      const priorRejected = sumActiveQcRejectedQty(prod.qcEntries);
      const pendingQcQty = getProductionBatchQcPendingQty(producedQty, priorAccepted, priorRejected);

      if (pendingQcQty <= WO_SO_EPS) {
        const err = new Error(
          "There is no pending quantity to inspect for this production batch. It may already be fully processed by quality control.",
        );
        err.statusCode = 400;
        throw err;
      }

      const checkedQty = Number(body.checkedQty);
      const rejectedQty = Number(body.rejectedQty);

      if (rejectedQty > checkedQty + WO_SO_EPS) {
        const err = new Error(
          "Rejected quantity cannot exceed checked quantity for this inspection.",
        );
        err.statusCode = 400;
        throw err;
      }

      if (checkedQty > pendingQcQty + WO_SO_EPS) {
        const err = new Error(
          `Checked quantity cannot exceed the pending QC quantity for this batch (${Number(pendingQcQty.toFixed(6))}).`,
        );
        err.statusCode = 400;
        throw err;
      }

      const acceptedQty = checkedQty - rejectedQty;
      if (acceptedQty < -WO_SO_EPS) {
        const err = new Error("Accepted quantity cannot be negative.");
        err.statusCode = 400;
        throw err;
      }

      const hasSplit = body.rejectedSplit != null;
      const splitRework = Number(body.rejectedSplit?.reworkQty ?? 0);
      const splitHold = Number(body.rejectedSplit?.holdQty ?? 0);
      const splitScrap = Number(body.rejectedSplit?.scrapQty ?? 0);
      const splitTotal = splitRework + splitHold + splitScrap;
      if (hasSplit) {
        if (rejectedQty <= WO_SO_EPS) {
          const err = new Error("Rejected split cannot be provided when rejected qty is zero.");
          err.statusCode = 400;
          throw err;
        }
        if (!Number.isFinite(splitRework) || splitRework < 0) {
          const err = new Error("Rework qty must be 0 or more.");
          err.statusCode = 400;
          throw err;
        }
        if (!Number.isFinite(splitHold) || splitHold < 0) {
          const err = new Error("Hold qty must be 0 or more.");
          err.statusCode = 400;
          throw err;
        }
        if (!Number.isFinite(splitScrap) || splitScrap < 0) {
          const err = new Error("Scrap qty must be 0 or more.");
          err.statusCode = 400;
          throw err;
        }
        if (splitTotal <= WO_SO_EPS) {
          const err = new Error("At least one split quantity must be greater than zero.");
          err.statusCode = 400;
          throw err;
        }
        if (Math.abs(splitTotal - rejectedQty) > WO_SO_EPS) {
          const err = new Error("Rework + Hold + Scrap must equal rejected qty.");
          err.statusCode = 400;
          throw err;
        }
      } else {
        if (rejectedQty > WO_SO_EPS && body.rejectedStockBucket == null) {
          const err = new Error(
            "When rejected quantity is greater than zero, choose a rejected stock action: Rework, Hold, Usable, or Scrap.",
          );
          err.statusCode = 400;
          throw err;
        }
      }

      /** Operator routing on reject: rework qty goes to owned REWORK (manual rework → final rework QC); hold uses owned QC_HOLD. */
      /** @type {"USABLE" | "QC_HOLD" | "REWORK" | "SCRAP" | null} */
      const requestedRejectedBucket = !hasSplit && rejectedQty > WO_SO_EPS ? body.rejectedStockBucket : null;

      /** Ledger bucket stored on QcEntry + used for stock posting. */
      /** @type {"USABLE" | "QC_HOLD" | "REWORK" | "SCRAP" | null} */
      let ledgerRejectedBucket = requestedRejectedBucket;
      /** @type {import("@prisma/client").QcRejectedRoute | null} */
      let rejectedRoute = null;
      if (hasSplit) {
        // Split routing: rejectedQty is distributed across multiple dispositions/buckets.
        // Snapshot bucket on QcEntry: prefer QC_HOLD when hold exists; else REWORK when rework-only; else SCRAP.
        ledgerRejectedBucket =
          splitHold > WO_SO_EPS
            ? "QC_HOLD"
            : splitRework > WO_SO_EPS
              ? "REWORK"
              : splitScrap > WO_SO_EPS
                ? "SCRAP"
                : null;
        rejectedRoute = null;
      }
      if (requestedRejectedBucket === "REWORK") {
        ledgerRejectedBucket = "REWORK";
        rejectedRoute = "REWORK";
      } else if (requestedRejectedBucket === "QC_HOLD") {
        ledgerRejectedBucket = "QC_HOLD";
        rejectedRoute = "HOLD";
      } else if (requestedRejectedBucket === "SCRAP") {
        ledgerRejectedBucket = "SCRAP";
        rejectedRoute = "SCRAP";
      } else if (requestedRejectedBucket === "USABLE") {
        ledgerRejectedBucket = "USABLE";
        rejectedRoute = "USABLE";
      }

      // Accounting loss on the QC row: initial scrap only (rework/hold are recoverable until scrapped).
      const lossQty = hasSplit
        ? Math.max(0, splitScrap)
        : rejectedRoute === "SCRAP"
          ? Math.max(0, rejectedQty)
          : 0;
      // FG stock: accepted credits USABLE; rejected credits exactly one bucket (no double-count across buckets).
      const fgItemIdForAssert = prod.workOrderLine.fgItemId;
      await assertNonNegativeStockAfterNetChange(
        tx,
        fgItemIdForAssert,
        acceptedQty,
        "Cannot post this QC: usable stock would go negative. Adjust quantities or refresh and try again.",
        { stockBucket: "USABLE" },
      );
      if (hasSplit) {
        if (splitRework > WO_SO_EPS) {
          await assertNonNegativeStockAfterNetChange(
            tx,
            fgItemIdForAssert,
            splitRework,
            "Cannot post this QC: rework bucket would go negative. Adjust rework split or refresh.",
            { stockBucket: "REWORK" },
          );
        }
        if (splitHold > WO_SO_EPS) {
          await assertNonNegativeStockAfterNetChange(
            tx,
            fgItemIdForAssert,
            splitHold,
            "Cannot post this QC: QC hold bucket would go negative. Adjust hold split or refresh.",
            { stockBucket: "QC_HOLD" },
          );
        }
        if (splitScrap > WO_SO_EPS) {
          await assertNonNegativeStockAfterNetChange(
            tx,
            fgItemIdForAssert,
            splitScrap,
            "Cannot post this QC: scrap bucket would go negative. Adjust scrap split or refresh.",
            { stockBucket: "SCRAP" },
          );
        }
      } else if (ledgerRejectedBucket === "USABLE") {
        await assertNonNegativeStockAfterNetChange(
          tx,
          fgItemIdForAssert,
          rejectedQty,
          "Cannot post this QC: usable stock would go negative. Adjust rejected quantity or refresh.",
          { stockBucket: "USABLE" },
        );
      } else if (ledgerRejectedBucket === "QC_HOLD") {
        await assertNonNegativeStockAfterNetChange(
          tx,
          fgItemIdForAssert,
          rejectedQty,
          "Cannot post this QC: QC hold bucket would go negative. Adjust rejected quantity or refresh.",
          { stockBucket: "QC_HOLD" },
        );
      } else if (ledgerRejectedBucket === "REWORK") {
        await assertNonNegativeStockAfterNetChange(
          tx,
          fgItemIdForAssert,
          rejectedQty,
          "Cannot post this QC: rework bucket would go negative. Adjust rejected quantity or refresh.",
          { stockBucket: "REWORK" },
        );
      } else if (ledgerRejectedBucket === "QC_PENDING") {
        await assertNonNegativeStockAfterNetChange(
          tx,
          fgItemIdForAssert,
          rejectedQty,
          "Cannot post this QC: awaiting-QC bucket would go negative. Adjust rejected quantity or refresh.",
          { stockBucket: "QC_PENDING" },
        );
      } else if (ledgerRejectedBucket === "SCRAP") {
        await assertNonNegativeStockAfterNetChange(
          tx,
          fgItemIdForAssert,
          rejectedQty,
          "Cannot post this QC: scrap bucket would go negative. Adjust rejected quantity or refresh.",
          { stockBucket: "SCRAP" },
        );
      }

      const created = await tx.qcEntry.create({
        data: {
          docNo: await allocateDocNo(tx, { docType: DocType.QC_ENTRY, date: new Date() }),
          productionId: prod.id,
          acceptedQty: String(acceptedQty),
          rejectedQty: String(rejectedQty),
          rejectedStockBucket: ledgerRejectedBucket,
          rejectedRoute,
          lossQty: String(lossQty),
          reason: body.reason,
          scrapReusable: body.scrapReusable,
        },
      });

      const woId = prod.workOrderLine.workOrderId;
      // IMPORTANT: these must be declared before any REWORK pre/post reads (REWORK bucket, not production WO).
      /** @type {number | undefined} */
      let reworkStockGlobalBefore;
      /** @type {number | undefined} */
      let reworkStockGlobalAfter;
      /** @type {number | undefined} */
      let ownedReworkStockBefore;
      /** @type {number | undefined} */
      let ownedReworkStockAfter;

      /** @type {number | null} */
      let createdDispositionId = null;
      /** @type {import("@prisma/client").StockTransaction | null} */
      let reworkOwnedStockTxn = null;

      if (hasSplit && rejectedQty > WO_SO_EPS) {
        // Split: create multiple dispositions and stock postings.
        const now = new Date();
        const reasonTrim = typeof body.reason === "string" ? body.reason.trim() : "";

        // REWORK portion: disposition ready for final rework QC + owned REWORK (manual rework → final QC).
        if (splitRework > WO_SO_EPS) {
          const disp = await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: created.id,
              workOrderId: woId,
              itemId: fgItemIdForAssert,
              qty: String(splitRework),
              remainingQty: String(splitRework),
              phase: "FIRST_QC",
              status: "REWORK_READY_FOR_QC",
              remarks: reasonTrim || null,
              createdByUserId: req.user.userId,
            },
          });
          const dispId = Number(disp?.id ?? 0) > 0 ? Number(disp.id) : null;
          if (dispId == null) {
            const err = new Error("QC split posting failed: rework disposition could not be created.");
            err.statusCode = 500;
            throw err;
          }
          createdDispositionId = createdDispositionId ?? dispId;

          reworkStockGlobalBefore = await getItemStockQty(fgItemIdForAssert, tx, { stockBucket: "REWORK" });
          ownedReworkStockBefore = await getItemStockQty(fgItemIdForAssert, tx, {
            stockBucket: "REWORK",
            qcRejectedDispositionId: dispId,
          });

          reworkOwnedStockTxn = await tx.stockTransaction.create({
            data: {
              itemId: fgItemIdForAssert,
              transactionType: "QC",
              refId: created.id,
              qcRejectedDispositionId: dispId,
              stockBucket: "REWORK",
              qtyIn: String(splitRework),
              qtyOut: "0",
              reason: reasonTrim
                ? `QC reject → rework bucket (owned REWORK) — ${reasonTrim}`
                : "QC reject → rework bucket (owned REWORK)",
              createdByUserId: req.user.userId,
            },
          });
          const reRead = await tx.stockTransaction.findFirst({
            where: { id: reworkOwnedStockTxn.id, qcRejectedDispositionId: dispId },
            select: { id: true },
          });
          if (!reRead) {
            const err = new Error("QC split posting failed: owned REWORK stock row was not created.");
            err.statusCode = 500;
            throw err;
          }
        }

        // HOLD portion (create disposition + owned QC_HOLD credit so it appears in Hold Decision queue).
        if (splitHold > WO_SO_EPS) {
          const dispHold = await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: created.id,
              workOrderId: woId,
              itemId: fgItemIdForAssert,
              qty: String(splitHold),
              remainingQty: String(splitHold),
              phase: "FIRST_QC",
              status: "HOLD",
              remarks: reasonTrim || null,
              createdByUserId: req.user.userId,
            },
          });
          const dispHoldId = Number(dispHold?.id ?? 0) > 0 ? Number(dispHold.id) : null;
          if (dispHoldId == null) {
            const err = new Error("QC split posting failed: hold disposition could not be created.");
            err.statusCode = 500;
            throw err;
          }
          await tx.stockTransaction.create({
            data: {
              itemId: fgItemIdForAssert,
              transactionType: "QC",
              refId: created.id,
              qcRejectedDispositionId: dispHoldId,
              stockBucket: "QC_HOLD",
              qtyIn: String(splitHold),
              qtyOut: "0",
              reason: reasonTrim ? `QC reject → HOLD (owned QC_HOLD) — ${reasonTrim}` : "QC reject → HOLD (owned QC_HOLD)",
              createdByUserId: req.user.userId,
            },
          });
        }

        // SCRAP portion (direct to SCRAP + SCRAP disposition for register).
        if (splitScrap > WO_SO_EPS) {
          await tx.stockTransaction.create({
            data: {
              itemId: fgItemIdForAssert,
              transactionType: "QC",
              refId: created.id,
              stockBucket: "SCRAP",
              qtyIn: String(splitScrap),
              qtyOut: "0",
            },
          });
          await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: created.id,
              workOrderId: woId,
              itemId: fgItemIdForAssert,
              qty: String(splitScrap),
              remainingQty: "0",
              phase: "FIRST_QC",
              status: "SCRAP",
              remarks: reasonTrim || null,
              createdByUserId: req.user.userId,
              closedAt: now,
            },
          });
        }
      } else if (rejectedQty > WO_SO_EPS && rejectedRoute && rejectedRoute !== "USABLE") {
        // Single-route reject dispositions + owned stock (rework skips supervisor approval).
        if (rejectedRoute === "REWORK") {
          const disp = await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: created.id,
              workOrderId: woId,
              itemId: fgItemIdForAssert,
              qty: String(rejectedQty),
              remainingQty: String(rejectedQty),
              phase: "FIRST_QC",
              status: "REWORK_READY_FOR_QC",
              remarks: body.reason ?? null,
              createdByUserId: req.user.userId,
            },
          });
          createdDispositionId = Number(disp?.id ?? 0) > 0 ? Number(disp.id) : null;
          if (createdDispositionId == null) {
            const err = new Error("QC rework posting failed: disposition could not be created.");
            err.statusCode = 500;
            throw err;
          }

          reworkStockGlobalBefore = await getItemStockQty(fgItemIdForAssert, tx, { stockBucket: "REWORK" });
          ownedReworkStockBefore = await getItemStockQty(fgItemIdForAssert, tx, {
            stockBucket: "REWORK",
            qcRejectedDispositionId: createdDispositionId,
          });

          reworkOwnedStockTxn = await tx.stockTransaction.create({
            data: {
              itemId: fgItemIdForAssert,
              transactionType: "QC",
              refId: created.id,
              qcRejectedDispositionId: createdDispositionId,
              stockBucket: "REWORK",
              qtyIn: String(rejectedQty),
              qtyOut: "0",
              reason: body.reason?.trim()
                ? `QC reject → rework bucket (owned REWORK) — ${body.reason.trim()}`
                : "QC reject → rework bucket (owned REWORK)",
              createdByUserId: req.user.userId,
            },
          });

          const reRead = await tx.stockTransaction.findFirst({
            where: { id: reworkOwnedStockTxn.id, qcRejectedDispositionId: createdDispositionId },
            select: {
              id: true,
              itemId: true,
              stockBucket: true,
              qtyIn: true,
              qtyOut: true,
              refId: true,
              qcRejectedDispositionId: true,
            },
          });
          if (!reRead) {
            const err = new Error("QC rework posting failed: owned REWORK stock row was not created.");
            err.statusCode = 500;
            throw err;
          }
        } else if (rejectedRoute === "HOLD") {
          const dispHold = await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: created.id,
              workOrderId: woId,
              itemId: fgItemIdForAssert,
              qty: String(rejectedQty),
              remainingQty: String(rejectedQty),
              phase: "FIRST_QC",
              status: "HOLD",
              remarks: body.reason ?? null,
              createdByUserId: req.user.userId,
            },
          });
          const dispHoldId = Number(dispHold?.id ?? 0) > 0 ? Number(dispHold.id) : null;
          if (dispHoldId == null) {
            const err = new Error("QC hold posting failed: disposition could not be created.");
            err.statusCode = 500;
            throw err;
          }
          await tx.stockTransaction.create({
            data: {
              itemId: fgItemIdForAssert,
              transactionType: "QC",
              refId: created.id,
              qcRejectedDispositionId: dispHoldId,
              stockBucket: "QC_HOLD",
              qtyIn: String(rejectedQty),
              qtyOut: "0",
              reason: body.reason?.trim()
                ? `QC reject → HOLD (owned QC_HOLD) — ${body.reason.trim()}`
                : "QC reject → HOLD (owned QC_HOLD)",
              createdByUserId: req.user.userId,
            },
          });
        } else if (rejectedRoute === "SCRAP") {
          await tx.qcRejectedDisposition.create({
            data: {
              sourceQcEntryId: created.id,
              workOrderId: woId,
              itemId: fgItemIdForAssert,
              qty: String(rejectedQty),
              remainingQty: "0",
              phase: "FIRST_QC",
              status: "SCRAP",
              remarks: body.reason ?? null,
              createdByUserId: req.user.userId,
              closedAt: new Date(),
            },
          });
        }
      }

      // Scrap system (loss tracking only, not stock): auto-create on QC reject.
      // For split routing, record only the SCRAP portion as loss (rework/hold are not scrap until decided).
      const scrapLossQty = hasSplit
        ? Math.max(0, splitScrap)
        : rejectedRoute === "SCRAP"
          ? Math.max(0, rejectedQty)
          : 0;
      if (scrapLossQty > 0) {
        await tx.scrapRecord.create({
          data: {
            fgItemId: prod.workOrderLine.fgItemId,
            workOrderId: prod.workOrderLine.workOrderId,
            rejectedQty: String(scrapLossQty),
            reason: body.reason,
            qcEntryId: created.id,
          },
        });
      }

      const fgItemId = prod.workOrderLine.fgItemId;
      const affectsUsableFg = acceptedQty > WO_SO_EPS;
      const affectsRejectedBucket = !hasSplit && rejectedQty > WO_SO_EPS && ledgerRejectedBucket != null;
      // REWORK/HOLD post owned rows above; SCRAP/USABLE use generic posting when applicable.
      const affectsRejectedBucketPosting =
        affectsRejectedBucket && rejectedRoute !== "REWORK" && rejectedRoute !== "HOLD";
      const affectsReworkBucketPosting =
        rejectedRoute === "REWORK" && ledgerRejectedBucket === "REWORK" && rejectedQty > WO_SO_EPS;
      /** @type {number | undefined} */
      let stockBefore;
      /** @type {number | undefined} */
      let stockAfter;
      if (affectsUsableFg || affectsRejectedBucket) {
        stockBefore = await getItemStockQty(fgItemId, tx);
      }
      if (affectsReworkBucketPosting) {
        if (reworkStockGlobalBefore === undefined) {
          reworkStockGlobalBefore = await getItemStockQty(fgItemId, tx, { stockBucket: "REWORK" });
        }
        if (createdDispositionId != null && ownedReworkStockBefore === undefined) {
          ownedReworkStockBefore = await getItemStockQty(fgItemId, tx, {
            stockBucket: "REWORK",
            qcRejectedDispositionId: createdDispositionId,
          });
        }
      }
      if (affectsUsableFg) {
        await tx.stockTransaction.create({
          data: {
            itemId: fgItemId,
            transactionType: "QC",
            refId: created.id,
            stockBucket: "USABLE",
            qtyIn: String(acceptedQty),
            qtyOut: "0",
          },
        });
      }
      if (affectsRejectedBucketPosting) {
        await tx.stockTransaction.create({
          data: {
            itemId: fgItemId,
            transactionType: "QC",
            refId: created.id,
            stockBucket: ledgerRejectedBucket,
            qtyIn: String(rejectedQty),
            qtyOut: "0",
          },
        });
      }
      if (affectsUsableFg || affectsRejectedBucket) {
        stockAfter = await getItemStockQty(fgItemId, tx);
      }
      if (affectsReworkBucketPosting) {
        reworkStockGlobalAfter = await getItemStockQty(fgItemId, tx, { stockBucket: "REWORK" });
        if (createdDispositionId != null) {
          ownedReworkStockAfter = await getItemStockQty(fgItemId, tx, {
            stockBucket: "REWORK",
            qcRejectedDispositionId: createdDispositionId,
          });
        }
        const inc = Number(reworkStockGlobalAfter ?? 0) - Number(reworkStockGlobalBefore ?? 0);
        if (Math.abs(inc - rejectedQty) > 1e-6) {
          const err = new Error(
            `QC rework posting failed: expected REWORK stock to increase by ${rejectedQty}, got ${inc}.`,
          );
          err.statusCode = 500;
          throw err;
        }
        if (createdDispositionId != null) {
          const ownedInc = Number(ownedReworkStockAfter ?? 0) - Number(ownedReworkStockBefore ?? 0);
          if (Math.abs(ownedInc - rejectedQty) > 1e-6) {
            const err = new Error(
              `QC rework posting failed: expected OWNED REWORK to increase by ${rejectedQty}, got ${ownedInc}.`,
            );
            err.statusCode = 500;
            throw err;
          }
        }
      }

      // Split rework: verify global + owned REWORK deltas match splitRework.
      if (hasSplit && splitRework > WO_SO_EPS && createdDispositionId != null) {
        const afterGlobal = await getItemStockQty(fgItemId, tx, { stockBucket: "REWORK" });
        const beforeGlobal = Number(reworkStockGlobalBefore ?? 0);
        if (Math.abs(Number(afterGlobal) - beforeGlobal - splitRework) > 1e-6) {
          const err = new Error(
            `QC split rework posting failed: expected REWORK stock to increase by ${splitRework}, got ${Number(afterGlobal) - beforeGlobal}.`,
          );
          err.statusCode = 500;
          throw err;
        }
        const ownedAfter = await getItemStockQty(fgItemId, tx, {
          stockBucket: "REWORK",
          qcRejectedDispositionId: createdDispositionId,
        });
        const ownedBefore = Number(ownedReworkStockBefore ?? 0);
        if (Math.abs(ownedAfter - ownedBefore - splitRework) > 1e-6) {
          const err = new Error(
            `QC split rework posting failed: expected OWNED REWORK to increase by ${splitRework}, got ${ownedAfter - ownedBefore}.`,
          );
          err.statusCode = 500;
          throw err;
        }
      }

      const wol = prod.workOrderLine;
      const soId = wol.workOrder.salesOrderId;
      const reasonTrim = body.reason?.trim() ?? "";

      /** @type {Record<string, unknown>} */
      const auditPayload = {
        snapshot: {
          productionId: prod.id,
          workOrderId: wol.workOrderId,
          workOrderLineId: wol.id,
          salesOrderId: soId,
          fgItemId,
          ...(wol.fgItem?.itemName ? { fgItemName: wol.fgItem.itemName } : {}),
          checkedQty,
          acceptedQty,
          rejectedQty,
          ...(requestedRejectedBucket != null ? { requestedRejectedBucket, ledgerRejectedBucket } : {}),
          scrapReusable: body.scrapReusable,
          ...(rejectedQty > WO_SO_EPS ? { scrapRecorded: true } : {}),
          ...(reasonTrim ? { note: reasonTrim } : {}),
        },
        ...((affectsUsableFg || affectsRejectedBucket) && stockBefore !== undefined && stockAfter !== undefined
          ? { stockBefore, stockAfter }
          : {}),
      };

      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.QC_ENTRY,
        entityId: String(created.id),
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `QC entry #${created.id} posted (batch ${prod.id}, SO ${soId})`,
        payload: auditPayload,
      });

      const woQ = prod.workOrderLine.workOrder;
      const qcDoc = displayQcEntryNo(created.id, created.docNo);
      await logActivity({
        tx,
        user: req.user,
        module: ACTIVITY_MODULES.QC,
        entityType: ACTIVITY_ENTITY_TYPES.QC_ENTRY,
        entityId: created.id,
        docNo: qcDoc,
        action: ACTIVITY_ACTIONS.FINALIZED,
        message: `QC Entry ${qcDoc} posted`,
        metadata: {
          workOrderId: woQ?.id,
          itemId: fgItemId,
          acceptedQty,
          rejectedQty,
          cycleId: woQ?.cycleId != null ? Number(woQ.cycleId) : undefined,
          cycleNo: woQ?.cycle?.cycleNo != null ? Number(woQ.cycle.cycleNo) : undefined,
        },
      });

      await maybeAutoCloseSalesOrderOperationally(tx, soId, {
        actorUserId: req.user?.userId,
        actorRole: req.user?.role,
        reason: "QC posting completed the remaining operational work.",
      });

      return created;
    }).catch((e) => {
      // Attach high-signal context for server logs (errorHandler prints the error object).
      try {
        e.qcContext = {
          route: "POST /api/production/qc-entries",
          userId: req.user?.userId,
          role: req.user?.role,
          productionId: body.productionId,
          checkedQty: body.checkedQty,
          rejectedQty: body.rejectedQty,
          rejectedStockBucket: body.rejectedStockBucket ?? null,
          scrapReusable: body.scrapReusable ?? false,
        };
      } catch {
        // ignore
      }
      throw e;
    });

    return res.status(201).json(qc);
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/production/qc-stock-adjustments
 * FG stock-in adjustments waiting for QC allocation to a sales order (so they can contribute to dispatch QC pool).
 */
productionRouter.get("/qc-stock-adjustments", requireAuth, requireRole(["ADMIN", "QA"]), async (req, res, next) => {
  try {
    const txns = await prisma.stockTransaction.findMany({
      where: {
        transactionType: "ADJUSTMENT",
        stockBucket: "USABLE",
        reversedAt: null,
        reversalOfId: null,
        qtyIn: { gt: 0 },
        item: { itemType: "FG" },
        // Legacy safeguard: hide older internal rows that were (incorrectly) stored as ADJUSTMENT.
        // After introducing StockTxnType.BUCKET_TRANSFER, new internal rows are excluded by transactionType alone.
        NOT: {
          OR: [
            { reason: { contains: "Bucket " } },
            { reason: { contains: "Rework QC" } },
            { reason: { contains: "QC recheck" } },
            { reason: { contains: "Supervisor approved rework" } },
            { reason: { contains: "Rework executed" } },
          ],
        },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: { item: true },
      take: 200,
    });

    const ids = txns.map((t) => t.id);
    const qcAgg =
      ids.length === 0
        ? []
        : await prisma.stockAdjustmentQcEntry.groupBy({
            by: ["stockTransactionId"],
            where: { stockTransactionId: { in: ids }, reversedAt: null },
            _sum: { acceptedQty: true, rejectedQty: true },
          });
    const usedByTxnId = new Map(
      qcAgg.map((r) => [
        r.stockTransactionId,
        Number(r._sum.acceptedQty ?? 0) + Number(r._sum.rejectedQty ?? 0),
      ]),
    );

    const rows = txns
      .map((t) => {
        const totalIn = Number(t.qtyIn ?? 0);
        const used = usedByTxnId.get(t.id) ?? 0;
        const pending = Math.max(0, totalIn - used);
        return {
          stockTransactionId: t.id,
          date: t.date.toISOString(),
          itemId: t.itemId,
          itemName: t.item.itemName,
          qtyIn: totalIn,
          qcUsedQty: used,
          qcPendingQty: pending,
          reason: t.reason ?? null,
        };
      })
      .filter((r) => r.qcPendingQty > REPORT_QUEUE_EPS);

    return res.json({ rows });
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /api/production/qc-stock-adjustments
 * Record QC against stock-adjusted FG and allocate accepted qty to a sales order + item for dispatch QC pool.
 */
productionRouter.post("/qc-stock-adjustments", requireAuth, requireRole(["ADMIN", "QA"]), async (req, res, next) => {
  try {
    const schema = z.object({
      stockTransactionId: z.number().int(),
      salesOrderId: z.number().int(),
      /** Units inspected this posting; must be ≤ pending qty on the stock adjustment txn. */
      checkedQty: z.number().positive(),
      rejectedQty: z.number().nonnegative(),
      reason: z.string().optional(),
    });
    const body = schema.parse(req.body);

    const created = await prisma.$transaction(async (tx) => {
      const st = await tx.stockTransaction.findUnique({
        where: { id: body.stockTransactionId },
        include: { item: true },
      });
      if (!st) {
        const err = new Error("Stock adjustment not found.");
        err.statusCode = 404;
        throw err;
      }
      if (st.transactionType !== "ADJUSTMENT" || Number(st.qtyIn ?? 0) <= REPORT_QUEUE_EPS) {
        const err = new Error("QC stock adjustment must reference an FG stock-in adjustment.");
        err.statusCode = 400;
        throw err;
      }
      if (st.reversedAt != null || st.reversalOfId != null) {
        const err = new Error("This stock adjustment is reversed; QC cannot be posted.");
        err.statusCode = 409;
        throw err;
      }
      if (st.item?.itemType !== "FG") {
        const err = new Error("Only FG stock adjustments can be sent to QC for dispatch eligibility.");
        err.statusCode = 400;
        throw err;
      }

      const so = await tx.salesOrder.findUnique({ where: { id: body.salesOrderId }, include: { lines: true } });
      if (!so) {
        const err = new Error("Sales order not found.");
        err.statusCode = 404;
        throw err;
      }
      if (so.internalStatus === "DRAFT") {
        const err = new Error("Sales order must be approved before QC allocation.");
        err.statusCode = 409;
        throw err;
      }
      const soHasItem = (so.lines || []).some((l) => l.itemId === st.itemId);
      if (!soHasItem) {
        const err = new Error("Selected sales order does not contain this FG item.");
        err.statusCode = 400;
        throw err;
      }

      const checkedQty = Number(body.checkedQty);
      const rejectedQty = Number(body.rejectedQty);
      if (rejectedQty > checkedQty + WO_SO_EPS) {
        const err = new Error("Rejected quantity cannot exceed checked quantity.");
        err.statusCode = 400;
        throw err;
      }
      const acceptedQty = checkedQty - rejectedQty;
      if (acceptedQty < -WO_SO_EPS) {
        const err = new Error("Accepted quantity cannot be negative.");
        err.statusCode = 400;
        throw err;
      }

      const agg = await tx.stockAdjustmentQcEntry.aggregate({
        where: { stockTransactionId: st.id, reversedAt: null },
        _sum: { acceptedQty: true, rejectedQty: true },
      });
      const used = Number(agg._sum.acceptedQty ?? 0) + Number(agg._sum.rejectedQty ?? 0);
      const pending = Math.max(0, Number(st.qtyIn ?? 0) - used);
      if (checkedQty > pending + WO_SO_EPS) {
        const err = new Error(`Checked quantity cannot exceed pending qty on this stock adjustment (${pending}).`);
        err.statusCode = 400;
        throw err;
      }

      const row = await tx.stockAdjustmentQcEntry.create({
        data: {
          stockTransactionId: st.id,
          salesOrderId: so.id,
          itemId: st.itemId,
          acceptedQty: String(acceptedQty),
          rejectedQty: String(rejectedQty),
          reason: body.reason ?? null,
        },
      });

      await auditLog.write(tx, {
        action: auditLog.AuditAction.CREATE,
        entityType: auditLog.AuditEntityType.QC_ENTRY,
        entityId: String(row.id),
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `QC posted for stock adjustment #${st.id} (SO-${so.id}, item #${st.itemId})`,
        payload: {
          sourceType: "STOCK_ADJUSTMENT",
          stockTransactionId: st.id,
          salesOrderId: so.id,
          itemId: st.itemId,
          checkedQty,
          acceptedQty,
          rejectedQty,
          pendingBefore: pending,
        },
      });

      return row;
    });

    return res.status(201).json(created);
  } catch (e) {
    return next(e);
  }
});

/**
 * Full reversal of one QC entry: void QC + scrap link, QcReversal header, QC_REVERSAL stock
 * (qtyOut from USABLE for accepted; qtyOut from stored rejected bucket when rejected was posted to stock).
 * QC_REVERSAL rows set reversalOfId → matching forward QC StockTransaction; forward QC stock rows get reversedAt.
 * Original QC entry rows are not deleted; a new QC may be posted for the same production.
 * After qcEntry.reversedAt is set, this row is excluded from dispatch caps and QC aggregates (see qcEntryConstants.js).
 */
productionRouter.post("/qc-reverse", requireAuth, requireRole(["ADMIN", "QA"]), async (req, res, next) => {
  try {
    const schema = z.object({
      qcEntryId: z.number().int().positive(),
      reason: z.string().min(1, "Reason is required."),
    });
    const body = schema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      // Unlocked: only resolves salesOrderId + fgItemId for lock order (SalesOrder → Item → QcEntry).
      // Authoritative QC state comes from the re-read after FOR UPDATE.
      const lockRouting = await tx.qcEntry.findUnique({
        where: { id: body.qcEntryId },
        select: {
          id: true,
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
      });
      if (!lockRouting?.production?.workOrderLine?.workOrder) {
        const err = new Error("QC entry not found");
        err.statusCode = 404;
        throw err;
      }
      const soId = lockRouting.production.workOrderLine.workOrder.salesOrderId;
      const fgItemIdPeek = lockRouting.production.workOrderLine.fgItemId;
      if (soId == null) {
        const err = new Error("Work order not found for this QC entry");
        err.statusCode = 400;
        throw err;
      }

      await lockSalesOrderForUpdate(tx, soId);
      await lockItemForUpdate(tx, fgItemIdPeek);
      await lockQcEntryForUpdate(tx, body.qcEntryId);

      const qc = await tx.qcEntry.findUnique({
        where: { id: body.qcEntryId },
        include: {
          production: { include: { workOrderLine: { include: { workOrder: { include: { cycle: true } } } } } },
        },
      });
      if (!qc) {
        const err = new Error("QC entry not found");
        err.statusCode = 404;
        throw err;
      }
      if (qc.reversedAt != null) {
        const err = new Error("QC entry already reversed");
        err.statusCode = 400;
        throw err;
      }

      const linkedDispositions = await tx.qcRejectedDisposition.findMany({
        where: { sourceQcEntryId: qc.id, voidedAt: null },
      });
      for (const d of linkedDispositions) {
        if (d.status === "REWORK_READY_FOR_QC") {
          const err = new Error(
            "Cannot reverse this QC while approved rework is waiting for QC recheck. Use QC workflows to clear the line first.",
          );
          err.statusCode = 400;
          throw err;
        }
        if (d.phase === "RECHECK") {
          const err = new Error(
            "Cannot reverse this QC after a QC recheck split was recorded. Contact Admin if a correction is required.",
          );
          err.statusCode = 400;
          throw err;
        }
        if (
          d.status !== "SCRAP" &&
          Number(d.remainingQty) < Number(d.qty) - WO_SO_EPS
        ) {
          const err = new Error(
            "Cannot reverse this QC after part of the rejected quantity was moved by a follow-up action.",
          );
          err.statusCode = 400;
          throw err;
        }
      }

      const fgItemId = qc.production.workOrderLine.fgItemId;
      const acceptedQty = Number(qc.acceptedQty);
      const rejectedQty = Number(qc.rejectedQty);

      const woForSo = await tx.workOrder.findUnique({
        where: { id: qc.production.workOrderLine.workOrderId },
        select: { salesOrderId: true },
      });
      if (!woForSo?.salesOrderId) {
        const err = new Error("Work order not found for this QC entry");
        err.statusCode = 400;
        throw err;
      }
      const qcAcceptedTotal = await sumQcAcceptedForSoItem(tx, soId, fgItemId);
      const qcAfterReversal = qcAcceptedTotal - acceptedQty;
      const netDispatched = await netDispatchedForSoItem(tx, soId, fgItemId);
      if (netDispatched > qcAfterReversal + STOCK_EPS) {
        const err = new Error(
          "Cannot reverse QC while dispatch already exceeds QC-approved quantity that would remain. Reverse or adjust dispatch first.",
        );
        err.statusCode = 400;
        throw err;
      }

      if (acceptedQty > WO_SO_EPS) {
        await assertSufficientStockForQtyOut(
          tx,
          fgItemId,
          acceptedQty,
          "Cannot reverse QC. Insufficient usable stock. Reverse dispatch or transfers first.",
          { stockBucket: "USABLE" },
        );
      }
      if (rejectedQty > WO_SO_EPS && qc.rejectedStockBucket != null) {
        await assertSufficientStockForQtyOut(
          tx,
          fgItemId,
          rejectedQty,
          "Cannot reverse QC. Insufficient stock in the bucket used for rejected quantity. Adjust transfers or stock first.",
          { stockBucket: qc.rejectedStockBucket },
        );
      }

      const reasonTrim = body.reason.trim();
      const now = new Date();

      const affectsUsable = acceptedQty > WO_SO_EPS;
      const affectsRejectedBucket = rejectedQty > WO_SO_EPS && qc.rejectedStockBucket != null;
      const affectsStock = affectsUsable || affectsRejectedBucket;
      let stockBefore;
      let stockAfter;
      if (affectsStock) {
        stockBefore = await getItemStockQty(fgItemId, tx);
      }

      const rev = await tx.qcReversal.create({
        data: {
          qcEntryId: qc.id,
          reason: reasonTrim,
        },
      });

      await tx.qcEntry.update({
        where: { id: qc.id },
        data: {
          reversedAt: now,
          reversalReason: reasonTrim,
        },
      });

      await tx.qcRejectedDisposition.updateMany({
        where: { sourceQcEntryId: qc.id, voidedAt: null },
        data: { voidedAt: now },
      });

      /** @type {number | null} */
      let acceptedForwardStockId = null;
      /** @type {number | null} */
      let rejectedForwardStockId = null;
      if (affectsUsable) {
        const accRow = await tx.stockTransaction.findFirst({
          where: {
            itemId: fgItemId,
            transactionType: "QC",
            refId: qc.id,
            stockBucket: "USABLE",
          },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        acceptedForwardStockId = accRow?.id ?? null;
        if (acceptedForwardStockId == null) {
          const err = new Error("QC reversal failed: original QC usable stock row not found.");
          err.statusCode = 500;
          throw err;
        }
      }
      if (affectsRejectedBucket && qc.rejectedStockBucket != null) {
        const rejRow = await tx.stockTransaction.findFirst({
          where: {
            itemId: fgItemId,
            transactionType: "QC",
            refId: qc.id,
            stockBucket: qc.rejectedStockBucket,
          },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        rejectedForwardStockId = rejRow?.id ?? null;
        if (rejectedForwardStockId == null) {
          const err = new Error("QC reversal failed: original QC rejected-bucket stock row not found.");
          err.statusCode = 500;
          throw err;
        }
      }

      if (affectsUsable) {
        await tx.stockTransaction.create({
          data: {
            itemId: fgItemId,
            transactionType: "QC_REVERSAL",
            refId: rev.id,
            reversalOfId: acceptedForwardStockId,
            stockBucket: "USABLE",
            qtyIn: "0",
            qtyOut: String(acceptedQty),
            createdByUserId: req.user.userId,
          },
        });
      }
      if (affectsRejectedBucket) {
        await tx.stockTransaction.create({
          data: {
            itemId: fgItemId,
            transactionType: "QC_REVERSAL",
            refId: rev.id,
            reversalOfId: rejectedForwardStockId,
            stockBucket: qc.rejectedStockBucket,
            qtyIn: "0",
            qtyOut: String(rejectedQty),
            createdByUserId: req.user.userId,
          },
        });
      }

      if (affectsUsable || affectsRejectedBucket) {
        await tx.stockTransaction.updateMany({
          where: {
            itemId: fgItemId,
            refId: qc.id,
            transactionType: "QC",
          },
          data: {
            reversedAt: now,
            reversedByUserId: req.user.userId,
          },
        });
      }

      const scrapToVoid = await tx.scrapRecord.count({
        where: { qcEntryId: qc.id, voidedAt: null },
      });

      await tx.scrapRecord.updateMany({
        where: { qcEntryId: qc.id, voidedAt: null },
        data: { voidedAt: now },
      });

      if (affectsStock) {
        stockAfter = await getItemStockQty(fgItemId, tx);
      }

      /** @type {Record<string, unknown>} */
      const auditPayload = {
        reversedOf: {
          entityType: auditLog.AuditEntityType.QC_ENTRY,
          entityId: String(qc.id),
        },
        reason: reasonTrim,
        snapshot: {
          qcReversalId: rev.id,
          productionId: qc.productionId,
          acceptedQty,
          rejectedQty,
          fgItemId,
          qcReversalUsableQty: affectsUsable ? acceptedQty : 0,
          qcReversalRejectedBucketQty:
            affectsRejectedBucket && qc.rejectedStockBucket != null ? { bucket: qc.rejectedStockBucket, qty: rejectedQty } : null,
        },
        ...(affectsStock ? { stockBefore, stockAfter } : {}),
      };

      if (scrapToVoid > 0) {
        auditPayload.changes = {
          scrapRecords: {
            voided: { from: "active", to: "voided" },
            count: scrapToVoid,
          },
        };
      }

      await auditLog.write(tx, {
        action: auditLog.AuditAction.REVERSE,
        entityType: auditLog.AuditEntityType.QC_ENTRY,
        entityId: String(qc.id),
        actorUserId: req.user.userId,
        actorRole: req.user.role,
        summary: `QC entry #${qc.id} reversed (SO ${soId}, usable out ${acceptedQty}${affectsRejectedBucket ? `, ${qc.rejectedStockBucket} out ${rejectedQty}` : ""})`,
        payload: auditPayload,
        reason: reasonTrim,
      });

      const woRv = qc.production?.workOrderLine?.workOrder;
      const qcDocRv = displayQcEntryNo(qc.id, qc.docNo);
      await logActivity({
        tx,
        user: req.user,
        module: ACTIVITY_MODULES.QC,
        entityType: ACTIVITY_ENTITY_TYPES.QC_ENTRY,
        entityId: qc.id,
        docNo: qcDocRv,
        action: ACTIVITY_ACTIONS.REVERSED,
        message: `QC Entry ${qcDocRv} reversed`,
        reason: reasonTrim,
        metadata: {
          workOrderId: woRv?.id,
          itemId: fgItemId,
          acceptedQty,
          rejectedQty,
          cycleId: woRv?.cycleId != null ? Number(woRv.cycleId) : undefined,
          cycleNo: woRv?.cycle?.cycleNo != null ? Number(woRv.cycle.cycleNo) : undefined,
        },
      });

      return { qcReversal: rev, qcEntryId: qc.id };
    });

    return res.status(201).json(result);
  } catch (e) {
    return next(e);
  }
});

module.exports = { productionRouter };
