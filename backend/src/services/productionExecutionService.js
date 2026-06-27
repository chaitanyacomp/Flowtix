/**
 * NO_QTY Production Execution — shortfall resolution.
 * Production owns execution actions; Work Order lifecycle updates via applyWorkOrderExecutionOutcome only.
 */

const auditLog = require("./auditLog");
const { getApprovedProducedQtyByWorkOrderLineIds } = require("./productionMetrics");
const { getWoLineRemainingProductionQty } = require("./reportMetrics");

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

function isNoQtyWorkOrder(wo, so) {
  return so?.orderType === "NO_QTY" || wo?.requirementSheetId != null || wo?.cycleId != null;
}

function blockReasonLabel(reason) {
  return String(reason ?? "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildFinishSuccessMessage(woDocNo, workOrderId, outcome, remainderQty, surplusQty = 0) {
  const label = (woDocNo && String(woDocNo).trim()) || `WO-${workOrderId}`;
  const rem = round3(remainderQty);
  const surplus = round3(surplusQty);
  if (outcome === "WAIVE_BALANCE") {
    return `${label} closed. Remaining ${rem} qty waived/cancelled.`;
  }
  if (outcome === "CARRY_FORWARD") {
    return `${label} closed. Remaining ${rem} qty carried forward.`;
  }
  if (outcome === "FULL_COMPLETE") {
    if (surplus > EPS) {
      return `Production completed successfully. Extra Production: ${surplus} Qty. Work Order ${label} closed.`;
    }
    return `Production completed successfully. Work Order ${label} closed.`;
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
  if (!isNoQtyWorkOrder(wo, wo.salesOrder)) {
    const err = new Error("Production execution shortfall resolution applies to NO_QTY work orders only.");
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
  return {
    workOrderId: wo.id,
    workOrderDocNo: wo.docNo,
    workOrderStatus: wo.status,
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
 * Blocks production entry when execution is BLOCKED or COMPLETED.
 */
async function assertNoQtyProductionExecutionAllowsProduction(tx, workOrderId) {
  const wo = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      requirementSheetId: true,
      cycleId: true,
      status: true,
      salesOrder: { select: { orderType: true } },
      productionExecution: { select: { executionStatus: true, blockReason: true } },
    },
  });
  if (!wo || !isNoQtyWorkOrder(wo, wo.salesOrder)) return;

  const exec = wo.productionExecution;
  if (!exec) return;

  if (exec.executionStatus === "BLOCKED") {
    const err = new Error(
      `Production is blocked (${blockReasonLabel(exec.blockReason)}). Resume production before recording new batches.`,
    );
    err.statusCode = 409;
    err.code = "WO_EXEC_BLOCKED";
    throw err;
  }
  if (exec.executionStatus === "SHORTFALL_PENDING") {
    const err = new Error(
      "Production shortfall decision is pending. Choose Waive, Carry Forward, or Pause before recording more production.",
    );
    err.statusCode = 409;
    err.code = "WO_EXEC_SHORTFALL_DECISION_REQUIRED";
    throw err;
  }
  if (exec.executionStatus === "COMPLETED") {
    const err = new Error("Production execution is finished for this work order. No further production is allowed.");
    err.statusCode = 409;
    err.code = "WO_EXEC_COMPLETED";
    throw err;
  }
  if (wo.status === "COMPLETED" || wo.status === "REJECTED") {
    const err = new Error("Work order is closed. No further production is allowed.");
    err.statusCode = 409;
    err.code = "WO_TERMINAL";
    throw err;
  }
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
 * Workflow engine: apply Work Order outcome after Production execution decision.
 */
async function applyWorkOrderExecutionOutcome(tx, workOrderId, { outcome, actorUserId, actorRole }) {
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
    await tx.workOrder.update({
      where: { id: workOrderId },
      data: { status: "COMPLETED" },
    });
    if (typeof actorUserId === "number") {
      await auditLog.write(tx, {
        action: auditLog.AuditAction.UPDATE,
        entityType: auditLog.AuditEntityType.SETTINGS,
        entityId: `WORK_ORDER:${workOrderId}`,
        actorUserId,
        actorRole,
        summary: `Work order ${wo.docNo || workOrderId} marked COMPLETED after production execution ${outcome}`,
        payload: { module: "PRODUCTION_EXECUTION", outcome },
      });
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

async function createCarryForwardPendingFromLine(tx, {
  wo,
  line,
  remainderQty,
  resolutionReason,
  remarks,
  resolutionAuditId,
  actorUserId,
}) {
  return tx.carryForwardPending.create({
    data: {
      itemId: line.fgItemId,
      salesOrderId: wo.salesOrderId,
      sourceRequirementSheetId: wo.requirementSheetId ?? null,
      sourceWorkOrderId: wo.id,
      cycleId: wo.cycleId ?? null,
      remainingQty: String(round3(remainderQty)),
      resolutionReason,
      resolutionReasonOther: resolutionReason === "OTHER" ? String(remarks ?? "").trim() : null,
      remarks: remarks?.trim() || null,
      status: "PENDING",
      createdByUserId: actorUserId ?? null,
      productionShortfallResolutionId: resolutionAuditId,
    },
  });
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
      actorUserId,
      actorRole,
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

  // Shortfall — require explicit outcome
  if (!shortfallOutcome) {
    const err = new Error("Production shortfall detected. Choose how to resolve the remaining quantity.");
    err.statusCode = 409;
    err.code = "WO_EXEC_SHORTFALL_REQUIRED";
    err.shortfall = summary;
    throw err;
  }

  if (shortfallOutcome === "BLOCK") {
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

  if (!FINISH_OUTCOMES.includes(shortfallOutcome)) {
    const err = new Error("Invalid shortfall outcome.");
    err.statusCode = 400;
    throw err;
  }

  validateResolutionReason(resolutionReason, remarks);

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
      resolutionType: shortfallOutcome,
      resolutionReason,
      remarks,
      actorUserId,
    });

    if (shortfallOutcome === "CARRY_FORWARD") {
      const cf = await createCarryForwardPendingFromLine(tx, {
        wo,
        line: wo.lines.find((l) => l.id === line.workOrderLineId),
        remainderQty: line.remainderQty,
        resolutionReason,
        remarks,
        resolutionAuditId: auditRow.id,
        actorUserId,
      });
      carryForwardRecords.push(cf);
    }

    if (shortfallOutcome === "WAIVE_BALANCE") {
      await tx.workOrderLine.update({
        where: { id: line.workOrderLineId },
        data: { executionWaivedQty: String(round3(line.remainderQty)) },
      });
    }
  }

  await applyWorkOrderExecutionOutcome(tx, workOrderId, {
    outcome: shortfallOutcome,
    actorUserId,
    actorRole,
  });

  const execution = await tx.workOrderProductionExecution.update({
    where: { workOrderId },
    data: {
      executionStatus: "COMPLETED",
      completedAt: now,
      completedByUserId: actorUserId ?? null,
      lastResolutionType: shortfallOutcome,
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
      summary: `Production execution finished (${shortfallOutcome}) on WO ${wo.docNo || workOrderId}`,
      payload: {
        module: "PRODUCTION_EXECUTION",
        action: "FINISH_SHORTFALL",
        shortfallOutcome,
        resolutionReason,
        carryForwardCount: carryForwardRecords.length,
      },
      reason: remarks?.trim() || null,
    });
  }

  return {
    execution,
    summary: await computeExecutionSummary(tx, {
      ...wo,
      productionExecution: execution,
      status: "COMPLETED",
    }),
    outcome: shortfallOutcome,
    carryForwardPending: carryForwardRecords,
    successMessage: buildFinishSuccessMessage(
      wo.docNo,
      workOrderId,
      shortfallOutcome,
      shortfallRemainderQty,
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
  if (isNoQtyWorkOrder(wo, wo.salesOrder) && !wo.productionExecution) {
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
  if (isNoQtyWorkOrder(wo, wo.salesOrder) && wo.productionExecution) {
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
