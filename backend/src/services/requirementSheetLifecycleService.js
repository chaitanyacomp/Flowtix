/**
 * NO_QTY Requirement Sheet lifecycle (create guard + admin cancellation eligibility).
 */

const RS_LIFECYCLE_MESSAGES = Object.freeze({
  CYCLE_ALREADY_LOCKED:
    "Cannot create another Requirement Sheet for this cycle. The cycle is already locked. Create the next cycle instead.",
  CYCLE_DEMAND_CANCELLED:
    "Cannot create another Requirement Sheet for this cycle. This cycle's requirement was cancelled. Create a fresh Requirement Sheet instead.",
  LOCKED_CYCLE_CANNOT_REVISE: "Locked cycle cannot be revised. Cancel it first or create the next cycle.",
  CANCEL_SUCCESS: "Requirement Sheet cancelled successfully. The Sales Order is available for a fresh Requirement Sheet.",
  NOT_LOCKED: "Only locked requirement sheets can be cancelled.",
  ALREADY_CANCELLED: "This requirement sheet is already cancelled.",
  DOWNSTREAM_EXISTS: "Cannot cancel this Requirement Sheet because downstream execution exists.",
  VALIDATION_FAILED: "Cancellation could not be validated safely. No changes were made; contact an administrator.",
});

