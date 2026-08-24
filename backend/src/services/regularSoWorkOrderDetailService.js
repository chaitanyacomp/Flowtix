/**
 * REGULAR_SO Work Order detail read-model — permanent document by workOrderId.
 * NO_QTY WOs may be loaded for identification only; lifecycle actions stay REGULAR-scoped.
 */

const { prisma } = require("../utils/prisma");
const { qtyToNumber } = require("./rmPurchaseHelpers");
const { displaySalesOrderNo, displayWorkOrderNo } = require("../utils/docNoLabels");
const { regularWoLifecycleActions, isRegularWorkOrderRecord } = require("./workOrderLifecycleService");
const { buildRegularSoPlanningSnapshotView } = require("./regularSoPlanningSnapshotService");
const { loadGrossIssuedByWorkOrder, loadReturnedByWorkOrder } = require("./materialReturnService");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { round3 } = require("./bomExplosionService");
const { summarizeMaterialWastageByCategory } = require("./materialWastageService");

const STOCK_EPS = 1e-6;

function n(v) {
  return qtyToNumber(v);
}

function resolveLinePlannedQty(line) {
  const planned = n(line?.plannedQty);
  const qty = n(line?.qty);
  return planned > STOCK_EPS ? planned : qty;
}

function deriveNextAction({
  isRegular,
  pmrStatus,
  netIssued,
  theoreticalRm,
  productionAllowed,
  approvedProduced,
  woTarget,
  qaPending,
  lifecycleStatus,
}) {
  const st = String(lifecycleStatus || "").toUpperCase();
  if (st === "REJECTED") return { key: "CANCELLED", label: "View cancelled WO", hrefKind: "SELF" };
  if (st === "COMPLETED" || st === "CLOSED_WITH_SHORTFALL") {
    return { key: "VIEW_REPORT", label: "View Production Report", hrefKind: "PRODUCTION_REPORT" };
  }
  if (!isRegular) {
    return { key: "NO_QTY_GUIDED", label: "Open NO_QTY Work Order flow", hrefKind: "NO_QTY_WO" };
  }
  if (!pmrStatus || pmrStatus === "DRAFT" || pmrStatus === "REQUESTED") {
    return { key: "ISSUE_RM", label: "Issue RM", hrefKind: "MATERIAL_ISSUE" };
  }
  if (pmrStatus === "PARTIALLY_ISSUED") {
    return { key: "CONTINUE_ISSUE", label: "Continue RM Issue", hrefKind: "MATERIAL_ISSUE" };
  }
  if (netIssued <= STOCK_EPS) {
    return { key: "ISSUE_RM", label: "Issue RM", hrefKind: "MATERIAL_ISSUE" };
  }
  if (qaPending > STOCK_EPS) {
    return { key: "VIEW_QA", label: "View QA", hrefKind: "QA" };
  }
  if (approvedProduced + STOCK_EPS < woTarget && productionAllowed > STOCK_EPS) {
    return {
      key: approvedProduced > STOCK_EPS ? "CONTINUE_PRODUCTION" : "START_PRODUCTION",
      label: approvedProduced > STOCK_EPS ? "Continue Production" : "Start Production",
      hrefKind: "PRODUCTION",
    };
  }
  if (approvedProduced > STOCK_EPS) {
    return { key: "VIEW_REPORT", label: "View Production Report", hrefKind: "PRODUCTION_REPORT" };
  }
  if (theoreticalRm > STOCK_EPS && netIssued + STOCK_EPS < theoreticalRm) {
    return { key: "CONTINUE_ISSUE", label: "Continue RM Issue", hrefKind: "MATERIAL_ISSUE" };
  }
  return { key: "VIEW_DISPATCH", label: "View Dispatch", hrefKind: "DISPATCH" };
}

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number} workOrderId
 * @param {string | null} actorRole
 */
