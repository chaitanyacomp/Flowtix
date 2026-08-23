/**
 * REGULAR_SO machine-run planning stages (derived — no separate status column).
 *
 * Flow: SO approved → Production machine planning → RM/purging → Store creates WO
 *
 * Stages:
 * - MACHINE_PLANNING_PENDING: no saved production-run allocations
 * - MACHINE_PLANNING_IN_PROGRESS: runs exist but incomplete/invalid/stale vs planned qty
 * - COMPLETE (machine): runs fully validate; WO readiness still requires material gates
 *
 * NO_QTY is out of scope (returns null / skipped).
 */

const { prisma } = require("../utils/prisma");
const snapshotSvc = require("./regularSoPlanningSnapshotService");
const woRunSvc = require("./woProductionRunAllocationService");

const MACHINE_PLANNING_PENDING = "MACHINE_PLANNING_PENDING";
const MACHINE_PLANNING_IN_PROGRESS = "MACHINE_PLANNING_IN_PROGRESS";
/** Valid allocations saved but Complete Machine Planning not clicked yet. */
const MACHINE_PLANNING_AWAITING_COMPLETION = "MACHINE_PLANNING_AWAITING_COMPLETION";
const MACHINE_PLANNING_COMPLETE = "MACHINE_PLANNING_COMPLETE";

const CLOSED_SO_STATUSES = Object.freeze([
  "DRAFT",
  "CLOSED",
  "MANUALLY_CLOSED",
  "CLOSED_WITH_WAIVER",
  "COMPLETED",
  "CANCELLED",
]);

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function httpError(message, statusCode = 400, code = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

/**
 * Soft-enrich draft runs: keep row-level basics; skip qty reconcile / full-FG coverage.
 * Invalid machine/standard rows still throw so drafts stay actionable.
 */
async function softEnrichProductionRunsForDraft(db, rawRuns, plannedFgLines) {
  return woRunSvc.validateAndEnrichProductionRuns(db, rawRuns ?? [], plannedFgLines, {
    requireRuns: false,
    allowIncomplete: true,
  });
}

/**
 * @returns {Promise<{
 *   key: string,
 *   label: string,
 *   machinePlanningComplete: boolean,
 *   productionRunCount: number,
 *   plannedPurgeCount: number,
 *   issues: string[],
 *   primaryFgName: string|null,
 *   plannedProductionQty: number,
 *   requiredDeliveryDate: string|null,
 *   approvedBomRevision: string|null,
 * }>}
 */
async function assessRegularSoMachinePlanning(salesOrderId, db = prisma) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    throw httpError("Invalid sales order id.", 400, "INVALID_SALES_ORDER_ID");
  }

  const view = await snapshotSvc.buildRegularSoPlanningSnapshotView(soId, db);
  if ((view.orderType ?? "NORMAL") === "NO_QTY") {
    return {
      key: MACHINE_PLANNING_PENDING,
      label: "Machine Planning Pending",
      machinePlanningComplete: false,
      productionRunCount: 0,
      plannedPurgeCount: 0,
      issues: ["NO_QTY orders use Requirement Sheet execution for machine runs."],
      primaryFgName: null,
      plannedProductionQty: 0,
      requiredDeliveryDate: null,
      approvedBomRevision: null,
    };
  }

  const plannedFgLines = (view.lines || [])
    .filter((l) => n(l.plannedProductionQty ?? l.rmPlanningQty ?? l.toProduce) > 0)
    .map((l) => ({
      fgItemId: Number(l.fgItemId),
      plannedQty: n(l.plannedProductionQty ?? l.rmPlanningQty ?? l.toProduce),
      fgName: l.fgName ?? l.itemName ?? null,
    }));

  const primaryFgName = plannedFgLines[0]?.fgName ?? null;
  const plannedProductionQty = plannedFgLines.reduce((s, l) => s + l.plannedQty, 0);

  const so = view.salesOrder;
  const requiredDeliveryDate =
    so?.po?.requiredDate != null ? new Date(so.po.requiredDate).toISOString().slice(0, 10) : null;

  let approvedBomRevision = null;
  try {
    const fgIds = plannedFgLines.map((l) => l.fgItemId).filter((id) => id > 0);
    if (fgIds.length && typeof db.bom?.findFirst === "function") {
      const bom = await db.bom.findFirst({
        where: { fgItemId: fgIds[0], status: "APPROVED" },
        orderBy: { revisionNo: "desc" },
        select: { revisionNo: true, docNo: true, id: true },
      });
      if (bom) {
        approvedBomRevision =
          bom.docNo != null
            ? `${bom.docNo} (rev ${bom.revisionNo})`
            : `Rev ${bom.revisionNo}`;
      }
    }
  } catch {
    approvedBomRevision = null;
  }

  const runs = Array.isArray(view.productionRuns) ? view.productionRuns : [];
  if (!runs.length || !plannedFgLines.length) {
    return {
      key: MACHINE_PLANNING_PENDING,
      label: "Machine Planning Pending",
      machinePlanningComplete: false,
      productionRunCount: 0,
      plannedPurgeCount: 0,
      issues: plannedFgLines.length
        ? ["Machine allocation pending — Production/Admin action required."]
        : ["No planned FG quantity for machine allocation."],
      primaryFgName,
      plannedProductionQty,
      requiredDeliveryDate,
      approvedBomRevision,
    };
  }

  try {
    const validated = await woRunSvc.validateAndEnrichProductionRuns(
      db,
      runs.map((r) =>
        typeof woRunSvc.mapPersistedRunRow === "function" ? woRunSvc.mapPersistedRunRow(r) : r,
      ),
      plannedFgLines,
      { requireRuns: true, allowIncomplete: false },
    );
    const handedOff = Boolean(view.machinePlanningCompleted);
    if (!handedOff) {
      return {
        key: MACHINE_PLANNING_AWAITING_COMPLETION,
        label: "Planning Valid — Awaiting Completion",
        machinePlanningComplete: false,
        allocationsValid: true,
        productionRunCount: validated.productionRunCount,
        plannedPurgeCount: validated.plannedPurgeCount,
        issues: ["Click Complete Machine Planning to hand off to Store."],
        primaryFgName,
        plannedProductionQty,
        requiredDeliveryDate,
        approvedBomRevision,
      };
    }
    return {
      key: MACHINE_PLANNING_COMPLETE,
      label: "Machine planning complete — handed to Store",
      machinePlanningComplete: true,
      allocationsValid: true,
      productionRunCount: validated.productionRunCount,
      plannedPurgeCount: validated.plannedPurgeCount,
      issues: [],
      primaryFgName,
      plannedProductionQty,
      requiredDeliveryDate,
      approvedBomRevision,
    };
  } catch (e) {
    return {
      key: MACHINE_PLANNING_IN_PROGRESS,
      label: "Machine Planning In Progress",
      machinePlanningComplete: false,
      allocationsValid: false,
      productionRunCount: runs.length,
      plannedPurgeCount: n(view.plannedPurgeCount),
      issues: [e?.message || "Saved allocations are incomplete or no longer match planned quantity."],
      primaryFgName,
      plannedProductionQty,
      requiredDeliveryDate,
      approvedBomRevision,
    };
  }
}

