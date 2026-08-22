/**
 * REGULAR work order lifecycle — HOLD, resume, close with shortfall.
 * NO_QTY work orders are rejected (cycleId set).
 */

const { prisma } = require("../utils/prisma");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { assertRegularProductionRmReadiness } = require("./productionRmReadinessService");
const auditLog = require("./auditLog");

const EPS = 1e-6;

const HOLD_REASONS = [
  "RM_SHORTAGE",
  "MACHINE_BREAKDOWN",
  "PRIORITY_SHIFT",
  "CUSTOMER_HOLD",
  "MANAGEMENT_HOLD",
  "PRODUCTION_PAUSE",
  "OTHER",
];

const WO_PRODUCTION_BLOCKED = new Set([
  "HOLD",
  "PAUSED",
  "CLOSED_WITH_SHORTFALL",
  "COMPLETED",
  "REJECTED",
]);

const WO_STATUS_SYNC_FROZEN = new Set(["HOLD", "PAUSED", "CLOSED_WITH_SHORTFALL", "REJECTED"]);

const WO_TERMINAL = new Set(["CLOSED_WITH_SHORTFALL", "COMPLETED", "REJECTED"]);

function regularShortageClosureReasonFromPendingExecution(execution) {
  if (String(execution?.executionStatus ?? "").toUpperCase() !== "SHORTFALL_PENDING") return null;
  const remarks = String(execution?.blockRemarks ?? "");
  if (!remarks.startsWith("REGULAR: End with SO shortage")) return null;
  const marker = "Production Report pending.";
  const reason = remarks.includes(marker) ? remarks.slice(remarks.indexOf(marker) + marker.length).trim() : "";
  return reason || "Permanent Regular SO shortage confirmed in Production Report.";
}

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function isRegularWorkOrderRecord(wo, so) {
  if (!so || so.orderType === "NO_QTY") return false;
  if (wo.requirementSheetId != null) return false;
  return true;
}

/**
 * Effective line qty counting against SO planning (shortfall-closed WOs release remainder).
 */
function effectiveLinePlanQty(line, woStatus) {
  const qty = n(line.qty);
  if (woStatus === "CLOSED_WITH_SHORTFALL") {
    const sf = line.shortfallQty != null ? n(line.shortfallQty) : n(line.workOrder?.shortfallQty);
    return round3(Math.max(0, qty - sf));
  }
  return round3(qty);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 */
async function loadWorkOrderLifecycleContext(db, workOrderId) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      lines: { include: { fgItem: { select: { id: true, itemName: true } } } },
      salesOrder: { select: { id: true, docNo: true, orderType: true } },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  return { wo, so: wo.salesOrder };
}

/**
 * REGULAR lifecycle only.
 */
async function assertRegularWorkOrderLifecycleScope(db, workOrderId) {
  const ctx = await loadWorkOrderLifecycleContext(db, workOrderId);
  if (!isRegularWorkOrderRecord(ctx.wo, ctx.so)) {
    const err = new Error(
      "Work order hold and shortfall close apply to REGULAR sales orders only. NO_QTY orders use cycle planning.",
    );
    err.statusCode = 409;
    err.code = "WO_LIFECYCLE_REGULAR_ONLY";
    throw err;
  }
  return ctx;
}

function productionBlockedMessage(status, holdReason) {
  if (status === "PAUSED") {
    return "Work order is paused. Accepted FG stock is kept in store. Resume production to continue.";
  }
  if (status === "HOLD") {
    const reasonLabel = holdReason ? String(holdReason).replace(/_/g, " ") : "on hold";
    return `Work order is on hold (${reasonLabel}). Resume the work order before recording production.`;
  }
  if (status === "CLOSED_WITH_SHORTFALL") {
    return "Work order is closed with shortfall. No further production is allowed.";
  }
  if (status === "COMPLETED") {
    return "Work order is completed. No further production is allowed.";
  }
  if (status === "REJECTED") {
    return "Work order is rejected.";
  }
  return "Production is not allowed for this work order status.";
}

/**
 * Call for REGULAR production create/approve paths (after NO_QTY guard).
 */
