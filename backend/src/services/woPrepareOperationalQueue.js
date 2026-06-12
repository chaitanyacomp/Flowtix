/**
 * REGULAR SO → WO prepare operational substages (WO_PENDING only).
 * Drives Sales Order list labels/CTAs and Store/Admin dashboard WO-prepare queues.
 */

const { prisma } = require("../utils/prisma");
const { computeFgGapLinesForSalesOrder } = require("./rmCheckService");
const { evaluateWoPrepareReadiness } = require("./materialPlanningService");
const { summarizeMaterialRequirement } = require("./procurementWorkspaceService");
const { loadPendingRequestAllocByMrLineId } = require("./purchaseRequestService");
const { RM_REQUISITION_ACTIVE_STATUSES } = require("./rmRequisitionLifecycle");
const { regularSoProcurementSourceTypes } = require("./regularSoProcurementSource");

const WO_PLANNING_SOURCE = "WORK_ORDER_PLANNING";

function salesOrderHasFgLines(so) {
  return (so.lines || []).some((l) => l.item?.itemType === "FG");
}

function isRegularWoPrepareCandidate(so) {
  if (!so || so.orderType === "NO_QTY" || so.orderType === "REPLACEMENT") return false;
  if (so.internalStatus === "DRAFT") return false;
  if (so.processStage?.key !== "WO_PENDING") return false;
  return salesOrderHasFgLines(so);
}

/**
 * @param {object} so — sales order with lines + item includes
 * @param {import('@prisma/client').PrismaClient} [db]
 */
async function resolveWoPrepareOperationalForSalesOrder(so, db = prisma) {
  const { fgLines } = await computeFgGapLinesForSalesOrder(so, db);
  const readiness = await evaluateWoPrepareReadiness(so.id, { fgLines }, db);
  const pending = readiness.pendingMaterialRequirements || [];
  const shortageRmCount =
    readiness.materialReadiness?.shortageRmCount ?? readiness.totalShortageLines ?? 0;
  const primaryFgName =
    readiness.fgSummary?.find((f) => f.fgQty > 0)?.fgName ??
    fgLines.find((f) => f.toProduce > 0 && !f.note)?.fgName ??
    null;
  const pendingMrRefs = pending.map((m) => m.docNo || `#${m.id}`).join(", ");

  /** @type {{ key: string; label: string; nextActionKey: string }} */
  let stage;
  if (readiness.canCreateWorkOrder) {
    stage = {
      key: "READY_FOR_WO",
      label: "Ready for WO",
      nextActionKey: "CREATE_WO",
    };
  } else if (pending.length > 0 && shortageRmCount > 0) {
    stage = {
      key: "PURCHASE_GRN_PENDING",
      label: "Purchase / GRN Pending",
      nextActionKey: "OPEN_PURCHASE_PLAN",
    };
  } else if (shortageRmCount > 0) {
    stage = {
      key: "RM_SHORTAGE",
      label: "RM Shortage — WO blocked",
      nextActionKey: "RAISE_MR",
    };
  } else {
    stage = {
      key: "WO_PREPARE",
      label: "WO Pending",
      nextActionKey: "PREPARE_WO",
    };
  }

  return {
    ...stage,
    canCreateWorkOrder: Boolean(readiness.canCreateWorkOrder),
    shortageRmCount,
    pendingMaterialRequirements: pending.map((m) => ({
      id: m.id,
      docNo: m.docNo ?? null,
    })),
    pendingMrRefs,
    primaryFgName,
    woBlockReason: readiness.woBlockReason ?? null,
  };
}

/**
 * Attach `woPrepareOperational` to REGULAR WO_PENDING sales orders on list/detail payloads.
 * @param {import('@prisma/client').PrismaClient} db
 * @param {object[]} salesOrders
 */
async function enrichSalesOrdersWithWoPrepareOperational(db, salesOrders) {
  const list = salesOrders || [];
  const candidates = list.filter(isRegularWoPrepareCandidate);
  if (!candidates.length) {
    return list.map((s) => ({ ...s, woPrepareOperational: null }));
  }

  /** @type {Map<number, object>} */
  const bySoId = new Map();
  await Promise.all(
    candidates.map(async (so) => {
      try {
        const op = await resolveWoPrepareOperationalForSalesOrder(so, db);
        bySoId.set(so.id, op);
      } catch {
        bySoId.set(so.id, null);
      }
    }),
  );

  return list.map((s) => {
    const op = bySoId.get(s.id) ?? null;
    if (!op) return { ...s, woPrepareOperational: null };
    return {
      ...s,
      woPrepareOperational: op,
      processStage: {
        key: s.processStage?.key ?? "WO_PENDING",
        label: op.label,
      },
    };
  });
}

/**
 * Store/Admin dashboard queues for REGULAR SOs awaiting first WO.
 * @param {import('@prisma/client').PrismaClient} [db]
 * @param {{ limit?: number }} [opts]
 */
