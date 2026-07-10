/**
 * Unified Pending Actions read model (P8B).
 * Aggregates existing operational queue snapshots — no new workflow rules.
 */

const { prisma } = require("../utils/prisma");
const { getOrSetRequestCache } = require("../utils/prismaQueryMetrics");
const {
  CONTROL_TOWER_ROW_MODES,
  fetchMergedNormalizedRows,
  fetchStoreScopedNormalizedRows,
} = require("./controlTowerNormalizedRowsService");
const { dedupeRoleQueueRows, attachRowIdentity } = require("./controlTowerRowIdentity");
const { RISK_LEVELS, ROW_TYPES } = require("./controlTowerRowNormalizer");

const EPS = 1e-6;

const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");
const {
  NO_QTY_MONTHLY_PLANNING_GATE,
  assessNoQtyMonthlyPlanningGate,
  isNoQtyMonthlyPlanningGateExecutionReady,
} = require("./noQtyMonthlyPlanningGateService");
const { getEligibleDispatches } = require("./salesBillService");
const {
  getQuotationsPendingSalesOrderRows,
} = require("./dashboardQueueSnapshots");
const { buildProcurementPendingQueue, buildGrnPendingSection } = require("./procurementWorkspaceService");
const { buildStoreIssuePendingDashboardRows, buildStoreProductionHandoffDashboardRows, buildMaterialAvailabilityWorkspace } = require("./materialAvailabilityWorkspaceService");
const {
  loadStoreProductionReleaseEligibilityByWorkOrder,
} = require("./productionMaterialRequestService");
const {
  computeNoQtyCreateNextRsEligibility,
  computeNoQtyCreateNextRsEligibilityResolved,
  resolveNoQtyEligibilityCycleId,
} = require("./noQtyCreateNextRsEligibility");
const { assessNoQtyPlacementStageForCycle } = require("./requirementSheetExecutionService");
const {
  deriveActionNeeded,
  mapRmCoverage,
  resolvePlaceWoActionLabel,
} = require("./noQtyExecutionRegisterService");
const { formatQuantityWithUnit } = require("./quantityDisplayService");
const { buildGreenLevelWoPlacement, GREEN_LEVEL_WO_SOURCE_TYPE } = require("./greenLevelWorkOrderService");
const {
  WAITING_FOR_PURCHASE_RM_PO,
  PREPARE_RM_PO,
  RM_ISSUED_WAITING_FOR_PRODUCTION,
  READY_TO_START_PRODUCTION,
  resolveRmRiskPendingAction,
  resolveProcurementDemandPool,
} = require("./rmProcurementStageSignals");
const {
  productionExecutionPendingActionLabel,
  PRODUCTION_EXECUTION_PENDING_LABELS,
} = require("./productionExecutionService");
const { listProductionRmReturnPending } = require("./productionWorkOrderReportService");
const { getDispatchBacklogRows } = require("./dashboardQueueSnapshots");
const { fetchNoQtyRecoveryPendingActions } = require("./noQtyRecoveryAnalyticsService");
const {
  buildStoreDispatchPendingActionLabel,
  isStoreDispatchWorkflowTriggerAction,
  resolveStoreDispatchPendingActionGroups,
} = require("./dispatchWorkflowTriggers");
const {
  appendProductionBucketToProductionHref,
  buildProductionWorkspaceHrefFromPendingMeta,
} = require("./productionWorkspaceHref");

const STORE_ISSUE_PENDING_ACTION = "Issue Material";
const STORE_ISSUE_REMAINING_ACTION = "Issue Remaining Material";
const STORE_RELEASE_TO_PRODUCTION_ACTION = "Release to Production";
const RM_RETURN_PENDING_ACTION = "RM Return Pending";
const DISPATCH_PENDING_ACTION = "Dispatch Pending";
const STORE_DISPATCH_READY_PREFIX = "Ready to Dispatch";
const GRN_PENDING_ACTION = "GRN Pending";
const PURCHASE_PO_PREP_ACTIONS = new Set([PREPARE_RM_PO, "Create PO"]);
const PROCUREMENT_PENDING_ACTIONS = new Set([
  "Create Purchase Request",
  "Resolve RM Shortage",
  WAITING_FOR_PURCHASE_RM_PO,
  PREPARE_RM_PO,
]);

const PENDING_PRIORITY = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
});