async function buildWorkOrderDetail(db, workOrderId, actorRole = null) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      lines: {
        include: {
          fgItem: { select: { id: true, itemName: true, unit: true } },
        },
        orderBy: { id: "asc" },
      },
      salesOrder: {
        include: {
          customer: { select: { id: true, name: true } },
          lines: {
            where: { item: { itemType: "FG" } },
            select: {
              id: true,
              itemId: true,
              qty: true,
              customerPoQty: true,
              item: { select: { id: true, itemName: true, unit: true } },
            },
          },
        },
      },
      cycle: { select: { id: true, cycleNo: true, status: true } },
      productionMaterialRequests: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { id: "desc" },
        include: {
          lines: true,
          materialIssueNotes: {
            select: { id: true, docNo: true, createdAt: true },
            orderBy: { id: "desc" },
            take: 20,
          },
        },
      },
      productionExecution: { select: { executionStatus: true, blockRemarks: true } },
      productionReports: {
        orderBy: { id: "desc" },
        take: 5,
        select: { id: true, status: true, confirmedAt: true, createdAt: true },
      },
      materialWastageNotes: { select: { qty: true, reason: true, remarks: true } },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found");
    err.statusCode = 404;
    throw err;
  }

  const so = wo.salesOrder;
  const isRegular = isRegularWorkOrderRecord(wo, so);
  const flow = isRegular ? "REGULAR_SO" : so?.orderType === "NO_QTY" ? "NO_QTY" : String(so?.orderType || "UNKNOWN");

  const primaryLine = (wo.lines || [])[0] || null;
  const fgItemId = primaryLine?.fgItemId ?? primaryLine?.fgItem?.id ?? null;
  const soLine =
    (so?.lines || []).find((l) => Number(l.itemId) === Number(fgItemId)) || (so?.lines || [])[0] || null;
  const customerSoQty = n(soLine?.customerPoQty ?? soLine?.qty);
  const woTargetQty = primaryLine ? resolveLinePlannedQty(primaryLine) : 0;

  let productionBufferPercent = 0;
  let productionBufferQty = 0;
  if (isRegular && so?.id) {
    try {
      const planning = await buildRegularSoPlanningSnapshotView(so.id, db);
      const planLine =
        (planning.lines || []).find((l) => Number(l.fgItemId) === Number(fgItemId)) ||
        (planning.lines || [])[0];
      if (planLine) {
        productionBufferPercent = n(planLine.productionBufferPercent);
        productionBufferQty = n(planLine.productionBufferQty);
      }
    } catch {
      /* snapshot optional for cancelled / legacy */
    }
  }

  const lineIds = (wo.lines || []).map((l) => l.id);
  const producedByLine = lineIds.length
    ? await getApprovedProducedQtyByWorkOrderLineIds(db, lineIds)
    : new Map();
  let approvedProduced = 0;
  for (const id of lineIds) approvedProduced += n(producedByLine.get(id));
  approvedProduced = round3(approvedProduced);

  const latestPmr = (wo.productionMaterialRequests || [])[0] || null;
  const theoreticalRm = round3(
    (latestPmr?.lines || []).reduce((s, ln) => s + n(ln.requiredQty), 0),
  );
  const pmrIssued = round3((latestPmr?.lines || []).reduce((s, ln) => s + n(ln.issuedQty), 0));
  const pmrWaived = round3((latestPmr?.lines || []).reduce((s, ln) => s + n(ln.waivedQty), 0));

  const issuedMap = await loadGrossIssuedByWorkOrder(db, wo.id);
  const returnedMap = await loadReturnedByWorkOrder(db, wo.id);
  let cumulativeIssued = 0;
  let cumulativeReturned = 0;
  for (const v of issuedMap.values()) cumulativeIssued += n(v);
  for (const v of returnedMap.values()) cumulativeReturned += n(v);
  cumulativeIssued = round3(cumulativeIssued);
  cumulativeReturned = round3(cumulativeReturned);
  const netIssued = round3(Math.max(0, cumulativeIssued - cumulativeReturned));

  const wastageSummary = summarizeMaterialWastageByCategory(wo.materialWastageNotes || []);
  const wastageQty = wastageSummary.processWastageQty;
  const purgingConsumptionQty = wastageSummary.purgingConsumptionQty;

  const remainingIssueBalance = round3(Math.max(0, theoreticalRm - pmrIssued - pmrWaived));
  const supportedProductionCapacity =
    theoreticalRm > STOCK_EPS && woTargetQty > STOCK_EPS
      ? Math.floor((netIssued * woTargetQty) / theoreticalRm + STOCK_EPS)
      : 0;

  const qcPendingAgg = lineIds.length
    ? await db.productionEntry.aggregate({
        where: {
          workOrderLineId: { in: lineIds },
          workflowStatus: "APPROVED",
          qcEntries: { none: { reversedAt: null } },
        },
        _sum: { producedQty: true },
      })
    : { _sum: { producedQty: 0 } };
  const qaPendingQty = round3(n(qcPendingAgg?._sum?.producedQty));

  const qcRows = lineIds.length
    ? await db.qcEntry.findMany({
        where: { production: { workOrderLineId: { in: lineIds } }, reversedAt: null },
        orderBy: { id: "desc" },
        take: 20,
        select: {
          id: true,
          result: true,
          createdAt: true,
          productionId: true,
          production: { select: { docNo: true, producedQty: true } },
        },
      })
    : [];

  const dispatchRows = so?.id
    ? await db.dispatch.findMany({
        where: { soId: so.id },
        orderBy: { id: "desc" },
        take: 20,
        select: { id: true, docNo: true, workflowStatus: true, date: true },
      })
    : [];

  let lifecycleActions = null;
  if (isRegular) {
    try {
      lifecycleActions = await regularWoLifecycleActions(db, wo.id, actorRole);
    } catch {
      lifecycleActions = null;
    }
  }

  const bom = fgItemId
    ? await db.bom.findFirst({
        where: { fgItemId, status: "APPROVED" },
        orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
        select: { id: true, version: true, status: true, approvedAt: true },
      })
    : null;

  const nextAction = deriveNextAction({
    isRegular,
    pmrStatus: latestPmr?.status ?? null,
    netIssued,
    theoreticalRm,
    productionAllowed: Math.max(0, supportedProductionCapacity - approvedProduced),
    approvedProduced,
    woTarget: woTargetQty,
    qaPending: qaPendingQty,
    lifecycleStatus: wo.status,
  });

  const issueNotes = (latestPmr?.materialIssueNotes || []).map((m) => ({
    id: m.id,
    docNo: m.docNo,
    createdAt: m.createdAt,
  }));

  return {
    id: wo.id,
    docNo: wo.docNo,
    displayNo: displayWorkOrderNo(wo.id, wo.docNo),
    flow,
    orderType: so?.orderType ?? null,
    lifecycleStatus: wo.status,
    createdAt: wo.createdAt,
    createdBy: null,
    closureReason: wo.closureReason ?? null,
    closedAt: wo.closedAt ?? null,
    identification: {
      workOrderId: wo.id,
      workOrderNo: displayWorkOrderNo(wo.id, wo.docNo),
      salesOrderId: so?.id ?? null,
      salesOrderNo: so ? displaySalesOrderNo(so.id, so.docNo) : null,
      salesOrderLineId: soLine?.id ?? null,
      customerId: so?.customer?.id ?? null,
      customerName: so?.customer?.name ?? null,
      fgItemId,
      fgItemName: primaryLine?.fgItem?.itemName ?? null,
      fgUnit: primaryLine?.fgItem?.unit ?? null,
      approvedBom: bom,
      cycleId: wo.cycleId ?? wo.cycle?.id ?? null,
      cycleNo: wo.cycle?.cycleNo ?? null,
      requirementSheetId: wo.requirementSheetId ?? null,
    },
    quantityPlanning: {
      customerSoQty,
      productionBufferPercent,
      productionBufferQty,
      woTargetQty,
      producedQty: approvedProduced,
      remainingProductionQty: round3(Math.max(0, woTargetQty - approvedProduced)),
    },
    rmPosition: {
      theoreticalRmRequiredQty: theoreticalRm,
      reservedQty: round3(Math.max(0, theoreticalRm - pmrIssued - pmrWaived)),
      cumulativeIssuedQty: cumulativeIssued,
      cumulativeReturnedQty: cumulativeReturned,
      netIssuedQty: netIssued,
      wastageQty,
      purgingConsumptionQty,
      processWastageQty: wastageQty,
      remainingIssueBalance,
      supportedProductionCapacityQty: supportedProductionCapacity,
      pmrIssuedQty: pmrIssued,
      pmrWaivedQty: pmrWaived,
    },
    linkedExecution: {
      pmr: latestPmr
        ? {
            id: latestPmr.id,
            docNo: latestPmr.docNo,
            status: latestPmr.status,
          }
        : null,
      materialIssues: issueNotes,
      productionReports: wo.productionReports || [],
      executionStatus: wo.productionExecution?.executionStatus ?? null,
      qaInspections: qcRows.map((q) => ({
        id: q.id,
        result: q.result,
        createdAt: q.createdAt,
        productionId: q.productionId,
        productionDocNo: q.production?.docNo ?? null,
        producedQty: n(q.production?.producedQty),
      })),
      dispatches: dispatchRows.map((d) => ({
        id: d.id,
        docNo: d.docNo,
        status: d.workflowStatus,
        createdAt: d.date,
      })),
    },
    nextAction,
    lifecycleActions,
    lines: (wo.lines || []).map((l) => ({
      id: l.id,
      fgItemId: l.fgItemId,
      fgItemName: l.fgItem?.itemName ?? null,
      unit: l.fgItem?.unit ?? null,
      qty: resolveLinePlannedQty(l),
      plannedQty: n(l.plannedQty),
      producedQty: round3(n(producedByLine.get(l.id))),
    })),
  };
}

module.exports = {
  buildWorkOrderDetail,
  deriveNextAction,
};
