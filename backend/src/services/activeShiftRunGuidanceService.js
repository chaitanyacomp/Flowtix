/**
 * Active shift-run next-action guidance for Production operators.
 * OPEN session + ACTIVE run segment overrides "Ready to Start Production".
 */

const { prisma } = require("../utils/prisma");

const ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS = Object.freeze({
  CONFIRM_MACHINE_START: "Confirm Machine Start",
  RECORD_PRODUCTION: "Record Production",
});

const OPEN_ACTIVE_SHIFT_LABEL = "Open Active Shift";

const READY_STYLE_LABELS = new Set([
  "Ready to Start Production",
  "Ready to Start",
  "Continue Production",
  "Production Pending",
  "Start Production",
]);

function n(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function isStartConfirmationPending(startConfirmationStatus) {
  return String(startConfirmationStatus ?? "").trim().toUpperCase() !== "CONFIRMED";
}

/**
 * @param {{
 *   startConfirmationStatus?: string | null;
 *   requiresStartConfirmation?: boolean;
 *   runAllocationId?: number | null;
 * }} input
 */
function resolveActiveShiftRunPrimaryAction(input = {}) {
  const runAllocationId = n(input.runAllocationId);
  const requires =
    input.requiresStartConfirmation != null
      ? Boolean(input.requiresStartConfirmation)
      : runAllocationId > 0;
  if (requires && isStartConfirmationPending(input.startConfirmationStatus)) {
    return ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START;
  }
  return ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION;
}

function buildActiveShiftSessionHref(sessionId) {
  const id = n(sessionId);
  if (!(id > 0)) return "/shift-production";
  return `/shift-production/sessions/${id}`;
}

/**
 * Deep-link into Production Workspace with active shift + run context (does not start a new segment).
 * @param {object} input
 * @param {string} [from]
 */
function buildActiveShiftRunWorkspaceHref(input = {}, from = "dashboard") {
  const workOrderId = n(input.workOrderId);
  const params = new URLSearchParams();
  if (from) {
    params.set("from", from);
    if (from === "pending-actions") params.set("returnTo", "pending-actions");
  }
  if (workOrderId > 0) params.set("workOrderId", String(workOrderId));
  const workOrderLineId = n(input.workOrderLineId);
  if (workOrderLineId > 0) params.set("workOrderLineId", String(workOrderLineId));
  const runAllocationId = n(input.runAllocationId);
  if (runAllocationId > 0) params.set("runAllocationId", String(runAllocationId));
  const shiftSessionId = n(input.shiftSessionId ?? input.sessionId);
  if (shiftSessionId > 0) params.set("shiftSessionId", String(shiftSessionId));
  const runSegmentId = n(input.runSegmentId);
  if (runSegmentId > 0) params.set("runSegmentId", String(runSegmentId));
  const machineId = n(input.machineId);
  if (machineId > 0) params.set("machineId", String(machineId));
  const salesOrderId = n(input.salesOrderId);
  if (salesOrderId > 0) params.set("salesOrderId", String(salesOrderId));
  const cycleId = n(input.cycleId);
  if (cycleId > 0) params.set("cycleId", String(cycleId));
  const orderType = String(input.orderType ?? "").trim().toUpperCase();
  if (orderType) params.set("flow", orderType === "GREEN_LEVEL" ? "GREEN_LEVEL" : orderType);

  params.set("pwSection", "active");
  params.set("productionBucket", "inProgress");

  const primary =
    String(input.primaryActionLabel ?? "").trim() ||
    resolveActiveShiftRunPrimaryAction({
      startConfirmationStatus: input.startConfirmationStatus,
      runAllocationId,
      requiresStartConfirmation: input.requiresStartConfirmation,
    });
  if (primary === ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START) {
    params.set("focusConfirmStart", "1");
  } else {
    params.set("focusRecordProduction", "1");
  }

  return `/production?${params.toString()}`;
}

function formatRunningDurationMs(ms) {
  const totalSec = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * @param {object} segment — Prisma MachineShiftSessionRunSegment with includes
 * @param {Date} [now]
 */
function mapActiveRunSegmentToGuidance(segment, now = new Date()) {
  if (!segment) return null;
  const session = segment.session ?? null;
  if (!session || String(session.status ?? "").toUpperCase() !== "OPEN") return null;
  if (String(segment.status ?? "").toUpperCase() !== "ACTIVE") return null;

  const runAllocation = segment.runAllocation ?? null;
  const runAllocationId = n(segment.runAllocationId ?? runAllocation?.id);
  const workOrderId = n(
    segment.workOrderId ??
      runAllocation?.workOrderId ??
      runAllocation?.workOrder?.id ??
      segment.workOrder?.id,
  );
  const workOrderLineId = n(runAllocation?.workOrderLineId);
  const startConfirmationStatus = runAllocation?.startConfirmation?.status ?? null;
  const requiresStartConfirmation = runAllocationId > 0;
  const primaryActionLabel = resolveActiveShiftRunPrimaryAction({
    startConfirmationStatus,
    runAllocationId,
    requiresStartConfirmation,
  });

  const machine = session.machine ?? null;
  const shift = session.shift ?? null;
  const operator = session.primaryOperator ?? null;
  const startedAtRaw = segment.segmentStartedAt ?? segment.createdAt ?? null;
  const startedAt = startedAtRaw ? new Date(startedAtRaw) : null;
  const runningMs =
    startedAt && Number.isFinite(startedAt.getTime()) ? Math.max(0, now.getTime() - startedAt.getTime()) : 0;

  const workOrderNo =
    String(segment.workOrder?.docNo ?? runAllocation?.workOrder?.docNo ?? "").trim() ||
    (workOrderId > 0 ? `WO-${workOrderId}` : null);

  const base = {
    shiftSessionId: n(segment.sessionId ?? session.id),
    shiftSessionNo: String(session.shiftSessionNo ?? "").trim() || null,
    runSegmentId: n(segment.id),
    segmentNo: n(segment.segmentNo) || 1,
    machineId: n(segment.machineId ?? session.machineId ?? machine?.id),
    machineCode: String(machine?.machineCode ?? "").trim() || null,
    machineName: String(machine?.machineName ?? "").trim() || null,
    shiftId: n(session.shiftId ?? shift?.id) || null,
    shiftCode: String(shift?.shiftCode ?? "").trim() || null,
    shiftName: String(shift?.shiftName ?? "").trim() || null,
    workOrderId,
    workOrderNo,
    workOrderLineId: workOrderLineId > 0 ? workOrderLineId : null,
    runAllocationId: runAllocationId > 0 ? runAllocationId : null,
    operatorId: n(session.primaryOperatorId ?? operator?.id) || null,
    operatorName: String(operator?.operatorName ?? "").trim() || null,
    operatorCode: String(operator?.operatorCode ?? "").trim() || null,
    segmentStartedAt: startedAt ? startedAt.toISOString() : null,
    runningMs,
    runningTimeLabel: formatRunningDurationMs(runningMs),
    startConfirmationStatus: startConfirmationStatus ? String(startConfirmationStatus) : null,
    confirmationPending: requiresStartConfirmation && isStartConfirmationPending(startConfirmationStatus),
    primaryActionLabel,
    secondaryActionLabel: OPEN_ACTIVE_SHIFT_LABEL,
  };

  return {
    ...base,
    workspaceHref: buildActiveShiftRunWorkspaceHref(base, "dashboard"),
    pendingActionsHref: buildActiveShiftRunWorkspaceHref(base, "pending-actions"),
    shiftSessionHref: buildActiveShiftSessionHref(base.shiftSessionId),
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} [db]
 * @param {Date} [now]
 */
async function listActiveShiftRunGuidance(db = prisma, now = new Date()) {
  const segments = await db.machineShiftSessionRunSegment.findMany({
    where: {
      status: "ACTIVE",
      session: { status: "OPEN" },
    },
    orderBy: [{ segmentStartedAt: "desc" }, { id: "desc" }],
    include: {
      session: {
        include: {
          machine: { select: { id: true, machineCode: true, machineName: true } },
          shift: { select: { id: true, shiftCode: true, shiftName: true } },
          primaryOperator: { select: { id: true, operatorName: true, operatorCode: true } },
        },
      },
      workOrder: { select: { id: true, docNo: true } },
      runAllocation: {
        select: {
          id: true,
          workOrderId: true,
          workOrderLineId: true,
          machineId: true,
          startConfirmation: { select: { id: true, status: true } },
          workOrder: { select: { id: true, docNo: true } },
        },
      },
    },
  });

  /** @type {ReturnType<typeof mapActiveRunSegmentToGuidance>[]} */
  const out = [];
  for (const segment of segments) {
    const g = mapActiveRunSegmentToGuidance(segment, now);
    if (g) out.push(g);
  }
  return out;
}

/**
 * @param {Array<object>} list
 * @returns {Map<number, object>}
 */
function indexActiveShiftRunGuidanceByWorkOrderId(list) {
  const map = new Map();
  for (const g of list || []) {
    const woId = n(g?.workOrderId);
    if (!(woId > 0)) continue;
    if (!map.has(woId)) map.set(woId, g);
  }
  return map;
}

function shouldOverrideProductionActionLabel(label) {
  const t = String(label ?? "").trim();
  if (!t) return true;
  if (READY_STYLE_LABELS.has(t)) return true;
  if (t === ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.CONFIRM_MACHINE_START) return true;
  if (t === ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION) return true;
  return false;
}

/**
 * Mutates production-queue rows in place when an ACTIVE shift segment exists for the WO.
 * @param {object[]} rows
 * @param {Array<object>} guidanceList
 */
function attachActiveShiftRunGuidanceToProductionQueueRows(rows, guidanceList) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const byWo = indexActiveShiftRunGuidanceByWorkOrderId(guidanceList);
  if (!byWo.size) return rows;

  for (const row of rows) {
    const woId = n(row?.workOrderId);
    const g = woId > 0 ? byWo.get(woId) : null;
    if (!g) continue;

    // Prefer guidance matching this line's run when workOrderLineId aligns.
    let guidance = g;
    const lineId = n(row?.workOrderLineId);
    if (lineId > 0 && Array.isArray(guidanceList)) {
      const lineMatch = guidanceList.find(
        (x) => n(x.workOrderId) === woId && n(x.workOrderLineId) === lineId,
      );
      if (lineMatch) guidance = lineMatch;
    }

    row.activeShiftRun = guidance;
    if (shouldOverrideProductionActionLabel(row.actionLabel)) {
      row.actionLabel = guidance.primaryActionLabel;
      row.actionHref = guidance.workspaceHref;
    }
    if (String(row.productionWorkState ?? "").toUpperCase() === "READY_TO_START") {
      row.productionWorkState = "CONTINUE_PRODUCTION";
    }
  }
  return rows;
}

/**
 * Overlay Confirm Machine Start / Record Production onto Ready-to-Start pending rows.
 * @param {object[]} actions
 * @param {Array<object>} guidanceList
 */
function applyActiveShiftRunGuidanceToPendingActions(actions, guidanceList) {
  if (!Array.isArray(actions) || !actions.length) return actions || [];
  const byWo = indexActiveShiftRunGuidanceByWorkOrderId(guidanceList);
  if (!byWo.size) return actions;

  return actions.map((action) => {
    const href = String(action?.href ?? "");
    const fromHref = href.match(/[?&]workOrderId=(\d+)/);
    const fromId = String(action?.id ?? "").match(/(?:^|:)wo:(\d+)/);
    const woId = fromHref ? n(fromHref[1]) : fromId ? n(fromId[1]) : 0;
    if (!(woId > 0)) return action;
    const guidance = byWo.get(woId);
    if (!guidance) return action;
    if (!shouldOverrideProductionActionLabel(action.action)) return action;
    return {
      ...action,
      action: guidance.primaryActionLabel,
      href: guidance.pendingActionsHref || buildActiveShiftRunWorkspaceHref(guidance, "pending-actions"),
      activeShiftRun: guidance,
    };
  });
}

module.exports = {
  ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS,
  OPEN_ACTIVE_SHIFT_LABEL,
  applyActiveShiftRunGuidanceToPendingActions,
  attachActiveShiftRunGuidanceToProductionQueueRows,
  buildActiveShiftRunWorkspaceHref,
  buildActiveShiftSessionHref,
  formatRunningDurationMs,
  indexActiveShiftRunGuidanceByWorkOrderId,
  isStartConfirmationPending,
  listActiveShiftRunGuidance,
  mapActiveRunSegmentToGuidance,
  resolveActiveShiftRunPrimaryAction,
  shouldOverrideProductionActionLabel,
};
