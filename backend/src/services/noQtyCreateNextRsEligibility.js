/**
 * NO_QTY: When operators may create the next cycle's requirement sheet — rolling / demand-driven planning.
 * Independent of dispatch, billing, export, QC completion, and WO line completion.
 *
 * Cycle scope: evaluate using a concrete `SalesOrderCycle` row that belongs to the SO (`cycleId` + `salesOrderId`).
 * Callers resolve the evaluation cycle via {@link resolveNoQtyEligibilityCycleId} (ACTIVE, pointer, or latest CLOSED
 * when between cycles). Do not require `SalesOrder.currentCycleId` to match — stale / null pointers must not alone
 * yield `NO_CYCLE` for eligibility reads.
 *
 * Eligible when (evaluated cycle):
 * 1) Current cycle has a LOCKED requirement sheet
 * 2) No LOCKED requirement sheet exists on any non-CLOSED cycle with cycleNo strictly greater than current
 *    (DRAFT-only rows do not block advancing — stale drafts must not prevent closing the active cycle;
 *     LOCKED sheets on CLOSED higher cycles are historical artifacts and do not block rolling planning.)
 *
 * Not eligible: NOT_NO_QTY, SO closed, invalid cycle, no locked RS on that cycle, or a non-closed later cycle already has a LOCKED RS.
 */

/**
 * Same cycle resolution as prepare-next-requirement-sheet: prefer ACTIVE cycle (highest cycleNo),
 * else fall back to SO.currentCycleId if that row still exists for this SO,
 * else (read-path only) latest CLOSED cycle when the SO is between cycles (pointer null after auto-close).
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} salesOrderId
 * @returns {Promise<{ cycleId: number | null; source: "ACTIVE" | "POINTER_FALLBACK" | "BETWEEN_CYCLES_CLOSED" | "NONE" | "INVALID_SO" }>}
 */
async function resolveNoQtyEligibilityCycleId(db, salesOrderId) {
  const soId = Number(salesOrderId);
  if (!Number.isFinite(soId) || soId <= 0) {
    return { cycleId: null, source: "INVALID_SO" };
  }

  const active = await db.salesOrderCycle.findFirst({
    where: { salesOrderId: soId, status: "ACTIVE" },
    orderBy: { cycleNo: "desc" },
    select: { id: true },
  });
  if (active?.id != null) {
    return { cycleId: Number(active.id), source: "ACTIVE" };
  }

  const so = await db.salesOrder.findUnique({
    where: { id: soId },
    select: { currentCycleId: true, orderType: true, internalStatus: true },
  });
  const cid = so?.currentCycleId != null ? Number(so.currentCycleId) : null;
  if (cid != null && Number.isFinite(cid) && cid > 0) {
    const row = await db.salesOrderCycle.findFirst({
      where: { id: cid, salesOrderId: soId },
      select: { id: true },
    });
    if (row?.id != null) {
      return { cycleId: Number(row.id), source: "POINTER_FALLBACK" };
    }
  }

  // Between cycles: no ACTIVE row; SO pointer often null after maybeAutoCloseNoQtyCycle (cycle CLOSED, bill finalized).
  // Evaluate Create Next RS eligibility against the latest CLOSED cycle — read-only interpretation (no writes).
  if (
    so?.orderType === "NO_QTY" &&
    !["COMPLETED", "CLOSED", "MANUALLY_CLOSED"].includes(String(so.internalStatus ?? ""))
  ) {
    const latestClosed = await db.salesOrderCycle.findFirst({
      where: { salesOrderId: soId, status: "CLOSED" },
      orderBy: { cycleNo: "desc" },
      select: { id: true },
    });
    if (latestClosed?.id != null) {
      return { cycleId: Number(latestClosed.id), source: "BETWEEN_CYCLES_CLOSED" };
    }
  }

  return { cycleId: null, source: "NONE" };
}

/**
 * List / Dashboard / flow-state: eligibility using the same cycle id prepare-next would use.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} salesOrderId
 */
