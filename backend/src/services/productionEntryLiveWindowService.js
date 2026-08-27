/**
 * Normal live Production Entry window: OPEN session + ACTIVE segment + now <= live cutoff.
 *
 * Context is resolved server-side. A missing client runAllocationId never implies
 * legacy skip. Legacy is allowed only when the server proves there is no
 * shift-linked run/session applicable to this WO / WO line / machine.
 *
 * RM, max-qty, WO, and material gates run after this gate.
 */

const { domainError } = require("./machineShiftSessionErrors");
const {
  reconcileSessionExpiry,
  throwLiveWindowEnded,
  evaluateLiveWindow,
  SESSION_STATUS,
  asDate,
} = require("./shiftSessionTimeWindowService");

const SEGMENT_ACTIVE = "ACTIVE";
const SEGMENT_CLOSED = "CLOSED";

const LIVE_GATE_CODES = Object.freeze({
  SHIFT_LIVE_WINDOW_ENDED: "SHIFT_LIVE_WINDOW_ENDED",
  SHIFT_RUN_CONTEXT_AMBIGUOUS: "SHIFT_RUN_CONTEXT_AMBIGUOUS",
  SHIFT_RUN_CONTEXT_REQUIRED: "SHIFT_RUN_CONTEXT_REQUIRED",
  SHIFT_RUN_CONTEXT_CONFLICT: "SHIFT_RUN_CONTEXT_CONFLICT",
  SHIFT_RUN_INACTIVE: "SHIFT_RUN_INACTIVE",
});

