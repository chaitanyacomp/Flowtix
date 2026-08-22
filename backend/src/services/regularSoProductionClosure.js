/**
 * REGULAR_SO production closure — SO demand vs WO planned quantity.
 *
 * WO planned qty may intentionally exceed SO demand (rejection/wastage buffer).
 * Closure eligibility uses authoritative remaining SO demand, not WO-plan remainder.
 * NO_QTY / Green Level must not call these helpers for shop-floor execution decisions.
 */

const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { dispatchFifoQtyForSoLine } = require("./regularSoBufferQty");

const EPS = 1e-6;

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

/** Local copy — avoid circular require with workOrderLifecycleService. */
function isRegularWorkOrderRecord(wo, so) {
  if (!so || so.orderType === "NO_QTY") return false;
  if (wo.requirementSheetId != null) return false;
  return true;
}

/**
 * Pure line-level coverage decision (decimal-safe).
 * @param {{
 *   soDemandQty: number;
 *   producedOnOtherWos: number;
 *   producedOnThisWo: number;
 *   woPlannedQty: number;
 * }} input
 */
function evaluateRegularSoLineDemandCoverage(input) {
  const soDemandQty = round3(Math.max(0, n(input.soDemandQty)));
  const producedOnOtherWos = round3(Math.max(0, n(input.producedOnOtherWos)));
  const producedOnThisWo = round3(Math.max(0, n(input.producedOnThisWo)));
  const woPlannedQty = round3(Math.max(0, n(input.woPlannedQty)));

  const remainingSoDemand = round3(Math.max(0, soDemandQty - producedOnOtherWos));
  const woTargetBalance = round3(Math.max(0, woPlannedQty - producedOnThisWo));
  const soDemandCovered = producedOnThisWo + EPS >= remainingSoDemand;
  const woPlanMet = producedOnThisWo + EPS >= woPlannedQty;
  const expectedExcessBeforeQc = round3(Math.max(0, producedOnThisWo - remainingSoDemand));
  const soShortageQty = round3(Math.max(0, remainingSoDemand - producedOnThisWo));

  /** AUTO COMPLETED: SO demand covered OR WO plan fully produced. */
  const productionObligationMet = soDemandCovered || woPlanMet;
  /** True shortage vs customer demand (not mere WO-plan buffer remainder). */
  const hasSoShortage = soShortageQty > EPS;
  /** SO covered but WO-plan buffer not fully produced — End Production allowed. */
  const canEndProductionWithWoRemainder = soDemandCovered && woTargetBalance > EPS;

  return {
    soDemandQty,
    producedOnOtherWos,
    producedOnThisWo,
    woPlannedQty,
    remainingSoDemand,
    woTargetBalance,
    soDemandCovered,
    woPlanMet,
    expectedExcessBeforeQc,
    soShortageQty,
    productionObligationMet,
    hasSoShortage,
    canEndProductionWithWoRemainder,
  };
}

/**
 * Aggregate SO demand qty for one FG item on a sales order (customer PO / FIFO basis).
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} tx
 */
async function loadRegularSoDemandQtyForItem(tx, salesOrderId, fgItemId) {
  const so = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      orderType: true,
      lines: {
        where: { itemId: fgItemId },
        select: { qty: true, customerPoQty: true, itemId: true },
      },
    },
  });
  if (!so) return 0;
  let total = 0;
  for (const line of so.lines ?? []) {
    total = round3(total + dispatchFifoQtyForSoLine(line, so.orderType));
  }
  return total;
}

/**
 * Approved produced qty on other non-rejected WOs for the same SO + FG.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} tx
 */
async function loadApprovedProducedOnOtherRegularWos(tx, { salesOrderId, fgItemId, excludeWorkOrderId }) {
  const otherLines = await tx.workOrderLine.findMany({
    where: {
      fgItemId,
      workOrderId: { not: excludeWorkOrderId },
      workOrder: {
        salesOrderId,
        status: { not: "REJECTED" },
        requirementSheetId: null,
        salesOrder: { orderType: { not: "NO_QTY" } },
      },
    },
    select: { id: true },
  });
  if (!otherLines.length) return 0;
  const producedMap = await getApprovedProducedQtyByWorkOrderLineIds(
    tx,
    otherLines.map((l) => l.id),
  );
  let total = 0;
  for (const line of otherLines) {
    total = round3(total + (producedMap.get(line.id) ?? 0));
  }
  return total;
}

/**
 * Full WO coverage snapshot for REGULAR end-production / completion.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} tx
 */
