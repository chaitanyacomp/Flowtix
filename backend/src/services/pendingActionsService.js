/**
 * Unified Pending Actions read model (P8B).
 * Aggregates existing operational queue snapshots — no new workflow rules.
 */

const { prisma } = require("../utils/prisma");
const {
  CONTROL_TOWER_ROW_MODES,
  fetchMergedNormalizedRows,
} = require("./controlTowerNormalizedRowsService");
const { dedupeRoleQueueRows, attachRowIdentity } = require("./controlTowerRowIdentity");
const { RISK_LEVELS, ROW_TYPES } = require("./controlTowerRowNormalizer");

const EPS = 1e-6;

const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");
const {
  getQuotationsPendingSalesOrderRows,
} = require("./dashboardQueueSnapshots");
const { buildProcurementPendingQueue, buildGrnPendingSection } = require("./procurementWorkspaceService");
const { buildStoreIssuePendingDashboardRows, buildStoreProductionHandoffDashboardRows } = require("./materialAvailabilityWorkspaceService");
const {
  computeNoQtyCreateNextRsEligibilityResolved,
  resolveNoQtyEligibilityCycleId,
} = require("./noQtyCreateNextRsEligibility");
const {
  WAITING_FOR_PURCHASE_RM_PO,
  PREPARE_RM_PO,
  RM_ISSUED_WAITING_FOR_PRODUCTION,
  READY_TO_START_PRODUCTION,
  resolveRmRiskPendingAction,
  resolveProcurementDemandPool,
} = require("./rmProcurementStageSignals");

const STORE_ISSUE_PENDING_ACTION = "Material Issue Pending";
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

function resolveHrefForNormalizedRow(row, role = "STORE") {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const rowType = String(row?.rowType ?? "");
  if (rowType === ROW_TYPES.RM_RISK) {
    const resolved = resolveRmRiskPendingAction(meta, {
      queueType: meta.queueType ?? meta.sourceQueueType,
      freeStockQty: meta.freeStockQty,
      netShortageAfterIncomingQty: meta.netShortageAfterIncomingQty,
      recommendedAction: row?.nextAction,
    }, role);
    return resolved.href;
  }
  if (meta.href && String(meta.href).trim()) return String(meta.href).trim();

  const salesOrderId = Number(meta.salesOrderId ?? 0);
  const workOrderId = Number(meta.workOrderId ?? 0);

  if (rowType === ROW_TYPES.NO_QTY_PLANNING && salesOrderId > 0) {
    return `/sales-orders/${salesOrderId}/requirement-sheets`;
  }
  if (rowType === ROW_TYPES.WO_PLANNING && salesOrderId > 0) {
    return `/work-orders/prepare?salesOrderId=${salesOrderId}&from=pending-actions`;
  }
  if (rowType === ROW_TYPES.DISPATCH_BACKLOG && salesOrderId > 0) {
    return `/dispatch?salesOrderId=${salesOrderId}&source=pending-actions`;
  }
  if (rowType === ROW_TYPES.CONTINUE_WORKING) {
    if (meta.href) return String(meta.href);
    if (salesOrderId > 0) {
      const stage = String(meta.sourceStageKey ?? "").toUpperCase();
      if (stage === "DISPATCH") return `/dispatch?salesOrderId=${salesOrderId}&source=pending-actions`;
      if (stage === "QC") return `/qc-entry?salesOrderId=${salesOrderId}&source=pending-actions`;
      if (stage === "PRODUCTION") return `/production?salesOrderId=${salesOrderId}&from=pending-actions`;
      if (stage === "SALES_BILL") return `/sales-bills/new?salesOrderId=${salesOrderId}&from=pending-actions`;
      if (stage === "NEXT_RS") return `/sales-orders/${salesOrderId}/requirement-sheets`;
    }
  }
  if (rowType === ROW_TYPES.PRODUCTION_QUEUE && workOrderId > 0) {
    return `/production?workOrderId=${workOrderId}&from=pending-actions`;
  }
  if (rowType === ROW_TYPES.QA_QUEUE && workOrderId > 0) {
    return `/qc-entry?workOrderId=${workOrderId}&source=pending-actions`;
  }
  if (rowType === ROW_TYPES.QA_REWORK) {
    const dispId = Number(meta.dispositionId ?? 0);
    if (dispId > 0) return `/qc-entry?source=pending-actions#qc-rework-pending`;
    if (workOrderId > 0) return `/qc-entry?workOrderId=${workOrderId}&source=pending-actions`;
  }
  if (workOrderId > 0) return `/work-orders?highlight=${workOrderId}&from=pending-actions`;
  if (salesOrderId > 0) return `/sales-orders/${salesOrderId}/requirement-sheets`;
  return "/dashboard";
}