function n(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function statusOf(row) {
  return String(row?.status || "").trim().toUpperCase();
}

function throwContextAmbiguous(details) {
  throw domainError(
    409,
    LIVE_GATE_CODES.SHIFT_RUN_CONTEXT_AMBIGUOUS,
    "Select the production run. More than one shift run matches this work order.",
    details,
  );
}

function throwContextRequired(details) {
  throw domainError(
    409,
    LIVE_GATE_CODES.SHIFT_RUN_CONTEXT_REQUIRED,
    "Select the production run for this shift. The server could not uniquely resolve it.",
    details,
  );
}

function throwContextConflict(details) {
  throw domainError(
    409,
    LIVE_GATE_CODES.SHIFT_RUN_CONTEXT_CONFLICT,
    "The selected production run does not match this work order, line, or machine.",
    details,
  );
}

function throwRunInactive(session, extra = {}) {
  throw domainError(
    409,
    LIVE_GATE_CODES.SHIFT_RUN_INACTIVE,
    "This shift run is no longer active. Live production cannot be recorded on a closed or cancelled shift.",
    {
      sessionId: session?.id ?? null,
      shiftSessionNo: session?.shiftSessionNo ?? null,
      status: session?.status ?? extra.status ?? null,
      ...extra,
    },
  );
}

function modelsAvailable(tx) {
  return (
    typeof tx?.machineShiftSession?.findUnique === "function" &&
    typeof tx?.machineShiftSessionRunSegment?.findMany === "function"
  );
}

async function loadAllocation(tx, runAllocationId) {
  if (!n(runAllocationId) || typeof tx.workOrderProductionRunAllocation?.findUnique !== "function") {
    return null;
  }
  return tx.workOrderProductionRunAllocation.findUnique({
    where: { id: n(runAllocationId) },
    select: {
      id: true,
      workOrderId: true,
      workOrderLineId: true,
      fgItemId: true,
      machineId: true,
      isActive: true,
    },
  });
}

async function listAllocationsForWorkOrder(tx, workOrderId) {
  if (!n(workOrderId) || typeof tx.workOrderProductionRunAllocation?.findMany !== "function") {
    return [];
  }
  const rows = await tx.workOrderProductionRunAllocation.findMany({
    where: { workOrderId: n(workOrderId) },
  });
  return Array.isArray(rows) ? rows : [];
}

function allocationMatchesLineAndFg(allocation, { workOrderLineId, fgItemId }) {
  if (!allocation) return false;
  const lineId = n(workOrderLineId);
  const fg = n(fgItemId);
  if (lineId && allocation.workOrderLineId != null && n(allocation.workOrderLineId) !== lineId) {
    return false;
  }
  if (fg && allocation.fgItemId != null && n(allocation.fgItemId) !== fg) {
    return false;
  }
  return true;
}

function assertSuppliedAllocationContext(allocation, ctx) {
  if (!allocation) {
    throw domainError(404, "RUN_ALLOCATION_NOT_FOUND", "Production run allocation was not found.");
  }
  if (allocation.isActive === false) {
    throw domainError(
      409,
      "RUN_ALLOCATION_INACTIVE",
      "This planned machine run is inactive and cannot receive production entries.",
    );
  }
  if (n(ctx.workOrderId) && n(allocation.workOrderId) !== n(ctx.workOrderId)) {
    throw domainError(
      409,
      "RUN_ALLOCATION_WO_MISMATCH",
      "Run allocation does not belong to this work order.",
    );
  }
  if (
    n(ctx.workOrderLineId) &&
    allocation.workOrderLineId != null &&
    n(allocation.workOrderLineId) !== n(ctx.workOrderLineId)
  ) {
    throwContextConflict({
      reason: "WOL_MISMATCH",
      runAllocationId: allocation.id,
      workOrderLineId: ctx.workOrderLineId,
      allocationWorkOrderLineId: allocation.workOrderLineId,
    });
  }
  if (n(ctx.fgItemId) && allocation.fgItemId != null && n(allocation.fgItemId) !== n(ctx.fgItemId)) {
    throw domainError(
      409,
      "RUN_ALLOCATION_FG_MISMATCH",
      "Run allocation does not belong to this FG line.",
    );
  }
  if (n(ctx.claimedMachineId) && n(allocation.machineId) !== n(ctx.claimedMachineId)) {
    throw domainError(
      409,
      "RUN_ALLOCATION_MACHINE_MISMATCH",
      "Assigned machine does not match the planned run allocation.",
    );
  }
}

async function listSegmentsRaw(tx, where) {
  if (typeof tx.machineShiftSessionRunSegment?.findMany !== "function") return [];
  const rows = await tx.machineShiftSessionRunSegment.findMany({
    where,
    orderBy: { id: "desc" },
  });
  return Array.isArray(rows) ? rows : [];
}

async function loadSession(tx, sessionId, now) {
  if (!n(sessionId) || typeof tx.machineShiftSession?.findUnique !== "function") return null;
  let session = await tx.machineShiftSession.findUnique({ where: { id: n(sessionId) } });
  if (!session) return null;
  return reconcileSessionExpiry(tx, session, now);
}

function segmentLinkedToWorkOrder(segment, workOrderId, allocationIds) {
  if (n(segment.workOrderId) === n(workOrderId)) return true;
  if (n(segment.runAllocationId) && allocationIds.has(n(segment.runAllocationId))) return true;
  return false;
}

function rowKey(row) {
  return `${n(row.session?.id) || 0}:${n(row.segment?.id) || 0}`;
}

function isOperationalStatus(status) {
  return status === SESSION_STATUS.OPEN || status === SESSION_STATUS.HANDOVER_PENDING;
}

function isInactiveStatus(status) {
  return status === SESSION_STATUS.SHIFT_OVER || status === SESSION_STATUS.CANCELLED;
}

function filterByClaimedMachine(rows, claimedMachineId) {
  const machineId = n(claimedMachineId);
  if (!machineId) return rows;
  return rows.filter((row) => n(row.segment?.machineId) === machineId || n(row.session?.machineId) === machineId);
}

function preferActiveSegment(rows) {
  const active = rows.filter((row) => statusOf(row.segment) === SEGMENT_ACTIVE);
  return active.length ? active : rows;
}

function uniqueOperationalOrThrow(rows, { suppliedAllocationId }) {
  const operational = preferActiveSegment(rows.filter((row) => isOperationalStatus(statusOf(row.session))));
  const byKey = new Map();
  for (const row of operational) byKey.set(rowKey(row), row);
  const unique = [...byKey.values()];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) {
    throwContextAmbiguous({
      matchCount: unique.length,
      sessionIds: unique.map((r) => r.session?.id).filter(Boolean),
      runAllocationIds: unique.map((r) => r.segment?.runAllocationId).filter((id) => id != null),
      suppliedAllocationId: suppliedAllocationId ?? null,
    });
  }
  return null;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   workOrderId: number,
 *   workOrderLineId?: number|null,
 *   fgItemId?: number|null,
 *   runAllocationId?: number|null,
 *   claimedMachineId?: number|null,
 *   now?: Date,
 * }} input
 */
