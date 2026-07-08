/**
 * NO_QTY Production Execution — shortfall resolution.
 * Production owns execution actions; Work Order document completion via workOrderCompletionService.
 */
const { reconcileWorkOrderStatusFromProduction } = require("./workOrderCompletionService");

const auditLog = require("./auditLog");
const { GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");
const {
  isShopFloorExecutionWorkOrder,
  resolveWorkOrderOperationalStatus,
  assertShopFloorExecutionAllowsProduction,
} = require("./workOrderOperationalStatus");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { getWoLineRemainingProductionQty } = require("./reportMetrics");
const {
  createCarryForwardPendingFromProductionShortfall,
} = require("./carryForwardPendingService");

const EPS = 1e-6;

/** Operator-facing Pending Actions / production queue labels keyed by execution status. */
const PRODUCTION_EXECUTION_PENDING_LABELS = Object.freeze({
  NOT_STARTED: "Ready to Start Production",
  RUNNING: "Continue Production",
  SHORTFALL_PENDING: "Resolve Production Shortfall",
  BLOCKED: "Production Paused",
});

/**
 * Pending Actions label from NO_QTY production execution status.
 * @param {string | null | undefined} executionStatus
 * @returns {string | null} null when COMPLETED (row should not appear in pending actions)
 */
function productionExecutionPendingActionLabel(executionStatus) {
  const status = String(executionStatus ?? "NOT_STARTED")
    .trim()
    .toUpperCase();
  if (status === "COMPLETED") return null;
  return PRODUCTION_EXECUTION_PENDING_LABELS[status] ?? PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING;
}

/**
 * Production queue row action label — defers to execution status for production work,
 * keeps dashboard routing labels for QC / dispatch / billing / next RS.
 * @param {{ nextAction?: string | null; execStatus?: string | null }} params
 */
function deriveProductionQueueActionLabel({ nextAction, execStatus }) {
  const na = String(nextAction ?? "");
  if (na === "QC_PENDING") return "Complete QA";
  if (na === "DISPATCH_PENDING") return "Go to Dispatch";
  if (na === "ON_HOLD") return "Review Hold";
  if (na === "NEXT_RS_REQUIRED") return "Create Next RS";
  if (na === "SALES_BILL_PENDING") return "Create Sales Bill";
  if (na === "PRODUCTION_EXECUTION_BLOCKED") return PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED;
  if (na === "PRODUCTION_SHORTFALL_DECISION") return PRODUCTION_EXECUTION_PENDING_LABELS.SHORTFALL_PENDING;
  return productionExecutionPendingActionLabel(execStatus);
}

const BLOCK_REASONS = Object.freeze([
  "MACHINE_BREAKDOWN",
  "WAITING_FOR_RM",
  "TOOL_MOULD_MAINTENANCE",
  "QUALITY_CONCERN",
  "EMERGENCY_PRIORITY_PRODUCTION",
  "POWER_UTILITY_FAILURE",
  "MANAGEMENT_HOLD",
  "OTHER",
]);

const RESOLUTION_REASONS = Object.freeze([
  "MACHINE_BREAKDOWN",
  "CAPACITY_CONSTRAINT",
  "WAITING_FOR_RM",
  "TOOL_MAINTENANCE",
  "CUSTOMER_PRIORITY_CHANGE",
  "MANAGEMENT_DECISION",
  "QUALITY_CONCERN",
  "OTHER",
]);

const FINISH_OUTCOMES = Object.freeze(["CARRY_FORWARD", "WAIVE_BALANCE"]);

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function isGreenLevelWorkOrder(wo) {
  return String(wo?.sourceType ?? "").toUpperCase() === GREEN_LEVEL_WO_SOURCE_TYPE;
}

function isNoQtyWorkOrder(wo, so) {
  return so?.orderType === "NO_QTY" || wo?.requirementSheetId != null || wo?.cycleId != null;
}

function supportsShopFloorExecutionWorkOrder(wo, so) {
  return isShopFloorExecutionWorkOrder(wo, so);
}

function blockReasonLabel(reason) {
  return String(reason ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildFinishSuccessMessage(woDocNo, workOrderId, outcome, remainderQty, surplusQty = 0, opts = {}) {
  const surplus = round3(surplusQty);
  if (outcome === "WAIVE_BALANCE") {
    return "Production completed. Remaining quantity has been waived.";
  }
  if (outcome === "CARRY_FORWARD") {
    if (opts.greenLevel) {
      return "Production completed. Remaining quantity recorded for stock replenishment follow-up.";
    }
    return "Production completed. Remaining quantity has been carried forward to the next Requirement Sheet.";
  }
  if (outcome === "FULL_COMPLETE") {
    if (surplus > EPS) {
      return "Production completed. Surplus production has been recorded.";
    }
    return "Production completed successfully. Work Order sent for Quality Inspection.";
  }
  return null;
}

async function loadNoQtyExecutionContext(db, workOrderId) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      lines: { include: { fgItem: { select: { id: true, itemName: true } } } },
      salesOrder: { select: { id: true, docNo: true, orderType: true, customerId: true } },
      productionExecution: true,
    },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (!supportsShopFloorExecutionWorkOrder(wo, wo.salesOrder)) {
    const err = new Error(
      "Production execution shortfall resolution applies to NO_QTY and Green Level work orders only.",
    );
    err.statusCode = 409;
    err.code = "WO_EXEC_NO_QTY_ONLY";
    throw err;
  }
  return wo;
}

async function ensureProductionExecutionRecord(tx, workOrderId) {
  const existing = await tx.workOrderProductionExecution.findUnique({ where: { workOrderId } });
  if (existing) return existing;
  return tx.workOrderProductionExecution.create({
    data: { workOrderId, executionStatus: "RUNNING" },
  });
}

async function computeExecutionSummary(tx, wo) {
  const lineIds = wo.lines.map((l) => l.id);
  const producedByLineId = await getApprovedProducedQtyByWorkOrderLineIds(tx, lineIds);
  const lines = wo.lines.map((line) => {
    const plannedQty = round3(n(line.plannedQty ?? line.qty));
    const producedQty = round3(producedByLineId.get(line.id) ?? 0);
    const remainderQty = round3(Math.max(0, plannedQty - producedQty));
    const surplusQty = round3(Math.max(0, producedQty - plannedQty));
    const productionPendingQty =
      wo.productionExecution?.executionStatus === "COMPLETED"
        ? 0
        : getWoLineRemainingProductionQty(plannedQty, producedQty);
    return {
      workOrderLineId: line.id,
      fgItemId: line.fgItemId,
      fgItemName: line.fgItem?.itemName ?? null,
      plannedQty,
      producedQty,
      remainderQty,
      surplusQty,
      productionPendingQty: round3(productionPendingQty),
      executionWaivedQty: line.executionWaivedQty != null ? round3(n(line.executionWaivedQty)) : null,
      executionSurplusQty: line.executionSurplusQty != null ? round3(n(line.executionSurplusQty)) : null,
    };
  });
  const plannedQty = round3(lines.reduce((s, l) => s + l.plannedQty, 0));
  const producedQty = round3(lines.reduce((s, l) => s + l.producedQty, 0));
  const remainderQty = round3(lines.reduce((s, l) => s + l.remainderQty, 0));
  const surplusQty = round3(lines.reduce((s, l) => s + l.surplusQty, 0));
  const productionPendingQty = round3(lines.reduce((s, l) => s + l.productionPendingQty, 0));
  const operational = resolveWorkOrderOperationalStatus(wo, wo.salesOrder);
  return {
    workOrderId: wo.id,
    workOrderDocNo: wo.docNo,
    workOrderStatus: wo.status,
    operationalStatus: operational.operationalKey,
    operationalAuthority: operational.authority,
    executionStatus: wo.productionExecution?.executionStatus ?? "RUNNING",
    blockReason: wo.productionExecution?.blockReason ?? null,
    blockRemarks: wo.productionExecution?.blockRemarks ?? null,
    blockedAt: wo.productionExecution?.blockedAt ?? null,
    plannedQty,
    producedQty,
    remainderQty,
    surplusQty,
    productionPendingQty,
    hasShortfall: remainderQty > EPS && wo.productionExecution?.executionStatus !== "COMPLETED",
    hasSurplus: surplusQty > EPS && wo.productionExecution?.executionStatus !== "COMPLETED",
    pendingShortfallResolution: wo.productionExecution?.executionStatus === "SHORTFALL_PENDING",
    lines,
  };
}

/**
 * @deprecated Prefer {@link assertShopFloorExecutionAllowsProduction} via productionEntryGateService.
 */
async function assertNoQtyProductionExecutionAllowsProduction(tx, workOrderId) {
  return assertShopFloorExecutionAllowsProduction(tx, workOrderId);
}

function validateBlockReason(blockReason, remarks) {
  if (!BLOCK_REASONS.includes(blockReason)) {
    const err = new Error("Invalid block reason.");
    err.statusCode = 400;
    throw err;
  }
  if (blockReason === "OTHER") {
    const t = String(remarks ?? "").trim();
    if (t.length < 3) {
      const err = new Error("Remarks are required when block reason is Other.");
      err.statusCode = 400;
      throw err;
    }
  }
}

function validateResolutionReason(resolutionReason, remarks) {
  if (!RESOLUTION_REASONS.includes(resolutionReason)) {
    const err = new Error("Invalid resolution reason.");
    err.statusCode = 400;
    throw err;
  }
  if (resolutionReason === "OTHER") {
    const t = String(remarks ?? "").trim();
    if (t.length < 3) {
      const err = new Error("Remarks are required when resolution reason is Other.");
      err.statusCode = 400;
      throw err;
    }
  }
}

function defaultAutomaticShortfallResolutionReason(shortfallOutcome, resolutionReason) {
  if (resolutionReason) return resolutionReason;
  if (shortfallOutcome === "CARRY_FORWARD") return "CAPACITY_CONSTRAINT";
  return resolutionReason;
}

async function writeShortfallResolutionAudit(tx, {
  workOrderId,
  workOrderLineId,
  plannedQty,
  producedQty,
  remainderQty,
  resolutionType,
  resolutionReason,
  blockReason,
  remarks,
  actorUserId,
}) {
  return tx.productionShortfallResolution.create({
    data: {
      workOrderId,
      workOrderLineId: workOrderLineId ?? null,
      plannedQty: String(round3(plannedQty)),
      producedQty: String(round3(producedQty)),
      remainderQty: String(round3(remainderQty)),
      resolutionType,
      resolutionReason: resolutionReason ?? null,
      blockReason: blockReason ?? null,
      resolutionReasonOther: resolutionReason === "OTHER" ? String(remarks ?? "").trim() : null,
      remarks: remarks?.trim() || null,
      createdByUserId: actorUserId ?? null,
    },
  });
}

/**
 * Validates production execution outcome before execution status is finalized.
 * Work order document completion is applied separately via workOrderCompletionService.
 */
async function applyWorkOrderExecutionOutcome(tx, workOrderId, { outcome }) {
  const wo = await loadNoQtyExecutionContext(tx, workOrderId);
  const exec = wo.productionExecution ?? (await ensureProductionExecutionRecord(tx, workOrderId));

  if (exec.executionStatus === "COMPLETED") {
    const err = new Error("Production execution is already completed.");
    err.statusCode = 409;
    throw err;
  }

  if (outcome === "BLOCK") {
    return { workOrder: wo, execution: exec, outcome: "BLOCK" };
  }

  if (outcome === "CARRY_FORWARD" || outcome === "WAIVE_BALANCE" || outcome === "FULL_COMPLETE") {
    const terminalStatuses = new Set(["COMPLETED", "REJECTED", "CLOSED_WITH_SHORTFALL"]);
    if (terminalStatuses.has(wo.status)) {
      return { workOrderId, outcome, alreadyTerminal: true };
    }
  }

  return { workOrderId, outcome };
}

/**
 * Cannot Continue Production — block execution.
 */
async function blockProductionExecution(tx, workOrderId, { blockReason, remarks, actorUserId, actorRole }) {
  validateBlockReason(blockReason, remarks);
  const wo = await loadNoQtyExecutionContext(tx, workOrderId);
  if (wo.productionExecution?.executionStatus === "COMPLETED") {
    const err = new Error("Production execution is already completed.");
    err.statusCode = 409;
    throw err;
  }

  const summary = await computeExecutionSummary(tx, wo);
  if (summary.remainderQty <= EPS && summary.producedQty <= EPS) {
    const err = new Error("Cannot block before any production has started.");
    err.statusCode = 409;
    throw err;
  }

  await ensureProductionExecutionRecord(tx, workOrderId);
  const now = new Date();
  const execution = await tx.workOrderProductionExecution.update({
    where: { workOrderId },
    data: {
      executionStatus: "BLOCKED",
      blockReason,
      blockRemarks: remarks?.trim() || null,
      blockedAt: now,
      blockedByUserId: actorUserId ?? null,
      lastResolutionType: "BLOCKED",
      resumedAt: null,
      resumedByUserId: null,
    },
  });

  for (const line of summary.lines) {
    if (line.remainderQty <= EPS) continue;
    await writeShortfallResolutionAudit(tx, {
      workOrderId,
      workOrderLineId: line.workOrderLineId,
      plannedQty: line.plannedQty,
      producedQty: line.producedQty,
      remainderQty: line.remainderQty,
      resolutionType: "BLOCKED",
      blockReason,
      remarks,
      actorUserId,
    });
  }

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `WORK_ORDER:${workOrderId}`,
      actorUserId,
      actorRole,
      summary: `Production execution blocked on WO ${wo.docNo || workOrderId} (${blockReasonLabel(blockReason)})`,
      payload: { module: "PRODUCTION_EXECUTION", action: "BLOCK", blockReason },
      reason: remarks?.trim() || null,
    });
  }

  return { execution, summary: await computeExecutionSummary(tx, { ...wo, productionExecution: execution }) };
}