function friendlyActionForNormalizedRow(row, role = "STORE") {
  const rowType = String(row?.rowType ?? "");
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const nextAction = String(row?.nextAction ?? "").trim();
  const status = String(row?.currentStatus ?? "").toUpperCase();

  if (rowType === ROW_TYPES.PRODUCTION_QUEUE) {
    if (status.includes("ON_HOLD")) return "Production On Hold";
    return "Production Pending";
  }
  if (rowType === ROW_TYPES.QA_QUEUE) return "QC Pending";
  if (rowType === ROW_TYPES.QA_REWORK) return "Rework Pending";
  if (rowType === ROW_TYPES.DISPATCH_BACKLOG || status === "DISPATCH_PENDING") return "Dispatch Ready";
  if (rowType === ROW_TYPES.CONTINUE_WORKING) {
    const stage = String(meta.sourceStageKey ?? "").toUpperCase();
    if (stage === "DISPATCH") return "Dispatch Ready";
    if (stage === "QC") return "QC Pending";
    if (stage === "PRODUCTION") return "Production Pending";
    if (stage === "SALES_BILL") return "Sales Bill Pending";
    if (stage === "NEXT_RS") {
      const cycleNo = meta.cycleNo != null ? Number(meta.cycleNo) : 1;
      return Number.isFinite(cycleNo) && cycleNo > 0 ? `Create RS Cycle ${cycleNo}` : "Create RS Cycle";
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
    href: resolveHrefForNormalizedRow(enriched, role),
    sourceModule: enriched.sourceModule ?? null,
    currentStatus,
    purchaseOrderId: meta.primaryPoId != null ? Number(meta.primaryPoId) : null,
    materialRequirementId: meta.materialRequirementId != null ? Number(meta.materialRequirementId) : null,
  };
}

/**
 * Monthly plan lifecycle actions (Store submit / Purchase review / Store release).
 */
async function fetchMonthlyPlanPendingActions(db = prisma) {
  const plans = await db.monthlyProductionPlan.findMany({
    where: {
      OR: [
        { status: "DRAFT" },
        { status: "AWAITING_PURCHASE_REVIEW" },
        { status: "APPROVED", releasedAt: null },
      ],
    },
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
    const href = `/monthly-planning?period=${encodeURIComponent(periodKey)}&planId=${plan.id}&from=pending-actions`;
    const ageHours = ageHoursFromTimestamp(plan.updatedAt ?? plan.createdAt);

    if (plan.status === "DRAFT") {
      actions.push({
        id: `monthly-plan:submit:${plan.id}`,
        priority: PENDING_PRIORITY.MEDIUM,
        action: `Submit ${displayLabel}`,
        documentNo: docNo,
        ownerRole: "STORE",
        ageHours,
        href,
        sourceModule: "MONTHLY_PLANNING",
        currentStatus: "DRAFT",
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
      });
    } else if (plan.status === "APPROVED" && plan.releasedAt == null) {
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
      });
    }
  }
  return actions;
}

