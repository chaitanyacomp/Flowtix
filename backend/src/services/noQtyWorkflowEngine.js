const { normalizePositiveCycleId } = require("../utils/cycleIds");
const {
  netDispatchedByItemId,
  DISPATCH_ALLOC_MODE,
} = require("./salesOrderDispatchAllocation");
const {
  computeNoQtyCreateNextRsEligibility,
  computeNoQtyCreateNextRsEligibilityResolved,
  resolveNoQtyEligibilityCycleId,
} = require("./noQtyCreateNextRsEligibility");
const { findNoQtyNextRollingRequirementSheetTarget } = require("./noQtyRollingRequirementNav");
const {
  loadNoQtyDispositionUsableForDispatchPoolMap,
  loadNoQtyPostCycleApprovalMapForInputs,
} = require("./noQtyPostCycleApprovalService");
const { QC_ENTRY_ACTIVE_WHERE } = require("./qcEntryConstants");
const {
  getProductionBatchQcPendingQty,
  sumActiveQcAcceptedQty,
  sumActiveQcRejectedQty,
} = require("./reportMetrics");
const { loadNoQtyCycleQcAcceptedMap } = require("../routes/dispatch");

const NO_QTY_WORKFLOW_EPS = 1e-6;

const { assessNoQtyPlacementStageForCycle } = require("./requirementSheetExecutionService");

const ACTION_LABELS = Object.freeze({
  NONE: "No action",
  CREATE_NEXT_RS: "Next RS",
  NEXT_RS: "Next RS",
  REQUIREMENT: "Requirement Sheet",
  WORK_ORDER: "Place WO",
  PRODUCTION: "Continue Production",
  QC: "Open QC",
  DISPATCH: "Open Dispatch",
  SALES_BILL: "Sales Bill",
  DONE: "Done",
  BLOCKED: "Blocked",
});

const ACTION_OWNERS = Object.freeze({
  CREATE_NEXT_RS: "STORE",
  REQUIREMENT: "STORE",
  WORK_ORDER: "STORE",
  PRODUCTION: "PRODUCTION",
  QC: "QA",
  DISPATCH: "STORE",
  SALES_BILL: "ADMIN",
  DONE: "SYSTEM",
  BLOCKED: "SYSTEM",
});

function buildNoQtyGuidedHref(to, salesOrderId, cycleId, fromStep) {
  const hasQuery = String(to).includes("?");
  const q = [`source=no_qty_so`, `salesOrderId=${encodeURIComponent(String(salesOrderId))}`];
  if (cycleId != null && Number.isFinite(Number(cycleId)) && Number(cycleId) > 0) {
    q.push(`cycleId=${encodeURIComponent(String(cycleId))}`);
  }
  if (fromStep) q.push(`fromStep=${encodeURIComponent(String(fromStep))}`);
  return `${to}${hasQuery ? "&" : "?"}${q.join("&")}`;
}

function actionHref(action, salesOrderId, cycleId) {
  switch (action) {
    case "CREATE_NEXT_RS":
    case "NEXT_RS":
    case "REQUIREMENT":
      return buildNoQtyGuidedHref(`/sales-orders/${salesOrderId}/requirement-sheets`, salesOrderId, cycleId, "requirement");
    case "WORK_ORDER":
      return `${buildNoQtyGuidedHref(`/sales-orders/${salesOrderId}/requirement-sheets`, salesOrderId, cycleId, "requirement")}&focus=execution`;
    case "PRODUCTION":
      return buildNoQtyGuidedHref("/production", salesOrderId, cycleId, "work_order");
    case "QC":
      return buildNoQtyGuidedHref("/qc-entry", salesOrderId, cycleId, "production");
    case "DISPATCH":
      return buildNoQtyGuidedHref("/dispatch", salesOrderId, cycleId, "qc");
    case "SALES_BILL":
      return buildNoQtyGuidedHref("/sales-bills", salesOrderId, cycleId, "dispatch");
    default:
      return null;
  }
}

function normalizeRole(role) {
  return String(role ?? "").trim().toUpperCase();
}