function releaseHandoffQty(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatReleaseHandoffPmrStatus(status) {
  const token = String(status ?? "").trim().toUpperCase();
  if (token === "FULLY_ISSUED") return "Fully issued";
  if (token === "SHORT_ISSUE_ACCEPTED") return "Short issue accepted";
  return token.replaceAll("_", " ") || "—";
}

function resolveReleaseHandoffSourceLabel({ sourceType, orderType, salesOrderDocNo }) {
  const st = String(sourceType ?? "").trim().toUpperCase();
  const ot = String(orderType ?? "").trim().toUpperCase();
  if (st === GREEN_LEVEL_WO_SOURCE_TYPE) return "Green Level · Stock Replenishment";
  if (ot === "NO_QTY") return salesOrderDocNo ? `NO_QTY · ${salesOrderDocNo}` : "NO_QTY";
  if (salesOrderDocNo) return `Regular SO · ${salesOrderDocNo}`;
  return "Work Order";
}

function buildReleaseToProductionHref(row = {}) {
  const params = new URLSearchParams({ from: "pending-actions" });
  const woId = Number(row.workOrderId ?? 0);
  const pmrId = Number(row.pmrId ?? 0);
  const salesOrderId = Number(row.salesOrderId ?? 0);
  const workOrderLineId = Number(row.workOrderLineId ?? 0);
  const cycleId = Number(row.cycleId ?? 0);
  const requirementSheetId = Number(row.requirementSheetId ?? 0);
  const sourceType = String(row.sourceType ?? "").trim().toUpperCase();
  const orderType = String(row.orderType ?? "").trim().toUpperCase();
  if (woId > 0) params.set("workOrderId", String(woId));
  if (pmrId > 0) params.set("pmrId", String(pmrId));
  if (salesOrderId > 0) params.set("salesOrderId", String(salesOrderId));
  if (workOrderLineId > 0) params.set("workOrderLineId", String(workOrderLineId));
  if (cycleId > 0) params.set("cycleId", String(cycleId));
  if (requirementSheetId > 0) params.set("requirementSheetId", String(requirementSheetId));
  if (sourceType === GREEN_LEVEL_WO_SOURCE_TYPE || orderType === "GREEN_LEVEL") {
    params.set("flow", "GREEN_LEVEL");
  } else if (orderType && orderType !== "NO_QTY") {
    params.set("flow", "REGULAR_SO");
  }
  return `/production-release?${params.toString()}`;
}

const PRIORITY_SORT = Object.freeze({
  [PENDING_PRIORITY.HIGH]: 0,
  [PENDING_PRIORITY.MEDIUM]: 1,
  [PENDING_PRIORITY.LOW]: 2,
});

function parseUserRole(role) {
  return String(role ?? "")
    .trim()
    .toUpperCase();
}

function ageHoursFromTimestamp(ts) {
  if (!ts) return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return 0;
  return Math.floor(diff / (60 * 60 * 1000));
}

function timestampMs(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isRequirementSheetNewerThanPlan(sheet, plan) {
  if (!plan) return true;
  const planMs =
    timestampMs(plan.releasedAt) ??
    timestampMs(plan.approvedAt) ??
    timestampMs(plan.updatedAt) ??
    timestampMs(plan.createdAt);
  if (planMs == null) return true;
  const sheetMs = timestampMs(sheet?.updatedAt) ?? timestampMs(sheet?.createdAt);
  if (sheetMs == null) return true;
  return sheetMs > planMs;
}

function priorityFromRiskLevel(riskLevel) {
  const token = String(riskLevel ?? "").toUpperCase();
  if (token === RISK_LEVELS.CRITICAL || token === RISK_LEVELS.HIGH) return PENDING_PRIORITY.HIGH;
  if (token === RISK_LEVELS.MEDIUM) return PENDING_PRIORITY.MEDIUM;
  return PENDING_PRIORITY.LOW;
}

function priorityFromOperationalKey(key) {
  const token = String(key ?? "").toUpperCase();
  if (token.includes("CRITICAL") || token === "RM_SHORTAGE" || token === "CREATE_RS") {
    return PENDING_PRIORITY.HIGH;
  }
  if (
    token.includes("REVIEW") ||
    token.includes("SUBMIT") ||
    token.includes("RELEASE") ||
    token === "PR_PENDING_PO" ||
    token === "CREATE_PO"
  ) {
    return PENDING_PRIORITY.MEDIUM;
  }
  return PENDING_PRIORITY.LOW;
}

/** Requirement & Cycle Planning hub — create next-cycle RS (not Cycle 1 execution workspace). */
function buildNoQtyCreateNextRsPlanningHubHref(salesOrderId, opts = {}) {
  const sid = Number(salesOrderId);
  if (!Number.isFinite(sid) || sid <= 0) return "/planning-dashboard";
  const params = new URLSearchParams();
  params.set("salesOrderId", String(Math.trunc(sid)));
  params.set("source", "no_qty_planning");
  params.set("action", "create-next-rs");
  const from = opts.from != null ? String(opts.from).trim() : "pending-actions";
  if (from) params.set("from", from);
  const nextCycleNo = opts.nextCycleNo != null ? Number(opts.nextCycleNo) : NaN;
  if (Number.isFinite(nextCycleNo) && nextCycleNo > 0) {
    params.set("nextCycleNo", String(Math.trunc(nextCycleNo)));
  }
  return `/planning-dashboard?${params.toString()}`;
}

/** Requirement Sheet Creation Workspace — first RS or draft continuation (not execution / Place WO). */
function buildNoQtyRsCreationWorkspaceHref(salesOrderId, opts = {}) {
  const sid = Number(salesOrderId);
  if (!Number.isFinite(sid) || sid <= 0) return "/sales-orders?soType=NO_QTY";
  const params = new URLSearchParams();
  params.set("intent", "add");
  params.set("source", "no_qty_so");
  params.set("salesOrderId", String(sid));
  const cycleId = opts.cycleId != null ? Number(opts.cycleId) : 0;
  if (Number.isFinite(cycleId) && cycleId > 0) params.set("cycleId", String(cycleId));
  const from = opts.from != null ? String(opts.from).trim() : "pending-actions";
  if (from) params.set("from", from);
  return `/sales-orders/${sid}/requirement-sheets?${params.toString()}`;
}

function resolveNoQtyPlanningWorkspaceHref(row) {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const salesOrderId = Number(meta.salesOrderId ?? 0);
  if (salesOrderId <= 0) return "/sales-orders?soType=NO_QTY";
  const rsStatus = String(meta.latestRequirementSheetStatus ?? meta.sourceStatus ?? "")
    .trim()
    .toUpperCase();
  const hasSheet =
    meta.latestRequirementSheetId != null &&
    Number.isFinite(Number(meta.latestRequirementSheetId)) &&
    Number(meta.latestRequirementSheetId) > 0;
  const sourceNext = String(meta.sourceNextAction ?? "").trim().toUpperCase();
  const nextAction = String(row?.nextAction ?? "").trim();
  const isCreateRs =
    sourceNext === "CREATE_RS" ||
    (!hasSheet && (!rsStatus || rsStatus === "NO_RS")) ||
    /^Create RS/i.test(nextAction);
  if (isCreateRs || rsStatus === "DRAFT") {
    return buildNoQtyRsCreationWorkspaceHref(salesOrderId, {
      cycleId: meta.cycleId ?? null,
      from: "pending-actions",
    });
  }
  const params = new URLSearchParams();
  params.set("source", "no_qty_so");
  params.set("salesOrderId", String(salesOrderId));
  if (meta.cycleId != null && Number(meta.cycleId) > 0) params.set("cycleId", String(meta.cycleId));
  return `/sales-orders/${salesOrderId}/requirement-sheets?${params.toString()}`;
}

function resolveHrefForNormalizedRow(row, role = "STORE") {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const rowType = String(row?.rowType ?? "");
  if (rowType === ROW_TYPES.RM_RISK) {
    const executionStarted =
      String(meta.productionExecutionStatus ?? "NOT_STARTED").trim().toUpperCase() !== "NOT_STARTED";
    if (
      role === "STORE" &&
      String(meta.queueType ?? meta.sourceQueueType ?? "").trim() === "READY_TO_RELEASE_WO" &&
      !meta.materialReleasedToProduction &&
      !meta.workOrderReleased &&
      !executionStarted &&
      !meta.hasProductionEntry
    ) {
      return buildReleaseToProductionHref(meta);
    }
    const resolved = resolveRmRiskPendingAction(meta, {
      queueType: meta.queueType ?? meta.sourceQueueType,
      freeStockQty: meta.freeStockQty,
      netShortageAfterIncomingQty: meta.netShortageAfterIncomingQty,
      recommendedAction: row?.nextAction,
    }, role);
    return resolved.href;
  }

  const salesOrderId = Number(meta.salesOrderId ?? 0);
  const workOrderId = Number(meta.workOrderId ?? 0);

  if (rowType === ROW_TYPES.CONTINUE_WORKING && salesOrderId > 0) {
    const stage = String(meta.sourceStageKey ?? "").toUpperCase();
    if (stage === "NEXT_RS") {
      const docCycle = meta.cycleNo != null ? Number(meta.cycleNo) : null;
      const nextCycle =
        Number.isFinite(docCycle) && docCycle > 0
          ? docCycle + 1
          : meta.nextCycleNo != null
            ? Number(meta.nextCycleNo)
            : null;
      return buildNoQtyCreateNextRsPlanningHubHref(salesOrderId, {
        nextCycleNo: nextCycle,
        from: "pending-actions",
      });
    }
    if (stage === "PRODUCTION") {
      return buildProductionWorkspaceHrefFromPendingMeta(
        {
          ...meta,
          salesOrderId,
        },
        "pending-actions",
      );
    }
  }

  if (meta.href && String(meta.href).trim()) return String(meta.href).trim();

  if (rowType === ROW_TYPES.NO_QTY_PLANNING && salesOrderId > 0) {
    return resolveNoQtyPlanningWorkspaceHref(row);
  }
  if (rowType === ROW_TYPES.WO_PLANNING && salesOrderId > 0) {
    return `/work-orders/prepare?salesOrderId=${salesOrderId}&from=pending-actions`;
  }
  if (rowType === ROW_TYPES.DISPATCH_BACKLOG && salesOrderId > 0) {
    const params = new URLSearchParams({ salesOrderId: String(salesOrderId), source: "pending-actions" });
    if (meta.itemId != null && Number(meta.itemId) > 0) params.set("itemId", String(meta.itemId));
    if (meta.cycleId != null && Number(meta.cycleId) > 0) params.set("cycleId", String(meta.cycleId));
    return `/dispatch?${params.toString()}`;
  }
  if (rowType === ROW_TYPES.CONTINUE_WORKING) {
    if (salesOrderId > 0) {
      const stage = String(meta.sourceStageKey ?? "").toUpperCase();
      if (stage === "DISPATCH") {
        const params = new URLSearchParams({ salesOrderId: String(salesOrderId), source: "pending-actions" });
        const itemId = Number(meta.itemId ?? 0);
        if (itemId > 0) params.set("itemId", String(itemId));
        const cycleId = Number(meta.cycleId ?? 0);
        if (cycleId > 0) params.set("cycleId", String(cycleId));
        const salesOrderLineId = Number(meta.salesOrderLineId ?? 0);
        if (salesOrderLineId > 0) params.set("salesOrderLineId", String(salesOrderLineId));
        return `/dispatch?${params.toString()}`;
      }
      if (stage === "QC") {
        const params = new URLSearchParams({ source: "pending-actions" });
        params.set("salesOrderId", String(salesOrderId));
        const woId = Number(meta.workOrderId ?? 0);
        if (woId > 0) params.set("workOrderId", String(woId));
        const productionId = Number(meta.productionId ?? 0);
        if (productionId > 0) params.set("productionId", String(productionId));
        return `/qc-entry?${params.toString()}#qc-production-pending`;
      }
      if (stage === "PRODUCTION") {
        return buildProductionWorkspaceHrefFromPendingMeta(
          { ...meta, salesOrderId },
          "pending-actions",
        );
      }
      if (stage === "SALES_BILL") {
        const dispatchId = Number(meta.dispatchId ?? 0);
        if (dispatchId > 0) {
          return `/sales-bills/new?dispatchId=${dispatchId}&from=pending-actions`;
        }
        return `/sales-bills/new?salesOrderId=${salesOrderId}&from=pending-actions`;
      }
    }
    if (meta.href) return String(meta.href);
  }
  if (rowType === ROW_TYPES.PRODUCTION_QUEUE && workOrderId > 0) {
    const sourceNext = String(meta.sourceNextAction ?? "").trim().toUpperCase();
    const productionId = Number(meta.productionId ?? 0);
    if (sourceNext === "QC_PENDING" || row?.currentStatus === "QA_PENDING") {
      const params = new URLSearchParams({ source: "pending-actions" });
      if (salesOrderId > 0) params.set("salesOrderId", String(salesOrderId));
      params.set("workOrderId", String(workOrderId));
      if (productionId > 0) params.set("productionId", String(productionId));
      return `/qc-entry?${params.toString()}#qc-production-pending`;
    }
    const actionHref = String(meta.actionHref ?? "").trim();
    if (actionHref) return actionHref;
    return buildProductionWorkspaceHrefFromPendingMeta(meta, "pending-actions");
  }
  if (rowType === ROW_TYPES.QA_QUEUE) {
    const params = new URLSearchParams({ source: "pending-actions" });
    if (salesOrderId > 0) params.set("salesOrderId", String(salesOrderId));
    if (workOrderId > 0) params.set("workOrderId", String(workOrderId));
    const productionId = Number(meta.productionId ?? 0);
    if (productionId > 0) params.set("productionId", String(productionId));
    return `/qc-entry?${params.toString()}#qc-production-pending`;
  }
  if (rowType === ROW_TYPES.QA_REWORK) {
    const dispId = Number(meta.dispositionId ?? 0);
    const sourceStatus = String(meta.sourceStatus ?? "").trim().toUpperCase();
    const hash =
      sourceStatus === "HOLD"
        ? "#qc-hold-decisions"
        : sourceStatus === "REWORK_PENDING_SUPERVISOR"
          ? "#qc-rework-supervisor"
          : "#qc-rework-pending";
    if (dispId > 0) return `/qc-entry?source=pending-actions${hash}`;
    if (workOrderId > 0) return `/qc-entry?workOrderId=${workOrderId}&source=pending-actions${hash}`;
  }
  if (workOrderId > 0) return `/work-orders?highlight=${workOrderId}&from=pending-actions`;
  if (salesOrderId > 0) return resolveNoQtyPlanningWorkspaceHref(row);
  return "/dashboard";
}

function friendlyActionForNormalizedRow(row, role = "STORE") {
  const rowType = String(row?.rowType ?? "");
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const nextAction = String(row?.nextAction ?? "").trim();
  const status = String(row?.currentStatus ?? "").toUpperCase();

  if (rowType === ROW_TYPES.PRODUCTION_QUEUE) {
    const sourceNextAction = String(meta.sourceNextAction ?? "").trim();
    if (
      nextAction === "Complete QA" ||
      nextAction === "QC_PENDING" ||
      sourceNextAction === "QC_PENDING" ||
      status === "QA_PENDING"
    ) {
      return "QC Pending";
    }
    const execStatus =
      meta.productionExecutionStatus ??
      (nextAction === "PRODUCTION_EXECUTION_BLOCKED"
        ? "BLOCKED"
        : nextAction === "PRODUCTION_SHORTFALL_DECISION"
          ? "SHORTFALL_PENDING"
          : null);
    if (execStatus === "BLOCKED" || execStatus === "SHORTFALL_PENDING") {
      const label = productionExecutionPendingActionLabel(execStatus);
      if (label) return label;
    }
    if (status.includes("ON_HOLD")) return "Production On Hold";
    const label = productionExecutionPendingActionLabel(execStatus);
    if (label) return label;
    return PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING;
  }
  if (rowType === ROW_TYPES.QA_QUEUE) return "QC Pending";
  if (rowType === ROW_TYPES.QA_REWORK) {
    const sourceStatus = String(meta.sourceStatus ?? "").trim().toUpperCase();
    if (sourceStatus === "HOLD") return "Hold Decision Pending";
    if (sourceStatus === "REWORK_PENDING_SUPERVISOR") return "Rework Approval Pending";
    return "Rework Pending";
  }
  if (rowType === ROW_TYPES.DISPATCH_BACKLOG || status === "DISPATCH_PENDING") return DISPATCH_PENDING_ACTION;
  if (rowType === ROW_TYPES.CONTINUE_WORKING) {
    const stage = String(meta.sourceStageKey ?? "").toUpperCase();
    if (stage === "DISPATCH") return DISPATCH_PENDING_ACTION;
    if (stage === "QC") return "QC Pending";
    if (stage === "PRODUCTION") return PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING;
    if (stage === "SALES_BILL") return "Create Sales Bill";
    if (stage === "NEXT_RS") {
      const docCycle = meta.cycleNo != null ? Number(meta.cycleNo) : null;
      const nextCycle = Number.isFinite(docCycle) && docCycle > 0 ? docCycle + 1 : null;
      return nextCycle != null
        ? `Create Cycle ${nextCycle} Requirement Sheet`
        : "Create Next Requirement Sheet";
    }
  }
  if (rowType === ROW_TYPES.RM_RISK) {
    const resolved = resolveRmRiskPendingAction(meta, {
      queueType: meta.queueType ?? meta.sourceQueueType,
      freeStockQty: meta.freeStockQty,
      netShortageAfterIncomingQty: meta.netShortageAfterIncomingQty,
      recommendedAction: row?.nextAction,
    }, role);
    if (resolved.action === "Create PO") return PREPARE_RM_PO;
    if (resolved.action === "GRN Pending") return "GRN Pending";
    return resolved.action;
  }
  if (nextAction) return nextAction;
  return "Open";
}

function mapNormalizedRowToPendingAction(row, role = "STORE") {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const enriched = row?.rowKey ? row : attachRowIdentity(row);
  const actionLabel = friendlyActionForNormalizedRow(enriched, role);
  let currentStatus = enriched.currentStatus ?? null;
  if (String(enriched.rowType ?? "") === ROW_TYPES.RM_RISK) {
    if (actionLabel === GRN_PENDING_ACTION) currentStatus = "GRN_PENDING";
    else if (meta.operationalKey) currentStatus = String(meta.operationalKey);
  }
  return {
    id: enriched.rowKey ?? enriched.sourceId,
    priority: priorityFromRiskLevel(enriched.riskLevel),
    action: actionLabel,
    documentNo: enriched.documentNo ?? null,
    ownerRole: String(enriched.currentOwner ?? "").toUpperCase(),
    ageHours: enriched.ageHours != null ? enriched.ageHours : null,
    href: appendProductionBucketToProductionHref(resolveHrefForNormalizedRow(enriched, role), actionLabel),
    sourceModule: enriched.sourceModule ?? null,
    currentStatus,
    purchaseOrderId: meta.primaryPoId != null ? Number(meta.primaryPoId) : null,
    materialRequirementId: meta.materialRequirementId != null ? Number(meta.materialRequirementId) : null,
  };
}

/**
 * Monthly plan lifecycle actions (Store submit / Purchase review / Store release).
 * @param {import('@prisma/client').PrismaClient} [db]
 * @param {{ role?: string | null }} [opts]
 */
async function fetchMonthlyPlanPendingActions(db = prisma, opts = {}) {
  const role = parseUserRole(opts.role);
  /** @type {import('@prisma/client').Prisma.MonthlyProductionPlanWhereInput} */
  let where;
  if (role === "STORE") {
    where = {
      OR: [{ status: "DRAFT" }, { status: "APPROVED", releasedAt: null }],
    };
  } else if (role === "PURCHASE") {
    where = { status: "AWAITING_PURCHASE_REVIEW" };
  } else {
    where = {
      OR: [
        { status: "DRAFT" },
        { status: "AWAITING_PURCHASE_REVIEW" },
        { status: "APPROVED", releasedAt: null },
      ],
    };
  }

  const plans = await db.monthlyProductionPlan.findMany({
    where,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      docNo: true,
      periodKey: true,
      planSequenceNo: true,
      status: true,
      updatedAt: true,
      createdAt: true,
      releasedAt: true,
    },
  });

  const actions = [];
  for (const plan of plans) {
    const displayLabel = buildPlanDisplayLabel(plan);
    const docNo = plan.docNo?.trim() || displayLabel || `Plan-${plan.id}`;
    const periodKey = plan.periodKey;
    const href = `/monthly-planning?period=${encodeURIComponent(periodKey)}&planId=${plan.id}&monthlyPlanId=${plan.id}&from=pending-actions`;
    const ageHours = ageHoursFromTimestamp(plan.updatedAt ?? plan.createdAt);

    if (plan.status === "DRAFT") {
      actions.push({
        id: `monthly-plan:draft:${plan.id}`,
        priority: PENDING_PRIORITY.MEDIUM,
        action: "Complete Monthly Plan Draft",
        documentNo: docNo,
        ownerRole: "STORE",
        ageHours,
        href,
        sourceModule: "MONTHLY_PLANNING",
        currentStatus: "DRAFT",
        planId: plan.id,
        monthlyPlanId: plan.id,
      });
    } else if (plan.status === "AWAITING_PURCHASE_REVIEW") {
      actions.push({
        id: `monthly-plan:review:${plan.id}`,
        priority: PENDING_PRIORITY.MEDIUM,
        action: `Review ${displayLabel}`,
        documentNo: docNo,
        ownerRole: "PURCHASE",
        ageHours,
        href,
        sourceModule: "MONTHLY_PLANNING",
        currentStatus: "AWAITING_PURCHASE_REVIEW",
        planId: plan.id,
        monthlyPlanId: plan.id,
      });
    } else if (plan.status === "APPROVED" && plan.releasedAt == null) {
      let emitRelease = true;
      try {
        const {
          assessMonthlyPlanProcurementOutcome,
          completeProcurementHandoffIfNotRequired,
          MONTHLY_PLAN_PROCUREMENT_OUTCOME,
        } = require("./monthlyPlanningProcurementOutcomeService");
        const assessment = await assessMonthlyPlanProcurementOutcome({ db, planId: plan.id, plan });
        if (assessment.outcome === MONTHLY_PLAN_PROCUREMENT_OUTCOME.PROCUREMENT_NOT_REQUIRED) {
          await completeProcurementHandoffIfNotRequired({ db, planId: plan.id });
          emitRelease = false;
        }
      } catch {
        emitRelease = true;
      }
      if (emitRelease) {
        actions.push({
          id: `monthly-plan:release:${plan.id}`,
          priority: PENDING_PRIORITY.MEDIUM,
          action: `Release ${displayLabel}`,
          documentNo: docNo,
          ownerRole: "STORE",
          ageHours,
          href,
          sourceModule: "MONTHLY_PLANNING",
          currentStatus: "APPROVED",
          planId: plan.id,
          monthlyPlanId: plan.id,
        });
      }
    }
  }
  return actions;
}

async function fetchAdminCommercialPendingActions(db = prisma) {
  const [quotations, salesBillActions, tallyExportActions] = await Promise.all([
    getQuotationsPendingSalesOrderRows({ limit: 50 }),
    fetchAdminSalesBillPendingActions(db),
    fetchAdminTallyExportPendingActions(db),
  ]);
  const quotationActions = quotations.map((q) => ({
    id: q.key ?? `quotation-pending-so-${q.quotationId}`,
    priority: PENDING_PRIORITY.MEDIUM,
    action: "Create Sales Order from Quotation",
    documentNo: q.quotationNo ?? null,
    ownerRole: "ADMIN",
    ageHours: null,
    href: q.href ?? `/sales-orders?quotationId=${q.quotationId}`,
    sourceModule: "QUOTATION",
    currentStatus: "QUOTATION_APPROVED",
  }));
  return [...quotationActions, ...salesBillActions, ...tallyExportActions];
}

async function fetchAdminSalesBillPendingActions(db = prisma) {
  const eligible = await getEligibleDispatches(db);
  return eligible.slice(0, 50).map((d) => {
    const dispatchNo = d.dispatchNo ?? `D-${d.dispatchId}`;
    const soDoc = d.salesOrderDocNo ?? (d.salesOrderId ? `SO-${d.salesOrderId}` : null);
    const customer = d.customerName ? String(d.customerName).trim() : "";
    const documentNo = [dispatchNo, soDoc, customer].filter(Boolean).join(" · ");
    const href =
      d.hasDraftBill && d.draftBillId
        ? `/sales-bills/${d.draftBillId}?from=pending-actions`
        : `/sales-bills/new?dispatchId=${d.dispatchId}&from=pending-actions`;
    return {
      id: `admin:sales-bill:dispatch:${d.dispatchId}`,
      priority: PENDING_PRIORITY.MEDIUM,
      action: "Create Sales Bill",
      documentNo: documentNo || dispatchNo,
      ownerRole: "ADMIN",
      ageHours: d.dispatchDate ? ageHoursFromTimestamp(d.dispatchDate) : null,
      href,
      sourceModule: "SALES_BILL",
      currentStatus: "SALES_BILL_PENDING",
    };
  });
}

async function fetchAdminTallyExportPendingActions(db = prisma) {
  const bills = await db.salesBill.findMany({
    where: { status: "FINALIZED", cancelledAt: null, isExported: false },
    select: {
      id: true,
      docNo: true,
      billNo: true,
      billDate: true,
      customerNameSnapshot: true,
    },
    orderBy: [{ billDate: "desc" }, { id: "desc" }],
    take: 50,
  });
  return bills.map((bill) => ({
    id: `admin:tally-export:sb:${bill.id}`,
    priority: PENDING_PRIORITY.MEDIUM,
    action: "Export to Tally",
    documentNo: bill.docNo?.trim() || bill.billNo?.trim() || `SB-${bill.id}`,
    ownerRole: "ADMIN",
    ageHours: ageHoursFromTimestamp(bill.billDate),
    href: `/sales-bills/${bill.id}?from=pending-actions`,
    sourceModule: "SALES_BILL_EXPORT",
    currentStatus: "EXPORT_PENDING",
  }));
}

function buildProcurementPlanningHrefForRow(row, demandPool) {
  const mrId = Number(row.materialRequirementId ?? 0);
  const params = new URLSearchParams({ returnTo: "pending-actions", demandPool });
  if (mrId > 0) params.set("materialRequirementId", String(mrId));
  if (row.workOrderId) params.set("workOrderId", String(row.workOrderId));
  if (row.salesOrderId) params.set("salesOrderId", String(row.salesOrderId));
  return `/procurement-planning?${params.toString()}`;
}

/**
 * Map procurement workspace queue row → Purchase pending action (read-model projection).
 * @param {object} row — buildProcurementPendingQueue() element
 * @returns {object | null}
 */
function mapProcurementQueueRowToPurchasePendingAction(row) {
  const nextKey = String(row.nextActionKey ?? "").trim().toUpperCase();
  const opKey = String(row.operationalKey ?? "").trim().toUpperCase();
  if (opKey === "GRN_PENDING" || nextKey === "OPEN_GRN") return null;
  if (opKey === "RM_READY" || opKey === "REOPEN_REQUIRED") return null;

  const purchaseActionable =
    nextKey === "CREATE_PR" ||
    nextKey === "CREATE_PO" ||
    nextKey === "OPEN_PO" ||
    opKey === "PROCUREMENT_PENDING" ||
    opKey === "PR_PENDING_PO" ||
    opKey === "SUPPLIER_PENDING";
  if (!purchaseActionable) return null;

  const mrId = Number(row.materialRequirementId ?? 0);
  const idSuffix = mrId || Number(row.workOrderId ?? 0) || Number(row.salesOrderId ?? 0);
  if (!idSuffix) return null;
  const docNo = row.docNo?.trim() || (mrId > 0 ? `MR-${mrId}` : null);
  const demandPool =
    row.procurementDemandPool?.trim() || resolveProcurementDemandPool(row.sourceType);
  const planningHref = buildProcurementPlanningHrefForRow(row, demandPool);
  const base = {
    documentNo: docNo,
    ownerRole: "PURCHASE",
    ageHours: ageHoursFromTimestamp(row.createdAt),
    sourceModule: "PROCUREMENT",
    materialRequirementId: mrId > 0 ? mrId : null,
  };

  if (nextKey === "CREATE_PO" || opKey === "PR_PENDING_PO") {
    return {
      ...base,
      id: `procurement:create-po:mr:${idSuffix}`,
      priority: priorityFromOperationalKey("CREATE_PO"),
      action: PREPARE_RM_PO,
      href: planningHref,
      currentStatus: "PR_PENDING_PO",
    };
  }

  if (nextKey === "CREATE_PR" || opKey === "PROCUREMENT_PENDING") {
    return {
      ...base,
      id: `procurement:create-pr:mr:${idSuffix}`,
      priority: priorityFromOperationalKey("CREATE_PR"),
      action: "Create Purchase Request",
      href: planningHref,
      currentStatus: "PROCUREMENT_PENDING",
    };
  }

  const poId = Number(row.primaryPoId ?? 0);
  return {
    ...base,
    id: poId > 0 ? `procurement:open-po:${poId}` : `procurement:supplier-pending:mr:${idSuffix}`,
    priority: priorityFromOperationalKey("OPEN_PO"),
    action: "Follow up Purchase Order",
    href: poId > 0 ? `/rm-po-grn/${poId}?from=pending-actions` : planningHref,
    currentStatus: "SUPPLIER_PENDING",
    purchaseOrderId: poId > 0 ? poId : null,
  };
}

async function fetchPurchaseProcurementPendingActions(db = prisma) {
  const procurementPending = await buildProcurementPendingQueue(db);
  const actions = [];
  const seenMr = new Set();

  for (const row of procurementPending) {
    const action = mapProcurementQueueRowToPurchasePendingAction(row);
    if (!action) continue;
    const mrId = Number(row.materialRequirementId ?? 0);
    if (mrId > 0) {
      if (seenMr.has(mrId)) continue;
      seenMr.add(mrId);
    }
    actions.push(action);
  }

  return actions;
}

async function fetchStoreGrnPendingActions(db = prisma) {
  const grnPending = await buildGrnPendingSection(db);
  const byPo = new Map();

  for (const row of grnPending) {
    const poId = Number(row.purchaseOrderId ?? 0);
    if (poId <= 0 || byPo.has(poId)) continue;
    byPo.set(poId, {
      id: `procurement:grn:po:${poId}`,
      priority: PENDING_PRIORITY.LOW,
      action: GRN_PENDING_ACTION,
      documentNo: row.purchaseOrderDocNo ?? `PO-${poId}`,
      ownerRole: "STORE",
      ageHours: null,
      href: `/rm-po-grn?poId=${poId}&from=pending-actions`,
      sourceModule: "PROCUREMENT",
      currentStatus: "GRN_PENDING",
      purchaseOrderId: poId,
    });
  }

  return [...byPo.values()];
}

async function fetchStoreIssuePendingActions(db = prisma, opts = {}) {
  const rows = await buildStoreIssuePendingDashboardRows(db, opts);

  return rows.map((row) => {
    const woId = Number(row.workOrderId ?? 0);
    const pmrId = row.pmrId != null ? Number(row.pmrId) : 0;
    const pmrIssued = Number(row.pmrIssuedQty ?? 0);
    const pmrRemaining = Number(row.pmrRemainingQty ?? 0);
    const action =
      pmrIssued > EPS && pmrRemaining > EPS ? STORE_ISSUE_REMAINING_ACTION : STORE_ISSUE_PENDING_ACTION;
    const params = new URLSearchParams({ returnTo: "pending-actions", onlyBlocked: "1" });
    if (woId > 0) params.set("workOrderId", String(woId));
    if (pmrId > 0) params.set("pmrId", String(pmrId));
    if (row.salesOrderId) params.set("salesOrderId", String(row.salesOrderId));
    if (row.materialRequirementId) params.set("materialRequirementId", String(row.materialRequirementId));
    return {
      id: `store-issue:wo:${woId}:${action === STORE_ISSUE_REMAINING_ACTION ? "remaining" : "initial"}`,
      priority: PENDING_PRIORITY.MEDIUM,
      action,
      documentNo: row.workOrderNo ?? row.salesOrderDocNo ?? null,
      ownerRole: "STORE",
      ageHours: null,
      href: `/material-issue?${params.toString()}`,
      sourceModule: "MATERIAL_ISSUE",
      currentStatus: action === STORE_ISSUE_REMAINING_ACTION ? "STORE_ISSUE_REMAINING" : "STORE_ISSUE_PENDING",
    };
  });
}

function formatStoreDispatchPendingQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return String(Math.round(n * 1000) / 1000);
}