async function computeRegularSoWorkOrderDemandCoverage(tx, workOrderId) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      docNo: true,
      status: true,
      requirementSheetId: true,
      cycleId: true,
      sourceType: true,
      salesOrderId: true,
      salesOrder: { select: { id: true, docNo: true, orderType: true } },
      lines: { select: { id: true, qty: true, plannedQty: true, fgItemId: true } },
      productionExecution: { select: { executionStatus: true } },
      productionReports: {
        where: { status: "CONFIRMED" },
        select: { id: true, status: true, confirmedAt: true },
        take: 1,
      },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (!isRegularWorkOrderRecord(wo, wo.salesOrder)) {
    const err = new Error("SO-demand closure coverage applies to REGULAR work orders only.");
    err.statusCode = 409;
    err.code = "REGULAR_SCOPE_REQUIRED";
    throw err;
  }

  const lineIds = wo.lines.map((l) => l.id);
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);
  const lines = [];
  for (const line of wo.lines) {
    const soDemandQty = await loadRegularSoDemandQtyForItem(tx, wo.salesOrderId, line.fgItemId);
    const producedOnOtherWos = await loadApprovedProducedOnOtherRegularWos(tx, {
      salesOrderId: wo.salesOrderId,
      fgItemId: line.fgItemId,
      excludeWorkOrderId: wo.id,
    });
    const producedOnThisWo = round3(producedByLineId.get(line.id) ?? 0);
    const woPlannedQty = round3(n(line.plannedQty ?? line.qty));
    const coverage = evaluateRegularSoLineDemandCoverage({
      soDemandQty,
      producedOnOtherWos,
      producedOnThisWo,
      woPlannedQty,
    });
    lines.push({
      workOrderLineId: line.id,
      fgItemId: line.fgItemId,
      ...coverage,
    });
  }

  const soDemandCovered = lines.every((l) => l.soDemandCovered);
  const productionObligationMet = lines.every((l) => l.productionObligationMet);
  const hasSoShortage = lines.some((l) => l.hasSoShortage);
  const woTargetBalance = round3(lines.reduce((s, l) => s + l.woTargetBalance, 0));
  const producedQty = round3(lines.reduce((s, l) => s + l.producedOnThisWo, 0));
  const soDemandQty = round3(lines.reduce((s, l) => s + l.soDemandQty, 0));
  const remainingSoDemand = round3(lines.reduce((s, l) => s + l.remainingSoDemand, 0));
  const expectedExcessBeforeQc = round3(lines.reduce((s, l) => s + l.expectedExcessBeforeQc, 0));
  const woPlannedQty = round3(lines.reduce((s, l) => s + l.woPlannedQty, 0));
  const soShortageQty = round3(lines.reduce((s, l) => s + l.soShortageQty, 0));
  const canEndProductionWithWoRemainder = soDemandCovered && woTargetBalance > EPS;
  const executionStatus = String(wo.productionExecution?.executionStatus ?? "RUNNING").toUpperCase();
  const confirmedReport = wo.productionReports?.[0] ?? null;
  const reportPending = executionStatus === "SHORTFALL_PENDING" && !confirmedReport;

  return {
    workOrderId: wo.id,
    workOrderDocNo: wo.docNo,
    workOrderStatus: wo.status,
    salesOrderId: wo.salesOrderId,
    salesOrderDocNo: wo.salesOrder?.docNo ?? null,
    executionStatus,
    reportPending,
    productionReportConfirmed: Boolean(confirmedReport),
    productionReportId: confirmedReport?.id ?? null,
    productionReportConfirmedAt: confirmedReport?.confirmedAt ?? null,
    soDemandQty,
    producedQty,
    woPlannedQty,
    woTargetBalance,
    remainingSoDemand,
    expectedExcessBeforeQc,
    soShortageQty,
    soDemandCovered,
    productionObligationMet,
    hasSoShortage,
    canEndProductionWithWoRemainder,
    /** End Production (SO covered) or End with Shortage (SO short). */
    canRequestEndProduction: producedQty > EPS && (canEndProductionWithWoRemainder || hasSoShortage),
    lines,
  };
}

/**
 * Pure gate: additional REGULAR_SO production is forbidden once SO demand is covered
 * or End Production has parked the mandatory Production Report.
 * @param {{ reportPending?: boolean; soDemandCovered?: boolean; lines?: Array<{ workOrderLineId: number; soDemandCovered?: boolean }> } | null | undefined} coverage
 * @param {number} workOrderLineId
 * @returns {{ code: string; message: string } | null}
 */
function regularSoAdditionalProductionBlock(coverage, workOrderLineId) {
  if (!coverage) return null;
  if (coverage.reportPending) {
    return {
      code: "REGULAR_SO_PRODUCTION_LOCKED_REPORT_PENDING",
      message: "Production entry is locked while the Production Report is pending.",
    };
  }
  const line = (coverage.lines || []).find((l) => Number(l.workOrderLineId) === Number(workOrderLineId));
  const covered = line ? Boolean(line.soDemandCovered) : Boolean(coverage.soDemandCovered);
  if (covered) {
    return {
      code: "REGULAR_SO_DEMAND_COVERED",
      message:
        "SO demand is already covered by finalized production. End production and continue to the Production Report — additional production is not allowed.",
    };
  }
  return null;
}

/**
 * Reject new REGULAR_SO production after finalized produced qty covers SO demand.
 * No-op for NO_QTY / Green Level / RS-linked work orders.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} tx
 * @param {number} workOrderLineId
 */
async function assertRegularSoAdditionalProductionAllowed(tx, workOrderLineId) {
  const wol = await tx.workOrderLine.findUnique({
    where: { id: workOrderLineId },
    select: {
      id: true,
      workOrderId: true,
      workOrder: {
        select: {
          id: true,
          requirementSheetId: true,
          sourceType: true,
          salesOrder: { select: { id: true, orderType: true } },
        },
      },
    },
  });
  if (!wol?.workOrder) return;
  const wo = wol.workOrder;
  if (String(wo.sourceType ?? "").toUpperCase() === "GREEN_LEVEL_REPLENISHMENT") return;
  if (!isRegularWorkOrderRecord(wo, wo.salesOrder)) return;

  const coverage = await computeRegularSoWorkOrderDemandCoverage(tx, wo.id);
  const block = regularSoAdditionalProductionBlock(coverage, wol.id);
  if (!block) return;
  const err = new Error(block.message);
  err.statusCode = 409;
  err.code = block.code;
  throw err;
}

module.exports = {
  EPS,
  evaluateRegularSoLineDemandCoverage,
  loadRegularSoDemandQtyForItem,
  loadApprovedProducedOnOtherRegularWos,
  computeRegularSoWorkOrderDemandCoverage,
  regularSoAdditionalProductionBlock,
  assertRegularSoAdditionalProductionAllowed,
};