async function assertWorkOrderAllowsProduction(tx, workOrderId) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      status: true,
      holdReason: true,
      cycleId: true,
      requirementSheetId: true,
      salesOrder: { select: { orderType: true } },
      productionExecution: { select: { executionStatus: true } },
    },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (!isRegularWorkOrderRecord(wo, wo.salesOrder)) return;
  if (WO_PRODUCTION_BLOCKED.has(wo.status)) {
    const err = new Error(productionBlockedMessage(wo.status, wo.holdReason));
    err.statusCode = 409;
    err.code = "WO_PRODUCTION_BLOCKED";
    throw err;
  }
  const exec = String(wo.productionExecution?.executionStatus ?? "").toUpperCase();
  if (exec === "SHORTFALL_PENDING") {
    const err = new Error(
      "Production Report is pending. Confirm the report to close this work order, or resume only if further production is intended.",
    );
    err.statusCode = 409;
    err.code = "PRODUCTION_REPORT_PENDING";
    throw err;
  }
}

function shouldFreezeStatusSync(status) {
  return WO_STATUS_SYNC_FROZEN.has(status);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function holdWorkOrder(tx, workOrderId, { holdReason, remarks, actorUserId, actorRole }) {
  const { wo } = await assertRegularWorkOrderLifecycleScope(tx, workOrderId);
  if (WO_TERMINAL.has(wo.status)) {
    const err = new Error(`Cannot hold a work order in status ${wo.status}.`);
    err.statusCode = 409;
    throw err;
  }
  if (wo.status === "HOLD" || wo.status === "PAUSED") {
    const err = new Error(
      wo.status === "PAUSED" ? "Work order is already paused." : "Work order is already on hold.",
    );
    err.statusCode = 409;
    throw err;
  }
  if (!HOLD_REASONS.includes(holdReason)) {
    const err = new Error("Invalid hold reason.");
    err.statusCode = 400;
    throw err;
  }

  const nextStatus = holdReason === "PRODUCTION_PAUSE" ? "PAUSED" : "HOLD";
  const actionLabel = nextStatus === "PAUSED" ? "PAUSE" : "HOLD";

  const updated = await tx.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: nextStatus,
      holdReason,
      heldAt: new Date(),
      heldByUserId: actorUserId ?? null,
      holdRemarks: remarks?.trim() || null,
    },
    include: { lines: { include: { fgItem: true } }, salesOrder: true },
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `WORK_ORDER:${workOrderId}`,
      actorUserId,
      actorRole,
      summary: `Work order ${updated.docNo || workOrderId} ${nextStatus === "PAUSED" ? "paused" : "placed on hold"} (${holdReason})`,
      payload: { module: "WORK_ORDER_LIFECYCLE", actionLabel, holdReason, status: nextStatus },
    });
  }

  return updated;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function resumeWorkOrder(tx, workOrderId, { actorUserId, actorRole }) {
  const { wo } = await assertRegularWorkOrderLifecycleScope(tx, workOrderId);
  if (wo.status !== "HOLD" && wo.status !== "PAUSED") {
    const err = new Error("Only paused or on-hold work orders can be resumed.");
    err.statusCode = 409;
    throw err;
  }

  await tx.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: "PENDING",
      holdReason: null,
      heldAt: null,
      heldByUserId: null,
      holdRemarks: null,
    },
  });

  const { reconcileWorkOrderStatusFromProduction } = require("./workOrderCompletionService");
  await reconcileWorkOrderStatusFromProduction(tx, workOrderId, {
    actorUserId,
    actorRole,
    source: "RESUME",
  });

  const updated = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    include: { lines: { include: { fgItem: true } }, salesOrder: true },
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `WORK_ORDER:${workOrderId}`,
      actorUserId,
      actorRole,
      summary: `Work order ${updated?.docNo || workOrderId} resumed (${updated?.status ?? "PENDING"})`,
      payload: {
        module: "WORK_ORDER_LIFECYCLE",
        actionLabel: "RESUME",
        status: updated?.status ?? "PENDING",
      },
    });
  }

  return updated;
}