async function resolveLinkedShiftSessionForLiveGate(tx, input = {}) {
  const now = asDate(input.now) || new Date();
  const workOrderId = n(input.workOrderId);
  const workOrderLineId = n(input.workOrderLineId);
  const fgItemId = n(input.fgItemId);
  const claimedMachineId = n(input.claimedMachineId);
  const suppliedAllocationId = n(input.runAllocationId);

  if (!workOrderId) {
    return { skipped: true, session: null, segment: null, machineId: null, reason: "NO_WORK_ORDER" };
  }
  if (!modelsAvailable(tx)) {
    return { skipped: true, session: null, segment: null, machineId: null, reason: "SHIFT_MODELS_UNAVAILABLE" };
  }

  const allocations = (await listAllocationsForWorkOrder(tx, workOrderId)).filter((a) =>
    allocationMatchesLineAndFg(a, { workOrderLineId, fgItemId }),
  );
  const allocationIds = new Set(allocations.map((a) => n(a.id)).filter(Boolean));

  let suppliedAllocation = null;
  if (suppliedAllocationId) {
    suppliedAllocation = await loadAllocation(tx, suppliedAllocationId);
    assertSuppliedAllocationContext(suppliedAllocation, {
      workOrderId,
      workOrderLineId,
      fgItemId,
      claimedMachineId,
    });
    allocationIds.add(n(suppliedAllocation.id));
  }

  const [byWo, byAlloc] = await Promise.all([
    listSegmentsRaw(tx, { workOrderId }),
    allocationIds.size
      ? listSegmentsRaw(tx, { runAllocationId: { in: [...allocationIds] } })
      : Promise.resolve([]),
  ]);
  const seenSeg = new Set();
  const segments = [];
  for (const seg of [...byWo, ...byAlloc]) {
    if (!seg || seenSeg.has(seg.id)) continue;
    if (!segmentLinkedToWorkOrder(seg, workOrderId, allocationIds)) continue;
    seenSeg.add(seg.id);
    segments.push(seg);
  }
  segments.sort((a, b) => Number(b.id) - Number(a.id));

  const linked = [];
  for (const segment of segments) {
    const session = await loadSession(tx, segment.sessionId, now);
    if (!session) continue;
    linked.push({ segment, session, allocation: suppliedAllocation });
  }

  const lineFiltered = linked.filter((row) => {
    const allocId = n(row.segment.runAllocationId);
    if (!allocId || !workOrderLineId) return true;
    const alloc = allocations.find((a) => n(a.id) === allocId) || suppliedAllocation;
    if (!alloc || alloc.workOrderLineId == null) return true;
    return n(alloc.workOrderLineId) === workOrderLineId;
  });

  let candidates = filterByClaimedMachine(lineFiltered, claimedMachineId);
  if (claimedMachineId) {
    const claimedOperational = candidates.filter((row) => isOperationalStatus(statusOf(row.session)));
    const otherOperational = lineFiltered.filter(
      (row) => isOperationalStatus(statusOf(row.session)) && n(row.segment?.machineId) !== claimedMachineId,
    );
    if (claimedOperational.length === 0 && otherOperational.length) {
      throwContextConflict({
        reason: "MACHINE_MISMATCH",
        claimedMachineId,
        operationalMachineId: otherOperational[0].segment?.machineId ?? null,
        sessionId: otherOperational[0].session?.id ?? null,
      });
    }
  }
  if (suppliedAllocationId) {
    const forAlloc = candidates.filter((row) => {
      const segAlloc = n(row.segment.runAllocationId);
      if (segAlloc) return segAlloc === suppliedAllocationId;
      return (
        n(row.segment.workOrderId) === workOrderId &&
        n(row.segment.machineId) === n(suppliedAllocation.machineId)
      );
    });
    const otherOperational = candidates.filter(
      (row) =>
        isOperationalStatus(statusOf(row.session)) &&
        n(row.segment.runAllocationId) != null &&
        n(row.segment.runAllocationId) !== suppliedAllocationId,
    );
    if (forAlloc.filter((row) => isOperationalStatus(statusOf(row.session))).length === 0 && otherOperational.length) {
      throwContextConflict({
        reason: "ALLOCATION_MISMATCH",
        suppliedAllocationId,
        operationalRunAllocationId: otherOperational[0].segment.runAllocationId,
        sessionId: otherOperational[0].session?.id ?? null,
      });
    }
    candidates = forAlloc;
  }

  const operationalMatch = uniqueOperationalOrThrow(candidates, {
    suppliedAllocationId,
  });
  if (operationalMatch) {
    return {
      skipped: false,
      session: operationalMatch.session,
      segment: operationalMatch.segment,
      machineId: n(operationalMatch.segment.machineId) || n(operationalMatch.session.machineId),
      workOrderId,
      runAllocationId: n(operationalMatch.segment.runAllocationId) || suppliedAllocationId,
    };
  }

  const inactive = candidates.filter((row) => isInactiveStatus(statusOf(row.session)) || statusOf(row.segment) === SEGMENT_CLOSED);
  if (inactive.length) {
    const latest = inactive[0];
    throwRunInactive(latest.session, {
      reason: "STALE_SEGMENT",
      segmentId: latest.segment?.id ?? null,
      segmentStatus: latest.segment?.status ?? null,
    });
  }

  if (suppliedAllocationId) {
    const machineId = n(suppliedAllocation.machineId);
    let session = await tx.machineShiftSession.findFirst({
      where: { machineId, status: SESSION_STATUS.OPEN },
      orderBy: { id: "desc" },
    });
    if (session) session = await reconcileSessionExpiry(tx, session, now);
    if (session && isOperationalStatus(statusOf(session))) {
      const sessionSegs = linked.filter((row) => n(row.session?.id) === n(session.id));
      const matching = sessionSegs.filter(
        (row) =>
          n(row.segment.workOrderId) === workOrderId ||
          n(row.segment.runAllocationId) === suppliedAllocationId,
      );
      if (matching.length) {
        throwContextRequired({
          reason: "SESSION_WITHOUT_RESOLVED_SEGMENT",
          sessionId: session.id,
          suppliedAllocationId,
        });
      }
    }
    return {
      skipped: true,
      session: null,
      segment: null,
      machineId,
      workOrderId,
      runAllocationId: suppliedAllocationId,
      reason: "ALLOCATION_NOT_SHIFT_LINKED",
    };
  }

  if (linked.length) {
    throwContextRequired({
      reason: "SHIFT_LINKED_BUT_UNRESOLVED",
      workOrderId,
      segmentCount: linked.length,
    });
  }

  return {
    skipped: true,
    session: null,
    segment: null,
    machineId: claimedMachineId,
    workOrderId,
    runAllocationId: null,
    reason: "NO_SHIFT_LINKED_RUN",
  };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   workOrderId: number,
 *   workOrderLineId?: number|null,
 *   fgItemId?: number|null,
 *   runAllocationId?: number|null,
 *   claimedMachineId?: number|null,
 *   now?: Date,
 * }} input
 * @returns {Promise<{ skipped: boolean, session?: object|null, segment?: object|null }>}
 */