async function fetchAdminCommercialPendingActions() {
  const quotations = await getQuotationsPendingSalesOrderRows({ limit: 50 });
  return quotations.map((q) => ({
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
}

async function fetchPurchaseProcurementPendingActions(db = prisma) {
  const procurementPending = await buildProcurementPendingQueue(db);
  const actions = [];

  for (const row of procurementPending) {
    const nextKey = String(row.nextActionKey ?? row.operationalKey ?? "").toUpperCase();
    if (nextKey !== "CREATE_PO" && row.operationalKey !== "PR_PENDING_PO") continue;
    const mrId = Number(row.materialRequirementId ?? 0);
    const docNo = row.docNo?.trim() || (mrId > 0 ? `MR-${mrId}` : null);
    const demandPool =
      row.procurementDemandPool?.trim() ||
      resolveProcurementDemandPool(row.sourceType);
    const params = new URLSearchParams({ returnTo: "pending-actions", demandPool });
    if (mrId > 0) params.set("materialRequirementId", String(mrId));
    if (row.workOrderId) params.set("workOrderId", String(row.workOrderId));
    if (row.salesOrderId) params.set("salesOrderId", String(row.salesOrderId));
    actions.push({
      id: `procurement:create-po:mr:${mrId || row.workOrderId || row.salesOrderId}`,
      priority: priorityFromOperationalKey("CREATE_PO"),
      action: PREPARE_RM_PO,
      documentNo: docNo,
      ownerRole: "PURCHASE",
      ageHours: ageHoursFromTimestamp(row.createdAt),
      href: `/procurement-planning?${params.toString()}`,
      sourceModule: "PROCUREMENT",
      currentStatus: row.operationalKey ?? "PR_PENDING_PO",
    });
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

async function fetchStoreIssuePendingActions(db = prisma) {
  const rows = await buildStoreIssuePendingDashboardRows(db);
  return rows.map((row) => {
    const woId = Number(row.workOrderId ?? 0);
    const params = new URLSearchParams({ returnTo: "pending-actions", onlyBlocked: "1" });
    if (woId > 0) params.set("workOrderId", String(woId));
    if (row.salesOrderId) params.set("salesOrderId", String(row.salesOrderId));
    if (row.materialRequirementId) params.set("materialRequirementId", String(row.materialRequirementId));
    return {
      id: `store-issue:wo:${woId}`,
      priority: PENDING_PRIORITY.MEDIUM,
      action: "Material Issue Pending",
      documentNo: row.workOrderNo ?? row.salesOrderDocNo ?? null,
      ownerRole: "STORE",
      ageHours: null,
      href: `/material-issue?${params.toString()}`,
      sourceModule: "MATERIAL_ISSUE",
      currentStatus: "STORE_ISSUE_PENDING",
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

async function fetchStoreProductionHandoffPendingActions(db = prisma) {
  const rawRows = await buildStoreProductionHandoffDashboardRows(db);
  const rows = await filterNoQtyStoreHandoffSupersededByLaterRs(db, rawRows);
  return rows.map((row) => {
    const woId = Number(row.workOrderId ?? 0);
    const params = new URLSearchParams({ returnTo: "pending-actions", onlyBlocked: "1" });
    if (woId > 0) params.set("workOrderId", String(woId));
    if (row.salesOrderId) params.set("salesOrderId", String(row.salesOrderId));
    if (row.materialRequirementId) params.set("materialRequirementId", String(row.materialRequirementId));
    return {
      id: `store-handoff:wo:${woId}`,
      priority: PENDING_PRIORITY.LOW,
      action: RM_ISSUED_WAITING_FOR_PRODUCTION,
      documentNo: row.workOrderNo ?? row.salesOrderDocNo ?? null,
      ownerRole: "STORE",
      ageHours: null,
      href: `/reports/rm-shortage?${params.toString()}`,
      sourceModule: "RM_HANDOFF",
      currentStatus: "HANDOFF_TO_PRODUCTION",
    };
  });
}

/**
 * P8F-A14 — Store-owned NO_QTY cycle continuation when current-cycle RS is locked and next RS is eligible.
 */
async function fetchStoreNoQtyCreateNextRsPendingActions(db = prisma) {
  const openSoRows = await db.salesOrder.findMany({
    where: {
      orderType: "NO_QTY",
      internalStatus: { notIn: ["COMPLETED", "CLOSED", "MANUALLY_CLOSED"] },
    },
    select: { id: true, docNo: true, updatedAt: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 50,
  });

  const actions = [];
  for (const so of openSoRows) {
    const soId = Number(so.id);
    const eligibility = await computeNoQtyCreateNextRsEligibilityResolved(db, soId);
    if (!eligibility.eligible) continue;

    const { cycleId } = await resolveNoQtyEligibilityCycleId(db, soId);
    if (!cycleId) continue;

    const [cycle, lockedRs] = await Promise.all([
      db.salesOrderCycle.findFirst({
        where: { id: cycleId, salesOrderId: soId },
        select: { cycleNo: true },
      }),
      db.requirementSheet.findFirst({
        where: { salesOrderId: soId, cycleId, status: "LOCKED" },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        select: { updatedAt: true },
      }),
    ]);
    if (!lockedRs) continue;

    const nextCycleNo =
      cycle?.cycleNo != null && Number(cycle.cycleNo) > 0 ? Number(cycle.cycleNo) + 1 : null;
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
      ageHours: ageHoursFromTimestamp(lockedRs.updatedAt ?? so.updatedAt),
      href: `/sales-orders/${soId}/requirement-sheets?intent=add&from=pending-actions&source=no_qty_so&salesOrderId=${soId}`,
      sourceModule: "NO_QTY_PLANNING",
      currentStatus: "NEXT_RS_READY",
    });
  }
  return actions;
}

function filterNormalizedRowsByOwner(rows, role) {
  const parsed = parseUserRole(role);
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => String(row?.currentOwner ?? "").toUpperCase() === parsed,
  );
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
  if (status === "PR_PENDING_PO") return "PR_PENDING_PO";
  if (PURCHASE_PO_PREP_ACTIONS.has(action?.action)) return "PR_PENDING_PO";
  if (action?.action === WAITING_FOR_PURCHASE_RM_PO) return "PR_PENDING_PO";
  return null;
}

function isProcurementSupplementalAction(action) {
  return String(action?.id ?? "").startsWith("procurement:create-po:");
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
  if (label === READY_TO_START_PRODUCTION) return 0;
  if (label === "Production On Hold") return 1;
  if (label === "Production Pending") return 2;
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
 * @param {{ userRole?: string | null; db?: import('@prisma/client').PrismaClient }} [opts]
 */
async function getPendingActions(opts = {}) {
  const role = parseUserRole(opts.userRole);
  if (!role) {
    return { count: 0, actions: [], meta: { role: null, generatedAt: new Date().toISOString() } };
  }

  const db = opts.db ?? prisma;

  const [{ rows: mergedRows }, monthlyPlanActions] = await Promise.all([
    fetchMergedNormalizedRows({ mode: CONTROL_TOWER_ROW_MODES.FULL }),
    fetchMonthlyPlanPendingActions(db),
  ]);

  const roleFilteredNormalized = filterNormalizedRowsByOwner(mergedRows, role);
  const dedupedNormalized = dedupeRoleQueueRows(roleFilteredNormalized, role);
  const normalizedActions = dedupedNormalized.map((row) => mapNormalizedRowToPendingAction(row, role));

  const supplemental = [...monthlyPlanActions.filter((a) => String(a.ownerRole).toUpperCase() === role)];

  if (role === "ADMIN") {
    supplemental.push(...(await fetchAdminCommercialPendingActions()));
  }
  if (role === "PURCHASE") {
    supplemental.push(...(await fetchPurchaseProcurementPendingActions(db)));
  }
  if (role === "STORE") {
    supplemental.push(...(await fetchStoreIssuePendingActions(db)));
    supplemental.push(...(await fetchStoreGrnPendingActions(db)));
    supplemental.push(...(await fetchStoreProductionHandoffPendingActions(db)));
    supplemental.push(...(await fetchStoreNoQtyCreateNextRsPendingActions(db)));
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
  }

  const actions = sortPendingActions(merged);

  return {
    count: actions.length,
    actions: actions.map(({ id, priority, action, documentNo, ownerRole, ageHours, href }) => ({
      id,
      priority,
      action,
      documentNo,
      ownerRole,
      ageHours,
      href,
    })),
    meta: {
      role,
      generatedAt: new Date().toISOString(),
      normalizedRowCount: dedupedNormalized.length,
      supplementalCount: supplemental.length,
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
  fetchStoreGrnPendingActions,
  fetchStoreNoQtyCreateNextRsPendingActions,
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
  dedupeProductionPendingActions,
  preferProductionExecutionPendingAction,
  extractSalesOrderIdFromPendingAction,
};