async function assertProductionReportConfirmedForWorkOrder(tx, workOrderId) {
  const { assertProductionReportConfirmedForCompletion } = require("./productionWorkOrderReportService");
  return assertProductionReportConfirmedForCompletion(tx, workOrderId);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function closeWorkOrderWithShortfall(tx, workOrderId, { closureReason, actorUserId, actorRole }) {
  await assertRegularWorkOrderLifecycleScope(tx, workOrderId);
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { status: true },
  });
  if (wo?.status === "REJECTED") {
    const err = new Error("Rejected work orders cannot be closed with shortfall.");
    err.statusCode = 409;
    throw err;
  }

  const { completeWorkOrder, COMPLETION_TYPES } = require("./workOrderCompletionService");
  const result = await completeWorkOrder(tx, workOrderId, {
    completionType: COMPLETION_TYPES.CLOSED_WITH_SHORTFALL,
    closureReason,
    actorUserId,
    actorRole,
    source: "SHORTFALL_CLOSE",
  });

  return {
    workOrder: result.workOrder,
    shortfallQty: result.shortfallQty,
    lineShortfalls: result.lineShortfalls,
  };
}

async function regularWoLifecycleActions(db, workOrderId, actorRole = null) {
  const { wo, so } = await assertRegularWorkOrderLifecycleScope(db, workOrderId);
  const lineIds = (wo.lines || []).map((line) => line.id);
  const [productionCount, approvedProductionCount, qaCount, pmrCount, issueCount, allocationCount, reportCount] =
    await Promise.all([
      db.productionEntry.count({ where: { workOrderLineId: { in: lineIds } } }),
      db.productionEntry.count({ where: { workOrderLineId: { in: lineIds }, workflowStatus: "APPROVED" } }),
      db.qcEntry.count({ where: { production: { workOrderLineId: { in: lineIds } }, reversedAt: null } }),
      db.productionMaterialRequest.count({ where: { workOrderId } }),
      db.materialIssueNote.count({ where: { workOrderId } }),
      db.materialAllocation.count({ where: { workOrderId } }),
      db.productionWorkOrderReport.count({ where: { workOrderId } }),
    ]);
  const isAdmin = String(actorRole || "").toUpperCase() === "ADMIN";
  const isStore = String(actorRole || "").toUpperCase() === "STORE";
  const editableStatus = ["PENDING", "HOLD", "PAUSED"].includes(wo.status);
  const editBlockers = [];
  if (!editableStatus) editBlockers.push(`WO status is ${wo.status}`);
  if (approvedProductionCount) editBlockers.push("Production finalized");
  if (qaCount) editBlockers.push("QA completed");
  if (reportCount) editBlockers.push("Reconciliation finalized");
  if (!isAdmin && !isStore) editBlockers.push("User lacks permission");

  const deleteBlockers = [];
  if (wo.status !== "PENDING") deleteBlockers.push("WO is not an untouched draft");
  if (pmrCount) deleteBlockers.push("PMR exists");
  if (allocationCount) deleteBlockers.push("RM reservation/allocation exists");
  if (issueCount) deleteBlockers.push("RM issue exists");
  if (productionCount) deleteBlockers.push("Production exists");
  if (qaCount) deleteBlockers.push("QA completed");
  if (reportCount) deleteBlockers.push("Reconciliation exists");
  if (!isAdmin) deleteBlockers.push("User lacks permission");

  const cancelBlockers = [];
  if (["COMPLETED", "CLOSED_WITH_SHORTFALL"].includes(wo.status)) {
    cancelBlockers.push("WO is finally closed; use controlled reopen/reversal");
  }
  if (qaCount) cancelBlockers.push("QA completed");
  if (!isAdmin && !isStore) cancelBlockers.push("User lacks permission");

  const reopenBlockers = [];
  if (wo.status !== "CLOSED_WITH_SHORTFALL") {
    reopenBlockers.push("WO was not permanently closed through the Regular SO shortage path");
  }
  const fgItemIds = (wo.lines || []).map((line) => line.fgItemId);
  const dispatches = fgItemIds.length
    ? await db.dispatch.findMany({
        where: {
          soId: so.id,
          itemId: { in: fgItemIds },
          reversalOfId: null,
          dispatchedQty: { gt: 0 },
        },
        select: { id: true, docNo: true, workflowStatus: true },
      })
    : [];
  if (dispatches.length) reopenBlockers.push("dispatch exists against produced stock");
  const salesBillCount = await db.salesBill.count({
    where: {
      OR: [
        { soId: so.id, status: { not: "CANCELLED" } },
        { dispatchId: { in: dispatches.map((row) => row.id) }, status: { not: "CANCELLED" } },
      ],
    },
  });
  if (salesBillCount) reopenBlockers.push("sales bill exists");
  const tallyExportCount = await db.salesBill.count({
    where: {
      OR: [{ soId: so.id }, { dispatchId: { in: dispatches.map((row) => row.id) } }],
      isExported: true,
    },
  });
  if (tallyExportCount) reopenBlockers.push("Tally export exists");
  let laterConflictingTransactionCount = 0;
  if (wo.closedAt) {
    const [laterProductionCount, laterQcCount, laterIssueCount] = await Promise.all([
      db.productionEntry.count({
        where: { workOrderLineId: { in: lineIds }, date: { gt: wo.closedAt } },
      }),
      db.qcEntry.count({
        where: { production: { workOrderLineId: { in: lineIds } }, date: { gt: wo.closedAt }, reversedAt: null },
      }),
      db.materialIssueNote.count({ where: { workOrderId, createdAt: { gt: wo.closedAt } } }),
    ]);
    laterConflictingTransactionCount = laterProductionCount + laterQcCount + laterIssueCount;
  }
  if (laterConflictingTransactionCount) {
    reopenBlockers.push("a later production, QC, or RM issue transaction conflicts with the closure");
  }
  if (!reportCount) reopenBlockers.push("original Production Report is missing");
  if (!isAdmin) reopenBlockers.push("User lacks permission");
  return {
    workOrderId,
    salesOrderId: so.id,
    edit: { enabled: editBlockers.length === 0, blockers: editBlockers },
    hardDelete: { enabled: deleteBlockers.length === 0, blockers: deleteBlockers },
    cancel: { enabled: cancelBlockers.length === 0, blockers: cancelBlockers },
    reopen: { enabled: reopenBlockers.length === 0, blockers: reopenBlockers },
    facts: {
      productionCount,
      approvedProductionCount,
      qaCount,
      pmrCount,
      issueCount,
      allocationCount,
      reportCount,
      laterConflictingTransactionCount,
    },
  };
}