/**
 * Assert machine planning is complete before Store/Admin may create a REGULAR WO.
 */
async function assertRegularSoMachinePlanningCompleteForWoCreate(salesOrderId, db = prisma) {
  const assessment = await assessRegularSoMachinePlanning(salesOrderId, db);
  if (!assessment.machinePlanningComplete) {
    throw httpError(
      assessment.issues[0] ||
        "Machine allocation pending — Production/Admin action required.",
      409,
      assessment.key === MACHINE_PLANNING_PENDING
        ? "MACHINE_PLANNING_PENDING"
        : "MACHINE_PLANNING_INCOMPLETE",
    );
  }
  return assessment;
}

/**
 * Production planning queue: approved REGULAR SOs without WO.
 * Splits active machine planning from completed handoff to Store (RM may still be short).
 * Operational fields only (no commercial prices/margins).
 */
async function getRegularSoMachinePlanningQueue(db = prisma, opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 80));

  const rows = await db.salesOrder.findMany({
    where: {
      orderType: "NORMAL",
      internalStatus: "APPROVED",
      workOrders: { none: { status: { not: "REJECTED" } } },
    },
    include: {
      po: { select: { requiredDate: true } },
      lines: {
        include: { item: { select: { itemName: true, itemType: true } } },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "desc" },
    take: Math.min(500, limit * 4),
  });

  const needsPlanning = [];
  const handedToStore = [];

  for (const so of rows) {
    if (CLOSED_SO_STATUSES.includes(so.internalStatus)) continue;
    const hasFg = (so.lines || []).some((l) => l.item?.itemType === "FG");
    if (!hasFg) continue;

    let assessment;
    try {
      assessment = await assessRegularSoMachinePlanning(so.id, db);
    } catch {
      continue;
    }

    let storeOperational = null;
    let rmReadinessSummary = null;
    try {
      const { resolveWoPrepareOperationalForSalesOrder } = require("./woPrepareOperationalQueue");
      if (assessment.machinePlanningComplete) {
        storeOperational = await resolveWoPrepareOperationalForSalesOrder(
          { ...so, processStage: { key: "WO_PENDING", label: "WO pending" } },
          db,
        );
        rmReadinessSummary = {
          canCreateWorkOrder: Boolean(storeOperational.canCreateWorkOrder),
          shortageRmCount: storeOperational.shortageRmCount ?? 0,
          woBlockReason: storeOperational.woBlockReason ?? null,
          storeOperationalKey: storeOperational.key,
          storeOperationalLabel: storeOperational.label,
          requiredQtyTotal: storeOperational.rmRequiredQtyTotal ?? 0,
          availableQtyTotal: storeOperational.rmAvailableQtyTotal ?? 0,
          shortageQtyTotal: storeOperational.rmShortageQtyTotal ?? 0,
          shortageLines: storeOperational.rmShortageLines ?? [],
        };
      } else {
        // Preview RM stock only — never READY_FOR_WO / canCreateWorkOrder before machine planning completes.
        const { evaluateWoPrepareReadiness } = require("./materialPlanningService");
        const { computeFgGapLinesForSalesOrder } = require("./rmCheckService");
        const { summarizeRmQtyFromReadiness } = require("./woPrepareOperationalQueue");
        const { fgLines } = await computeFgGapLinesForSalesOrder(so, db);
        const readiness = await evaluateWoPrepareReadiness(so.id, { fgLines }, db);
        const rmQty = summarizeRmQtyFromReadiness(readiness);
        const shortageRmCount =
          readiness.materialReadiness?.shortageRmCount ?? readiness.totalShortageLines ?? 0;
        const hasShortage = shortageRmCount > 0 || rmQty.shortageQtyTotal > 1e-9;
        rmReadinessSummary = {
          canCreateWorkOrder: false,
          shortageRmCount,
          woBlockReason: readiness.woBlockReason ?? null,
          storeOperationalKey: hasShortage ? "RM_SHORTAGE" : "RM_AVAILABLE",
          storeOperationalLabel: hasShortage ? "RM Shortage" : "RM Available",
          requiredQtyTotal: rmQty.requiredQtyTotal,
          availableQtyTotal: rmQty.availableQtyTotal,
          shortageQtyTotal: rmQty.shortageQtyTotal,
          shortageLines: rmQty.shortageLines,
        };
      }
    } catch {
      rmReadinessSummary = null;
    }

    const requiredDeliveryDate =
      so.po?.requiredDate != null
        ? new Date(so.po.requiredDate).toISOString().slice(0, 10)
        : assessment.requiredDeliveryDate;

    const row = {
      salesOrderId: so.id,
      salesOrderDocNo: so.docNo ?? null,
      fgItemName: assessment.primaryFgName,
      plannedQty: assessment.plannedProductionQty,
      requiredDeliveryDate,
      approvedBomRevision: assessment.approvedBomRevision,
      machinePlanningStatus: assessment.key,
      machinePlanningLabel: assessment.label,
      machinePlanningIssues: assessment.issues,
      machinePlanningComplete: Boolean(assessment.machinePlanningComplete),
      productionRunCount: assessment.productionRunCount,
      plannedPurgeCount: assessment.plannedPurgeCount,
      rmReadinessSummary,
      storeOperationalKey: storeOperational?.key ?? null,
      storeOperationalLabel: storeOperational?.label ?? null,
    };

    if (assessment.machinePlanningComplete) {
      if (handedToStore.length < limit) handedToStore.push(row);
    } else if (
      assessment.key === MACHINE_PLANNING_PENDING ||
      assessment.key === MACHINE_PLANNING_IN_PROGRESS ||
      assessment.key === MACHINE_PLANNING_AWAITING_COMPLETION
    ) {
      if (needsPlanning.length < limit) needsPlanning.push(row);
    }

    if (needsPlanning.length >= limit && handedToStore.length >= limit) break;
  }

  return {
    needsPlanning,
    handedToStore,
    /** @deprecated Prefer needsPlanning — kept for older clients during rollout. */
    items: needsPlanning,
  };
}

