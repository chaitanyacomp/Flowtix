/**
 * REGULAR SO → WO prepare operational substages (WO_PENDING only).
 * Drives Sales Order list labels/CTAs and Store/Admin dashboard WO-prepare queues.
 *
 * Machine planning gates READY_FOR_WO: approved SO alone (or RM stock alone) is never enough.
 */

const { prisma } = require("../utils/prisma");
const rmCheckSvc = require("./rmCheckService");
const materialPlanningSvc = require("./materialPlanningService");
const { summarizeMaterialRequirement } = require("./procurementWorkspaceService");
const { loadTotalPurchaseRequestAllocByMrLineId } = require("./purchaseRequestService");
const { RM_REQUISITION_ACTIVE_STATUSES } = require("./rmRequisitionLifecycle");
const { regularSoProcurementSourceTypes } = require("./regularSoProcurementSource");
const {
  assessRegularSoMachinePlanning,
  MACHINE_PLANNING_PENDING,
  MACHINE_PLANNING_IN_PROGRESS,
  MACHINE_PLANNING_AWAITING_COMPLETION,
  MACHINE_PLANNING_COMPLETE,
} = require("./regularSoMachinePlanningService");

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

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Aggregate RM required / available / shortage for Store operational queues (existing terminology).
 * @param {object} readiness — evaluateWoPrepareReadiness result
 */
function summarizeRmQtyFromReadiness(readiness) {
  const lines = Array.isArray(readiness?.rmSummary) ? readiness.rmSummary : [];
  let requiredQtyTotal = 0;
  let availableQtyTotal = 0;
  let shortageQtyTotal = 0;
  const shortageLines = [];
  for (const r of lines) {
    const requiredQty = n(r.requiredQty);
    const availableQty = n(r.availableQty);
    const shortageQty = n(r.shortageQty ?? r.shortage ?? Math.max(0, requiredQty - availableQty));
    requiredQtyTotal += requiredQty;
    availableQtyTotal += availableQty;
    shortageQtyTotal += shortageQty;
    if (shortageQty > 1e-9) {
      shortageLines.push({
        rmItemId: r.rmItemId ?? null,
        itemName: r.itemName ?? `RM #${r.rmItemId}`,
        unit: r.unit ?? null,
        requiredQty,
        availableQty,
        shortageQty,
      });
    }
  }
  return {
    requiredQtyTotal: Math.round(requiredQtyTotal * 1000) / 1000,
    availableQtyTotal: Math.round(availableQtyTotal * 1000) / 1000,
    shortageQtyTotal: Math.round(shortageQtyTotal * 1000) / 1000,
    shortageLines,
  };
}

/**
 * @param {object} so — sales order with lines + item includes
 * @param {import('@prisma/client').PrismaClient} [db]
 */
async function resolveWoPrepareOperationalForSalesOrder(so, db = prisma) {
  const machine = await assessRegularSoMachinePlanning(so.id, db);

  // Incomplete / stale machine planning stays with Production — never Store RM queues.
  // Valid draft (awaiting Complete click) also stays with Production.
  if (!machine.machinePlanningComplete) {
    const pending = machine.key === MACHINE_PLANNING_IN_PROGRESS;
    const awaiting = machine.key === MACHINE_PLANNING_AWAITING_COMPLETION;
    return {
      key: awaiting
        ? MACHINE_PLANNING_AWAITING_COMPLETION
        : pending
          ? MACHINE_PLANNING_IN_PROGRESS
          : MACHINE_PLANNING_PENDING,
      label: awaiting
        ? "Planning Valid — Awaiting Completion"
        : pending
          ? "Machine Planning In Progress"
          : "Machine Planning Pending",
      nextActionKey: awaiting ? "COMPLETE_MACHINE_PLANNING" : "PLAN_MACHINE_RUNS",
      canCreateWorkOrder: false,
      shortageRmCount: 0,
      pendingMaterialRequirements: [],
      pendingMrRefs: "",
      primaryFgName: machine.primaryFgName,
      woBlockReason:
        machine.issues[0] ||
        (awaiting
          ? "Click Complete Machine Planning to hand off to Store."
          : "Machine allocation pending — Production action required."),
      machinePlanningStatus: machine.key,
      machinePlanningComplete: false,
      rmRequiredQtyTotal: 0,
      rmAvailableQtyTotal: 0,
      rmShortageQtyTotal: 0,
      rmShortageLines: [],
    };
  }

  // Valid machine planning always hands the SO to Store — even when RM is short.
  const { fgLines } = await rmCheckSvc.computeFgGapLinesForSalesOrder(so, db);
  const readiness = await materialPlanningSvc.evaluateWoPrepareReadiness(so.id, { fgLines }, db);
  const rmQty = summarizeRmQtyFromReadiness(readiness);
  const pending = readiness.pendingMaterialRequirements || [];
  const shortageRmCount =
    readiness.materialReadiness?.shortageRmCount ?? readiness.totalShortageLines ?? 0;
  const primaryFgName =
    readiness.fgSummary?.find((f) => f.fgQty > 0)?.fgName ??
    fgLines.find((f) => f.toProduce > 0 && !f.note)?.fgName ??
    machine.primaryFgName ??
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
    // Existing Store RM terminology (workflow guidance maps shortage → RM Shortage / Waiting for RM).
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
    machinePlanningStatus: MACHINE_PLANNING_COMPLETE,
    machinePlanningComplete: true,
    rmRequiredQtyTotal: rmQty.requiredQtyTotal,
    rmAvailableQtyTotal: rmQty.availableQtyTotal,
    rmShortageQtyTotal: rmQty.shortageQtyTotal,
    rmShortageLines: rmQty.shortageLines,
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
      internalStatus: { notIn: ["DRAFT", "CLOSED", "MANUALLY_CLOSED", "CLOSED_WITH_WAIVER", "COMPLETED"] },
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
      machinePlanningComplete: Boolean(op.machinePlanningComplete),
      rmRequiredQtyTotal: op.rmRequiredQtyTotal ?? 0,
      rmAvailableQtyTotal: op.rmAvailableQtyTotal ?? 0,
      rmShortageQtyTotal: op.rmShortageQtyTotal ?? 0,
      rmShortageLines: op.rmShortageLines ?? [],
      canCreateWorkOrder: Boolean(op.canCreateWorkOrder),
    };

    // Only after completed machine planning — RM shortage never returns the SO to Production.
    if (!op.machinePlanningComplete) continue;

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
        const pendingByMr = await loadTotalPurchaseRequestAllocByMrLineId(db);
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
      internalStatus: { notIn: ["DRAFT", "CLOSED", "MANUALLY_CLOSED", "CLOSED_WITH_WAIVER", "COMPLETED"] },
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
  summarizeRmQtyFromReadiness,
};