async function getWoPrepareDashboardQueues(db = prisma, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 80));
  const rows = await db.salesOrder.findMany({
    where: {
      orderType: "NORMAL",
      internalStatus: { notIn: ["DRAFT", "CLOSED", "MANUALLY_CLOSED", "COMPLETED"] },
      workOrders: { none: { status: { not: "REJECTED" } } },
    },
    include: {
      customer: { select: { name: true } },
      lines: { include: { item: { select: { itemName: true, itemType: true } } } },
    },
    orderBy: { id: "desc" },
    take: limit,
  });

  const rmShortageBlocking = [];
  const purchaseGrnPending = [];
  const readyForWoCreation = [];

  for (const so of rows) {
    if (!salesOrderHasFgLines(so)) continue;
    let op;
    try {
      op = await resolveWoPrepareOperationalForSalesOrder(
        { ...so, processStage: { key: "WO_PENDING", label: "WO pending" } },
        db,
      );
    } catch {
      continue;
    }

    const row = {
      salesOrderId: so.id,
      salesOrderDocNo: so.docNo ?? null,
      customerName: so.customer?.name ?? "—",
      primaryFgName: op.primaryFgName,
      shortageRmCount: op.shortageRmCount,
      pendingMrRefs: op.pendingMrRefs,
      pendingMaterialRequirements: op.pendingMaterialRequirements,
      nextActionKey: op.nextActionKey,
      operationalKey: op.key,
      operationalLabel: op.label,
    };

      if (op.key === "READY_FOR_WO") readyForWoCreation.push(row);
    else if (op.key === "PURCHASE_GRN_PENDING") {
      const mr = await db.materialRequirement.findFirst({
        where: {
          salesOrderId: so.id,
          status: { in: RM_REQUISITION_ACTIVE_STATUSES },
          sourceType: { in: regularSoProcurementSourceTypes() },
        },
        include: {
          lines: { include: { rmItem: true } },
          salesOrder: {
            include: { lines: { include: { item: { select: { itemName: true, itemType: true } } } } },
          },
          createdBy: { select: { name: true, email: true } },
        },
        orderBy: { id: "desc" },
      });
      if (mr) {
        const pendingByMr = await loadPendingRequestAllocByMrLineId(db);
        const proc = await summarizeMaterialRequirement(mr, pendingByMr, db);
        row.procurementOperationalLabel = proc.operationalLabel;
        row.pendingPoStatus = proc.pendingPoStatus;
        row.pendingGrnStatus = proc.pendingGrnStatus;
        row.supplierPendingStatus = proc.supplierPendingStatus;
      }
      purchaseGrnPending.push(row);
    } else if (op.key === "RM_SHORTAGE") rmShortageBlocking.push(row);
  }

  return {
    rmShortageBlocking,
    purchaseGrnPending,
    readyForWoCreation,
  };
}

/**
 * Flat WO-prepare rows for Control Tower read model (REGULAR SO, no WO yet).
 * @param {import('@prisma/client').PrismaClient} [db]
 * @param {{ limit?: number }} [opts]
 */
async function getWoPreparePlanningRows(db = prisma, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 80));
  const rows = await db.salesOrder.findMany({
    where: {
      orderType: "NORMAL",
      internalStatus: { notIn: ["DRAFT", "CLOSED", "MANUALLY_CLOSED", "COMPLETED"] },
      workOrders: { none: { status: { not: "REJECTED" } } },
    },
    include: {
      customer: { select: { name: true } },
      lines: { include: { item: { select: { itemName: true, itemType: true } } } },
    },
    orderBy: { id: "desc" },
    take: limit,
  });

  const out = [];
  for (const so of rows) {
    if (!salesOrderHasFgLines(so)) continue;
    try {
      const op = await resolveWoPrepareOperationalForSalesOrder(
        { ...so, processStage: { key: "WO_PENDING", label: "WO pending" } },
        db,
      );
      out.push({
        salesOrderId: so.id,
        salesOrderDocNo: so.docNo ?? null,
        customerName: so.customer?.name ?? "—",
        primaryFgName: op.primaryFgName,
        shortageRmCount: op.shortageRmCount,
        pendingMrRefs: op.pendingMrRefs,
        nextActionKey: op.nextActionKey,
        operationalKey: op.key,
        operationalLabel: op.label,
        canCreateWorkOrder: op.canCreateWorkOrder,
        woBlockReason: op.woBlockReason ?? null,
      });
    } catch {
      continue;
    }
  }
  return out;
}

module.exports = {
  WO_PLANNING_SOURCE,
  isRegularWoPrepareCandidate,
  resolveWoPrepareOperationalForSalesOrder,
  enrichSalesOrdersWithWoPrepareOperational,
  getWoPrepareDashboardQueues,
  getWoPreparePlanningRows,
};