function isStoreDispatchLifecycleAction(action) {
  const label = String(action?.action ?? "").trim();
  if (label === DISPATCH_PENDING_ACTION || label === "Dispatch") return true;
  if (isStoreDispatchWorkflowTriggerAction(label)) return true;
  return label.startsWith(STORE_DISPATCH_READY_PREFIX);
}

async function fetchStoreDispatchPendingActions(db = prisma) {
  const rows = await getDispatchBacklogRows();
  const groups = await resolveStoreDispatchPendingActionGroups(db, rows);

  return groups
    .sort((a, b) => {
      const ta = a.salesOrderDate ? new Date(a.salesOrderDate).getTime() : 0;
      const tb = b.salesOrderDate ? new Date(b.salesOrderDate).getTime() : 0;
      return ta - tb;
    })
    .slice(0, 50)
    .map((group) => {
      const soDoc = String(group.salesOrderDocNo ?? group.salesOrderNo ?? `SO-${group.salesOrderId}`).trim();
      const params = new URLSearchParams({
        salesOrderId: String(group.salesOrderId),
        source: "pending-actions",
      });
      return {
        id: `store:dispatch:so:${group.salesOrderId}`,
        priority: PENDING_PRIORITY.MEDIUM,
        action: buildStoreDispatchPendingActionLabel(
          soDoc,
          formatStoreDispatchPendingQty(group.totalQty),
          group.trigger,
        ),
        documentNo: soDoc,
        ownerRole: "STORE",
        ageHours: group.salesOrderDate ? ageHoursFromTimestamp(group.salesOrderDate) : null,
        href: `/dispatch?${params.toString()}`,
        sourceModule: "DISPATCH",
        currentStatus: "DISPATCH_PENDING",
        salesOrderId: group.salesOrderId,
      };
    });
}