/**
 * Filter REGULAR SO ids to those with completed valid machine planning (for Store WO queue).
 * NO_QTY ids pass through unchanged.
 */
async function filterSalesOrderIdsWithCompletedMachinePlanning(db, salesOrderIds) {
  const ids = (salesOrderIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return [];

  const sos = await db.salesOrder.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderType: true },
  });
  const typeById = new Map(sos.map((s) => [s.id, s.orderType ?? "NORMAL"]));
  const out = [];
  for (const id of ids) {
    const orderType = typeById.get(id);
    if (orderType == null) continue;
    if (orderType === "NO_QTY") {
      out.push(id);
      continue;
    }
    try {
      const a = await assessRegularSoMachinePlanning(id, db);
      if (a.machinePlanningComplete) out.push(id);
    } catch {
      // skip
    }
  }
  return out;
}

module.exports = {
  MACHINE_PLANNING_PENDING,
  MACHINE_PLANNING_IN_PROGRESS,
  MACHINE_PLANNING_AWAITING_COMPLETION,
  MACHINE_PLANNING_COMPLETE,
  assessRegularSoMachinePlanning,
  assertRegularSoMachinePlanningCompleteForWoCreate,
  getRegularSoMachinePlanningQueue,
  filterSalesOrderIdsWithCompletedMachinePlanning,
  softEnrichProductionRunsForDraft,
};