async function cancelRegularWorkOrder(tx, workOrderId, { reason, actorUserId, actorRole }) {
  const actions = await regularWoLifecycleActions(tx, workOrderId, actorRole);
  if (!actions.cancel.enabled) {
    const err = new Error(`Cannot cancel work order: ${actions.cancel.blockers.join("; ")}.`);
    err.statusCode = 409;
    err.code = "REGULAR_WO_CANCEL_BLOCKED";
    throw err;
  }
  await tx.materialAllocation.updateMany({
    where: { workOrderId, status: { in: ["ACTIVE", "PARTIALLY_ISSUED"] }, qtyIssued: "0" },
    data: { status: "RELEASED", releasedByUserId: actorUserId ?? null, remarks: `Released on WO cancellation: ${reason}` },
  });
  await tx.productionMaterialRequest.updateMany({
    where: { workOrderId, status: { in: ["DRAFT", "REQUESTED"] } },
    data: { status: "CANCELLED", remarks: `WO cancelled: ${reason}` },
  });
  return tx.workOrder.update({
    where: { id: workOrderId },
    data: { status: "REJECTED", closureReason: reason, closedAt: new Date(), closedByUserId: actorUserId ?? null },
  });
}

async function reopenRegularWorkOrder(tx, workOrderId, { reason, actorUserId, actorRole }) {
  if (!String(reason ?? "").trim()) {
    const err = new Error("Admin reopening reason is required.");
    err.statusCode = 400;
    err.code = "REGULAR_WO_REOPEN_REASON_REQUIRED";
    throw err;
  }
  const actions = await regularWoLifecycleActions(tx, workOrderId, actorRole);
  if (!actions.reopen.enabled) {
    const err = new Error(`Cannot reopen work order: ${actions.reopen.blockers.join("; ")}.`);
    err.statusCode = 409;
    err.code = "REGULAR_WO_REOPEN_BLOCKED";
    throw err;
  }
  const before = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { status: true, shortfallQty: true, closureReason: true, closedAt: true, closedByUserId: true },
  });
  await tx.workOrderLine.updateMany({
    where: { workOrderId },
    data: { shortfallQty: null },
  });
  const updated = await tx.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: "IN_PROGRESS",
      shortfallQty: null,
      closureReason: null,
      closedAt: null,
      closedByUserId: null,
      materialReleasedToProductionAt: null,
      materialReleasedByUserId: null,
    },
  });
  await tx.workOrderProductionExecution.upsert({
    where: { workOrderId },
    create: {
      workOrderId,
      executionStatus: "RUNNING",
      blockRemarks: "Accidental closure reopened. Store must reissue any RM returned during closure.",
    },
    update: {
      executionStatus: "RUNNING",
      completedAt: null,
      completedByUserId: null,
      blockReason: null,
      blockRemarks: "Accidental closure reopened. Store must reissue any RM returned during closure.",
    },
  });
  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `WORK_ORDER:${workOrderId}`,
      actorUserId,
      actorRole,
      summary: `Work order ${workOrderId} accidental shortage closure reopened: ${reason}`,
      payload: {
        module: "WORK_ORDER_LIFECYCLE",
        actionLabel: "REOPEN_ACCIDENTAL_REGULAR_SHORTAGE_CLOSURE",
        reason,
        originalClosure: before,
        productionReportPreserved: true,
        approvedProductionPreserved: true,
        stockReposted: false,
        rmReissueRequiredFromActualBalance: true,
      },
      reason: String(reason).trim(),
    });
  }
  return updated;
}