/**
 * Resume Production after blocker resolved.
 */
async function resumeProductionExecution(tx, workOrderId, { actorUserId, actorRole }) {
  const wo = await loadNoQtyExecutionContext(tx, workOrderId);
  const exec = wo.productionExecution;
  if (!exec || exec.executionStatus !== "BLOCKED") {
    const err = new Error("Only blocked production execution can be resumed.");
    err.statusCode = 409;
    throw err;
  }

  const now = new Date();
  const execution = await tx.workOrderProductionExecution.update({
    where: { workOrderId },
    data: {
      executionStatus: "RUNNING",
      blockReason: null,
      blockRemarks: null,
      blockedAt: null,
      blockedByUserId: null,
      resumedAt: now,
      resumedByUserId: actorUserId ?? null,
    },
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `WORK_ORDER:${workOrderId}`,
      actorUserId,
      actorRole,
      summary: `Production execution resumed on WO ${wo.docNo || workOrderId}`,
      payload: { module: "PRODUCTION_EXECUTION", action: "RESUME" },
    });
  }

  return { execution, summary: await computeExecutionSummary(tx, { ...wo, productionExecution: execution }) };
}

/**
 * After an approved NO_QTY batch: mark execution SHORTFALL_PENDING when the batch triggers
 * the less-than-WO shortfall decision (same rule as frontend completion evaluate).
 */