async function assertNormalLiveProductionEntryAllowed(tx, input = {}) {
  const now = asDate(input.now) || new Date();
  const linked = await resolveLinkedShiftSessionForLiveGate(tx, { ...input, now });
  if (linked.skipped) {
    return { skipped: true, session: null, runAllocationId: linked.runAllocationId ?? null };
  }

  const session = linked.session;
  const status = statusOf(session);
  if (status === SESSION_STATUS.HANDOVER_PENDING) {
    throwLiveWindowEnded(session);
  }
  if (isInactiveStatus(status)) {
    throwRunInactive(session);
  }
  if (status !== SESSION_STATUS.OPEN) {
    throwLiveWindowEnded(session);
  }

  const live = evaluateLiveWindow(session, now);
  if (live.liveCutoffAt && !live.liveOpen) {
    const expired = await reconcileSessionExpiry(tx, session, now);
    throwLiveWindowEnded(expired || session);
  }

  const activeSegment = linked.segment;
  if (!activeSegment || statusOf(activeSegment) !== SEGMENT_ACTIVE) {
    throwRunInactive(session, { reason: "NO_ACTIVE_RUN_SEGMENT", segmentStatus: activeSegment?.status ?? null });
  }

  const workOrderId = n(input.workOrderId);
  if (workOrderId && n(activeSegment.workOrderId) && n(activeSegment.workOrderId) !== workOrderId) {
    throwContextConflict({
      reason: "ACTIVE_RUN_WO_MISMATCH",
      sessionId: session.id,
      segmentWorkOrderId: activeSegment.workOrderId,
      workOrderId,
    });
  }

  const suppliedAllocationId = n(input.runAllocationId);
  const segAlloc = n(activeSegment.runAllocationId);
  if (suppliedAllocationId && segAlloc && segAlloc !== suppliedAllocationId) {
    throwContextConflict({
      reason: "ACTIVE_RUN_ALLOCATION_MISMATCH",
      sessionId: session.id,
      suppliedAllocationId,
      segmentRunAllocationId: segAlloc,
    });
  }

  return {
    skipped: false,
    session,
    segment: activeSegment,
    runAllocationId: segAlloc || suppliedAllocationId,
  };
}

module.exports = {
  LIVE_GATE_CODES,
  resolveLinkedShiftSessionForLiveGate,
  assertNormalLiveProductionEntryAllowed,
};