async function fetchProductionRmReturnWaitingActions(db = prisma) {
  const rows = await listProductionRmReturnPending(db, { status: "PENDING", limit: 100 });
  const byWo = new Map();
  for (const row of rows) {
    const prev = byWo.get(row.workOrderId);
    if (!prev) byWo.set(row.workOrderId, { row, pendingCount: 1 });
    else prev.pendingCount += 1;
  }
  return [...byWo.values()].map(({ row, pendingCount }) => {
    const href = buildProductionWorkspaceHrefFromPendingMeta(
      {
        workOrderId: row.workOrderId,
        sourceType: row.workOrderSourceType ?? null,
        orderType: row.workOrderOrderType ?? null,
      },
      "pending-actions",
    );
    return {
      id: `production-rm-return-waiting:wo:${row.workOrderId}`,
      priority: PENDING_PRIORITY.MEDIUM,
      action: "RM Return Approval Pending",
      documentNo: row.workOrderNo ?? `WO-${row.workOrderId}`,
      ownerRole: "PRODUCTION",
      ageHours: ageHoursFromTimestamp(row.createdAt),
      href,
      sourceModule: "PRODUCTION_REPORT",
      currentStatus: "RM_RETURN_PENDING",
      workOrderId: row.workOrderId,
      metadata: { pendingCount },
    };
  });
}

async function fetchStoreProductionRmReturnPendingActions(db = prisma) {
  const rows = await listProductionRmReturnPending(db, {
    status: "PENDING",
    limit: 100,
    skipLocationResolution: true,
  });
  return rows.map((row) => {
    const params = new URLSearchParams({ from: "pending-actions", pendingId: String(row.id) });
    if (row.workOrderId) params.set("workOrderId", String(row.workOrderId));
    return {
      id: `production-rm-return-pending:${row.id}`,
      priority: PENDING_PRIORITY.MEDIUM,
      action: "RM Return Pending",
      documentNo: row.workOrderNo ?? `WO-${row.workOrderId}`,
      ownerRole: "STORE",
      ageHours: ageHoursFromTimestamp(row.createdAt),
      href: `/production/rm-returns?${params.toString()}`,
      sourceModule: "MATERIAL_RETURN",
      currentStatus: "RM_RETURN_PENDING",
      workOrderId: row.workOrderId,
      itemId: row.itemId,
      quantity: row.requestedQty,
      unit: row.unit,
      metadata: {
        productionReportId: row.productionReportId,
        pendingId: row.id,
        itemName: row.itemName,
      },
    };
  });
}

/**
 * P8F-A19 — Hide old-cycle NO_QTY RM handoff from Store pending actions once a later-cycle RS exists.
 * Execution remains visible in Production / WO / RM CC; this is pending-action presentation only.
 *
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {Array<{ workOrderId?: number | null; salesOrderId?: number | null }>} rows
 */
async function filterNoQtyStoreHandoffSupersededByLaterRs(db, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const woIds = [...new Set(list.map((r) => Number(r.workOrderId ?? 0)).filter((id) => id > 0))];
  if (!woIds.length) return list;

  const workOrders = await db.workOrder.findMany({
    where: { id: { in: woIds } },
    select: {
      id: true,
      salesOrderId: true,
      salesOrder: { select: { orderType: true } },
      cycle: { select: { cycleNo: true } },
    },
  });
  const woById = new Map(workOrders.map((wo) => [Number(wo.id), wo]));

  const noQtySoIds = [
    ...new Set(
      workOrders
        .filter((wo) => wo.salesOrder?.orderType === "NO_QTY" && wo.salesOrderId != null)
        .map((wo) => Number(wo.salesOrderId))
        .filter((id) => id > 0),
    ),
  ];

  /** @type {Map<number, number>} salesOrderId → highest cycleNo with DRAFT/LOCKED RS */
  const maxRsCycleNoBySo = new Map();
  if (noQtySoIds.length) {
    const laterRsRows = await db.requirementSheet.findMany({
      where: {
        salesOrderId: { in: noQtySoIds },
        status: { in: ["DRAFT", "LOCKED"] },
        cycleId: { not: null },
      },
      select: {
        salesOrderId: true,
        cycle: { select: { cycleNo: true } },
      },
    });
    for (const rs of laterRsRows) {
      const soId = Number(rs.salesOrderId);
      const cycleNo = Number(rs.cycle?.cycleNo ?? 0);
      if (!Number.isFinite(soId) || soId <= 0 || !Number.isFinite(cycleNo) || cycleNo <= 0) continue;
      maxRsCycleNoBySo.set(soId, Math.max(maxRsCycleNoBySo.get(soId) ?? 0, cycleNo));
    }
  }

  return list.filter((row) => {
    const woId = Number(row.workOrderId ?? 0);
    const wo = woById.get(woId);
    if (!wo || wo.salesOrder?.orderType !== "NO_QTY") return true;

    const woCycleNo = Number(wo.cycle?.cycleNo ?? 0);
    if (!Number.isFinite(woCycleNo) || woCycleNo <= 0) return true;

    const maxRsCycleNo = maxRsCycleNoBySo.get(Number(wo.salesOrderId)) ?? 0;
    if (maxRsCycleNo > woCycleNo) return false;
    return true;
  });
}

async function buildStoreProductionReleaseHandoffQueue(db = prisma, opts = {}) {
  const rawRows = await buildStoreProductionHandoffDashboardRows(db, opts);
  const rows = await filterNoQtyStoreHandoffSupersededByLaterRs(db, rawRows);
  const woIds = rows.map((row) => Number(row.workOrderId ?? 0)).filter((id) => id > 0);
  const eligibilityByWo = await loadStoreProductionReleaseEligibilityByWorkOrder(db, woIds);

  return rows
    .map((row) => {
      const woId = Number(row.workOrderId ?? 0);
      const gate = eligibilityByWo.get(woId);
      if (!gate?.eligible || !gate.pmr || !gate.wo) return null;
      const wo = gate.wo;
      const pmr = gate.pmr;
      const sourceType = wo.sourceType ?? null;
      const orderType =
        wo.salesOrder?.orderType ??
        (String(sourceType ?? "").toUpperCase() === GREEN_LEVEL_WO_SOURCE_TYPE ? "GREEN_LEVEL" : null);
      const salesOrderDocNo = row.salesOrderDocNo ?? wo.salesOrder?.docNo ?? null;
      const plannedQty = (wo.lines ?? []).reduce(
        (sum, line) => sum + Math.max(releaseHandoffQty(line.plannedQty), releaseHandoffQty(line.qty)),
        0,
      );
      const firstLine = wo.lines?.[0] ?? null;
      return {
        workOrderId: woId,
        workOrderNo: row.workOrderNo ?? wo.docNo ?? null,
        workOrderLineId: firstLine?.id ?? null,
        pmrId: pmr.id,
        pmrDocNo: pmr.docNo ?? null,
        pmrStatus: pmr.status,
        rmStatusLabel: formatReleaseHandoffPmrStatus(pmr.status),
        sourceType,
        orderType,
        sourceLabel: resolveReleaseHandoffSourceLabel({ sourceType, orderType, salesOrderDocNo }),
        itemName: row.primaryFgName ?? firstLine?.fgItem?.itemName ?? null,
        plannedQty,
        salesOrderId: row.salesOrderId ?? wo.salesOrderId ?? null,
        salesOrderDocNo,
        cycleId: wo.cycleId ?? null,
        requirementSheetId: wo.requirementSheetId ?? null,
      };
    })
    .filter(Boolean);
}

async function fetchStoreProductionHandoffPendingActions(db = prisma, opts = {}) {
  const queue = await buildStoreProductionReleaseHandoffQueue(db, opts);
  return queue.map((row) => ({
    id: `store-release:wo:${row.workOrderId}`,
    priority: PENDING_PRIORITY.MEDIUM,
    action: STORE_RELEASE_TO_PRODUCTION_ACTION,
    documentNo: row.workOrderNo ?? row.salesOrderDocNo ?? null,
    ownerRole: "STORE",
    ageHours: null,
    href: buildReleaseToProductionHref(row),
    sourceModule: "MATERIAL_ISSUE",
    currentStatus: "STORE_RELEASE_PENDING",
    workOrderId: row.workOrderId,
  }));
}

const STORE_OPEN_NO_QTY_SO_WHERE = Object.freeze({
  orderType: "NO_QTY",
  internalStatus: { notIn: ["COMPLETED", "CLOSED", "MANUALLY_CLOSED", "CLOSED_WITH_WAIVER"] },
});

