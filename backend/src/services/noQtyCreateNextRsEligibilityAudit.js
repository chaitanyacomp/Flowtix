/**
 * Diagnostic audit for Dashboard / list NO_QTY "Create Next RS" eligibility.
 * Logs one JSON line per open NO_QTY SO when triggered from GET /api/sales-orders.
 *
 * Does not change eligibility rules — only surfaces why computeNoQtyCreateNextRsEligibility
 * returned eligible:false (and compares SO.currentCycleId pointer vs ACTIVE cycle row).
 */

const { computeNoQtyCreateNextRsEligibility } = require("./noQtyCreateNextRsEligibility");

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {number} salesOrderId
 * @returns {Promise<Record<string, unknown>>}
 */
async function auditNoQtyRsEligibilityForSalesOrder(db, salesOrderId) {
  const sid = Number(salesOrderId);
  if (!Number.isFinite(sid) || sid <= 0) {
    return { error: "INVALID_SO_ID", salesOrderId };
  }

  const so = await db.salesOrder.findUnique({
    where: { id: sid },
    select: {
      id: true,
      docNo: true,
      orderType: true,
      internalStatus: true,
      currentCycleId: true,
    },
  });

  if (!so) {
    return { error: "SO_NOT_FOUND", salesOrderId: sid };
  }

  const pointerCycleId = so.currentCycleId != null ? Number(so.currentCycleId) : null;

  const activeCycle = await db.salesOrderCycle.findFirst({
    where: { salesOrderId: sid, status: "ACTIVE" },
    orderBy: { cycleNo: "desc" },
    select: { id: true, cycleNo: true, status: true, closedAt: true },
  });

  let pointerCycle = null;
  if (pointerCycleId != null && Number.isFinite(pointerCycleId) && pointerCycleId > 0) {
    pointerCycle = await db.salesOrderCycle.findFirst({
      where: { id: pointerCycleId, salesOrderId: sid },
      select: { id: true, cycleNo: true, status: true, closedAt: true },
    });
  }

  const latestRs = await db.requirementSheet.findFirst({
    where: { salesOrderId: sid },
    orderBy: { id: "desc" },
    select: { id: true, docNo: true, status: true, cycleId: true },
  });

  const sheetsOnPointerCycle =
    pointerCycleId != null && pointerCycleId > 0
      ? await db.requirementSheet.findMany({
          where: { salesOrderId: sid, cycleId: pointerCycleId },
          select: { id: true, docNo: true, status: true },
          orderBy: { id: "desc" },
        })
      : [];

  const sheetsOnActiveCycle =
    activeCycle?.id != null
      ? await db.requirementSheet.findMany({
          where: { salesOrderId: sid, cycleId: activeCycle.id },
          select: { id: true, docNo: true, status: true },
          orderBy: { id: "desc" },
        })
      : [];

  const requirementExists = sheetsOnPointerCycle.length > 0;
  const requirementLocked = sheetsOnPointerCycle.some((x) => x.status === "LOCKED");
  const hasDraftRs = sheetsOnPointerCycle.some((x) => x.status === "DRAFT");
  const hasOpenRs = hasDraftRs;

  const lockedDispatches =
    pointerCycleId != null && pointerCycleId > 0
      ? await db.dispatch.findMany({
          where: {
            soId: sid,
            cycleId: pointerCycleId,
            workflowStatus: "LOCKED",
            reversalOfId: null,
          },
          select: { id: true },
        })
      : [];

  const lockedDispatchesActiveCycle =
    activeCycle?.id != null
      ? await db.dispatch.findMany({
          where: {
            soId: sid,
            cycleId: activeCycle.id,
            workflowStatus: "LOCKED",
            reversalOfId: null,
          },
          select: { id: true },
        })
      : [];

  const dispatchIds = lockedDispatches.map((d) => d.id);
  const bills =
    dispatchIds.length > 0
      ? await db.salesBill.findMany({
          where: { dispatchId: { in: dispatchIds }, status: { in: ["DRAFT", "FINALIZED"] } },
          select: { id: true, status: true, isExported: true, dispatchId: true },
        })
      : [];

  let elig = { eligible: false, reason: "SKIPPED", existingNextRsDocNo: null, existingNextRsId: null };
  /** Same engine as list payload (`cycleId: SO.currentCycleId`). */
  let eligUsingPointer = elig;
  /** Same engine as POST prepare-next RS (`cycleId: ACTIVE SalesOrderCycle.id`). */
  let eligUsingActiveCycleRow = {
    eligible: false,
    reason: "NO_ACTIVE_CYCLE",
    existingNextRsDocNo: null,
    existingNextRsId: null,
  };

  let listSkippedReason = null;

  if (so.orderType !== "NO_QTY") {
    listSkippedReason = "NOT_NO_QTY";
  } else if (pointerCycleId == null || pointerCycleId <= 0) {
    listSkippedReason = "LIST_SKIPPED_NO_CURRENT_CYCLE_ON_SO";
    elig = { eligible: false, reason: "LIST_NOT_EVALUATED_NO_CYCLE_POINTER", existingNextRsDocNo: null, existingNextRsId: null };
    eligUsingPointer = elig;
  } else {
    eligUsingPointer = await computeNoQtyCreateNextRsEligibility(db, { salesOrderId: sid, cycleId: pointerCycleId });
    elig = eligUsingPointer;
  }

  if (so.orderType === "NO_QTY" && activeCycle?.id != null) {
    eligUsingActiveCycleRow = await computeNoQtyCreateNextRsEligibility(db, {
      salesOrderId: sid,
      cycleId: Number(activeCycle.id),
    });
  }

  const pointerMatchesActive =
    pointerCycleId != null &&
    activeCycle != null &&
    Number(pointerCycleId) === Number(activeCycle.id);

  /** Human-readable primary exclusion for dashboards */
  let exclusionReason = elig.eligible ? null : String(elig.reason ?? "UNKNOWN");
  if (listSkippedReason) {
    exclusionReason = listSkippedReason;
  }
  if (!elig.eligible && elig.reason === "NOT_CURRENT_CYCLE") {
    exclusionReason = `NOT_CURRENT_CYCLE (SO.currentCycleId=${pointerCycleId ?? "null"} must equal row used by engine; activeCycle.id=${activeCycle?.id ?? "null"})`;
  }

  const mismatchPointerVsActive =
    pointerCycleId != null &&
    activeCycle?.id != null &&
    Number(pointerCycleId) !== Number(activeCycle.id);

  return {
    soId: sid,
    soDocNo: so.docNo ?? null,
    orderType: so.orderType,
    internalStatus: so.internalStatus,
    currentCycleIdPointer: pointerCycleId,
    pointerCycleNo: pointerCycle?.cycleNo ?? null,
    pointerCycleStatus: pointerCycle?.status ?? null,
    pointerCycleClosedAt: pointerCycle?.closedAt ?? null,
    activeCycleId: activeCycle?.id ?? null,
    activeCycleNo: activeCycle?.cycleNo ?? null,
    activeCycleStatus: activeCycle?.status ?? null,
    activeCycleClosedAt: activeCycle?.closedAt ?? null,
    pointerMatchesActiveCycle: pointerMatchesActive,
    latestRsId: latestRs?.id ?? null,
    latestRsDocNo: latestRs?.docNo ?? null,
    latestRsStatus: latestRs?.status ?? null,
    latestRsCycleId: latestRs?.cycleId ?? null,
    latestRsLocked: latestRs?.status === "LOCKED",
    requirementSheetsOnPointerCycle: sheetsOnPointerCycle,
    requirementSheetsOnActiveCycle: sheetsOnActiveCycle,
    requirementExists,
    requirementLocked,
    hasDraftRs,
    hasOpenRs,
    lockedDispatchIds: dispatchIds,
    lockedDispatchIdsOnActiveCycle: lockedDispatchesActiveCycle.map((d) => d.id),
    hasDispatch: dispatchIds.length > 0,
    salesBillsOnLockedDispatches: bills.map((b) => ({
      id: b.id,
      status: b.status,
      isExported: b.isExported,
      dispatchId: b.dispatchId,
    })),
    hasSalesBill: bills.length > 0,
    billStatuses: bills.map((b) => b.status),
    billExportedFlags: bills.map((b) => b.isExported),
    computedNoQtyCreateNextRsEligible: elig.eligible,
    eligibilityEngineReason: elig.reason ?? null,
    eligibilityUsingPointerCycleId: {
      eligible: eligUsingPointer.eligible,
      reason: eligUsingPointer.reason ?? null,
    },
    eligibilityUsingActiveCycleRow: {
      eligible: eligUsingActiveCycleRow.eligible,
      reason: eligUsingActiveCycleRow.reason ?? null,
    },
    mismatchPointerVsActiveCycle: mismatchPointerVsActive,
    exclusionReason,
    listApiWouldSetEligible:
      pointerCycleId != null && pointerCycleId > 0 ? eligUsingPointer.eligible : false,
    notes: [
      "Eligibility does not require sales bill export (see noQtyCreateNextRsEligibility.js).",
      "GET /sales-orders list sets noQtyCreateNextRsEligible using SO.currentCycleId as cycleId.",
      "POST /sales-orders/:id/no-qty-cycle/prepare-next-requirement-sheet uses ACTIVE SalesOrderCycle.id (see noQtyCycleLifecycle.js).",
      mismatchPointerVsActive
        ? "MISMATCH: List eligibility uses pointer cycle; prepare uses ACTIVE cycle — Dashboard may hide a SO that prepare would still evaluate differently."
        : null,
      pointerMatchesActive ? null : "WARNING: SO.currentCycleId does not match ACTIVE cycle row.",
    ].filter(Boolean),
  };
}

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {Array<{ id: number; orderType?: string; internalStatus?: string }>} stagedRows
 */
async function auditAllOpenNoQtyForDashboard(db, stagedRows) {
  const open = stagedRows.filter((s) => {
    if (s.orderType !== "NO_QTY") return false;
    const st = String(s.internalStatus ?? "");
    return !["CLOSED", "MANUALLY_CLOSED", "COMPLETED"].includes(st);
  });
  const out = [];
  for (const s of open) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await auditNoQtyRsEligibilityForSalesOrder(db, s.id));
  }
  return out;
}

module.exports = {
  auditNoQtyRsEligibilityForSalesOrder,
  auditAllOpenNoQtyForDashboard,
};
