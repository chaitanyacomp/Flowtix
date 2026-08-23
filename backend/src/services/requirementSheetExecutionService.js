/**
 * P10-A2C - Read-only RS execution summary and readiness (NO_QTY).
 * RS balance uses locked Final RS Qty (totalRsQty / suggestedWoQtySnapshot via resolveNoQtyWoExecutableQty).
 */

const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");
const {
  isNoQtyWoPlacedStatusCounted,
  sumPlacedQtyByItem,
} = require("./noQtyExecutionReleaseService");
const {
  assessNoQtyBatchPlacement,
  previewRmReadinessForProposedQty,
} = require("./noQtyBatchPlacementEngine");
const { resolveNoQtyWoExecutableQty } = require("./noQtyWoQtyService");

const EPS = 1e-6;

const NO_QTY_PLACEMENT_STAGE = Object.freeze({
  READY_TO_PLACE_WO: "NO_QTY_READY_TO_PLACE_WO",
  PROCUREMENT_IN_PROGRESS: "NO_QTY_PROCUREMENT_IN_PROGRESS",
  MONTHLY_PLANNING_PENDING: "NO_QTY_REQUIREMENT_READY",
});

const NO_QTY_PLACEMENT_STAGE_LABELS = Object.freeze({
  [NO_QTY_PLACEMENT_STAGE.READY_TO_PLACE_WO]: "Ready to place WO",
  [NO_QTY_PLACEMENT_STAGE.PROCUREMENT_IN_PROGRESS]: "Procurement in progress",
  [NO_QTY_PLACEMENT_STAGE.MONTHLY_PLANNING_PENDING]: "Monthly planning pending",
});

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function dec(v) {
  if (v != null && typeof v === "object" && typeof v.toNumber === "function") {
    return v.toNumber();
  }
  return n(v);
}

/** Work-order line qty placed against RS execution balance (WO line planned qty). */
function woLinePlacedQty(line) {
  return round3(dec(line?.plannedQty ?? line?.qty));
}

function procurementSummaryLabel({ released, materialRequirementDocNo, mrStatus, partialStockReady = false }) {
  if (!released && partialStockReady) {
    return "RM-ready FG items can place WO; shortage items still need Monthly Planning / procurement";
  }
  if (!released) return "Not released to procurement";
  if (!materialRequirementDocNo) return "Procurement not required — execution ready";
  const statusPart = mrStatus ? ` - ${mrStatus}` : "";
  return `Released - MR ${materialRequirementDocNo}${statusPart}`;
}

function stepStatus({ complete = false, partial = false, inProgress = false, blocked = false } = {}) {
  if (blocked) return "BLOCKED";
  if (complete) return "COMPLETE";
  if (partial) return "PARTIAL";
  if (inProgress) return "IN_PROGRESS";
  return "NOT_STARTED";
}

function decisionLabel(status) {
  switch (status) {
    case "READY_TO_PLACE_WO":
      return "Ready to Place WO";
    case "PARTIALLY_READY":
      return "Partially Ready";
    case "AWAITING_PROCUREMENT":
      return "Awaiting Procurement";
    case "EXISTING_WO_PENDING_RM_ISSUE":
      return "Existing WO Pending RM Issue";
    case "EXISTING_WO_RUNNING":
      return "Existing WO Running";
    default:
      return "Blocked";
  }
}

function productionStatusFromWorkOrder(wo) {
  if (wo.status === "COMPLETED" || wo.status === "CLOSED") return "COMPLETE";
  if (wo.status === "CLOSED_WITH_SHORTFALL") return "CLOSED_WITH_SHORTFALL";
  if (wo.status === "IN_PROGRESS") return "IN_PROGRESS";
  return "NOT_STARTED";
}

function pmrIssueStatus(pmr) {
  if (!pmr) return "NOT_REQUESTED";
  const required = round3((pmr.lines ?? []).reduce((sum, line) => sum + dec(line.requiredQty), 0));
  const issued = round3((pmr.lines ?? []).reduce((sum, line) => sum + dec(line.issuedQty), 0));
  const pending = round3(Math.max(0, required - issued));
  if (required <= EPS) return pmr.status ?? "UNKNOWN";
  if (pending <= EPS || pmr.status === "FULLY_ISSUED") return "FULLY_ISSUED";
  if (issued > EPS || pmr.status === "PARTIALLY_ISSUED") return "PARTIALLY_ISSUED";
  return pmr.status === "DRAFT" ? "DRAFT" : "REQUESTED";
}


/**
 * WO placement totals for one locked RS (One RS → many WOs).
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} requirementSheetId
 */
