/**
 * NO_QTY: When operators may create the next cycle's requirement sheet — rolling / demand-driven planning.
 *
 * P6B-4B: Next RS is demand-driven. Execution progress on the current cycle (PMR, WO, production,
 * QA, dispatch, MPRS) must NOT block creating the next cycle RS while the NO_QTY agreement is OPEN.
 *
 * Cycle scope: evaluate using a concrete `SalesOrderCycle` row that belongs to the SO (`cycleId` + `salesOrderId`).
 * Callers resolve the evaluation cycle via {@link resolveNoQtyEligibilityCycleId} (ACTIVE, pointer, or latest CLOSED
 * when between cycles).
 *
 * Eligible when (evaluated cycle):
 * 1) Latest requirement sheet on the cycle is LOCKED or CANCELLED
 * 2) No LOCKED requirement sheet exists on any non-CLOSED cycle with cycleNo strictly greater than current
 * 3) No DRAFT requirement sheet exists on any non-CLOSED later cycle (open draft must be finished first)
 * 4) P10-A7D: LOCKED terminal RS with no WO on that cycle is not next-cycle demand — monthly planning / WO placement first
 *
 * Not eligible: NOT_NO_QTY, SO closed, invalid cycle, latest RS is DRAFT / missing, later LOCKED or DRAFT RS exists,
 * NO_NEXT_CYCLE_DEMAND (locked RS but execution not started on cycle).
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

  const latestOnCycle = await db.requirementSheet.findFirst({
    where: { salesOrderId, cycleId },
    orderBy: [{ version: "desc" }, { id: "desc" }],
    select: { id: true, status: true },
  });
  if (!latestOnCycle) {
    return { eligible: false, reason: "NO_LOCKED_RS", existingNextRsDocNo: null, existingNextRsId: null };
  }
  if (latestOnCycle.status === "DRAFT") {
    return {
      eligible: false,
      reason: "DRAFT_RS_ON_CYCLE",
      existingNextRsDocNo: null,
      existingNextRsId: latestOnCycle.id,
    };
  }
  if (latestOnCycle.status !== "LOCKED" && latestOnCycle.status !== "CANCELLED") {
    return { eligible: false, reason: "NO_LOCKED_RS", existingNextRsDocNo: null, existingNextRsId: null };
  }

  const sheetAhead = await db.requirementSheet.findFirst({
    where: {
      salesOrderId,
      status: "LOCKED",
      cycle: {
        salesOrderId,
        cycleNo: { gt: currentCycle.cycleNo },
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

  const draftAhead = await db.requirementSheet.findFirst({
    where: {
      salesOrderId,
      status: "DRAFT",
      cycle: {
        salesOrderId,
        cycleNo: { gt: currentCycle.cycleNo },
        status: { not: "CLOSED" },
      },
    },
    orderBy: [{ version: "desc" }, { id: "desc" }],
    select: { id: true, docNo: true },
  });
  if (draftAhead) {
    const doc = draftAhead.docNo?.trim() || `RS-${draftAhead.id}`;
    return {
      eligible: false,
      reason: "DRAFT_RS_EXISTS",
      existingNextRsDocNo: doc,
      existingNextRsId: draftAhead.id,
    };
  }

  /**
   * P10-A7D — Cycle 2+ RS is demand-driven. A freshly locked Cycle 1 RS (no WO yet) must route
   * to monthly planning / MPRS for the locked period, not to Create/Lock next-cycle RS actions.
   */
  if (latestOnCycle.status === "LOCKED") {
    const woOnCycle = await db.workOrder.findFirst({
      where: { salesOrderId, cycleId, status: { not: "REJECTED" } },
      select: { id: true },
    });
    if (!woOnCycle?.id) {
      return {
        eligible: false,
        reason: "NO_NEXT_CYCLE_DEMAND",
        existingNextRsDocNo: null,
        existingNextRsId: null,
      };
    }
  }

  return { eligible: true, reason: "OK", existingNextRsDocNo: null, existingNextRsId: null };
}

module.exports = {
  computeNoQtyCreateNextRsEligibility,
  resolveNoQtyEligibilityCycleId,
  computeNoQtyCreateNextRsEligibilityResolved,
};