async function syncShortfallPendingAfterProductionApprove(tx, workOrderId, approvedBatchQty) {
  const wo = await loadNoQtyExecutionContext(tx, workOrderId);
  if (isGreenLevelWorkOrder(wo)) {
    return wo.productionExecution ?? (await ensureProductionExecutionRecord(tx, workOrderId));
  }
  const exec = wo.productionExecution ?? (await ensureProductionExecutionRecord(tx, workOrderId));
  if (exec.executionStatus === "COMPLETED" || exec.executionStatus === "BLOCKED") return exec;

  const summary = await computeExecutionSummary(tx, { ...wo, productionExecution: exec });
  if (summary.producedQty <= EPS || summary.remainderQty <= EPS || (summary.surplusQty ?? 0) > EPS) {
    return exec;
  }

  const batchQty = round3(n(approvedBatchQty));
  if (!(batchQty + EPS >= summary.remainderQty)) return exec;

  if (exec.executionStatus === "SHORTFALL_PENDING") return exec;

  return tx.workOrderProductionExecution.update({
    where: { workOrderId },
    data: { executionStatus: "SHORTFALL_PENDING" },
  });
}

/**
 * Repair legacy RUNNING executions that already have an unresolved shortfall decision.
 */
async function reconcileShortfallPendingStatus(tx, wo) {
  if (isGreenLevelWorkOrder(wo)) return wo.productionExecution;
  const exec = wo.productionExecution;
  if (!exec || exec.executionStatus === "COMPLETED" || exec.executionStatus === "BLOCKED") return exec;
  if (exec.executionStatus === "SHORTFALL_PENDING") return exec;

  // Operator resumed after Pause — keep RUNNING until the next shortfall-triggering approve.
  if (exec.executionStatus === "RUNNING" && exec.resumedAt != null) {
    return exec;
  }

  const summary = await computeExecutionSummary(tx, wo);
  if (summary.producedQty <= EPS || summary.remainderQty <= EPS) return exec;

  const lastEntry = await tx.productionEntry.findFirst({
    where: {
      workflowStatus: "APPROVED",
      workOrderLine: { workOrderId: wo.id },
    },
    orderBy: { id: "desc" },
    select: { producedQty: true },
  });
  const batchQty = round3(n(lastEntry?.producedQty));
  if (!(batchQty + EPS >= summary.remainderQty)) return exec;

  return tx.workOrderProductionExecution.update({
    where: { workOrderId: wo.id },
    data: { executionStatus: "SHORTFALL_PENDING" },
  });
}