async function loadWoPlacementContextForSheet(db, requirementSheetId) {
  const sheetId = Number(requirementSheetId);
  const workOrdersRaw = await db.workOrder.findMany({
    where: { requirementSheetId: sheetId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      lines: { select: { id: true, fgItemId: true, qty: true, plannedQty: true, fgItem: { select: { itemName: true, unit: true } } } },
      productionMaterialRequests: {
        orderBy: { id: "desc" },
        take: 1,
        select: {
          id: true,
          docNo: true,
          status: true,
          lines: { select: { requiredQty: true, issuedQty: true } },
        },
      },
    },
  });

  /** @type {Map<number, number>} */
  const woPlacedByItem = new Map();
  for (const wo of workOrdersRaw) {
    if (!isNoQtyWoPlacedStatusCounted(wo.status)) continue;
    for (const line of wo.lines ?? []) {
      const itemId = Number(line.fgItemId);
      if (!(itemId > 0)) continue;
      const placed = woLinePlacedQty(line);
      woPlacedByItem.set(itemId, round3((woPlacedByItem.get(itemId) ?? 0) + placed));
    }
  }

  const existingWoSummary = workOrdersRaw.map((wo) => {
    const pmr = wo.productionMaterialRequests?.[0] ?? null;
    const woQty = round3((wo.lines ?? []).reduce((s, line) => s + woLinePlacedQty(line), 0));
    const rmRequiredQty = round3((pmr?.lines ?? []).reduce((s, line) => s + dec(line.requiredQty), 0));
    const rmIssuedQty = round3((pmr?.lines ?? []).reduce((s, line) => s + dec(line.issuedQty), 0));
    const primaryLine = (wo.lines ?? [])[0] ?? null;
    const fgItemId = primaryLine?.fgItemId != null ? Number(primaryLine.fgItemId) : null;
    return {
      workOrderId: wo.id,
      docNo: wo.docNo ?? null,
      woQty,
      woStatus: wo.status,
      createdAt: wo.createdAt?.toISOString?.() ?? wo.createdAt ?? null,
      fgItemId,
      fgItemName: primaryLine?.fgItem?.itemName ?? (fgItemId != null ? `Item ${fgItemId}` : null),
      unit: primaryLine?.fgItem?.unit ?? null,
      pmrId: pmr?.id ?? null,
      pmrDocNo: pmr?.docNo ?? null,
      pmrStatus: pmr?.status ?? null,
      rmRequiredQty,
      rmIssuedQty,
      rmPendingIssueQty: round3(Math.max(0, rmRequiredQty - rmIssuedQty)),
      rmIssueStatus: pmrIssueStatus(pmr),
      productionStatus: productionStatusFromWorkOrder(wo),
    };
  });

  return { workOrdersRaw, woPlacedByItem, existingWoSummary };
}

function buildRsBalanceLinesFromSheet(sheet, woPlacedByItem) {
  const lines = (sheet.lines ?? []).map((ln) => {
    const itemId = Number(ln.itemId);
    const rsDemandQty = round3(resolveNoQtyWoExecutableQty(ln));
    const woPlacedQty = round3(woPlacedByItem.get(itemId) ?? 0);
    const rsBalanceQty = round3(Math.max(0, rsDemandQty - woPlacedQty));
    return {
      itemId,
      itemName: ln.item?.itemName ?? `Item ${itemId}`,
      rsDemandQty,
      woPlacedQty,
      rsBalanceQty,
    };
  });

  const totals = {
    rsDemandQty: round3(lines.reduce((s, l) => s + l.rsDemandQty, 0)),
    woPlacedQty: round3(lines.reduce((s, l) => s + l.woPlacedQty, 0)),
    rsBalanceQty: round3(lines.reduce((s, l) => s + l.rsBalanceQty, 0)),
  };

  return { lines, totals };
}

/**
 * Planning Context composition from locked RS lines (Phase 2B transparency).
 * Does not change executable qty — only exposes existing base / PS / QC components.
 */
function sumLockedRsComposition(sheetLines = []) {
  let customerDemandQty = 0;
  let productionShortageQty = 0;
  let qcFinalRejectionQty = 0;
  for (const ln of sheetLines || []) {
    customerDemandQty = round3(
      customerDemandQty + dec(ln.baseDemandQty ?? ln.requirementQty),
    );
    productionShortageQty = round3(productionShortageQty + dec(ln.productionShortfallQty));
    qcFinalRejectionQty = round3(qcFinalRejectionQty + dec(ln.qcRejectionRecoveryQty));
  }
  const totalRecoveryQty = round3(productionShortageQty + qcFinalRejectionQty);
  const composedTotalRsRequirementQty = round3(customerDemandQty + totalRecoveryQty);
  return {
    customerDemandQty,
    productionShortageQty,
    qcFinalRejectionQty,
    totalRecoveryQty,
    composedTotalRsRequirementQty,
  };
}

function deriveReadyToPlaceWo(totals, placement, readinessStatus = null) {
  const suggestedExecutableQty = round3(n(placement?.summary?.totalExecutableQty));
  const status = String(readinessStatus ?? "").toUpperCase();
  const ready = status === "READY_TO_PLACE_WO" || status === "PARTIALLY_READY";
  return (
    totals.rsBalanceQty > EPS &&
    ready &&
    (placement?.canPlace === true || suggestedExecutableQty > EPS)
  );
}

/**
 * Single source for NO_QTY placement processStageKey / label derivation.
 */
function deriveNoQtyPlacementProcessStage({
  readyToPlaceWo,
  rsBalanceQty,
  executionPlanReady,
  materialRequirement,
}) {
  let processStageKey = NO_QTY_PLACEMENT_STAGE.MONTHLY_PLANNING_PENDING;
  if (readyToPlaceWo) {
    processStageKey = NO_QTY_PLACEMENT_STAGE.READY_TO_PLACE_WO;
  } else if (n(rsBalanceQty) <= EPS) {
    processStageKey = null;
  } else if (executionPlanReady) {
    processStageKey = NO_QTY_PLACEMENT_STAGE.PROCUREMENT_IN_PROGRESS;
  }
  return {
    processStageKey,
    processStageLabel: processStageKey ? NO_QTY_PLACEMENT_STAGE_LABELS[processStageKey] ?? null : null,
  };
}