class RequirementSheetLifecycleError extends Error {
  constructor(code, message, statusCode = 409, details = null) {
    super(message);
    this.name = "RequirementSheetLifecycleError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function resolveCycleNoLabel(db, cycleId) {
  const cid = cycleId != null ? Number(cycleId) : NaN;
  if (!Number.isFinite(cid) || cid <= 0) return null;
  const row = await db.salesOrderCycle.findUnique({ where: { id: cid }, select: { cycleNo: true } });
  const n = row?.cycleNo != null ? Number(row.cycleNo) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cycleLockedCreateMessage(cycleNo) {
  return cycleNo != null
    ? `Cannot create another Requirement Sheet for Cycle ${cycleNo}. Cycle ${cycleNo} is already locked. Create the next cycle instead.`
    : RS_LIFECYCLE_MESSAGES.CYCLE_ALREADY_LOCKED;
}

function cycleCancelledCreateMessage(cycleNo) {
  return cycleNo != null
    ? `Cannot create another Requirement Sheet for Cycle ${cycleNo}. This cycle's requirement was cancelled. Create a fresh Requirement Sheet instead.`
    : RS_LIFECYCLE_MESSAGES.CYCLE_DEMAND_CANCELLED;
}

async function assertNoLockedOrCancelledSheetForCyclePeriod(tx, input) {
  const soId = Number(input.salesOrderId);
  const cycleId = input.cycleId != null ? Number(input.cycleId) : null;
  const periodKey = String(input.periodKey ?? "").trim();
  if (!Number.isFinite(soId) || soId <= 0 || !periodKey) {
    throw new RequirementSheetLifecycleError("INVALID_INPUT", "Invalid requirement sheet scope.", 400);
  }
  const cycleNo = await resolveCycleNoLabel(tx, cycleId);
  const locked = await tx.requirementSheet.findFirst({
    where: { salesOrderId: soId, cycleId, periodKey, status: "LOCKED" },
    select: { id: true, docNo: true },
  });
  if (locked) throw new RequirementSheetLifecycleError("CYCLE_ALREADY_LOCKED", cycleLockedCreateMessage(cycleNo), 409, { existingSheetId: locked.id, cycleNo });

  // A cancelled sheet is audit history, not an execution lock. Its SO/cycle may create a fresh RS.
}

function addBlocker(blockers, code, label, count, references = []) {
  if (!Number.isFinite(Number(count)) || Number(count) <= 0) return;
  blockers.push({ code, label, count: Number(count), references: references.filter(Boolean) });
}

function blockedResult(blockers) {
  const summary = blockers.map((b) => `${b.label} (${b.count})`).join(", ");
  return {
    allowed: false,
    code: "DOWNSTREAM_EXISTS",
    message: `${RS_LIFECYCLE_MESSAGES.DOWNSTREAM_EXISTS} Blockers: ${summary}.`,
    details: { blockers },
  };
}

/** Evaluate every RS-specific downstream edge. This function is fail-closed. */
async function evaluateRequirementSheetCancellation(db, sheetId) {
  const id = Number(sheetId);
  if (!Number.isFinite(id) || id <= 0) return { allowed: false, code: "INVALID_ID", message: "Invalid requirement sheet id." };

  try {
    const sheet = await db.requirementSheet.findUnique({
      where: { id },
      select: { id: true, status: true, salesOrderId: true, cycleId: true, salesOrder: { select: { orderType: true } } },
    });
    if (!sheet) return { allowed: false, code: "NOT_FOUND", message: "Requirement sheet not found." };
    if (sheet.salesOrder?.orderType !== "NO_QTY") return { allowed: false, code: "NOT_NO_QTY", message: "Cancellation is allowed only for No Qty requirement sheets." };
    if (sheet.status === "CANCELLED") return { allowed: false, code: "ALREADY_CANCELLED", message: RS_LIFECYCLE_MESSAGES.ALREADY_CANCELLED };
    if (sheet.status !== "LOCKED") return { allowed: false, code: "NOT_LOCKED", message: RS_LIFECYCLE_MESSAGES.NOT_LOCKED };

    // All WOs count, including cancelled/closed ones: existence itself is downstream execution/history.
    const workOrders = await db.workOrder.findMany({ where: { requirementSheetId: id }, select: { id: true, docNo: true } });
    const woIds = workOrders.map((row) => row.id);
    const blockers = [];
    addBlocker(blockers, "WORK_ORDER_EXISTS", "Work Orders", workOrders.length, workOrders.map((r) => r.docNo || `WO-${r.id}`));

    let issueNotes = [], returnNotes = [], productions = [], qcEntries = [];
    if (woIds.length) {
      [issueNotes, returnNotes, productions] = await Promise.all([
        db.materialIssueNote.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true, docNo: true } }),
        db.materialReturnNote.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true, docNo: true } }),
        db.productionEntry.findMany({ where: { workOrderLine: { workOrderId: { in: woIds } } }, select: { id: true, docNo: true } }),
      ]);
      if (productions.length) qcEntries = await db.qcEntry.findMany({ where: { productionId: { in: productions.map((r) => r.id) } }, select: { id: true, docNo: true } });
    }
    addBlocker(blockers, "MATERIAL_ISSUE_EXISTS", "Material Issues", issueNotes.length, issueNotes.map((r) => r.docNo || `MIN-${r.id}`));
    addBlocker(blockers, "MATERIAL_RETURN_EXISTS", "Material Returns", returnNotes.length, returnNotes.map((r) => r.docNo || `MRN-${r.id}`));
    addBlocker(blockers, "PRODUCTION_EXISTS", "Production Entries", productions.length, productions.map((r) => r.docNo || `PE-${r.id}`));
    addBlocker(blockers, "QC_EXISTS", "QC Entries", qcEntries.length, qcEntries.map((r) => r.docNo || `QC-${r.id}`));

    const dispatches = sheet.cycleId == null ? [] : await db.dispatch.findMany({
      where: { soId: sheet.salesOrderId, cycleId: sheet.cycleId }, select: { id: true, docNo: true },
    });
    addBlocker(blockers, "DISPATCH_EXISTS", "Dispatches", dispatches.length, dispatches.map((r) => r.docNo || `DISP-${r.id}`));
    const salesBills = sheet.cycleId == null ? [] : await db.salesBill.findMany({
      where: { cycleId: sheet.cycleId, dispatch: { soId: sheet.salesOrderId } }, select: { id: true, docNo: true },
    });
    addBlocker(blockers, "SALES_BILL_EXISTS", "Sales Bills", salesBills.length, salesBills.map((r) => r.docNo || `SB-${r.id}`));

    const coverages = await db.monthlyPlanRequirementCoverage.findMany({
      where: { requirementSheetId: id }, select: { id: true, planId: true, plan: { select: { id: true, docNo: true } } },
    });
    const planIds = [...new Set(coverages.map((r) => r.planId))];
    addBlocker(blockers, "DOWNSTREAM_REFERENCE_EXISTS", "Planning references", coverages.length, coverages.map((r) => r.plan?.docNo || `PLAN-${r.planId}`));

    const [recoveryAllocations, recoveryDecisions, carryForwardSources, carryForwardTargets] = await Promise.all([
      db.recoveryAllocation.findMany({ where: { requirementSheetId: id }, select: { id: true } }),
      db.noQtyRsItemRecoveryDecision.findMany({ where: { requirementSheetId: id }, select: { id: true } }),
      db.carryForwardPending.findMany({ where: { sourceRequirementSheetId: id }, select: { id: true } }),
      db.carryForwardPending.findMany({ where: { targetRequirementSheetId: id }, select: { id: true } }),
    ]);
    const otherReferences = recoveryAllocations.length + recoveryDecisions.length + carryForwardSources.length + carryForwardTargets.length;
    addBlocker(blockers, "DOWNSTREAM_REFERENCE_EXISTS", "Other downstream references", otherReferences);

    let materialRequirements = [], purchaseRequests = [], purchaseOrders = [];
    if (planIds.length) {
      materialRequirements = await db.materialRequirement.findMany({
        where: { monthlyProductionPlanId: { in: planIds } },
        select: {
          id: true, docNo: true,
          lines: { select: { purchaseRequestSourceLinks: { select: { purchaseRequestLine: { select: { purchaseRequest: { select: { id: true, docNo: true } }, poLinks: { select: { rmPoLine: { select: { rmPo: { select: { id: true, supplierPoNumber: true } } } } } } } } } }, procurementLinks: { select: { rmPoLine: { select: { rmPo: { select: { id: true, supplierPoNumber: true } } } } } } } },
        },
      });
      for (const mr of materialRequirements) for (const line of mr.lines) {
        for (const link of line.purchaseRequestSourceLinks) {
          if (link.purchaseRequestLine?.purchaseRequest) purchaseRequests.push(link.purchaseRequestLine.purchaseRequest);
          for (const poLink of link.purchaseRequestLine?.poLinks || []) if (poLink.rmPoLine?.rmPo) purchaseOrders.push(poLink.rmPoLine.rmPo);
        }
        for (const link of line.procurementLinks) if (link.rmPoLine?.rmPo) purchaseOrders.push(link.rmPoLine.rmPo);
      }
    }
    const unique = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];
    purchaseRequests = unique(purchaseRequests); purchaseOrders = unique(purchaseOrders);
    addBlocker(blockers, "MATERIAL_REQUIREMENT_EXISTS", "Material Requirements", materialRequirements.length, materialRequirements.map((r) => r.docNo || `MR-${r.id}`));
    addBlocker(blockers, "PURCHASE_REQUEST_EXISTS", "Purchase Requests", purchaseRequests.length, purchaseRequests.map((r) => r.docNo || `PR-${r.id}`));
    addBlocker(blockers, "PURCHASE_ORDER_EXISTS", "Purchase Orders", purchaseOrders.length, purchaseOrders.map((r) => r.supplierPoNumber || `PO-${r.id}`));
    const grns = purchaseOrders.length ? await db.grn.findMany({ where: { rmPoId: { in: purchaseOrders.map((r) => r.id) } }, select: { id: true, supplierInvoiceNo: true } }) : [];
    addBlocker(blockers, "GRN_EXISTS", "Goods Receipts", grns.length, grns.map((r) => r.supplierInvoiceNo || `GRN-${r.id}`));

    const stockOr = [];
    if (issueNotes.length || returnNotes.length) stockOr.push({ transactionType: "LOCATION_TRANSFER", refId: { in: [...issueNotes, ...returnNotes].map((r) => r.id) } });
    if (productions.length) stockOr.push({ transactionType: { in: ["ISSUE", "PRODUCTION"] }, refId: { in: productions.map((r) => r.id) } });
    if (qcEntries.length) stockOr.push({ transactionType: "QC", refId: { in: qcEntries.map((r) => r.id) } });
    if (dispatches.length) stockOr.push({ transactionType: { in: ["DISPATCH", "DISPATCH_REVERSAL"] }, refId: { in: dispatches.map((r) => r.id) } });
    const stockCount = stockOr.length ? await db.stockTransaction.count({ where: { OR: stockOr } }) : 0;
    addBlocker(blockers, "STOCK_TRANSACTION_EXISTS", "Stock Transactions", stockCount);

    return blockers.length ? blockedResult(blockers) : { allowed: true, code: "OK", message: RS_LIFECYCLE_MESSAGES.CANCEL_SUCCESS, details: { blockers: [] } };
  } catch (error) {
    return {
      allowed: false,
      code: "VALIDATION_FAILED",
      message: RS_LIFECYCLE_MESSAGES.VALIDATION_FAILED,
      details: { blockers: [], validationError: error?.code || error?.name || "DATABASE_VALIDATION_ERROR" },
    };
  }
}

async function cancelLockedRequirementSheet(tx, input) {
  const sheetId = Number(input.sheetId);
  const evaluation = await evaluateRequirementSheetCancellation(tx, sheetId);
  if (!evaluation.allowed) throw new RequirementSheetLifecycleError(evaluation.code, evaluation.message, 409, evaluation.details ?? null);
  const reason = input.reason != null && String(input.reason).trim() ? String(input.reason).trim().slice(0, 8000) : null;
  const updated = await tx.requirementSheet.update({
    where: { id: sheetId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: input.actorUserId ?? null, cancellationReason: reason },
    include: { salesOrder: { select: { id: true, docNo: true } }, cycle: { select: { id: true, cycleNo: true } } },
  });
  return { sheet: updated, evaluation };
}

module.exports = {
  RS_LIFECYCLE_MESSAGES, RequirementSheetLifecycleError, assertNoLockedOrCancelledSheetForCyclePeriod,
  evaluateRequirementSheetCancellation, cancelLockedRequirementSheet, resolveCycleNoLabel, cycleLockedCreateMessage,
  _test: { blockedResult },
};