function userOwnsAction(role, action) {
  const r = normalizeRole(role);
  if (r === "ADMIN") return action !== "NONE";
  switch (action) {
    case "CREATE_NEXT_RS":
    case "REQUIREMENT":
      return r === "ADMIN" || r === "STORE";
    case "WORK_ORDER":
      return r === "ADMIN" || r === "STORE";
    case "PRODUCTION":
      return r === "PRODUCTION";
    case "QC":
      return r === "QA";
    case "DISPATCH":
      return r === "STORE";
    case "SALES_BILL":
      return r === "ADMIN";
    case "DONE":
    case "BLOCKED":
      return true;
    default:
      return false;
  }
}

function overallStateFromAction(overallAction) {
  const map = {
    CREATE_NEXT_RS: "NEXT_RS_READY",
    NEXT_RS: "NEXT_RS_READY",
    REQUIREMENT: "REQUIREMENT_PENDING",
    WORK_ORDER: "WORK_ORDER_REQUIRED",
    PRODUCTION: "PRODUCTION_REQUIRED",
    QC: "QC_PENDING",
    DISPATCH: "DISPATCH_READY",
    SALES_BILL: "SALES_BILL_PENDING",
    DONE: "DONE",
    BLOCKED: "BLOCKED",
  };
  return map[overallAction] ?? "BLOCKED";
}

function departmentMessageFor(role, nextDepartmentAction, overallAction) {
  if (nextDepartmentAction === "NONE" || overallAction === "DONE") return null;
  const owner = ACTION_OWNERS[nextDepartmentAction] ?? "another department";
  const label = ACTION_LABELS[nextDepartmentAction] ?? nextDepartmentAction;
  if (overallAction === "CREATE_NEXT_RS") {
    return "Cycle completed. Waiting for Store to create the next Requirement Sheet.";
  }
  if (nextDepartmentAction === "WORK_ORDER") {
    return "Waiting for Store to place Work Order(s) from the Requirement Sheet Execution Workspace.";
  }
  const ownerLabel = owner === "STORE" ? "Store" : owner === "QA" ? "QA" : owner.replace(/_/g, " ").toLowerCase();
  return `Waiting for ${ownerLabel} to complete ${label}.`;
}

function roleAwareActionPayload({ role, overallAction, secondaryActions, optionalActions, salesOrderId, cycleId, displaySummary }) {
  const canonicalOverall = overallAction === "NEXT_RS" ? "CREATE_NEXT_RS" : overallAction;
  const ownedSecondary = uniqActions((secondaryActions || []).map((a) => (a === "NEXT_RS" ? "CREATE_NEXT_RS" : a))).filter((a) =>
    userOwnsAction(role, a),
  );
  const ownedOptional = uniqActions((optionalActions || []).map((a) => (a === "NEXT_RS" ? "CREATE_NEXT_RS" : a))).filter((a) =>
    userOwnsAction(role, a),
  );
  const primaryActionForCurrentUser = userOwnsAction(role, canonicalOverall)
    ? canonicalOverall
    : ownedSecondary[0] ?? ownedOptional[0] ?? "NONE";
  const nextDepartmentAction =
    primaryActionForCurrentUser === "NONE" || primaryActionForCurrentUser !== canonicalOverall
      ? canonicalOverall
      : "NONE";
  const message =
    primaryActionForCurrentUser === "NONE"
      ? departmentMessageFor(role, nextDepartmentAction, canonicalOverall) || displaySummary
      : displaySummary;

  return {
    overallWorkflowState: overallStateFromAction(canonicalOverall),
    overallAction: canonicalOverall,
    primaryActionForCurrentUser,
    nextDepartmentAction,
    currentUserActionLabel:
      primaryActionForCurrentUser === "NONE" ? null : ACTION_LABELS[primaryActionForCurrentUser] ?? primaryActionForCurrentUser,
    currentUserActionHref:
      primaryActionForCurrentUser === "NONE" ? null : actionHref(primaryActionForCurrentUser, salesOrderId, cycleId),
    roleAllowedSecondaryActions: ownedSecondary,
    roleAllowedOptionalActions: ownedOptional,
    actionOwner: ACTION_OWNERS[canonicalOverall] ?? null,
    message,
  };
}