/** Operator-facing hint for workflow summaries — keyed only by assessor processStageKey. */
function noQtyPlacementStageWorkflowHint(placementStage) {
  const key = placementStage?.processStageKey ?? null;
  if (key === NO_QTY_PLACEMENT_STAGE.READY_TO_PLACE_WO) {
    return "RM available. Ready for Store to place Work Order(s).";
  }
  if (key === NO_QTY_PLACEMENT_STAGE.PROCUREMENT_IN_PROGRESS) {
    return "Procurement in progress. Store will place Work Order(s) when RM is ready.";
  }
  if (key === NO_QTY_PLACEMENT_STAGE.MONTHLY_PLANNING_PENDING) {
    return "Monthly planning is pending only when Estimated Net RM Requirement > 0.";
  }
  return null;
}

async function loadProcurementProgress(db, { released, materialRequirement }) {
  const mrLines = materialRequirement?.lines ?? [];
  const mrLineIds = mrLines.map((line) => Number(line.id)).filter((id) => id > 0);
  const counts = {
    mrLineCount: mrLineIds.length,
    prCount: 0,
    poCount: 0,
    grnCount: 0,
    grnReceivedQty: 0,
    pendingGrnQty: 0,
  };

  if (!mrLineIds.length) {
    return {
      steps: [
        { key: "MONTHLY_PLAN_RELEASED", label: "Monthly Plan Released", status: stepStatus({ complete: released }) },
        {
          key: "MR_CREATED",
          label: "MR Created",
          status: stepStatus({
            complete: Boolean(materialRequirement) || (released && !materialRequirement),
            inProgress: false,
          }),
        },
        { key: "PR_CREATED", label: "PR Created", status: "NOT_STARTED" },
        { key: "PO_CREATED", label: "PO Created", status: "NOT_STARTED" },
        { key: "GRN_RECEIVED", label: "GRN Received", status: "NOT_STARTED" },
      ],
      counts,
    };
  }

  const prIds = new Set();
  const poIds = new Set();
  const grnIds = new Set();
  const poLinePendingById = new Map();
  const poLineReceivedById = new Map();

  const sourceLinks = db.purchaseRequestLineSourceLink?.findMany
    ? await db.purchaseRequestLineSourceLink.findMany({
        where: { materialRequirementLineId: { in: mrLineIds } },
        include: {
          purchaseRequestLine: {
            include: {
              purchaseRequest: { select: { id: true, status: true, docNo: true } },
              poLinks: {
                include: {
                  rmPoLine: {
                    include: {
                      rmPo: { select: { id: true, status: true } },
                      grnLines: { include: { grn: true } },
                    },
                  },
                },
              },
            },
          },
        },
      })
    : [];

  const legacyLinks = db.rmPoLineProcurementLink?.findMany
    ? await db.rmPoLineProcurementLink.findMany({
        where: { materialRequirementLineId: { in: mrLineIds } },
        include: {
          rmPoLine: {
            include: {
              rmPo: { select: { id: true, status: true } },
              grnLines: { include: { grn: true } },
            },
          },
        },
      })
    : [];

  const trackPoLine = (poLine) => {
    if (!poLine?.rmPo) return;
    poIds.add(poLine.rmPo.id);
    const ordered = dec(poLine.qty);
    let received = 0;
    for (const gl of poLine.grnLines ?? []) {
      if (gl.grn?.reversedAt) continue;
      if (gl.grn?.id) grnIds.add(gl.grn.id);
      received += dec(gl.receivedQty);
    }
    poLineReceivedById.set(poLine.id, Math.max(poLineReceivedById.get(poLine.id) ?? 0, received));
    poLinePendingById.set(poLine.id, Math.max(poLinePendingById.get(poLine.id) ?? 0, Math.max(0, ordered - received)));
  };

  for (const link of sourceLinks ?? []) {
    const prLine = link.purchaseRequestLine;
    if (!prLine) continue;
    if (prLine.purchaseRequest?.id) prIds.add(prLine.purchaseRequest.id);
    for (const poLink of prLine.poLinks ?? []) trackPoLine(poLink.rmPoLine);
  }
  for (const link of legacyLinks ?? []) trackPoLine(link.rmPoLine);

  counts.prCount = prIds.size;
  counts.poCount = poIds.size;
  counts.grnCount = grnIds.size;
  counts.grnReceivedQty = round3([...poLineReceivedById.values()].reduce((sum, qty) => sum + qty, 0));
  counts.pendingGrnQty = round3([...poLinePendingById.values()].reduce((sum, qty) => sum + qty, 0));

  const poStatus = stepStatus({
    complete: counts.poCount > 0 && counts.pendingGrnQty <= EPS && counts.grnReceivedQty > EPS,
    partial: counts.poCount > 0 && counts.pendingGrnQty > EPS,
    inProgress: counts.poCount > 0,
  });
  const grnStatus = stepStatus({
    complete: counts.grnReceivedQty > EPS && counts.pendingGrnQty <= EPS,
    partial: counts.grnReceivedQty > EPS && counts.pendingGrnQty > EPS,
    inProgress: counts.pendingGrnQty > EPS,
  });

  const procurementPipelineComplete =
    counts.grnReceivedQty > EPS && counts.pendingGrnQty <= EPS && counts.poCount > 0;

  const prStatus = procurementPipelineComplete
    ? "COMPLETE"
    : stepStatus({
        complete: counts.prCount > 0 && counts.prCount >= counts.mrLineCount,
        partial: counts.prCount > 0 && counts.prCount < counts.mrLineCount,
      });
  const poStatusResolved = procurementPipelineComplete
    ? "COMPLETE"
    : poStatus;

  return {
    steps: [
      { key: "MONTHLY_PLAN_RELEASED", label: "Monthly Plan Released", status: stepStatus({ complete: released }) },
      { key: "MR_CREATED", label: "MR Created", status: stepStatus({ complete: Boolean(materialRequirement) }) },
      { key: "PR_CREATED", label: "PR Created", status: prStatus },
      { key: "PO_CREATED", label: "PO Created", status: poStatusResolved },
      { key: "GRN_RECEIVED", label: "GRN Received", status: grnStatus },
    ],
    counts,
  };
}