async function computeNoQtyCreateNextRsEligibilityResolved(db, salesOrderId) {
  const sid = Number(salesOrderId);
  const { cycleId, source } = await resolveNoQtyEligibilityCycleId(db, sid);
  if (!cycleId) {
    return {
      eligible: false,
      reason: source === "INVALID_SO" ? "INVALID_SO" : "NO_CYCLE",
      existingNextRsDocNo: null,
      existingNextRsId: null,
    };
  }
  return computeNoQtyCreateNextRsEligibility(db, { salesOrderId: sid, cycleId });
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {{ salesOrderId: number; cycleId: number | null }} input
 * @returns {Promise<{
 *   eligible: boolean;
 *   reason: string;
 *   existingNextRsDocNo: string | null;
 *   existingNextRsId: number | null;
 * }>}
 */
async function computeNoQtyCreateNextRsEligibility(db, input) {
  const salesOrderId = Number(input?.salesOrderId);
  const cycleId = input?.cycleId != null ? Number(input.cycleId) : null;

  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
    return { eligible: false, reason: "INVALID_SO", existingNextRsDocNo: null, existingNextRsId: null };
  }
  if (!Number.isFinite(cycleId) || cycleId <= 0) {
    return { eligible: false, reason: "INVALID_CYCLE", existingNextRsDocNo: null, existingNextRsId: null };
  }

  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { orderType: true, internalStatus: true },
  });
  if (!so || so.orderType !== "NO_QTY") {
    return { eligible: false, reason: "NOT_NO_QTY", existingNextRsDocNo: null, existingNextRsId: null };
  }
  if (["COMPLETED", "CLOSED", "MANUALLY_CLOSED"].includes(String(so.internalStatus))) {
    return { eligible: false, reason: "SO_CLOSED", existingNextRsDocNo: null, existingNextRsId: null };
  }

  const currentCycle = await db.salesOrderCycle.findFirst({
    where: { id: cycleId, salesOrderId },
    select: { id: true, cycleNo: true },
  });
  if (!currentCycle) {
    return { eligible: false, reason: "CYCLE_NOT_FOUND", existingNextRsDocNo: null, existingNextRsId: null };
  }

  const lockedRs = await db.requirementSheet.findFirst({
    where: { salesOrderId, cycleId, status: "LOCKED" },
    select: { id: true },
  });
  if (!lockedRs) {
    return { eligible: false, reason: "NO_LOCKED_RS", existingNextRsDocNo: null, existingNextRsId: null };
  }

  const sheetAhead = await db.requirementSheet.findFirst({
    where: {
      salesOrderId,
      status: "LOCKED",
      cycle: {
        salesOrderId,
        cycleNo: { gt: currentCycle.cycleNo },
        /** Rolling cycles: dispatch/stock may remain open on older cycles; CLOSED higher cycles must not gate next RS. */
        status: { not: "CLOSED" },
      },
    },
    orderBy: [{ id: "asc" }],
    select: { id: true, docNo: true },
  });

  if (sheetAhead) {
    const doc = sheetAhead.docNo?.trim() || `RS-${sheetAhead.id}`;
    return {
      eligible: false,
      reason: "NEXT_RS_EXISTS",
      existingNextRsDocNo: doc,
      existingNextRsId: sheetAhead.id,
    };
  }

  const pendingDispositionCount = await db.qcRejectedDisposition.count({
    where: {
      voidedAt: null,
      closedAt: null,
      remainingQty: { gt: 0 },
      status: {
        in: ["REWORK_PENDING_SUPERVISOR", "REWORK_APPROVED_PENDING_EXECUTION", "REWORK_READY_FOR_QC", "HOLD"],
      },
      workOrder: { salesOrderId, cycleId },
    },
  });
  if (pendingDispositionCount > 0) {
    return {
      eligible: false,
      reason: "DISPOSITION_PENDING",
      existingNextRsDocNo: null,
      existingNextRsId: null,
    };
  }

  const openPmr = await db.productionMaterialRequest.findFirst({
    where: {
      workOrder: { salesOrderId, cycleId },
      status: { in: ["REQUESTED", "PARTIALLY_ISSUED"] },
    },
    orderBy: { id: "desc" },
    select: { id: true, docNo: true, status: true },
  });
  if (openPmr) {
    return {
      eligible: false,
      reason: openPmr.status === "REQUESTED" ? "PMR_WAITING_STORE_ISSUE" : "PMR_PARTIALLY_ISSUED",
      existingNextRsDocNo: null,
      existingNextRsId: null,
      blockingPmrDocNo: openPmr.docNo ?? null,
      blockingPmrStatus: openPmr.status,
    };
  }

  return { eligible: true, reason: "OK", existingNextRsDocNo: null, existingNextRsId: null };
}

module.exports = {
  computeNoQtyCreateNextRsEligibility,
  resolveNoQtyEligibilityCycleId,
  computeNoQtyCreateNextRsEligibilityResolved,
};