async function loadStoreOpenNoQtySalesOrders(db = prisma) {
  return getOrSetRequestCache("store:open-no-qty-sos", () =>
    db.salesOrder.findMany({
      where: STORE_OPEN_NO_QTY_SO_WHERE,
      select: {
        id: true,
        docNo: true,
        updatedAt: true,
        currentCycleId: true,
        customer: { select: { name: true } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 50,
    }),
  );
}

const NO_QTY_WO_TERMINAL_STATUSES = new Set(["COMPLETED", "CLOSED", "CLOSED_WITH_SHORTFALL", "REJECTED"]);

function isNoQtyOpenWorkOrderStatus(status) {
  return !NO_QTY_WO_TERMINAL_STATUSES.has(String(status ?? "").toUpperCase());
}

function isNoQtyPlaceWoPendingFromPlacement(placement) {
  const suggested = Number(placement?.suggestedWoQty ?? 0);
  const balance = Number(placement?.rsBalanceQty ?? 0);
  if (!(balance > EPS) || !(suggested > EPS)) return false;

  const actionNeeded = deriveActionNeeded({
    rsBalanceQty: placement.rsBalanceQty,
    suggestedWoQty: placement.suggestedWoQty,
    placementStatus: placement.placementStatus,
    readinessStatus: placement.readinessStatus,
    existingWoSummary: placement.existingWoSummary ?? [],
  });
  return actionNeeded.key === "PLACE_WO";
}

function resolveNoQtyPlaceWoActionTitle(placement) {
  const rmCoverage = mapRmCoverage({
    placementStatus: placement.placementStatus,
    readinessStatus: placement.readinessStatus,
    rsBalanceQty: placement.rsBalanceQty,
  });
  return resolvePlaceWoActionLabel({
    rmCoverage,
    placementStatus: placement.placementStatus,
    readinessStatus: placement.readinessStatus,
  });
}

function buildNoQtyPlaceWoPendingDocumentNo({ soDocNo, customerName, cycleNo, rsDocNo, suggestedWoQty, uom }) {
  const suggestedLabel =
    suggestedWoQty != null
      ? `Suggested WO ${formatQuantityWithUnit(suggestedWoQty, { unit: uom ?? undefined })}`
      : null;
  const parts = [
    soDocNo,
    customerName,
    cycleNo != null ? `Cycle ${cycleNo}` : null,
    rsDocNo,
    suggestedLabel,
  ].filter(Boolean);
  return parts.join(" · ") || soDocNo || null;
}

async function loadNoQtyPlaceWoPendingContext(db, { cycleId, requirementSheetId }) {
  const cid = Number(cycleId);
  const sheetId = Number(requirementSheetId);
  const [cycleRow, sheetRow] = await Promise.all([
    cid > 0 && typeof db.salesOrderCycle?.findUnique === "function"
      ? db.salesOrderCycle.findUnique({ where: { id: cid }, select: { cycleNo: true } })
      : null,
    sheetId > 0 && typeof db.requirementSheet?.findUnique === "function"
      ? db.requirementSheet.findUnique({
          where: { id: sheetId },
          select: {
            docNo: true,
            lines: {
              take: 1,
              orderBy: { id: "asc" },
              select: {
                item: {
                  select: {
                    unit: true,
                    unitRef: { select: { unitCode: true, unitName: true } },
                  },
                },
              },
            },
          },
        })
      : null,
  ]);
  const lineItem = sheetRow?.lines?.[0]?.item;
  const uom = lineItem?.unitRef?.unitCode ?? lineItem?.unitRef?.unitName ?? lineItem?.unit ?? null;
  return {
    cycleNo: cycleRow?.cycleNo ?? null,
    rsDocNo: sheetRow?.docNo ?? null,
    uom,
  };
}

async function appendNoQtyPlaceWoWorkOrderLineParam(db, params, existingWoSummary) {
  const openWoIds = (existingWoSummary ?? [])
    .filter((wo) => isNoQtyOpenWorkOrderStatus(wo.woStatus))
    .map((wo) => Number(wo.workOrderId))
    .filter((id) => id > 0);
  if (openWoIds.length !== 1 || typeof db.workOrderLine?.findFirst !== "function") return;
  const line = await db.workOrderLine.findFirst({
    where: { workOrderId: openWoIds[0] },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (line?.id) params.set("workOrderLineId", String(line.id));
}

/** Unit-test fallback when mocks only implement findFirst. */
async function loadStoreNoQtySupplementalContextLegacy(db, openSoRows) {
  const lockedRsRows = [];
  const woRows = [];
  for (const so of openSoRows) {
    const soId = Number(so.id);
    if (typeof db.requirementSheet?.findFirst === "function") {
      const lockedRs = await db.requirementSheet.findFirst({
        where: { salesOrderId: soId, status: "LOCKED", cycleId: { not: null } },
        orderBy: [{ cycle: { cycleNo: "desc" } }, { version: "desc" }, { id: "desc" }],
        select: {
          id: true,
          salesOrderId: true,
          cycleId: true,
          periodKey: true,
          createdAt: true,
          updatedAt: true,
          cycle: { select: { cycleNo: true } },
        },
      });
      if (lockedRs) lockedRsRows.push({ ...lockedRs, salesOrderId: soId });
    }
    if (typeof db.workOrder?.findFirst === "function") {
      const wo = await db.workOrder.findFirst({
        where: { salesOrderId: soId, status: { not: "REJECTED" } },
        select: { id: true, salesOrderId: true, cycleId: true },
      });
      if (wo) woRows.push(wo);
    }
  }
  return [lockedRsRows, woRows];
}

/**
 * Shared NO_QTY supplemental context for Store pending-actions buckets.
 * @returns {Promise<{ openSoRows: object[]; lockedRsBySo: Map<number, object>; woOnCycleKeys: Set<string> }>}
 */
async function loadStoreNoQtySupplementalContext(db = prisma) {
  return getOrSetRequestCache("store:no-qty-supplemental-context", async () => {
    const openSoRows = await loadStoreOpenNoQtySalesOrders(db);
    const soIds = openSoRows.map((so) => Number(so.id)).filter((id) => id > 0);
    if (!soIds.length) {
      return { openSoRows, lockedRsBySo: new Map(), woOnCycleKeys: new Set() };
    }

    const [lockedRsRows, woRows] =
      typeof db.requirementSheet?.findMany === "function" && typeof db.workOrder?.findMany === "function"
        ? await Promise.all([
            db.requirementSheet.findMany({
              where: { salesOrderId: { in: soIds }, status: "LOCKED", cycleId: { not: null } },
              select: {
                id: true,
                salesOrderId: true,
                cycleId: true,
                periodKey: true,
                createdAt: true,
                updatedAt: true,
                cycle: { select: { cycleNo: true } },
              },
              orderBy: [{ cycle: { cycleNo: "desc" } }, { version: "desc" }, { id: "desc" }],
            }),
            db.workOrder.findMany({
              where: { salesOrderId: { in: soIds }, status: { not: "REJECTED" } },
              select: { id: true, salesOrderId: true, cycleId: true },
            }),
          ])
        : await loadStoreNoQtySupplementalContextLegacy(db, openSoRows);

    const lockedRsBySo = new Map();
    for (const rs of lockedRsRows) {
      const soId = Number(rs.salesOrderId);
      if (!lockedRsBySo.has(soId)) lockedRsBySo.set(soId, rs);
    }
    const woOnCycleKeys = new Set(
      woRows.map((wo) => `${Number(wo.salesOrderId)}:${Number(wo.cycleId)}`),
    );

    return { openSoRows, lockedRsBySo, woOnCycleKeys };
  });
}

/**
 * P10-A7D — After Cycle 1 RS lock (no WO yet), Store next step is monthly planning for the locked period.
 */
async function fetchStoreNoQtyMonthlyPlanningPendingActions(db = prisma) {
  const { openSoRows, lockedRsBySo, woOnCycleKeys } = await loadStoreNoQtySupplementalContext(db);
  const placementPairs = [];
  for (const so of openSoRows) {
    const soId = Number(so.id);
    const lockedRs = lockedRsBySo.get(soId);
    if (!lockedRs?.cycleId) continue;
    const rsCycleId = Number(lockedRs.cycleId);
    if (woOnCycleKeys.has(`${soId}:${rsCycleId}`)) continue;
    placementPairs.push({ salesOrderId: soId, cycleId: rsCycleId, so, lockedRs });
  }

  const actions = [];
  for (const pair of placementPairs) {
    const { so, lockedRs } = pair;
    const soId = Number(so.id);
    const rsCycleId = Number(lockedRs.cycleId);
    const placement = await assessNoQtyPlacementStageForCycle(db, { salesOrderId: soId, cycleId: rsCycleId });
    if (placement?.processStageKey !== "NO_QTY_REQUIREMENT_READY" || placement.readyToPlaceWo) continue;

    const periodKey = String(lockedRs.periodKey ?? "").trim();
    const planningGate = periodKey ? await assessNoQtyMonthlyPlanningGate(db, periodKey) : null;
    if (
      planningGate &&
      ![
        NO_QTY_MONTHLY_PLANNING_GATE.INITIAL_PLAN_REQUIRED,
        NO_QTY_MONTHLY_PLANNING_GATE.ADDITIONAL_PLAN_REQUIRED,
      ].includes(planningGate.gate)
    ) {
      continue;
    }
    if (
      planningGate?.gate === NO_QTY_MONTHLY_PLANNING_GATE.ADDITIONAL_PLAN_REQUIRED &&
      !isRequirementSheetNewerThanPlan(lockedRs, planningGate.plan)
    ) {
      continue;
    }

    const href = periodKey
      ? `/monthly-planning?period=${encodeURIComponent(periodKey)}&from=pending-actions`
      : "/monthly-planning?from=pending-actions";
    const action = planningGate?.action ?? "Monthly Planning Pending";
    const currentStatus =
      planningGate?.gate === NO_QTY_MONTHLY_PLANNING_GATE.ADDITIONAL_PLAN_REQUIRED
        ? "ADDITIONAL_MONTHLY_PLANNING_PENDING"
        : "MONTHLY_PLANNING_PENDING";

    actions.push({
      id: `no-qty-monthly-plan:${soId}:${rsCycleId}:${periodKey || "no-period"}`,
      priority: PENDING_PRIORITY.MEDIUM,
      action,
      documentNo: so.docNo ?? null,
      ownerRole: "STORE",
      ageHours: ageHoursFromTimestamp(lockedRs.updatedAt ?? so.updatedAt),
      href,
      sourceModule: "MONTHLY_PLANNING",
      currentStatus,
    });
  }
  return actions;
}

/**
 * Resolve Store "Create Cycle N Requirement Sheet" when the ACTIVE cycle is empty but the prior
 * CLOSED cycle already passed next-RS eligibility (post prepare-next / between-cycles).
 *
 * Does not change prepare-next gates — only the pending-actions read path.
 */
async function resolveStoreNoQtyCreateNextRsPendingContext(db, soId) {
  const sid = Number(soId);
  return getOrSetRequestCache(`store:create-next-rs-ctx:${sid}`, () =>
    resolveStoreNoQtyCreateNextRsPendingContextImpl(db, sid),
  );
}

async function resolveStoreNoQtyCreateNextRsPendingContextImpl(db, soId) {
  const sid = Number(soId);
  const active = await db.salesOrderCycle.findFirst({
    where: { salesOrderId: sid, status: "ACTIVE" },
    orderBy: { cycleNo: "desc" },
    select: { id: true, cycleNo: true },
  });

  if (active?.id != null) {
    const sheetOnActive = await db.requirementSheet.findFirst({
      where: { salesOrderId: sid, cycleId: Number(active.id) },
      select: { id: true },
    });
    if (!sheetOnActive) {
      const priorClosed = await db.salesOrderCycle.findFirst({
        where: {
          salesOrderId: sid,
          status: "CLOSED",
          cycleNo: { lt: Number(active.cycleNo) },
        },
        orderBy: { cycleNo: "desc" },
        select: { id: true },
      });
      if (priorClosed?.id != null) {
        const priorElig = await computeNoQtyCreateNextRsEligibility(db, {
          salesOrderId: sid,
          cycleId: Number(priorClosed.id),
        });
        if (priorElig.eligible) {
          const lockedRs = await db.requirementSheet.findFirst({
            where: { salesOrderId: sid, cycleId: Number(priorClosed.id), status: "LOCKED" },
            orderBy: [{ version: "desc" }, { id: "desc" }],
            select: { updatedAt: true },
          });
          return {
            eligible: true,
            reason: "OK",
            targetCycleId: Number(active.id),
            targetCycleNo: Number(active.cycleNo),
            ageTimestamp: lockedRs?.updatedAt ?? null,
            resolution: "ACTIVE_EMPTY_PRIOR_ELIGIBLE",
          };
        }
      }
    }
  }

  const eligibility = await computeNoQtyCreateNextRsEligibilityResolved(db, sid);
  if (!eligibility.eligible) {
    return { eligible: false, reason: eligibility.reason ?? "NOT_ELIGIBLE" };
  }

  const { cycleId } = await resolveNoQtyEligibilityCycleId(db, sid);
  if (!cycleId) {
    return { eligible: false, reason: "NO_CYCLE" };
  }

  const cycle = await db.salesOrderCycle.findFirst({
    where: { id: cycleId, salesOrderId: sid },
    select: { cycleNo: true },
  });
  const lockedRs = await db.requirementSheet.findFirst({
    where: { salesOrderId: sid, cycleId, status: "LOCKED" },
    orderBy: [{ version: "desc" }, { id: "desc" }],
    select: { updatedAt: true },
  });
  if (!lockedRs) {
    return { eligible: false, reason: "NO_LOCKED_RS" };
  }

  const nextCycleNo =
    cycle?.cycleNo != null && Number(cycle.cycleNo) > 0 ? Number(cycle.cycleNo) + 1 : null;

  return {
    eligible: true,
    reason: "OK",
    targetCycleId: active?.id != null ? Number(active.id) : null,
    targetCycleNo: nextCycleNo,
    ageTimestamp: lockedRs.updatedAt ?? null,
    resolution: "RESOLVED_CYCLE",
  };
}

/**
 * P8F-A14 — Store-owned NO_QTY cycle continuation when current-cycle RS is locked and next RS is eligible.
 */
async function fetchStoreNoQtyCreateNextRsPendingActions(db = prisma) {
  return getOrSetRequestCache("store:no-qty-create-next-rs-actions", () =>
    fetchStoreNoQtyCreateNextRsPendingActionsImpl(db),
  );
}

async function fetchStoreNoQtyCreateNextRsPendingActionsImpl(db = prisma) {
  const { openSoRows } = await loadStoreNoQtySupplementalContext(db);

  const debugStoreRs = process.env.DEBUG_STORE_RS === "1";

  const actions = [];
  for (const so of openSoRows) {
    const soId = Number(so.id);
    const ctx = await resolveStoreNoQtyCreateNextRsPendingContext(db, soId);
    if (debugStoreRs || String(so.docNo ?? "").trim() === "SO-26-0001") {
      // eslint-disable-next-line no-console
      console.log("[debug] fetchStoreNoQtyCreateNextRsPendingActions", {
        soId,
        docNo: so.docNo ?? null,
        ctx,
      });
    }
    if (!ctx.eligible) continue;

    const nextCycleNo =
      ctx.targetCycleNo != null && Number(ctx.targetCycleNo) > 0 ? Number(ctx.targetCycleNo) : null;
    const label =
      nextCycleNo != null && nextCycleNo > 0
        ? `Create Cycle ${nextCycleNo} Requirement Sheet`
        : "Create Next Requirement Sheet";

    actions.push({
      id: `no-qty-create-next-rs:${soId}`,
      priority: PENDING_PRIORITY.MEDIUM,
      action: label,
      documentNo: so.docNo ?? null,
      ownerRole: "STORE",
      ageHours: ageHoursFromTimestamp(ctx.ageTimestamp ?? so.updatedAt),
      href: buildNoQtyCreateNextRsPlanningHubHref(soId, {
        nextCycleNo,
        from: "pending-actions",
      }),
      sourceModule: "NO_QTY_PLANNING",
      currentStatus: "NEXT_RS_READY",
    });
  }
  return actions;
}

/**
 * P10-A5 — Store-owned WO placement when NO_QTY RM is ready and no WO exists yet.
 */
async function fetchStoreNoQtyPlaceWoPendingActions(db = prisma) {
  const { openSoRows } = await loadStoreNoQtySupplementalContext(db);

  const eligibilityBySo = new Map();
  await Promise.all(
    openSoRows.map(async (so) => {
      const soId = Number(so.id);
      const resolved = await resolveNoQtyEligibilityCycleId(db, soId);
      eligibilityBySo.set(soId, resolved.cycleId ?? (so.currentCycleId != null ? Number(so.currentCycleId) : null));
    }),
  );

  const placementPairs = openSoRows
    .map((so) => {
      const soId = Number(so.id);
      const effCycleId = eligibilityBySo.get(soId);
      if (!effCycleId) return null;
      return { salesOrderId: soId, cycleId: Number(effCycleId), so };
    })
    .filter(Boolean);

  const actions = [];
  for (const pair of placementPairs) {
    const { so, salesOrderId: soId, cycleId: effCycleId } = pair;
    const placement = await assessNoQtyPlacementStageForCycle(db, { salesOrderId: soId, cycleId: effCycleId });
    if (!isNoQtyPlaceWoPendingFromPlacement(placement)) continue;
    if (placement.periodKey) {
      const planningGate = await assessNoQtyMonthlyPlanningGate(db, placement.periodKey);
      if (!isNoQtyMonthlyPlanningGateExecutionReady(planningGate)) continue;
    }

    const actionTitle = resolveNoQtyPlaceWoActionTitle(placement);
    const ctx = await loadNoQtyPlaceWoPendingContext(db, {
      cycleId: effCycleId,
      requirementSheetId: placement.requirementSheetId,
    });
    const documentNo = buildNoQtyPlaceWoPendingDocumentNo({
      soDocNo: so.docNo ?? null,
      customerName: so.customer?.name ?? null,
      cycleNo: ctx.cycleNo,
      rsDocNo: placement.requirementSheetDocNo ?? ctx.rsDocNo ?? null,
      suggestedWoQty: placement.suggestedWoQty,
      uom: ctx.uom,
    });

    const params = new URLSearchParams({
      source: "no_qty_so",
      salesOrderId: String(soId),
      cycleId: String(effCycleId),
      focus: "execution",
      from: "pending-actions",
    });
    if (placement.requirementSheetId) params.set("sheetId", String(placement.requirementSheetId));
    await appendNoQtyPlaceWoWorkOrderLineParam(db, params, placement.existingWoSummary);

    const readiness = String(placement.readinessStatus ?? "").toUpperCase();
    const placementStatus = String(placement.placementStatus ?? "").toUpperCase();
    const currentStatus =
      readiness === "PARTIALLY_READY" || placementStatus === "PARTIALLY_READY"
        ? "PARTIALLY_READY_TO_PLACE_WO"
        : "READY_TO_PLACE_WO";

    actions.push({
      id: `no-qty-place-wo:${soId}:${effCycleId}`,
      priority: PENDING_PRIORITY.MEDIUM,
      action: actionTitle,
      documentNo,
      ownerRole: "STORE",
      ageHours: ageHoursFromTimestamp(so.updatedAt),
      href: `/sales-orders/${soId}/requirement-sheets?${params.toString()}`,
      sourceModule: "NO_QTY_EXECUTION",
      currentStatus,
    });
  }
  return actions;
}

async function fetchStoreGreenLevelPlaceWoPendingActions(db = prisma) {
  const placement = await buildGreenLevelWoPlacement(db);
  if (!placement?.available || !placement?.summary?.remainingQty) return [];
  const canCreate = placement.summary.canCreateWorkOrder === true;
  const params = new URLSearchParams({
    from: "pending-actions",
  });
  if (placement.plan?.id) params.set("planId", String(placement.plan.id));
  return [
    {
      id: `green-level-place-wo:${placement.plan?.id ?? "latest"}`,
      priority: PENDING_PRIORITY.MEDIUM,
      action: canCreate ? "Create Green Level WO" : "Green Level Replenishment WO Pending",
      documentNo: placement.plan?.docNo ?? placement.plan?.periodKey ?? null,
      ownerRole: "STORE",
      ageHours: ageHoursFromTimestamp(placement.plan?.releasedAt ?? new Date()),
      href: `/store/green-level-wo?${params.toString()}`,
      sourceModule: "GREEN_LEVEL_REPLENISHMENT",
      currentStatus: canCreate ? "READY_TO_PLACE_WO" : "AWAITING_RM",
      metadata: {
        monthlyProductionPlanId: placement.plan?.id ?? null,
        periodKey: placement.plan?.periodKey ?? null,
        remainingQty: placement.summary.remainingQty,
      },
    },
  ];
}

function filterNormalizedRowsByOwner(rows, role) {
  const parsed = parseUserRole(role);
  const list = Array.isArray(rows) ? rows : [];
  const qaQueueWoIds = new Set(
    list
      .filter((row) => String(row?.rowType ?? "") === ROW_TYPES.QA_QUEUE)
      .map((row) => Number(row?.metadata?.workOrderId ?? 0))
      .filter((id) => id > 0),
  );

  return list.filter((row) => {
    if (String(row?.currentOwner ?? "").toUpperCase() !== parsed) return false;
    const rowType = String(row?.rowType ?? "");
    const status = String(row?.currentStatus ?? "").toUpperCase();
    const woId = Number(row?.metadata?.workOrderId ?? 0);

    if (parsed === "QA" && status === "QA_PENDING" && woId > 0 && qaQueueWoIds.has(woId)) {
      if (rowType === ROW_TYPES.PRODUCTION_QUEUE || rowType === ROW_TYPES.CONTINUE_WORKING) {
        return false;
      }
    }
    if (parsed === "STORE" && rowType === ROW_TYPES.DISPATCH_BACKLOG) {
      return false;
    }
    return true;
  });
}

function extractMaterialRequirementIdFromPendingAction(action) {
  const href = String(action?.href ?? "");
  const fromHref = href.match(/[?&]materialRequirementId=(\d+)/);
  if (fromHref) return Number(fromHref[1]);
  const fromId = String(action?.id ?? "").match(/procurement:create-po:mr:(\d+)/);
  if (fromId) return Number(fromId[1]);
  return null;
}

function extractPurchaseOrderIdFromPendingAction(action) {
  if (action?.purchaseOrderId != null && Number(action.purchaseOrderId) > 0) {
    return Number(action.purchaseOrderId);
  }
  const href = String(action?.href ?? "");
  const fromQuery = href.match(/[?&]poId=(\d+)/);
  if (fromQuery) return Number(fromQuery[1]);
  const fromPath = href.match(/\/rm-po-grn\/(\d+)/);
  if (fromPath) return Number(fromPath[1]);
  const fromId = String(action?.id ?? "").match(/procurement:grn:po:(\d+)/);
  if (fromId) return Number(fromId[1]);
  return null;
}

function extractOperationalKeyFromPendingAction(action) {
  const status = String(action?.currentStatus ?? "").trim().toUpperCase();
  if (status === "GRN_PENDING") return "GRN_PENDING";
  if (action?.action === GRN_PENDING_ACTION) return "GRN_PENDING";
  if (status === "SUPPLIER_PENDING") return "SUPPLIER_PENDING";
  if (status === "PROCUREMENT_PENDING") return "PROCUREMENT_PENDING";
  if (status === "PR_PENDING_PO") return "PR_PENDING_PO";
  if (action?.action === "Create Purchase Request") return "PROCUREMENT_PENDING";
  if (action?.action === "Follow up Purchase Order") return "SUPPLIER_PENDING";
  if (PURCHASE_PO_PREP_ACTIONS.has(action?.action)) return "PR_PENDING_PO";
  if (action?.action === WAITING_FOR_PURCHASE_RM_PO) return "PR_PENDING_PO";
  return null;
}

function isProcurementSupplementalAction(action) {
  const id = String(action?.id ?? "");
  return (
    id.startsWith("procurement:create-po:") ||
    id.startsWith("procurement:create-pr:") ||
    id.startsWith("procurement:supplier-pending:") ||
    id.startsWith("procurement:open-po:")
  );
}

function isProcurementGrnSupplementalAction(action) {
  return String(action?.id ?? "").startsWith("procurement:grn:po:");
}

function procurementCaseDedupeKey(action) {
  const opKey = extractOperationalKeyFromPendingAction(action);
  if (!opKey) return null;
  const poId = extractPurchaseOrderIdFromPendingAction(action);
  if (poId > 0) return `po:${poId}:${opKey}`;
  const mrId =
    action?.materialRequirementId != null && Number(action.materialRequirementId) > 0
      ? Number(action.materialRequirementId)
      : extractMaterialRequirementIdFromPendingAction(action);
  if (mrId > 0) return `mr:${mrId}:${opKey}`;
  const woId = extractWorkOrderIdFromPendingAction(action);
  if (woId > 0) return `wo:${woId}:${opKey}`;
  return null;
}

function preferProcurementCaseAction(existing, candidate) {
  const opKey = extractOperationalKeyFromPendingAction(existing);

  if (opKey === "GRN_PENDING") {
    const existingSup = isProcurementGrnSupplementalAction(existing);
    const candidateSup = isProcurementGrnSupplementalAction(candidate);
    if (existingSup && !candidateSup) return existing;
    if (candidateSup && !existingSup) return candidate;
  }

  const existingPrepare = PURCHASE_PO_PREP_ACTIONS.has(existing.action);
  const candidatePrepare = PURCHASE_PO_PREP_ACTIONS.has(candidate.action);

  if (existing.action === WAITING_FOR_PURCHASE_RM_PO && candidatePrepare) return candidate;
  if (candidate.action === WAITING_FOR_PURCHASE_RM_PO && existingPrepare) return existing;

  const existingSup = isProcurementSupplementalAction(existing);
  const candidateSup = isProcurementSupplementalAction(candidate);
  if (existingSup && !candidateSup) return existing;
  if (candidateSup && !existingSup) return candidate;

  if (existing.action === PREPARE_RM_PO && candidate.action === "Create PO") return existing;
  if (candidate.action === PREPARE_RM_PO && existing.action === "Create PO") return candidate;

  if (existing.action === "Create Purchase Request" && candidatePrepare) return candidate;
  if (candidate.action === "Create Purchase Request" && existingPrepare) return existing;

  const pa = PRIORITY_SORT[existing.priority] ?? 99;
  const pb = PRIORITY_SORT[candidate.priority] ?? 99;
  if (pa !== pb) return pa <= pb ? existing : candidate;
  const aa = existing.ageHours != null ? Number(existing.ageHours) : -1;
  const ab = candidate.ageHours != null ? Number(candidate.ageHours) : -1;
  return ab <= aa ? candidate : existing;
}

function preferPurchasePendingAction(existing, candidate) {
  return preferProcurementCaseAction(existing, candidate);
}

function dedupePendingActionsByProcurementCase(actions) {
  const withoutKey = [];
  const byKey = new Map();
  for (const action of actions) {
    const key = procurementCaseDedupeKey(action);
    if (!key) {
      withoutKey.push(action);
      continue;
    }
    const prev = byKey.get(key);
    byKey.set(key, prev ? preferProcurementCaseAction(prev, action) : action);
  }
  return [...withoutKey, ...byKey.values()];
}

function extractWorkOrderIdFromPendingAction(action) {
  const href = String(action?.href ?? "");
  const fromHref = href.match(/[?&]workOrderId=(\d+)/);
  if (fromHref) return Number(fromHref[1]);
  const fromId = String(action?.id ?? "").match(/(?:^|:)wo:(\d+)/);
  if (fromId) return Number(fromId[1]);
  return null;
}

function extractSalesOrderIdFromPendingAction(action) {
  const href = String(action?.href ?? "");
  const fromHref = href.match(/[?&]salesOrderId=(\d+)/);
  if (fromHref) return Number(fromHref[1]);
  return null;
}

function isProductionExecutionPendingAction(action) {
  const label = String(action?.action ?? "");
  return (
    label === READY_TO_START_PRODUCTION ||
    label === PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING ||
    label === PRODUCTION_EXECUTION_PENDING_LABELS.SHORTFALL_PENDING ||
    label === PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED ||
    label === "Resume Production" ||
    label === "Production Pending" ||
    label === "Production On Hold"
  );
}

function productionExecutionDedupeKey(action) {
  const woId = extractWorkOrderIdFromPendingAction(action);
  if (woId > 0) return `wo:${woId}`;
  const soId = extractSalesOrderIdFromPendingAction(action);
  if (soId > 0) return `so:${soId}`;
  return null;
}

function productionPendingActionRank(action) {
  const label = String(action?.action ?? "");
  if (label === PRODUCTION_EXECUTION_PENDING_LABELS.BLOCKED || label === "Resume Production") return 0;
  if (label === PRODUCTION_EXECUTION_PENDING_LABELS.SHORTFALL_PENDING) return 0;
  if (label === "Production On Hold") return 1;
  if (label === PRODUCTION_EXECUTION_PENDING_LABELS.RUNNING) return 2;
  if (label === READY_TO_START_PRODUCTION) return 3;
  if (label === "Production Pending") return 4;
  return 99;
}

function preferProductionExecutionPendingAction(existing, candidate) {
  const ra = productionPendingActionRank(existing);
  const rb = productionPendingActionRank(candidate);
  if (ra !== rb) return ra <= rb ? existing : candidate;
  const pa = PRIORITY_SORT[existing.priority] ?? 99;
  const pb = PRIORITY_SORT[candidate.priority] ?? 99;
  if (pa !== pb) return pa <= pb ? existing : candidate;
  const aa = existing.ageHours != null ? Number(existing.ageHours) : -1;
  const ab = candidate.ageHours != null ? Number(candidate.ageHours) : -1;
  return ab <= aa ? candidate : existing;
}

function dedupeProductionPendingActions(actions) {
  const withoutKey = [];
  const byKey = new Map();
  for (const action of actions) {
    if (!isProductionExecutionPendingAction(action)) {
      withoutKey.push(action);
      continue;
    }
    const key = productionExecutionDedupeKey(action);
    if (!key) {
      withoutKey.push(action);
      continue;
    }
    const prev = byKey.get(key);
    byKey.set(key, prev ? preferProductionExecutionPendingAction(prev, action) : action);
  }
  return [...withoutKey, ...byKey.values()];
}

function preferStorePendingAction(existing, candidate) {
  const existingReturn = existing.action === RM_RETURN_PENDING_ACTION;
  const candidateReturn = candidate.action === RM_RETURN_PENDING_ACTION;
  if (existingReturn && !candidateReturn) return existing;
  if (candidateReturn && !existingReturn) return candidate;

  const existingIssue = existing.action === STORE_ISSUE_PENDING_ACTION;
  const candidateIssue = candidate.action === STORE_ISSUE_PENDING_ACTION;
  if (existing.action === WAITING_FOR_PURCHASE_RM_PO && candidate.action === "Create Purchase Request") {
    return existing;
  }
  if (candidate.action === WAITING_FOR_PURCHASE_RM_PO && existing.action === "Create Purchase Request") {
    return candidate;
  }
  if (existingIssue && !candidateIssue && PROCUREMENT_PENDING_ACTIONS.has(candidate.action)) {
    return candidate;
  }
  if (candidateIssue && !existingIssue && PROCUREMENT_PENDING_ACTIONS.has(existing.action)) {
    return existing;
  }
  const pa = PRIORITY_SORT[existing.priority] ?? 99;
  const pb = PRIORITY_SORT[candidate.priority] ?? 99;
  if (pa !== pb) return pa <= pb ? existing : candidate;
  const aa = existing.ageHours != null ? Number(existing.ageHours) : -1;
  const ab = candidate.ageHours != null ? Number(candidate.ageHours) : -1;
  return ab <= aa ? candidate : existing;
}

function dedupePendingActionsByWorkOrder(actions) {
  const withoutWo = [];
  const byWo = new Map();
  for (const action of actions) {
    const woId = extractWorkOrderIdFromPendingAction(action);
    if (!woId || woId <= 0) {
      withoutWo.push(action);
      continue;
    }
    const prev = byWo.get(woId);
    byWo.set(woId, prev ? preferStorePendingAction(prev, action) : action);
  }
  return [...withoutWo, ...byWo.values()];
}

const LIFECYCLE_ACTION_RANK = Object.freeze({
  "QC Pending": 0,
  [DISPATCH_PENDING_ACTION]: 1,
  Dispatch: 1,
  "Create Sales Bill": 2,
  "Export to Tally": 3,
});

function lifecycleActionRank(action) {
  const label = String(action?.action ?? "");
  if (label in LIFECYCLE_ACTION_RANK) return LIFECYCLE_ACTION_RANK[label];
  if (label.startsWith(STORE_DISPATCH_READY_PREFIX)) return LIFECYCLE_ACTION_RANK[DISPATCH_PENDING_ACTION];
  if (isStoreDispatchWorkflowTriggerAction(label)) return LIFECYCLE_ACTION_RANK[DISPATCH_PENDING_ACTION];
  return 99;
}

function preferLifecyclePendingAction(existing, candidate) {
  const ra = lifecycleActionRank(existing);
  const rb = lifecycleActionRank(candidate);
  if (ra !== rb) return rb < ra ? candidate : existing;
  const pa = PRIORITY_SORT[existing.priority] ?? 99;
  const pb = PRIORITY_SORT[candidate.priority] ?? 99;
  if (pa !== pb) return pa <= pb ? existing : candidate;
  const aa = existing.ageHours != null ? Number(existing.ageHours) : -1;
  const ab = candidate.ageHours != null ? Number(candidate.ageHours) : -1;
  return ab <= aa ? candidate : existing;
}

function dedupeLifecyclePendingActions(actions) {
  const withoutKey = [];
  const byDispatch = new Map();
  const bySo = new Map();
  const byWo = new Map();

  for (const action of actions) {
    const href = String(action?.href ?? "");
    const dispatchFromHref = href.match(/[?&]dispatchId=(\d+)/);
    const dispatchFromId = String(action?.id ?? "").match(/dispatch:(\d+)/);
    const dispatchId = dispatchFromHref
      ? Number(dispatchFromHref[1])
      : dispatchFromId
        ? Number(dispatchFromId[1])
        : null;

    if (dispatchId != null && dispatchId > 0) {
      const prev = byDispatch.get(dispatchId);
      byDispatch.set(dispatchId, prev ? preferLifecyclePendingAction(prev, action) : action);
      continue;
    }

    const woId = extractWorkOrderIdFromPendingAction(action);
    if (woId > 0 && action.action === "QC Pending") {
      const prev = byWo.get(woId);
      byWo.set(woId, prev ? preferLifecyclePendingAction(prev, action) : action);
      continue;
    }

    const soId = extractSalesOrderIdFromPendingAction(action);
    if (soId > 0 && (isStoreDispatchLifecycleAction(action) || action.action === "Create Sales Bill")) {
      const prev = bySo.get(soId);
      bySo.set(soId, prev ? preferLifecyclePendingAction(prev, action) : action);
      continue;
    }

    withoutKey.push(action);
  }

  return [...withoutKey, ...byDispatch.values(), ...bySo.values(), ...byWo.values()];
}

const PRODUCTION_TERMINAL_WORK_ORDER_STATUSES = new Set([
  "COMPLETED",
  "REJECTED",
  "CLOSED",
  "CANCELLED",
  "CLOSED_WITH_SHORTFALL",
]);

function isTerminalProductionWorkOrderStatus(status) {
  return PRODUCTION_TERMINAL_WORK_ORDER_STATUSES.has(String(status ?? "").trim().toUpperCase());
}

async function filterExecutableProductionPendingActions(db, actions) {
  const list = Array.isArray(actions) ? actions : [];
  const productionActions = list.filter(isProductionExecutionPendingAction);
  const woIds = [
    ...new Set(
      productionActions
        .map((action) => extractWorkOrderIdFromPendingAction(action))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (!woIds.length) return list;

  const workOrders = await db.workOrder.findMany({
    where: { id: { in: woIds } },
    select: {
      id: true,
      status: true,
      productionExecution: { select: { executionStatus: true } },
    },
  });
  const woById = new Map(workOrders.map((wo) => [Number(wo.id), wo]));

  const issueRows = await db.materialIssueNote.findMany({
    where: {
      workOrderId: { in: woIds },
      productionMaterialRequestId: { not: null },
      lines: { some: { issueQty: { gt: 0 } } },
    },
    select: { workOrderId: true },
  });
  const issuedWoIds = new Set(issueRows.map((row) => Number(row.workOrderId)).filter((id) => id > 0));

  return list.filter((action) => {
    if (!isProductionExecutionPendingAction(action)) return true;
    const woId = extractWorkOrderIdFromPendingAction(action);
    if (!(woId > 0)) return true;
    const wo = woById.get(woId);
    if (!wo) return false;
    if (isTerminalProductionWorkOrderStatus(wo.status)) return false;
    if (String(wo.productionExecution?.executionStatus ?? "").trim().toUpperCase() === "COMPLETED") return false;
    return issuedWoIds.has(woId);
  });
}
function sortPendingActions(actions) {
  return [...actions].sort((a, b) => {
    const pa = PRIORITY_SORT[a.priority] ?? 99;
    const pb = PRIORITY_SORT[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    const aa = a.ageHours != null ? Number(a.ageHours) : -1;
    const ab = b.ageHours != null ? Number(b.ageHours) : -1;
    if (aa !== ab) return ab - aa;
    return String(a.documentNo ?? "").localeCompare(String(b.documentNo ?? ""));
  });
}

/**
 * Store-only pending actions — scoped normalized merge + parallel store supplemental buckets.
 * @param {{
 *   db: import('@prisma/client').PrismaClient;
 *   timedBucket: (label: string, fn: () => Promise<unknown>) => Promise<unknown>;
 *   startedAt: number;
 *   bucketMs: Record<string, number>;
 * }} ctx
 */
async function getStorePendingActions(ctx) {
  const { db, timedBucket, startedAt, bucketMs } = ctx;
  const role = "STORE";

  const workspace = await buildMaterialAvailabilityWorkspace(db, { onlyBlocked: true });
  const workspaceOpts = { workspace };

  const [
    { rows: mergedRows },
    monthlyPlanActions,
    storeIssue,
    storeDispatch,
    storeRmReturn,
    storeGrn,
    storeHandoff,
    storeNoQtyMonthly,
    storeNoQtyCreateRs,
    storeNoQtyPlaceWo,
    storeGreenLevelPlaceWo,
    storeNoQtyRecovery,
  ] = await Promise.all([
    timedBucket("storeNormalized", () =>
      fetchStoreScopedNormalizedRows({ mode: CONTROL_TOWER_ROW_MODES.FULL }),
    ),
    timedBucket("monthlyPlan", () => fetchMonthlyPlanPendingActions(db, { role })),
    timedBucket("storeIssue", () => fetchStoreIssuePendingActions(db, workspaceOpts)),
    timedBucket("storeDispatch", () => fetchStoreDispatchPendingActions(db)),
    timedBucket("storeRmReturn", () => fetchStoreProductionRmReturnPendingActions(db)),
    timedBucket("storeGrn", () => fetchStoreGrnPendingActions(db)),
    timedBucket("storeHandoff", () => fetchStoreProductionHandoffPendingActions(db, workspaceOpts)),
    timedBucket("storeNoQtyMonthly", () => fetchStoreNoQtyMonthlyPlanningPendingActions(db)),
    timedBucket("storeNoQtyCreateRs", () => fetchStoreNoQtyCreateNextRsPendingActions(db)),
    timedBucket("storeNoQtyPlaceWo", () => fetchStoreNoQtyPlaceWoPendingActions(db)),
    timedBucket("storeGreenLevelPlaceWo", () => fetchStoreGreenLevelPlaceWoPendingActions(db)),
    timedBucket("storeNoQtyRecovery", () => fetchNoQtyRecoveryPendingActions(db, { role: "STORE" })),
  ]);

  const bucketCounts = {
    dispatch: storeDispatch.length,
    production: 0,
    qc: 0,
    procurement: storeGrn.length,
    noQty: storeNoQtyMonthly.length + storeNoQtyCreateRs.length + storeNoQtyPlaceWo.length + storeNoQtyRecovery.length,
    inventory: storeIssue.length,
    salesBill: 0,
    other: storeRmReturn.length,
    total: 0,
  };

  const roleFilteredNormalized = filterNormalizedRowsByOwner(mergedRows, role);
  const dedupedNormalized = dedupeRoleQueueRows(roleFilteredNormalized, role);
  const normalizedActions = dedupedNormalized
    .map((row) => mapNormalizedRowToPendingAction(row, role))
    .filter((action) => action.action !== STORE_RELEASE_TO_PRODUCTION_ACTION);

  const supplemental = [
    ...monthlyPlanActions,
    ...storeIssue,
    ...storeDispatch,
    ...storeRmReturn,
    ...storeGrn,
    ...storeHandoff,
    ...storeNoQtyMonthly,
    ...storeNoQtyCreateRs,
    ...storeNoQtyPlaceWo,
    ...storeGreenLevelPlaceWo,
    ...storeNoQtyRecovery,
  ];

  const combined = [...normalizedActions, ...supplemental];

  const byId = new Map();
  for (const action of combined) {
    const key = String(action.id ?? `${action.action}:${action.documentNo}`);
    if (!byId.has(key)) byId.set(key, action);
  }

  let merged = [...byId.values()].filter((a) => String(a.ownerRole ?? "").toUpperCase() === role);
  merged = dedupePendingActionsByProcurementCase(merged);
  merged = dedupePendingActionsByWorkOrder(merged);
  merged = dedupeLifecyclePendingActions(merged);

  const actions = sortPendingActions(merged);
  bucketMs.total = Date.now() - startedAt;
  bucketCounts.total = actions.length;

  if (process.env.NODE_ENV !== "production" || process.env.PERF_LOG === "1") {
    // eslint-disable-next-line no-console
    console.log("[perf] pending-actions buckets", {
      role,
      bucketMs,
      bucketCounts,
      normalizedRowCount: dedupedNormalized.length,
      supplementalCount: supplemental.length,
      storeScoped: true,
    });
  }

  return {
    count: actions.length,
    actions: actions.map((a) => ({
      id: a.id,
      priority: a.priority,
      action: a.action,
      documentNo: a.documentNo,
      ownerRole: a.ownerRole,
      ageHours: a.ageHours,
      href: a.href,
      ...(a.planId != null ? { planId: a.planId } : {}),
      ...(a.monthlyPlanId != null ? { monthlyPlanId: a.monthlyPlanId } : {}),
      ...(a.itemId != null ? { itemId: a.itemId } : {}),
      ...(a.itemName != null ? { itemName: a.itemName } : {}),
      ...(a.qty != null ? { qty: a.qty } : {}),
      ...(a.uom != null ? { uom: a.uom } : {}),
      ...(a.recoveryType != null ? { recoveryType: a.recoveryType } : {}),
      ...(a.reason != null ? { reason: a.reason } : {}),
      ...(a.reasonMessage != null ? { reasonMessage: a.reasonMessage } : {}),
    })),
    meta: {
      role,
      generatedAt: new Date().toISOString(),
      normalizedRowCount: dedupedNormalized.length,
      supplementalCount: supplemental.length,
      storeScoped: true,
      perf: {
        bucketMs,
        bucketCounts,
      },
    },
  };
}


/**
 * @param {{ userRole?: string | null; db?: import('@prisma/client').PrismaClient }} [opts]
 */
async function getPendingActions(opts = {}) {
  const role = parseUserRole(opts.userRole);
  if (!role) {
    return { count: 0, actions: [], meta: { role: null, generatedAt: new Date().toISOString() } };
  }

  const db = opts.db ?? prisma;
  const startedAt = Date.now();
  const bucketMs = {};

  async function timedBucket(label, fn) {
    const t0 = Date.now();
    const result = await fn();
    bucketMs[label] = Date.now() - t0;
    return result;
  }

  if (role === "STORE") {
    return getStorePendingActions({ db, timedBucket, startedAt, bucketMs });
  }

  const [{ rows: mergedRows }, monthlyPlanActions] = await Promise.all([
    timedBucket("normalizedMerge", () => fetchMergedNormalizedRows({ mode: CONTROL_TOWER_ROW_MODES.FULL })),
    timedBucket("monthlyPlan", () => fetchMonthlyPlanPendingActions(db, { role })),
  ]);

  const bucketCounts = {
    dispatch: 0,
    production: 0,
    qc: 0,
    procurement: 0,
    noQty: 0,
    inventory: 0,
    salesBill: 0,
    other: 0,
  };
  for (const row of mergedRows) {
    const type = String(row.rowType ?? "").toUpperCase();
    if (type.includes("DISPATCH")) bucketCounts.dispatch += 1;
    else if (type.includes("PRODUCTION") || type.includes("WO_PLANNING") || type.includes("CONTINUE")) {
      bucketCounts.production += 1;
    } else if (type.includes("QA")) bucketCounts.qc += 1;
    else if (type.includes("RM_RISK") || type.includes("INVENTORY")) bucketCounts.inventory += 1;
    else if (type.includes("NO_QTY")) bucketCounts.noQty += 1;
    else bucketCounts.other += 1;
  }

  const roleFilteredNormalized = filterNormalizedRowsByOwner(mergedRows, role);
  const dedupedNormalized = dedupeRoleQueueRows(roleFilteredNormalized, role);
  const normalizedActions = dedupedNormalized.map((row) => mapNormalizedRowToPendingAction(row, role));

  const supplemental = [...monthlyPlanActions.filter((a) => String(a.ownerRole).toUpperCase() === role)];

  const supplementalStartedAt = Date.now();
  if (role === "ADMIN") {
    supplemental.push(...(await fetchAdminCommercialPendingActions()));
    supplemental.push(...(await fetchNoQtyRecoveryPendingActions(db, { role: "ADMIN" })));
  }
  if (role === "PURCHASE") {
    const purchaseChunk = await fetchPurchaseProcurementPendingActions(db);
    supplemental.push(...purchaseChunk);
    bucketCounts.procurement += purchaseChunk.length;
  }
  if (role === "PRODUCTION" || role === "ADMIN") {
    supplemental.push(...(await fetchProductionRmReturnWaitingActions(db)));
  }
  bucketMs.supplemental = Date.now() - supplementalStartedAt;

  if (role === "ADMIN") {
    bucketCounts.salesBill += supplemental.filter((a) =>
      String(a.action ?? "").toLowerCase().includes("sales bill"),
    ).length;
    bucketCounts.procurement += supplemental.filter((a) =>
      String(a.href ?? "").includes("procurement") || String(a.action ?? "").toLowerCase().includes("purchase"),
    ).length;
  }

  const combined = [...normalizedActions, ...supplemental];

  /** Dedupe by id */
  const byId = new Map();
  for (const action of combined) {
    const key = String(action.id ?? `${action.action}:${action.documentNo}`);
    if (!byId.has(key)) byId.set(key, action);
  }

  let merged = [...byId.values()].filter((a) => String(a.ownerRole ?? "").toUpperCase() === role);
  if (role === "STORE") {
    merged = dedupePendingActionsByProcurementCase(merged);
    merged = dedupePendingActionsByWorkOrder(merged);
  }
  if (role === "PURCHASE" || role === "ADMIN") {
    merged = dedupePendingActionsByProcurementCase(merged);
  }
  if (role === "PRODUCTION" || role === "ADMIN") {
    merged = dedupeProductionPendingActions(merged);
    merged = await filterExecutableProductionPendingActions(db, merged);
  }
  if (role === "QA" || role === "ADMIN" || role === "STORE") {
    merged = dedupeLifecyclePendingActions(merged);
  }

  const actions = sortPendingActions(merged);
  bucketMs.total = Date.now() - startedAt;
  bucketCounts.total = actions.length;

  let storeRsPendingCount = null;
  if (role === "ADMIN") {
    const storeRsActions = await fetchStoreNoQtyCreateNextRsPendingActions(db);
    storeRsPendingCount = storeRsActions.length;
  }

  if (process.env.NODE_ENV !== "production" || process.env.PERF_LOG === "1") {
    // eslint-disable-next-line no-console
    console.log("[perf] pending-actions buckets", {
      role,
      bucketMs,
      bucketCounts,
      normalizedRowCount: dedupedNormalized.length,
      supplementalCount: supplemental.length,
    });
  }

  return {
    count: actions.length,
    actions: actions.map((a) => ({
      id: a.id,
      priority: a.priority,
      action: a.action,
      documentNo: a.documentNo,
      ownerRole: a.ownerRole,
      ageHours: a.ageHours,
      href: a.href,
      ...(a.planId != null ? { planId: a.planId } : {}),
      ...(a.monthlyPlanId != null ? { monthlyPlanId: a.monthlyPlanId } : {}),
      ...(a.itemId != null ? { itemId: a.itemId } : {}),
      ...(a.itemName != null ? { itemName: a.itemName } : {}),
      ...(a.qty != null ? { qty: a.qty } : {}),
      ...(a.uom != null ? { uom: a.uom } : {}),
      ...(a.recoveryType != null ? { recoveryType: a.recoveryType } : {}),
      ...(a.reason != null ? { reason: a.reason } : {}),
      ...(a.reasonMessage != null ? { reasonMessage: a.reasonMessage } : {}),
    })),
    meta: {
      role,
      generatedAt: new Date().toISOString(),
      normalizedRowCount: dedupedNormalized.length,
      supplementalCount: supplemental.length,
      perf: {
        bucketMs,
        bucketCounts,
      },
      ...(storeRsPendingCount != null ? { storeRsPendingCount } : {}),
    },
  };
}

module.exports = {
  PENDING_PRIORITY,
  getPendingActions,
  mapNormalizedRowToPendingAction,
  friendlyActionForNormalizedRow,
  resolveHrefForNormalizedRow,
  fetchMonthlyPlanPendingActions,
  fetchPurchaseProcurementPendingActions,
  mapProcurementQueueRowToPurchasePendingAction,
  fetchStoreGrnPendingActions,
  fetchStoreDispatchPendingActions,
  fetchProductionRmReturnWaitingActions,
  fetchStoreProductionRmReturnPendingActions,
  fetchStoreNoQtyMonthlyPlanningPendingActions,
  fetchStoreNoQtyCreateNextRsPendingActions,
  fetchStoreNoQtyPlaceWoPendingActions,
  fetchStoreGreenLevelPlaceWoPendingActions,
  fetchAdminCommercialPendingActions,
  fetchAdminSalesBillPendingActions,
  fetchAdminTallyExportPendingActions,
  buildStoreProductionReleaseHandoffQueue,
  loadStoreProductionReleaseEligibilityByWorkOrder,
  buildReleaseToProductionHref,
  buildProductionWorkspaceHrefFromPendingMeta,
  buildNoQtyCreateNextRsPlanningHubHref,
  fetchStoreProductionHandoffPendingActions,
  filterNoQtyStoreHandoffSupersededByLaterRs,
  sortPendingActions,
  filterNormalizedRowsByOwner,
  dedupePendingActionsByWorkOrder,
  dedupePendingActionsByProcurementCase,
  extractWorkOrderIdFromPendingAction,
  extractMaterialRequirementIdFromPendingAction,
  extractPurchaseOrderIdFromPendingAction,
  preferStorePendingAction,
  preferPurchasePendingAction,
  preferProcurementCaseAction,
  productionExecutionPendingActionLabel,
  PRODUCTION_EXECUTION_PENDING_LABELS,
  dedupeProductionPendingActions,
  preferProductionExecutionPendingAction,
  filterExecutableProductionPendingActions,
  extractSalesOrderIdFromPendingAction,
  dedupeLifecyclePendingActions,
  preferLifecyclePendingAction,
  buildStoreDispatchPendingActionLabel,
  isStoreDispatchLifecycleAction,
  formatStoreDispatchPendingQty,
};