/**
 * FG-level WO gate (SSOT): do not lock the whole RS because one FG has shortage.
 * Uses authoritative batch placement (`canPlace` / per-line executable qty).
 */
function resolveStockExecutableWithoutPlan({ released, rmReadiness, placement }) {
  if (released) {
    return {
      allFgStockCovered: false,
      anyFgExecutableFromStock: false,
      skipMonthlyPlanning: false,
      allowWoWithoutPlanRelease: false,
    };
  }
  const netRmShortage = round3(n(rmReadiness?.summary?.shortageQty));
  const allFgStockCovered = netRmShortage <= EPS;
  const executableQty = round3(n(placement?.summary?.totalExecutableQty));
  const anyFgExecutableFromStock =
    placement?.canPlace === true ||
    executableQty > EPS ||
    String(placement?.status ?? "").toUpperCase() === "READY" ||
    String(placement?.status ?? "").toUpperCase() === "PARTIALLY_READY";
  return {
    allFgStockCovered,
    anyFgExecutableFromStock,
    skipMonthlyPlanning: allFgStockCovered,
    allowWoWithoutPlanRelease: allFgStockCovered || anyFgExecutableFromStock,
  };
}

function buildReadinessDecision({
  totals,
  rmReadiness,
  existingWoSummary,
  released,
  materialRequirement,
  procurementRequired = true,
  placement = null,
}) {
  if (totals.rsBalanceQty <= EPS) {
    const status = "BLOCKED";
    return { status, label: decisionLabel(status), reason: "No RS balance remains to place on Work Orders." };
  }

  const pendingIssue = (existingWoSummary ?? []).find((wo) => wo.rmPendingIssueQty > EPS);
  if (pendingIssue) {
    const status = "EXISTING_WO_PENDING_RM_ISSUE";
    return { status, label: decisionLabel(status), reason: "Open WO still has RM pending for Store issue." };
  }

  const runningWo = (existingWoSummary ?? []).find((wo) => wo.productionStatus === "IN_PROGRESS");
  if (runningWo) {
    const status = "EXISTING_WO_RUNNING";
    return { status, label: decisionLabel(status), reason: "Existing WO is already running." };
  }

  if (rmReadiness.summary.missingBomCount > 0) {
    const status = "BLOCKED";
    return { status, label: decisionLabel(status), reason: "RM requirement preview is blocked by missing BOM data." };
  }

  /**
   * FG-level readiness (SSOT):
   * - All FG stock-covered → skip Monthly Planning entirely (PROCUREMENT_NOT_REQUIRED).
   * - Some FG executable from stock → allow WO for ready FG even before plan release;
   *   Monthly Planning remains for shortage FG only (do not whole-RS lock).
   * - No FG executable → await Monthly Planning / procurement as before.
   */
  const stockPath = resolveStockExecutableWithoutPlan({ released, rmReadiness, placement });
  const effectiveReleased = released || stockPath.allowWoWithoutPlanRelease;
  const effectiveProcurementRequired = stockPath.skipMonthlyPlanning ? false : procurementRequired;

  if (!effectiveReleased) {
    const status = "AWAITING_PROCUREMENT";
    return {
      status,
      label: decisionLabel(status),
      reason: "Monthly Plan procurement release is not complete yet.",
      procurementOutcome: null,
      skipMonthlyPlanning: false,
      allowWoWithoutPlanRelease: false,
    };
  }

  // Zero-net approved plans (or fully stock-covered initial path) complete handoff without an MR.
  // Mixed stock-ready FG may proceed without MR; shortage FG still need procurement separately.
  if (effectiveProcurementRequired && !materialRequirement && !stockPath.allowWoWithoutPlanRelease) {
    const status = "AWAITING_PROCUREMENT";
    return {
      status,
      label: decisionLabel(status),
      reason: "Monthly Plan procurement release or MR is not complete yet.",
      procurementOutcome: null,
      skipMonthlyPlanning: false,
      allowWoWithoutPlanRelease: false,
    };
  }

  if (!rmReadiness.lines.length && totals.rsBalanceQty > EPS) {
    const status = "BLOCKED";
    return { status, label: decisionLabel(status), reason: "RM requirement preview is blocked by missing BOM data." };
  }

  if (rmReadiness.summary.shortageQty <= EPS) {
    const status = "READY_TO_PLACE_WO";
    return {
      status,
      label: decisionLabel(status),
      reason: stockPath.skipMonthlyPlanning
        ? "All required RM available. Monthly Planning / procurement not required."
        : "All required RM available.",
      procurementOutcome: stockPath.skipMonthlyPlanning ? "PROCUREMENT_NOT_REQUIRED" : null,
      skipMonthlyPlanning: stockPath.skipMonthlyPlanning,
      allowWoWithoutPlanRelease: stockPath.allowWoWithoutPlanRelease,
    };
  }

  if (
    stockPath.anyFgExecutableFromStock ||
    rmReadiness.summary.availableQty > EPS ||
    rmReadiness.summary.incomingQty > EPS
  ) {
    const status = "PARTIALLY_READY";
    return {
      status,
      label: decisionLabel(status),
      reason: stockPath.anyFgExecutableFromStock
        ? "Work Order creation is available for RM-ready FG items. Items with unresolved RM shortages remain blocked."
        : "Some RM shortages still exist.",
      procurementOutcome: null,
      skipMonthlyPlanning: false,
      allowWoWithoutPlanRelease: stockPath.allowWoWithoutPlanRelease,
    };
  }

  const status = "AWAITING_PROCUREMENT";
  return {
    status,
    label: decisionLabel(status),
    reason: "Required RM is not available yet.",
    skipMonthlyPlanning: false,
    allowWoWithoutPlanRelease: false,
  };
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} requirementSheetId
 */