/**
 * REGULAR: End Production when SO demand is covered (WO-plan remainder optional),
 * or park for Production Report before shortage close when SO demand is unmet.
 *
 * Does not close the WO — Production Report confirm + reconcile / shortfall close does.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} workOrderId
 * @param {{ decision: 'END_COVERED' | 'END_SHORTAGE'; closureReason?: string | null; actorUserId?: number | null; actorRole?: string | null }} input
 */
async function requestRegularEndProduction(tx, workOrderId, input) {
  await assertRegularWorkOrderLifecycleScope(tx, workOrderId);
  const decision = String(input.decision ?? "").toUpperCase();
  if (decision !== "END_COVERED" && decision !== "END_SHORTAGE") {
    const err = new Error("decision must be END_COVERED or END_SHORTAGE.");
    err.statusCode = 400;
    throw err;
  }

  const { computeRegularSoWorkOrderDemandCoverage } = require("./regularSoProductionClosure");
  const coverage = await computeRegularSoWorkOrderDemandCoverage(tx, workOrderId);

  if (coverage.producedQty <= EPS) {
    const err = new Error("Record and approve at least one production batch before ending production.");
    err.statusCode = 409;
    err.code = "NO_APPROVED_PRODUCTION";
    throw err;
  }

  if (decision === "END_COVERED") {
    if (!coverage.soDemandCovered) {
      const err = new Error(
        `SO demand is not covered yet (produced ${coverage.producedQty}, remaining SO demand ${coverage.remainingSoDemand}). Continue production or End with Shortage.`,
      );
      err.statusCode = 409;
      err.code = "SO_DEMAND_NOT_COVERED";
      throw err;
    }
  } else if (!coverage.hasSoShortage) {
    const err = new Error(
      "No SO-demand shortage. Use End Production & Continue to Report when SO demand is already covered.",
    );
    err.statusCode = 409;
    err.code = "NO_SO_SHORTAGE";
    throw err;
  }
  if (decision === "END_SHORTAGE") {
    if (!String(input.closureReason ?? "").trim()) {
      const err = new Error("Closure reason is required for permanent Regular SO shortage closure.");
      err.statusCode = 400;
      err.code = "REGULAR_SHORTAGE_CLOSURE_REASON_REQUIRED";
      throw err;
    }
    if (input.permanentClosureAcknowledged !== true) {
      const err = new Error("Explicit acknowledgement of permanent WO shortage closure is required.");
      err.statusCode = 400;
      err.code = "REGULAR_SHORTAGE_CLOSURE_ACK_REQUIRED";
      throw err;
    }
  }

  if (WO_TERMINAL.has(coverage.workOrderStatus)) {
    const err = new Error(`Work order is already ${coverage.workOrderStatus}.`);
    err.statusCode = 409;
    throw err;
  }

  await tx.workOrderProductionExecution.upsert({
    where: { workOrderId },
    create: {
      workOrderId,
      executionStatus: "SHORTFALL_PENDING",
      blockRemarks:
        decision === "END_COVERED"
          ? "REGULAR: SO demand covered — Production Report pending before WO close."
          : `REGULAR: End with SO shortage — Production Report pending.${input.closureReason ? ` ${String(input.closureReason).trim()}` : ""}`,
    },
    update: {
      executionStatus: "SHORTFALL_PENDING",
      blockReason: null,
      blockRemarks:
        decision === "END_COVERED"
          ? "REGULAR: SO demand covered — Production Report pending before WO close."
          : `REGULAR: End with SO shortage — Production Report pending.${input.closureReason ? ` ${String(input.closureReason).trim()}` : ""}`,
    },
  });

  if (typeof input.actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `WORK_ORDER:${workOrderId}`,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      summary: `Work order ${coverage.workOrderDocNo || workOrderId} end production (${decision}) — Production Report pending`,
      payload: {
        module: "WORK_ORDER_LIFECYCLE",
        actionLabel: "REGULAR_END_PRODUCTION",
        decision,
        soDemandCovered: coverage.soDemandCovered,
        producedQty: coverage.producedQty,
        remainingSoDemand: coverage.remainingSoDemand,
        woTargetBalance: coverage.woTargetBalance,
        expectedExcessBeforeQc: coverage.expectedExcessBeforeQc,
      },
    });
  }

  const nextCoverage = await computeRegularSoWorkOrderDemandCoverage(tx, workOrderId);
  return {
    outcome: "AWAITING_PRODUCTION_REPORT",
    decision,
    coverage: nextCoverage,
  };
}

