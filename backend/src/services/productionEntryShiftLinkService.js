/**
 * Resolve ProductionEntry → MachineShiftSession / run segment (best-effort, non-blocking).
 * Never trusts client-supplied shift session or segment IDs.
 */

const SESSION_OPEN = "OPEN";
const SEGMENT_ACTIVE = "ACTIVE";

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ workOrderId: number, runAllocationId?: number | null }} input
 * @returns {Promise<{ shiftSessionId: number, shiftRunSegmentId: number } | null>}
 */
async function resolveShiftLinkForProductionEntry(tx, input) {
  const workOrderId = Number(input?.workOrderId);
  const runAllocationId =
    input?.runAllocationId == null || input.runAllocationId === ""
      ? null
      : Number(input.runAllocationId);

  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    return null;
  }

  let machineId = null;
  let resolvedWorkOrderId = workOrderId;

  if (runAllocationId != null && Number.isInteger(runAllocationId) && runAllocationId > 0) {
    const allocation = await tx.workOrderProductionRunAllocation.findUnique({
      where: { id: runAllocationId },
      select: { id: true, workOrderId: true, machineId: true, isActive: true },
    });
    if (!allocation || allocation.isActive === false) {
      return null;
    }
    if (Number(allocation.workOrderId) !== workOrderId) {
      return null;
    }
    machineId = Number(allocation.machineId);
    resolvedWorkOrderId = Number(allocation.workOrderId);
  } else {
    // Legacy / no allocation: only safe when exactly one ACTIVE segment for this WO
    // and that segment itself has no runAllocationId (no allocation conflict).
    const activeForWo = await tx.machineShiftSessionRunSegment.findMany({
      where: { workOrderId: resolvedWorkOrderId, status: SEGMENT_ACTIVE },
      select: { id: true, machineId: true, sessionId: true, runAllocationId: true, workOrderId: true },
      orderBy: { id: "desc" },
    });
    if (activeForWo.length !== 1) {
      return null;
    }
    const only = activeForWo[0];
    if (only.runAllocationId != null) {
      return null;
    }
    machineId = Number(only.machineId);
  }

  if (!Number.isInteger(machineId) || machineId <= 0) {
    return null;
  }

  const openSession = await tx.machineShiftSession.findFirst({
    where: { machineId, status: SESSION_OPEN },
    orderBy: { id: "desc" },
    select: { id: true, machineId: true, status: true },
  });
  if (!openSession) {
    return null;
  }

  const activeSegment = await tx.machineShiftSessionRunSegment.findFirst({
    where: {
      machineId,
      sessionId: openSession.id,
      status: SEGMENT_ACTIVE,
    },
    orderBy: { id: "desc" },
    select: {
      id: true,
      sessionId: true,
      machineId: true,
      workOrderId: true,
      runAllocationId: true,
      status: true,
    },
  });
  if (!activeSegment) {
    return null;
  }

  if (runAllocationId != null) {
    if (Number(activeSegment.runAllocationId) === runAllocationId) {
      return { shiftSessionId: openSession.id, shiftRunSegmentId: activeSegment.id };
    }
    // Soft fallback: same WO on the active segment with no conflicting allocation
    if (
      Number(activeSegment.workOrderId) === resolvedWorkOrderId &&
      activeSegment.runAllocationId == null
    ) {
      return { shiftSessionId: openSession.id, shiftRunSegmentId: activeSegment.id };
    }
    return null;
  }

  // PE without allocation — segment must also be WO-only (no allocation)
  if (
    Number(activeSegment.workOrderId) === resolvedWorkOrderId &&
    activeSegment.runAllocationId == null
  ) {
    return { shiftSessionId: openSession.id, shiftRunSegmentId: activeSegment.id };
  }

  return null;
}

/**
 * Apply best-effort link at ProductionEntry create (DRAFT). Non-blocking.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ workOrderId: number, runAllocationId?: number | null }} input
 */