async function assertProductionReportConfirmedForExecution(tx, workOrderId) {
  const { assertProductionReportConfirmedForCompletion } = require("./productionWorkOrderReportService");
  return assertProductionReportConfirmedForCompletion(tx, workOrderId);
}

/**
 * Finish Production Execution — full qty, carry forward, or waive balance.
 */
async function finishProductionExecution(tx, workOrderId, input, { actorUserId, actorRole }) {
  const { shortfallOutcome, resolutionReason, remarks, blockReason: dialogBlockReason } = input ?? {};
  const wo = await loadNoQtyExecutionContext(tx, workOrderId);
  if (wo.productionExecution?.executionStatus === "COMPLETED") {
    const err = new Error("Production execution is already completed.");
    err.statusCode = 409;
    throw err;
  }

  await ensureProductionExecutionRecord(tx, workOrderId);
  const summaryPreview = await computeExecutionSummary(tx, wo);

  if (wo.productionExecution?.executionStatus === "BLOCKED") {
    const allowPausedShortfallClose =
      shortfallOutcome &&
      FINISH_OUTCOMES.includes(shortfallOutcome) &&
      summaryPreview.remainderQty > EPS &&
      summaryPreview.producedQty > EPS;
    if (!allowPausedShortfallClose) {
      const err = new Error("Production execution is blocked. Resume production before finishing.");
      err.statusCode = 409;
      err.code = "WO_EXEC_BLOCKED";
      throw err;
    }
  }

  const summary = summaryPreview;
  const shortfallRemainderQty = summary.remainderQty;

  if (summary.producedQty <= EPS) {
    const err = new Error("Record at least one approved production batch before finishing execution.");
    err.statusCode = 409;
    throw err;
  }

  // Full production or surplus — no shortfall remainder
  await assertProductionReportConfirmedForExecution(tx, workOrderId);

  if (summary.remainderQty <= EPS) {
    const now = new Date();
    const totalSurplusQty = summary.surplusQty ?? 0;

    if (totalSurplusQty > EPS) {
      for (const line of summary.lines) {
        if (line.surplusQty <= EPS) continue;
        await writeShortfallResolutionAudit(tx, {
          workOrderId,
          workOrderLineId: line.workOrderLineId,
          plannedQty: line.plannedQty,
          producedQty: line.producedQty,
          remainderQty: line.surplusQty,
          resolutionType: "SURPLUS_PRODUCTION",
          resolutionReason: input?.surplusReason ?? null,
          remarks: input?.remarks?.trim() || null,
          actorUserId,
        });
        await tx.workOrderLine.update({
          where: { id: line.workOrderLineId },
          data: { executionSurplusQty: String(round3(line.surplusQty)) },
        });
      }
    }

    await applyWorkOrderExecutionOutcome(tx, workOrderId, {
      outcome: "FULL_COMPLETE",
    });
    const execution = await tx.workOrderProductionExecution.update({
      where: { workOrderId },
      data: {
        executionStatus: "COMPLETED",
        completedAt: now,
        completedByUserId: actorUserId ?? null,
        lastResolutionType: totalSurplusQty > EPS ? "SURPLUS_PRODUCTION" : null,
      },
    });

    if (typeof actorUserId === "number") {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `WORK_ORDER:${workOrderId}`,
        actorUserId,
        actorRole,
        summary:
          totalSurplusQty > EPS
            ? `Production execution completed with surplus ${round3(totalSurplusQty)} on WO ${wo.docNo || workOrderId}`
            : `Production execution completed (full qty) on WO ${wo.docNo || workOrderId}`,
        payload: {
          module: "PRODUCTION_EXECUTION",
          action: totalSurplusQty > EPS ? "FINISH_SURPLUS" : "FINISH_FULL",
          surplusQty: totalSurplusQty > EPS ? round3(totalSurplusQty) : undefined,
        },
      });
    }

    await reconcileWorkOrderStatusFromProduction(tx, workOrderId, {
      actorUserId,
      actorRole,
      source: "EXECUTION_FINISH_FULL",
    });

    return {
      execution,
      summary: await computeExecutionSummary(tx, { ...wo, productionExecution: execution, status: "COMPLETED" }),
      outcome: "FULL_COMPLETE",
      surplusQty: totalSurplusQty > EPS ? round3(totalSurplusQty) : 0,
      successMessage: buildFinishSuccessMessage(
        wo.docNo,
        workOrderId,
        "FULL_COMPLETE",
        0,
        totalSurplusQty,
      ),
    };
  }

  // Shortfall — require explicit outcome (Green Level auto-carries to next replenishment planning)
  let effectiveShortfallOutcome = shortfallOutcome;
  if (isGreenLevelWorkOrder(wo) && summary.remainderQty > EPS) {
    if (!effectiveShortfallOutcome || effectiveShortfallOutcome === "WAIVE_BALANCE") {
      effectiveShortfallOutcome = "CARRY_FORWARD";
    }
  }

  if (!effectiveShortfallOutcome) {
    const err = new Error("Production shortfall detected. Choose how to resolve the remaining quantity.");
    err.statusCode = 409;
    err.code = "WO_EXEC_SHORTFALL_REQUIRED";
    err.shortfall = summary;
    throw err;
  }

  if (effectiveShortfallOutcome === "BLOCK") {
    if (!input.blockReason) {
      const err = new Error("Block reason is required.");
      err.statusCode = 400;
      throw err;
    }
    return blockProductionExecution(tx, workOrderId, {
      blockReason: input.blockReason,
      remarks: input.remarks,
      actorUserId,
      actorRole,
    });
  }

  if (!FINISH_OUTCOMES.includes(effectiveShortfallOutcome)) {
    const err = new Error("Invalid shortfall outcome.");
    err.statusCode = 400;
    throw err;
  }

  const effectiveResolutionReason = defaultAutomaticShortfallResolutionReason(
    effectiveShortfallOutcome,
    resolutionReason,
  );
  validateResolutionReason(effectiveResolutionReason, remarks);

  const now = new Date();
  const carryForwardRecords = [];

  for (const line of summary.lines) {
    if (line.remainderQty <= EPS) continue;

    const auditRow = await writeShortfallResolutionAudit(tx, {
      workOrderId,
      workOrderLineId: line.workOrderLineId,
      plannedQty: line.plannedQty,
      producedQty: line.producedQty,
      remainderQty: line.remainderQty,
      resolutionType: effectiveShortfallOutcome,
      resolutionReason: effectiveResolutionReason,
      remarks,
      actorUserId,
    });

    if (
      !isGreenLevelWorkOrder(wo) &&
      (effectiveShortfallOutcome === "CARRY_FORWARD" || effectiveShortfallOutcome === "WAIVE_BALANCE")
    ) {
      const cf = await createCarryForwardPendingFromProductionShortfall(tx, {
        workOrder: wo,
        workOrderLine: wo.lines.find((l) => l.id === line.workOrderLineId),
        remainderQty: line.remainderQty,
        resolutionReason: effectiveResolutionReason,
        remarks,
        productionShortfallResolutionId: auditRow.id,
        actorUserId,
      });
      carryForwardRecords.push(cf);
    }

    if (effectiveShortfallOutcome === "WAIVE_BALANCE") {
      await tx.workOrderLine.update({
        where: { id: line.workOrderLineId },
        data: { executionWaivedQty: String(round3(line.remainderQty)) },
      });
    }
  }

  await applyWorkOrderExecutionOutcome(tx, workOrderId, {
    outcome: effectiveShortfallOutcome,
  });

  const execution = await tx.workOrderProductionExecution.update({
    where: { workOrderId },
    data: {
      executionStatus: "COMPLETED",
      completedAt: now,
      completedByUserId: actorUserId ?? null,
      lastResolutionType: effectiveShortfallOutcome,
      blockReason: null,
      blockRemarks: null,
      blockedAt: null,
      blockedByUserId: null,
    },
  });

  if (typeof actorUserId === "number") {
    await auditLog.write(tx, {
      action: auditLog.AuditAction.UPDATE,
      entityType: auditLog.AuditEntityType.SETTINGS,
      entityId: `WORK_ORDER:${workOrderId}`,
      actorUserId,
      actorRole,
      summary: `Production execution finished (${effectiveShortfallOutcome}) on WO ${wo.docNo || workOrderId}`,
      payload: {
        module: "PRODUCTION_EXECUTION",
        action: "FINISH_SHORTFALL",
        shortfallOutcome: effectiveShortfallOutcome,
        resolutionReason: effectiveResolutionReason,
        carryForwardCount: carryForwardRecords.length,
      },
      reason: remarks?.trim() || null,
    });
  }

  await reconcileWorkOrderStatusFromProduction(tx, workOrderId, {
    actorUserId,
    actorRole,
    source: "EXECUTION_FINISH_SHORTFALL",
  });

  return {
    execution,
    summary: await computeExecutionSummary(tx, {
      ...wo,
      productionExecution: execution,
      status: "COMPLETED",
    }),
    outcome: effectiveShortfallOutcome,
    carryForwardPending: carryForwardRecords,
    successMessage: buildFinishSuccessMessage(
      wo.docNo,
      workOrderId,
      effectiveShortfallOutcome,
      shortfallRemainderQty,
      0,
      { greenLevel: isGreenLevelWorkOrder(wo) },
    ),
  };
}