function stepFromAction(action) {
  const map = {
    NEXT_RS: 1,
    REQUIREMENT: 1,
    WORK_ORDER: 2,
    PRODUCTION: 3,
    QC: 4,
    DISPATCH: 5,
    SALES_BILL: 6,
    DONE: 6,
    BLOCKED: 1,
  };
  return map[action] ?? 1;
}

function uniqActions(actions) {
  const out = [];
  const seen = new Set();
  for (const a of actions || []) {
    if (!a || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

async function resolveCanonicalCycleId(db, salesOrderId, requestedCycleId, currentCycleId) {
  const soId = Number(salesOrderId);
  const reqCid = requestedCycleId != null ? Number(requestedCycleId) : null;
  if (Number.isFinite(reqCid) && reqCid > 0) {
    const row = await db.salesOrderCycle.findFirst({
      where: { id: reqCid, salesOrderId: soId },
      select: { id: true },
    });
    if (row?.id != null) return { cycleId: Number(row.id), source: "REQUESTED" };
  }

  const eligibilityCycle = await resolveNoQtyEligibilityCycleId(db, soId);
  if (eligibilityCycle.cycleId != null) {
    return { cycleId: Number(eligibilityCycle.cycleId), source: eligibilityCycle.source };
  }

  const ptrCid = currentCycleId != null ? Number(currentCycleId) : null;
  if (Number.isFinite(ptrCid) && ptrCid > 0) {
    const row = await db.salesOrderCycle.findFirst({
      where: { id: ptrCid, salesOrderId: soId },
      select: { id: true },
    });
    if (row?.id != null) return { cycleId: Number(row.id), source: "POINTER" };
  }

  return { cycleId: null, source: "NONE" };
}

async function loadNoQtyDispatchableFacts(db, soId, cycleId) {
  const wantCycle = normalizePositiveCycleId(cycleId);
  if (wantCycle == null) return { hasQcAcceptedUndispatched: false, dispatchableQty: 0 };

  const qcInputs = [{ id: soId, currentCycleId: wantCycle }];
  const [qcAcceptedMap, recheckDispMap, postCycleMap, dispatchRows] = await Promise.all([
    loadNoQtyCycleQcAcceptedMap(db, qcInputs),
    loadNoQtyDispositionUsableForDispatchPoolMap(db, qcInputs),
    loadNoQtyPostCycleApprovalMapForInputs(db, qcInputs),
    db.dispatch.findMany({
      where: { soId, reversalOfId: null },
      select: { itemId: true, dispatchedQty: true, cycleId: true, workflowStatus: true },
    }),
  ]);

  const cycleDispRows = (dispatchRows || []).filter((d) => normalizePositiveCycleId(d.cycleId) === wantCycle);
  const netByItemRaw = netDispatchedByItemId(cycleDispRows, DISPATCH_ALLOC_MODE.OPERATIONAL);
  const netByItem = new Map();
  for (const [k, v] of netByItemRaw.entries()) {
    const itemId = Number(k);
    if (!Number.isFinite(itemId)) continue;
    netByItem.set(itemId, (netByItem.get(itemId) ?? 0) + Number(v));
  }

  let dispatchableQty = 0;
  let hasQcAcceptedUndispatched = false;
  for (const [key, qcAccRaw] of qcAcceptedMap.entries()) {
    const parts = String(key).split(":");
    if (parts.length !== 3) continue;
    const kSo = Number(parts[0]);
    const kCycle = Number(parts[1]);
    const itemId = Number(parts[2]);
    if (kSo !== soId || kCycle !== wantCycle || !Number.isFinite(itemId)) continue;
    const pool =
      Number(qcAccRaw ?? 0) +
      Number(recheckDispMap.get(key) ?? 0) +
      Number(postCycleMap.get(key) ?? 0);
    const net = Number(netByItem.get(itemId) ?? 0);
    const headroom = Math.max(0, pool - net);
    dispatchableQty += headroom;
    if (headroom > NO_QTY_WORKFLOW_EPS) hasQcAcceptedUndispatched = true;
  }

  return { hasQcAcceptedUndispatched, dispatchableQty };
}

async function resolveNoQtyWorkflowState(db, input) {
  const soId = Number(input?.salesOrderId);
  const userRole = normalizeRole(input?.userRole);
  if (!Number.isFinite(soId) || soId <= 0) {
    const err = new Error("Invalid sales order id.");
    err.statusCode = 400;
    throw err;
  }

  const head = await db.salesOrder.findUnique({
    where: { id: soId },
    select: { id: true, orderType: true, currentCycleId: true, internalStatus: true },
  });
  if (!head) {
    const err = new Error("Sales order not found");
    err.statusCode = 404;
    throw err;
  }

  const isCompleted = ["COMPLETED", "MANUALLY_CLOSED", "CLOSED"].includes(String(head.internalStatus ?? ""));
  if (head.orderType !== "NO_QTY") {
    const rolePayload = roleAwareActionPayload({
      role: userRole,
      overallAction: "REQUIREMENT",
      secondaryActions: [],
      optionalActions: [],
      salesOrderId: soId,
      cycleId: null,
      displaySummary: "Regular sales order.",
    });
    return {
      salesOrderId: soId,
      canonicalSalesOrderId: soId,
      cycleId: null,
      canonicalCycleId: null,
      cycleStatus: null,
      isCompleted,
      requirementExists: false,
      requirementLocked: false,
      workOrderExists: false,
      workOrderId: null,
      productionExists: false,
      qcExists: false,
      qcPendingForCycle: false,
      hasQcDispatchPending: false,
      dispatchableQty: 0,
      dispatchExists: false,
      salesBillExists: false,
      createNextRsEligible: false,
      nextRsAlreadyCreatedDocNo: null,
      nextRollingRequirementSheetId: null,
      nextRollingRequirementSheetCycleId: null,
      treatFgAsOptionalStoreStock: false,
      nextAction: "REQUIREMENT",
      activeStep: 1,
      primaryAction: "REQUIREMENT",
      ...rolePayload,
      secondaryActions: [],
      optionalActions: [],
      actionLabel: ACTION_LABELS.REQUIREMENT,
      actionHref: null,
      blockedReasons: [],
      displaySummary: "Regular sales order.",
      workflowSummary: "Regular sales order.",
    };
  }

  const requestedCycleId = input?.cycleId != null ? Number(input.cycleId) : null;
  const resolved = await resolveCanonicalCycleId(db, soId, requestedCycleId, head.currentCycleId);
  const cycleId = resolved.cycleId;

  if (!cycleId) {
    const createNextRs = await computeNoQtyCreateNextRsEligibilityResolved(db, soId);
    const primaryAction = createNextRs.eligible ? "NEXT_RS" : isCompleted ? "DONE" : "REQUIREMENT";
    const rolePayload = roleAwareActionPayload({
      role: userRole,
      overallAction: primaryAction,
      secondaryActions: [],
      optionalActions: [],
      salesOrderId: soId,
      cycleId: null,
      displaySummary: createNextRs.eligible ? "Ready for Next RS." : "No active NO_QTY cycle.",
    });
    return {
      salesOrderId: soId,
      canonicalSalesOrderId: soId,
      cycleId: null,
      canonicalCycleId: null,
      canonicalCycleSource: resolved.source,
      cycleStatus: null,
      isCompleted,
      requirementExists: false,
      requirementLocked: false,
      workOrderExists: false,
      workOrderId: null,
      productionExists: false,
      qcExists: false,
      qcPendingForCycle: false,
      hasQcDispatchPending: false,
      dispatchableQty: 0,
      dispatchExists: false,
      salesBillExists: false,
      nextAction: primaryAction === "NEXT_RS" ? "REQUIREMENT" : primaryAction,
      activeStep: stepFromAction(primaryAction),
      createNextRsEligible: createNextRs.eligible,
      nextRsAlreadyCreatedDocNo: createNextRs.existingNextRsDocNo,
      createNextRsBlockReason: createNextRs.eligible ? null : createNextRs.reason ?? null,
      createNextRsBlockingPmrDocNo: createNextRs.blockingPmrDocNo ?? null,
      createNextRsBlockingPmrStatus: createNextRs.blockingPmrStatus ?? null,
      treatFgAsOptionalStoreStock: false,
      nextRollingRequirementSheetId: null,
      nextRollingRequirementSheetCycleId: null,
      primaryAction,
      ...rolePayload,
      secondaryActions: [],
      optionalActions: [],
      actionLabel: ACTION_LABELS[primaryAction],
      actionHref: actionHref(primaryAction, soId, null),
      blockedReasons: createNextRs.eligible ? [] : [createNextRs.reason || "NO_CYCLE"],
      displaySummary: createNextRs.eligible ? "Ready for Next RS." : "No active NO_QTY cycle.",
      workflowSummary: createNextRs.eligible ? "Ready for Next RS." : "No active NO_QTY cycle.",
    };
  }

  const [
    cycle,
    reqSheets,
    workOrders,
    prodAny,
    qcAny,
    dispatchRows,
    productionRows,
    pendingDispositionCount,
    createNextRs,
    cycleUi,
    rolling,
  ] = await Promise.all([
    db.salesOrderCycle.findFirst({
      where: { id: cycleId, salesOrderId: soId },
      select: { id: true, cycleNo: true, status: true },
    }),
    db.requirementSheet.findMany({
      where: { salesOrderId: soId, cycleId },
      select: { id: true, status: true },
    }),
    db.workOrder.findMany({
      where: { salesOrderId: soId, cycleId, status: { not: "REJECTED" } },
      select: { id: true, status: true, lines: { select: { plannedQty: true, qty: true } } },
      orderBy: [{ id: "asc" }],
    }),
    db.productionEntry.findFirst({
      where: {
        workflowStatus: "APPROVED",
        workOrderLine: { workOrder: { salesOrderId: soId, cycleId } },
      },
      select: { id: true },
    }),
    db.qcEntry.findFirst({
      where: {
        reversedAt: null,
        production: { workOrderLine: { workOrder: { salesOrderId: soId, cycleId } } },
      },
      select: { id: true },
    }),
    db.dispatch.findMany({
      where: { soId, cycleId, reversalOfId: null },
      select: { id: true, workflowStatus: true },
    }),
    db.productionEntry.findMany({
      where: {
        workflowStatus: "APPROVED",
        workOrderLine: { workOrder: { salesOrderId: soId, cycleId } },
      },
      include: {
        qcEntries: { where: QC_ENTRY_ACTIVE_WHERE },
        workOrderLine: { select: { plannedQty: true, qty: true } },
      },
    }),
    db.qcRejectedDisposition.count({
      where: {
        voidedAt: null,
        closedAt: null,
        remainingQty: { gt: 0 },
        status: { in: ["REWORK_PENDING_SUPERVISOR", "REWORK_APPROVED_PENDING_EXECUTION", "REWORK_READY_FOR_QC", "HOLD"] },
        workOrder: { salesOrderId: soId, cycleId },
      },
    }),
    computeNoQtyCreateNextRsEligibility(db, { salesOrderId: soId, cycleId }),
    db.salesOrderCycle.findFirst({
      where: { id: cycleId, salesOrderId: soId },
      select: { noQtyTreatFgAsOptionalStoreStock: true },
    }),
    findNoQtyNextRollingRequirementSheetTarget(db, soId, cycleId),
  ]);

  const requirementExists = (reqSheets || []).length > 0;
  const requirementLocked = (reqSheets || []).some((s) => s.status === "LOCKED");
  const workOrderExists = (workOrders || []).length > 0;
  const workOrderId = workOrders && workOrders.length ? Number(workOrders[workOrders.length - 1].id) : null;
  const productionExists = Boolean(prodAny?.id);
  const qcExists = Boolean(qcAny?.id);
  const dispatchExists = (dispatchRows || []).some((d) => d.workflowStatus === "LOCKED");
  const dispatchIds = (dispatchRows || []).map((d) => Number(d.id)).filter((id) => Number.isFinite(id) && id > 0);
  const billAny = dispatchIds.length
    ? await db.salesBill.findFirst({
        where: { dispatchId: { in: dispatchIds }, status: { in: ["DRAFT", "FINALIZED"] } },
        select: { id: true },
      })
    : null;
  const salesBillExists = Boolean(billAny?.id);

  let qcPendingForCycle = false;
  let approvedProducedQty = 0;
  let qcAcceptedQty = 0;
  let plannedQty = 0;
  for (const wo of workOrders || []) {
    for (const line of wo.lines || []) {
      const linePlan = Math.max(Number(line.plannedQty ?? 0), Number(line.qty ?? 0));
      if (Number.isFinite(linePlan) && linePlan > 0) plannedQty += linePlan;
    }
  }
  for (const pe of productionRows || []) {
    const producedQty = Number(pe.producedQty ?? 0);
    const acceptedQty = sumActiveQcAcceptedQty(pe.qcEntries || []);
    const rejectedQty = sumActiveQcRejectedQty(pe.qcEntries || []);
    const pendingQty = getProductionBatchQcPendingQty(producedQty, acceptedQty, rejectedQty);
    approvedProducedQty += Number.isFinite(producedQty) ? producedQty : 0;
    qcAcceptedQty += Number.isFinite(acceptedQty) ? acceptedQty : 0;
    if (pendingQty > NO_QTY_WORKFLOW_EPS && acceptedQty <= NO_QTY_WORKFLOW_EPS && rejectedQty <= NO_QTY_WORKFLOW_EPS) {
      qcPendingForCycle = true;
    }
  }

  const { hasQcAcceptedUndispatched, dispatchableQty } = await loadNoQtyDispatchableFacts(db, soId, cycleId);
  const productionRemainingQty = Math.max(0, plannedQty - approvedProducedQty);
  const carryForwardShortageOnly =
    createNextRs.eligible &&
    !qcPendingForCycle &&
    pendingDispositionCount <= 0 &&
    (productionExists || productionRemainingQty <= NO_QTY_WORKFLOW_EPS);

  const secondary = [];
  const optional = [];
  let primaryAction;
  const blockedReasons = [];

  if (isCompleted) {
    primaryAction = "DONE";
  } else if (qcPendingForCycle) {
    primaryAction = "QC";
  } else if (pendingDispositionCount > 0) {
    primaryAction = "QC";
    blockedReasons.push("REWORK_OR_HOLD_PENDING");
  } else if (createNextRs.eligible && carryForwardShortageOnly) {
    primaryAction = "NEXT_RS";
    if (productionRemainingQty > NO_QTY_WORKFLOW_EPS) optional.push("PRODUCTION");
    if (dispatchableQty > NO_QTY_WORKFLOW_EPS) secondary.push("DISPATCH");
  } else if (hasQcAcceptedUndispatched || dispatchableQty > NO_QTY_WORKFLOW_EPS) {
    primaryAction = "DISPATCH";
    if (createNextRs.eligible) secondary.push("NEXT_RS");
  } else if (workOrderExists && (!productionExists || productionRemainingQty > NO_QTY_WORKFLOW_EPS)) {
    primaryAction = "PRODUCTION";
    if (createNextRs.eligible) secondary.push("NEXT_RS");
  } else if (dispatchExists && !salesBillExists) {
    primaryAction = "SALES_BILL";
  } else if (salesBillExists) {
    primaryAction = "SALES_BILL";
  } else if (workOrderExists) {
    primaryAction = productionExists ? "DISPATCH" : "PRODUCTION";
  } else if (requirementLocked) {
    primaryAction = "WORK_ORDER";
  } else if (requirementExists) {
    primaryAction = "REQUIREMENT";
  } else {
    primaryAction = "REQUIREMENT";
  }

  // NO_QTY next-cycle planning is Store-owned and may run parallel to shop-floor work.
  if (createNextRs.eligible && primaryAction !== "NEXT_RS") {
    secondary.push("NEXT_RS");
  }

  let placementStage = null;
  if (requirementLocked && !workOrderExists && cycleId) {
    placementStage = await assessNoQtyPlacementStageForCycle(db, { salesOrderId: soId, cycleId });
  }

  const legacyNextAction = primaryAction === "NEXT_RS" ? "REQUIREMENT" : primaryAction;
  const displaySummary =
    primaryAction === "NEXT_RS"
      ? "Cycle completed. Ready for Next RS."
      : primaryAction === "QC"
        ? "QC or rework/hold action is pending."
        : primaryAction === "DISPATCH"
          ? "QC-accepted quantity is ready for dispatch."
          : primaryAction === "PRODUCTION"
            ? "Production is still available for this cycle."
            : primaryAction === "WORK_ORDER"
              ? placementStage?.readyToPlaceWo
                ? "RM available. Ready for Store to place Work Order(s)."
                : placementStage?.released
                  ? "Procurement in progress. Store will place Work Order(s) when RM is ready."
                  : "Monthly planning release is pending before Work Order placement."
              : primaryAction === "SALES_BILL"
                ? "Dispatch is ready for billing."
                : primaryAction === "DONE"
                  ? "NO_QTY workflow is complete."
                  : "NO_QTY Requirement Sheet planning is pending.";
  const rolePayload = roleAwareActionPayload({
    role: userRole,
    overallAction: primaryAction,
    secondaryActions: secondary,
    optionalActions: optional,
    salesOrderId: soId,
    cycleId,
    displaySummary,
  });

  return {
    salesOrderId: soId,
    canonicalSalesOrderId: soId,
    cycleId,
    canonicalCycleId: cycleId,
    canonicalCycleSource: resolved.source,
    cycleStatus: cycle?.status ?? null,
    cycleNo: cycle?.cycleNo ?? null,
    isCompleted,
    requirementExists,
    requirementLocked,
    workOrderExists,
    workOrderId,
    productionExists,
    qcExists,
    qcPendingForCycle,
    hasQcDispatchPending: hasQcAcceptedUndispatched,
    dispatchableQty,
    productionRemainingQty,
    approvedProducedQty,
    qcAcceptedQty,
    carryForwardShortageOnly,
    treatFgAsOptionalStoreStock: Boolean(cycleUi?.noQtyTreatFgAsOptionalStoreStock),
    nextRollingRequirementSheetId: rolling.sheetId,
    nextRollingRequirementSheetCycleId: rolling.cycleId,
    dispatchExists,
    salesBillExists,
    nextAction: legacyNextAction,
    activeStep: stepFromAction(primaryAction),
    createNextRsEligible: createNextRs.eligible,
    nextRsAlreadyCreatedDocNo: createNextRs.existingNextRsDocNo,
    createNextRsBlockReason: createNextRs.eligible ? null : createNextRs.reason ?? null,
    createNextRsBlockingPmrDocNo: createNextRs.blockingPmrDocNo ?? null,
    createNextRsBlockingPmrStatus: createNextRs.blockingPmrStatus ?? null,
    readyToPlaceWo: placementStage?.readyToPlaceWo ?? false,
    placementProcessStageKey: placementStage?.processStageKey ?? null,
    placementRequirementSheetId: placementStage?.requirementSheetId ?? null,
    primaryAction,
    ...rolePayload,
    secondaryActions: uniqActions(secondary),
    optionalActions: uniqActions(optional),
    actionLabel: ACTION_LABELS[primaryAction] ?? primaryAction,
    actionHref: actionHref(primaryAction, soId, cycleId),
    blockedReasons: uniqActions(blockedReasons),
    displaySummary,
    workflowSummary: displaySummary,
  };
}

module.exports = {
  NO_QTY_WORKFLOW_EPS,
  resolveNoQtyWorkflowState,
  ACTION_OWNERS,
  ACTION_LABELS,
  userOwnsAction,
  actionHref,
  _test: {
    roleAwareActionPayload,
    userOwnsAction,
    departmentMessageFor,
  },
};