async function resolveShiftLinkFieldsForCreate(tx, input) {
  const link = await resolveShiftLinkForProductionEntry(tx, input);
  if (!link) return {};
  return {
    shiftSessionId: link.shiftSessionId,
    shiftRunSegmentId: link.shiftRunSegmentId,
  };
}

/**
 * On approve: preserve existing valid historical link; if both null, best-effort ACTIVE match.
 * Never replaces an existing link with a newer session.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ id: number, shiftSessionId?: number | null, shiftRunSegmentId?: number | null, runAllocationId?: number | null, workOrderLine?: { workOrderId: number } }} prod
 */
async function ensureShiftLinkOnProductionEntryApprove(tx, prod) {
  const existingSessionId = prod.shiftSessionId != null ? Number(prod.shiftSessionId) : null;
  const existingSegmentId = prod.shiftRunSegmentId != null ? Number(prod.shiftRunSegmentId) : null;

  if (
    Number.isInteger(existingSessionId) &&
    existingSessionId > 0 &&
    Number.isInteger(existingSegmentId) &&
    existingSegmentId > 0
  ) {
    // Preserve historical link even if segment/session has closed.
    return {
      preserved: true,
      shiftSessionId: existingSessionId,
      shiftRunSegmentId: existingSegmentId,
    };
  }

  // Partial or missing — only best-effort when both are null
  if (existingSessionId || existingSegmentId) {
    return {
      preserved: true,
      shiftSessionId: existingSessionId,
      shiftRunSegmentId: existingSegmentId,
    };
  }

  const workOrderId = Number(prod.workOrderLine?.workOrderId);
  const runAllocationId = prod.runAllocationId != null ? Number(prod.runAllocationId) : null;
  const link = await resolveShiftLinkForProductionEntry(tx, { workOrderId, runAllocationId });
  if (!link) {
    return { preserved: false, shiftSessionId: null, shiftRunSegmentId: null };
  }

  await tx.productionEntry.update({
    where: { id: prod.id },
    data: {
      shiftSessionId: link.shiftSessionId,
      shiftRunSegmentId: link.shiftRunSegmentId,
    },
  });

  return {
    preserved: false,
    linked: true,
    shiftSessionId: link.shiftSessionId,
    shiftRunSegmentId: link.shiftRunSegmentId,
  };
}

/**
 * UI-safe linkage summary for a production entry row.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} db
 * @param {{ shiftSessionId?: number | null, shiftRunSegmentId?: number | null }} entry
 */
async function buildProductionEntryShiftLinkSummary(db, entry) {
  const sessionId = entry?.shiftSessionId != null ? Number(entry.shiftSessionId) : null;
  const segmentId = entry?.shiftRunSegmentId != null ? Number(entry.shiftRunSegmentId) : null;
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return {
      linked: false,
      shiftSessionId: null,
      shiftSessionNo: null,
      shiftRunSegmentId: null,
      shiftRunSegmentLabel: null,
    };
  }

  const session = await db.machineShiftSession.findUnique({
    where: { id: sessionId },
    select: { id: true, shiftSessionNo: true },
  });
  let segmentLabel = null;
  if (Number.isInteger(segmentId) && segmentId > 0) {
    const seg = await db.machineShiftSessionRunSegment.findUnique({
      where: { id: segmentId },
      select: {
        id: true,
        segmentNo: true,
        status: true,
        workOrder: { select: { docNo: true } },
      },
    });
    if (seg) {
      const wo = seg.workOrder?.docNo ? String(seg.workOrder.docNo) : null;
      segmentLabel = wo
        ? `Run ${seg.segmentNo} · ${wo}`
        : `Run ${seg.segmentNo}`;
    }
  }

  return {
    linked: Boolean(session),
    shiftSessionId: session?.id ?? sessionId,
    shiftSessionNo: session?.shiftSessionNo ?? null,
    shiftRunSegmentId: segmentId,
    shiftRunSegmentLabel: segmentLabel,
  };
}

module.exports = {
  resolveShiftLinkForProductionEntry,
  resolveShiftLinkFieldsForCreate,
  ensureShiftLinkOnProductionEntryApprove,
  buildProductionEntryShiftLinkSummary,
};