/**
 * Effective production pending for dashboard (0 when execution completed).
 */
function getEffectiveProductionPendingQty(plannedQty, producedQty, executionStatus) {
  if (executionStatus === "COMPLETED") return 0;
  if (executionStatus === "SHORTFALL_PENDING") return 0;
  return getWoLineRemainingProductionQty(plannedQty, producedQty);
}

async function getProductionExecutionSummary(db, workOrderId) {
  let wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      lines: { include: { fgItem: { select: { id: true, itemName: true } } } },
      salesOrder: { select: { id: true, docNo: true, orderType: true, customerId: true } },
      productionExecution: true,
    },
  });
  if (!wo) {
    const err = new Error("Work order not found.");
    err.statusCode = 404;
    throw err;
  }
  if (supportsShopFloorExecutionWorkOrder(wo, wo.salesOrder) && !wo.productionExecution) {
    await db.$transaction(async (tx) => {
      await ensureProductionExecutionRecord(tx, workOrderId);
    });
    wo = await db.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        lines: { include: { fgItem: { select: { id: true, itemName: true } } } },
        salesOrder: { select: { id: true, docNo: true, orderType: true, customerId: true } },
        productionExecution: true,
      },
    });
  }
  if (supportsShopFloorExecutionWorkOrder(wo, wo.salesOrder) && wo.productionExecution) {
    await db.$transaction(async (tx) => {
      await reconcileShortfallPendingStatus(tx, wo);
    });
    wo = await db.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        lines: { include: { fgItem: { select: { id: true, itemName: true } } } },
        salesOrder: { select: { id: true, docNo: true, orderType: true, customerId: true } },
        productionExecution: true,
      },
    });
  }
  return computeExecutionSummary(db, wo);
}

module.exports = {
  BLOCK_REASONS,
  RESOLUTION_REASONS,
  FINISH_OUTCOMES,
  blockReasonLabel,
  buildFinishSuccessMessage,
  loadNoQtyExecutionContext,
  ensureProductionExecutionRecord,
  computeExecutionSummary,
  getProductionExecutionSummary,
  assertNoQtyProductionExecutionAllowsProduction,
  blockProductionExecution,
  resumeProductionExecution,
  finishProductionExecution,
  applyWorkOrderExecutionOutcome,
  getEffectiveProductionPendingQty,
  syncShortfallPendingAfterProductionApprove,
  reconcileShortfallPendingStatus,
  productionExecutionPendingActionLabel,
  deriveProductionQueueActionLabel,
  PRODUCTION_EXECUTION_PENDING_LABELS,
};