const { EPS: WO_SO_EPS } = require("./workOrderSoValidation");

const PRODUCTION_ENTRY_WO_TOLERANCE_PCT = 0.05;

function allowsWorkOrderProductionOverPlan(wo, orderType) {
  // Shop-floor entry hard cap is issued-RM readiness (limiting BOM/PMR line), not WO plan.
  // WO plan remains Target Remaining / Use Remaining and a closure signal. REGULAR, NO_QTY,
  // and Green Level may exceed plan when issued RM supports the quantity.
  void wo;
  void orderType;
  return true;
}

/**
 * Legacy WO line plan cap (+5% tolerance). Skipped for all flows — RM readiness is authoritative.
 * Kept for call-site compatibility; does not reject when allowOverproduction is true.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 */
async function assertProductionEntryWoQtyTolerance(
  tx,
  {
    workOrderLineId,
    producedQty,
    excludeProductionId,
    lineQty,
    workOrder,
    orderType,
    messageBuilder,
  },
) {
  const allowOverproduction = allowsWorkOrderProductionOverPlan(workOrder, orderType);
  if (allowOverproduction) return;

  const where = { workOrderLineId };
  if (excludeProductionId != null) where.id = { not: excludeProductionId };
  const agg = await tx.productionEntry.aggregate({
    where,
    _sum: { producedQty: true },
  });
  const alreadyProduced = Number(agg._sum.producedQty ?? 0);
  const totalProducedQty = alreadyProduced + Number(producedQty);
  const allowedMaxQty = Number(lineQty) * (1 + PRODUCTION_ENTRY_WO_TOLERANCE_PCT);
  if (totalProducedQty > allowedMaxQty + WO_SO_EPS) {
    const err = new Error(
      messageBuilder({
        lineQty: Number(lineQty),
        allowedMaxQty,
        totalProducedQty,
        alreadyProduced,
      }),
    );
    err.statusCode = 409;
    err.code = "PRODUCTION_EXCEEDS_WO";
    throw err;
  }
}

module.exports = {
  HOLD_REASONS,
  WO_PRODUCTION_BLOCKED,
  WO_STATUS_SYNC_FROZEN,
  WO_TERMINAL,
  PRODUCTION_ENTRY_WO_TOLERANCE_PCT,
  allowsWorkOrderProductionOverPlan,
  isRegularWorkOrderRecord,
  effectiveLinePlanQty,
  assertWorkOrderAllowsProduction,
  assertProductionEntryWoQtyTolerance,
  shouldFreezeStatusSync,
  holdWorkOrder,
  resumeWorkOrder,
  closeWorkOrderWithShortfall,
  requestRegularEndProduction,
  regularWoLifecycleActions,
  cancelRegularWorkOrder,
  reopenRegularWorkOrder,
  regularShortageClosureReasonFromPendingExecution,
  loadWorkOrderLifecycleContext,
};