async function getRequirementSheetExecutionSummary(db, requirementSheetId, deps = {}) {
  const sheet = await db.requirementSheet.findUnique({
    where: { id: requirementSheetId },
    include: {
      salesOrder: { select: { id: true, orderType: true } },
      lines: {
        include: { item: { select: { id: true, itemName: true, itemType: true } } },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!sheet) {
    const err = new Error("Requirement sheet not found.");
    err.statusCode = 404;
    throw err;
  }
  if (sheet.salesOrder?.orderType !== "NO_QTY") {
    const err = new Error("Execution summary is available only for No Qty requirement sheets.");
    err.statusCode = 409;
    throw err;
  }
  if (sheet.status !== "LOCKED") {
    const err = new Error("Execution summary is available only for locked requirement sheets.");
    err.statusCode = 409;
    throw err;
  }

  const periodKey = String(sheet.periodKey ?? "").trim();
  const releasedPlan = periodKey
    ? await db.monthlyProductionPlan.findFirst({
        where: { periodKey, releasedAt: { not: null } },
        orderBy: [{ releasedAt: "desc" }, { id: "desc" }],
      })
    : null;
  const released = Boolean(releasedPlan?.releasedAt);
  // WO placement may proceed against a released plan even when Additional Plan is still
  // required for uncovered RS demand (ADDITIONAL_PLAN_REQUIRED must not block execution).
  const executionPlanReady = released;

  let materialRequirement = null;
  if (executionPlanReady && releasedPlan?.id) {
    materialRequirement = await db.materialRequirement.findFirst({
      where: {
        monthlyProductionPlanId: releasedPlan.id,
        sourceType: "MONTHLY_PLAN",
        reversedAt: null,
      },
      orderBy: { id: "desc" },
      select: {
        id: true,
        docNo: true,
        status: true,
        lines: { select: { id: true, rmItemId: true, requiredQty: true, shortageQty: true, procuredQty: true } },
      },
    });
  }

  const { workOrdersRaw, woPlacedByItem, existingWoSummary } = await loadWoPlacementContextForSheet(db, sheet.id);
  const assessPlacement = deps.assessNoQtyBatchPlacement || assessNoQtyBatchPlacement;
  const batchAssessment = await assessPlacement(db, sheet, { placedByItem: woPlacedByItem, ...deps });
  const totals = batchAssessment.totals;
  const composition = sumLockedRsComposition(sheet.lines);
  const lines = batchAssessment.balanceLines.map((line) => ({
    itemId: line.itemId,
    itemName: line.itemName,
    rsDemandQty: line.rsDemandQty,
    woPlacedQty: line.woPlacedQty,
    rsBalanceQty: line.rsBalanceQty,
  }));
  const placement = {
    ...batchAssessment.placement,
    snapshot: batchAssessment.snapshot,
  };
  const rmReadiness = batchAssessment.rmReadiness;

  const workOrders = workOrdersRaw.map((wo) => {
    const pmr = wo.productionMaterialRequests?.[0] ?? null;
    const totalQty = round3((wo.lines ?? []).reduce((s, line) => s + woLinePlacedQty(line), 0));
    return {
      id: wo.id,
      docNo: wo.docNo ?? null,
      status: wo.status,
      createdAt: wo.createdAt?.toISOString?.() ?? wo.createdAt ?? null,
      totalQty,
      pmrId: pmr?.id ?? null,
      pmrDocNo: pmr?.docNo ?? null,
      pmrStatus: pmr?.status ?? null,
    };
  });

  const mrDocNo = materialRequirement?.docNo ?? null;
  const mrStatus = materialRequirement?.status ?? null;
  let procurementRequired = true;
  if (executionPlanReady && releasedPlan?.id && !materialRequirement) {
    try {
      const {
        assessMonthlyPlanProcurementOutcome,
      } = require("./monthlyPlanningProcurementOutcomeService");
      const outcome = await assessMonthlyPlanProcurementOutcome({
        db,
        planId: releasedPlan.id,
        plan: releasedPlan,
      });
      procurementRequired = outcome.procurementRequired;
    } catch {
      procurementRequired = true;
    }
  } else if (materialRequirement) {
    procurementRequired = true;
  }
  const readiness = buildReadinessDecision({
    totals,
    rmReadiness,
    existingWoSummary,
    released: executionPlanReady,
    materialRequirement,
    procurementRequired,
    placement,
  });
  const skipMonthlyPlanning = Boolean(readiness.skipMonthlyPlanning);
  const allowWoWithoutPlanRelease = Boolean(readiness.allowWoWithoutPlanRelease);
  // Plan/handcuff release for procurement badge (all-covered skip OR real release).
  const procurementHandoffComplete = executionPlanReady || skipMonthlyPlanning;
  // WO create / Place WO PA may unlock for stock-ready FG before period release.
  const effectivePlanReady = procurementHandoffComplete || allowWoWithoutPlanRelease;
  const procurementProgress = await loadProcurementProgress(db, {
    released: procurementHandoffComplete,
    materialRequirement,
  });
  const procurementStatus = executionPlanReady
    ? (mrStatus ?? (materialRequirement ? "RELEASED" : "PROCUREMENT_NOT_REQUIRED"))
    : skipMonthlyPlanning
      ? "PROCUREMENT_NOT_REQUIRED"
      : allowWoWithoutPlanRelease
        ? "PARTIAL_STOCK_READY"
        : "NOT_RELEASED";
  const placementStage = await buildNoQtyLockedSheetPlacementAssessment(db, sheet, deps, {
    totals,
    placement,
    readiness,
    existingWoSummary,
    materialRequirement,
    executionPlanReady: effectivePlanReady,
  });

  const fgItemReadiness = (placement.lines ?? []).map((line) => {
    const executable = round3(n(line.suggestedExecutableQty ?? line.executableQty));
    const balance = round3(n(line.rsBalanceQty));
    let outcome = "PROCUREMENT_REQUIRED";
    if (balance <= EPS) outcome = "ZERO_BALANCE";
    else if (String(line.status).toUpperCase() === "MISSING_BOM") outcome = "MISSING_BOM";
    else if (executable > EPS && executable + EPS >= balance) outcome = "READY_FOR_WO";
    else if (executable > EPS) outcome = "PARTIALLY_READY";
    return {
      itemId: line.itemId,
      itemName: line.itemName,
      rsBalanceQty: balance,
      suggestedExecutableQty: executable,
      placementStatus: line.status,
      outcome,
      shortageSummary: line.operatorGuidance?.message ?? line.reason ?? null,
    };
  });
  const readyFgCount = fgItemReadiness.filter((r) => r.outcome === "READY_FOR_WO" || r.outcome === "PARTIALLY_READY").length;
  const shortageFgCount = fgItemReadiness.filter((r) => r.outcome === "PROCUREMENT_REQUIRED").length;

  let productionRuns = [];
  try {
    const { mapPersistedRunRow, RUN_INCLUDE } = require("./woProductionRunAllocationService");
    const runRows = await db.requirementSheetPlannedRunAllocation.findMany({
      where: { requirementSheetId: sheet.id },
      include: RUN_INCLUDE,
      orderBy: [{ fgItemId: "asc" }, { runSequence: "asc" }],
    });
    productionRuns = runRows.map(mapPersistedRunRow).filter(Boolean);
  } catch {
    productionRuns = [];
  }

  return {
    requirementSheetId: sheet.id,
    salesOrderId: sheet.salesOrderId,
    cycleId: sheet.cycleId ?? null,
    periodKey: periodKey || null,
    status: sheet.status,
    release: {
      monthlyPlanId: releasedPlan?.id ?? null,
      released: procurementHandoffComplete,
      releasedAt: releasedPlan?.releasedAt?.toISOString?.() ?? releasedPlan?.releasedAt ?? null,
      releasedRevision: releasedPlan?.releasedRevision ?? null,
      label: releasedPlan ? buildPlanDisplayLabel(releasedPlan) : null,
      procurementNotRequiredWithoutPlan: skipMonthlyPlanning && !executionPlanReady,
      allowWoWithoutPlanRelease: allowWoWithoutPlanRelease && !procurementHandoffComplete,
    },
    totals,
    lines,
    workOrders,
    readiness,
    procurementProgress,
    rmReadiness,
    purgingPlanning: batchAssessment.purgingPlanning ?? null,
    productionRuns,
    existingWoSummary,
    placement,
    placementSnapshot: batchAssessment.snapshot,
    placementStage,
    processStageKey: placementStage.processStageKey,
    processStageLabel: placementStage.processStageLabel,
    readyToPlaceWo: placementStage.readyToPlaceWo,
    fgItemReadiness,
    fgReadinessSummary: {
      readyCount: readyFgCount,
      shortageCount: shortageFgCount,
      totalWithBalance: fgItemReadiness.filter((r) => r.rsBalanceQty > EPS).length,
    },
    kpis: {
      customerDemandQty: composition.customerDemandQty,
      productionShortageQty: composition.productionShortageQty,
      qcFinalRejectionQty: composition.qcFinalRejectionQty,
      totalRecoveryQty: composition.totalRecoveryQty,
      totalRsRequirement: totals.rsDemandQty,
      woQuantityPlaced: totals.woPlacedQty,
      remainingRequirement: totals.rsBalanceQty,
      remainingToPlace: totals.rsBalanceQty,
      rmLimitedCapacity: totals.rmLimitedCapacityQty ?? placement.summary.totalExecutableQty,
      suggestedNextWoQty: placement.summary.totalExecutableQty,
      numberOfWos: existingWoSummary.length,
    },
    procurement: {
      status: procurementStatus,
      materialRequirementId: materialRequirement?.id ?? null,
      materialRequirementDocNo: mrDocNo,
      summaryLabel: procurementSummaryLabel({
        released: procurementHandoffComplete,
        materialRequirementDocNo: mrDocNo,
        mrStatus,
        partialStockReady: allowWoWithoutPlanRelease && !procurementHandoffComplete,
      }),
    },
    rmPreview: {
      available: true,
      basis: rmReadiness?.basis ?? "PROPOSED_WO_QTY",
      message:
        "RM Detail reflects the proposed / suggested Work Order quantity (not the full remaining RS requirement). Entered qty updates RM requirements live.",
    },
  };
}

/**
 * Authoritative NO_QTY placement assessment for a locked requirement sheet.
 * When `precomputed` is supplied (execution summary path), reuses loaded context.
 */
async function buildNoQtyLockedSheetPlacementAssessment(db, sheet, deps = {}, precomputed = null) {
  const periodKey = String(sheet.periodKey ?? "").trim();
  let executionPlanReady;
  let materialRequirement;
  let totals;
  let placement;
  let readiness;
  let existingWoSummary;
  let woPlacedByItem;

  if (precomputed) {
    ({
      totals,
      placement,
      readiness,
      existingWoSummary,
      materialRequirement,
      executionPlanReady,
    } = precomputed);
  } else {
    const releasedPlan = periodKey
      ? await db.monthlyProductionPlan.findFirst({
          where: { periodKey, releasedAt: { not: null } },
          orderBy: [{ releasedAt: "desc" }, { id: "desc" }],
        })
      : null;
    const released = Boolean(releasedPlan?.releasedAt);
    // WO placement may proceed against a released plan even when Additional Plan is still
    // required for uncovered RS demand (ADDITIONAL_PLAN_REQUIRED must not block execution).
    executionPlanReady = released;

    materialRequirement = null;
    if (executionPlanReady && releasedPlan?.id) {
      materialRequirement = await db.materialRequirement.findFirst({
        where: {
          monthlyProductionPlanId: releasedPlan.id,
          sourceType: "MONTHLY_PLAN",
          reversedAt: null,
        },
        orderBy: { id: "desc" },
        select: { id: true, docNo: true, status: true },
      });
    }

    ({ existingWoSummary, woPlacedByItem } = await loadWoPlacementContextForSheet(db, sheet.id));
    const assessPlacement = deps.assessNoQtyBatchPlacement || assessNoQtyBatchPlacement;
  const batchAssessment = await assessPlacement(db, sheet, { placedByItem: woPlacedByItem, ...deps });
    totals = batchAssessment.totals;
    placement = {
      ...batchAssessment.placement,
      snapshot: batchAssessment.snapshot,
    };
    const rmReadiness = batchAssessment.rmReadiness;
    let procurementRequired = true;
    if (executionPlanReady && releasedPlan?.id && !materialRequirement) {
      try {
        const {
          assessMonthlyPlanProcurementOutcome,
        } = require("./monthlyPlanningProcurementOutcomeService");
        const outcome = await assessMonthlyPlanProcurementOutcome({
          db,
          planId: releasedPlan.id,
          plan: releasedPlan,
        });
        procurementRequired = outcome.procurementRequired;
      } catch {
        procurementRequired = true;
      }
    } else if (materialRequirement) {
      procurementRequired = true;
    }
    readiness = buildReadinessDecision({
      totals,
      rmReadiness,
      existingWoSummary,
      released: executionPlanReady,
      materialRequirement,
      procurementRequired,
      placement,
    });
  }

  // Align with execution summary: Net RM = 0 without a Monthly Plan is execution-ready
  // (PROCUREMENT_NOT_REQUIRED). Mixed FG readiness also unlocks Place WO for stock-ready
  // lines without waiting for period release (allowWoWithoutPlanRelease).
  const skipMonthlyPlanning = Boolean(readiness?.skipMonthlyPlanning);
  const allowWoWithoutPlanRelease = Boolean(readiness?.allowWoWithoutPlanRelease);
  const effectiveReleased =
    Boolean(executionPlanReady) || skipMonthlyPlanning || allowWoWithoutPlanRelease;

  const suggestedWoQty = round3(n(placement?.summary?.totalExecutableQty));
  const readyToPlaceWo = deriveReadyToPlaceWo(totals, placement, readiness.status);
  const { processStageKey, processStageLabel } = deriveNoQtyPlacementProcessStage({
    readyToPlaceWo,
    rsBalanceQty: totals.rsBalanceQty,
    executionPlanReady: effectiveReleased,
    materialRequirement,
  });

  return {
    processStageKey,
    processStageLabel,
    readyToPlaceWo,
    requirementSheetId: Number(sheet.id),
    readinessStatus: readiness.status,
    periodKey: periodKey || null,
    released: effectiveReleased,
    skipMonthlyPlanning,
    allowWoWithoutPlanRelease,
    materialRequirementId: materialRequirement?.id ?? null,
    rsBalanceQty: totals.rsBalanceQty,
    suggestedWoQty,
    placementStatus: placement?.status ?? null,
    existingWoSummary,
    cycleId: sheet.cycleId != null ? Number(sheet.cycleId) : null,
    requirementSheetDocNo: sheet.docNo ?? null,
  };
}

function emptyNoQtyPlacementAssessment(overrides = {}) {
  return {
    processStageKey: null,
    processStageLabel: null,
    readyToPlaceWo: false,
    requirementSheetId: null,
    readinessStatus: null,
    periodKey: null,
    released: false,
    materialRequirementId: null,
    rsBalanceQty: 0,
    suggestedWoQty: 0,
    placementStatus: null,
    existingWoSummary: [],
    cycleId: null,
    requirementSheetDocNo: null,
    ...overrides,
  };
}

/**
 * Lightweight placement stage for a single locked NO_QTY requirement sheet.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} requirementSheetId
 */
async function assessNoQtyPlacementStageForSheet(db, requirementSheetId, deps = {}) {
  const sheetId = Number(requirementSheetId);
  if (!Number.isFinite(sheetId) || sheetId <= 0) {
    return emptyNoQtyPlacementAssessment();
  }

  const sheet = await db.requirementSheet.findUnique({
    where: { id: sheetId },
    include: {
      salesOrder: { select: { id: true, orderType: true } },
      lines: { include: { item: { select: { id: true, itemName: true, itemType: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!sheet || String(sheet.status ?? "").toUpperCase() !== "LOCKED" || sheet.salesOrder?.orderType !== "NO_QTY") {
    return emptyNoQtyPlacementAssessment({ requirementSheetId: sheetId });
  }

  return buildNoQtyLockedSheetPlacementAssessment(db, sheet, deps);
}

/**
 * Lightweight placement stage for NO_QTY list / workflow / pending actions (no full execution payload).
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {{ salesOrderId: number, cycleId: number }} input
 */
async function assessNoQtyPlacementStageForCycle(db, input, deps = {}) {
  const salesOrderId = Number(input?.salesOrderId);
  const cycleId = Number(input?.cycleId);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0 || !Number.isFinite(cycleId) || cycleId <= 0) {
    return emptyNoQtyPlacementAssessment();
  }

  const sheet = await db.requirementSheet.findFirst({
    where: { salesOrderId, cycleId, status: "LOCKED" },
    orderBy: [{ version: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (!sheet) {
    return emptyNoQtyPlacementAssessment();
  }

  return assessNoQtyPlacementStageForSheet(db, sheet.id, deps);
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {Array<{ salesOrderId: number, cycleId: number }>} pairs
 */
async function batchAssessNoQtyPlacementStages(db, pairs, deps = {}) {
  const list = Array.isArray(pairs) ? pairs : [];
  const out = new Map();
  await Promise.all(
    list.map(async ({ salesOrderId, cycleId }) => {
      const soId = Number(salesOrderId);
      const cid = Number(cycleId);
      if (!Number.isFinite(soId) || soId <= 0 || !Number.isFinite(cid) || cid <= 0) return;
      const key = `${soId}:${cid}`;
      if (out.has(key)) return;
      const assessed = await assessNoQtyPlacementStageForCycle(db, { salesOrderId: soId, cycleId: cid }, deps);
      out.set(key, assessed);
    }),
  );
  return out;
}

/**
 * Live RM Detail for operator-entered proposed WO quantities (preview only).
 * Reuses canonical BOM explosion + free-stock availability; does not place WO.
 */
async function previewRequirementSheetRmForProposedQty(db, requirementSheetId, proposedLines, deps = {}) {
  const sheet = await db.requirementSheet.findUnique({
    where: { id: requirementSheetId },
    include: {
      salesOrder: { select: { id: true, orderType: true } },
      lines: {
        include: { item: { select: { id: true, itemName: true, itemType: true, unit: true } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!sheet) {
    const err = new Error("Requirement sheet not found.");
    err.statusCode = 404;
    throw err;
  }
  if (sheet.salesOrder?.orderType !== "NO_QTY") {
    const err = new Error("RM preview is available only for No Qty requirement sheets.");
    err.statusCode = 409;
    throw err;
  }
  if (sheet.status !== "LOCKED") {
    const err = new Error("RM preview is available only for locked requirement sheets.");
    err.statusCode = 409;
    throw err;
  }

  const { woPlacedByItem } = await loadWoPlacementContextForSheet(db, sheet.id);
  const previewFn = deps.previewRmReadinessForProposedQty || previewRmReadinessForProposedQty;
  return previewFn(db, sheet, proposedLines ?? [], { placedByItem: woPlacedByItem, ...deps });
}

module.exports = {
  getRequirementSheetExecutionSummary,
  previewRequirementSheetRmForProposedQty,
  assessNoQtyPlacementStageForSheet,
  assessNoQtyPlacementStageForCycle,
  batchAssessNoQtyPlacementStages,
  emptyNoQtyPlacementAssessment,
  NO_QTY_PLACEMENT_STAGE,
  NO_QTY_PLACEMENT_STAGE_LABELS,
  deriveNoQtyPlacementProcessStage,
  noQtyPlacementStageWorkflowHint,
  buildNoQtyLockedSheetPlacementAssessment,
  buildReadinessDecision,
  deriveReadyToPlaceWo,
  loadWoPlacementContextForSheet,
  buildRsBalanceLinesFromSheet,
  sumLockedRsComposition,
  woLinePlacedQty,
  procurementSummaryLabel,
};
