/**
 * P10-A2C - Read-only RS execution summary and readiness (NO_QTY).
 * RS balance uses RequirementSheetLine.requirementQty only - not suggestedWoQtySnapshot.
 */

const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");
const { aggregateRmDemandForFgLines, loadApprovedBomWithLines } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const {
  isNoQtyWoPlacedStatusCounted,
  buildNoQtyWoBatchPlacementPreview,
} = require("./noQtyExecutionReleaseService");

const EPS = 1e-6;

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

function procurementSummaryLabel({ released, materialRequirementDocNo, mrStatus }) {
  if (!released) return "Not released to procurement";
  if (!materialRequirementDocNo) return "Released to procurement - MR pending";
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

function rmLineStatus({ requiredQty, availableQty, shortageQty, incomingQty }) {
  if (requiredQty <= EPS || shortageQty <= EPS) return "READY";
  if (availableQty > EPS || incomingQty > EPS) return "PARTIALLY_READY";
  return "AWAITING_PROCUREMENT";
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
          status: stepStatus({ complete: Boolean(materialRequirement), inProgress: released && !materialRequirement }),
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

  const prStatus = stepStatus({
    complete: counts.prCount > 0 && counts.prCount >= counts.mrLineCount,
    partial: counts.prCount > 0 && counts.prCount < counts.mrLineCount,
  });
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

  return {
    steps: [
      { key: "MONTHLY_PLAN_RELEASED", label: "Monthly Plan Released", status: stepStatus({ complete: released }) },
      { key: "MR_CREATED", label: "MR Created", status: stepStatus({ complete: Boolean(materialRequirement) }) },
      { key: "PR_CREATED", label: "PR Created", status: prStatus },
      { key: "PO_CREATED", label: "PO Created", status: poStatus },
      { key: "GRN_RECEIVED", label: "GRN Received", status: grnStatus },
    ],
    counts,
  };
}

async function buildRmReadiness(db, lines, deps = {}) {
  const aggregate = deps.aggregateRmDemandForFgLines || aggregateRmDemandForFgLines;
  const loadTopLevelBom = deps.loadApprovedBomWithLines || loadApprovedBomWithLines;
  const availability = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;
  const fgBalanceLines = (lines ?? [])
    .filter((line) => line.rsBalanceQty > EPS)
    .map((line) => ({
      fgItemId: line.itemId,
      fgItemName: line.itemName,
      fgQty: line.rsBalanceQty,
      bomMissing: false,
    }));

  if (!fgBalanceLines.length) {
    return {
      basis: "RS_BALANCE",
      fgBalanceLines: [],
      lines: [],
      missingBoms: [],
      summary: {
        requiredQty: 0,
        availableQty: 0,
        shortageQty: 0,
        incomingQty: 0,
        readyLineCount: 0,
        partialLineCount: 0,
        awaitingProcurementLineCount: 0,
        missingBomCount: 0,
      },
    };
  }

  const topLevelBomIssues = [];
  for (const fg of fgBalanceLines) {
    const bom = await loadTopLevelBom(db, fg.fgItemId);
    if (!bom) {
      topLevelBomIssues.push({
        type: "TOP_LEVEL_MISSING_BOM",
        status: "MISSING_BOM",
        fgItemId: fg.fgItemId,
        fgItemName: fg.fgItemName,
        fgQty: fg.fgQty,
        message: "Missing BOM for FG item. RM requirement cannot be calculated.",
      });
      continue;
    }
    if (!bom.lines?.length) {
      topLevelBomIssues.push({
        type: "TOP_LEVEL_EMPTY_BOM",
        status: "MISSING_BOM",
        fgItemId: fg.fgItemId,
        fgItemName: fg.fgItemName,
        fgQty: fg.fgQty,
        message: "FG BOM is empty. RM readiness cannot be previewed.",
      });
    }
  }

  const demand = await aggregate(db, fgBalanceLines);
  const rmNeeded = demand?.rmNeeded instanceof Map ? demand.rmNeeded : new Map();
  const childBomIssues = (demand?.missingChildBoms ?? []).map((m) => ({
    type: "CHILD_MISSING_BOM",
    status: "MISSING_BOM",
    sfgItemId: m.sfgItemId,
    sfgName: m.sfgName,
    message: "Missing BOM for SFG item. RM requirement cannot be fully calculated.",
  }));
  const missingBoms = [...topLevelBomIssues, ...childBomIssues];
  const itemIds = [...rmNeeded.keys()].filter((id) => Number(id) > 0);
  const availabilityRows = itemIds.length
    ? await availability({
        db,
        itemIds,
        requiredQtyByItemId: rmNeeded,
        includeIncoming: true,
        includeIssued: false,
      })
    : [];
  const itemRows =
    itemIds.length && db.item?.findMany
      ? await db.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, itemName: true },
        })
      : [];
  const itemNameById = new Map((itemRows ?? []).map((row) => [Number(row.id), row.itemName]));

  const rmLines = (availabilityRows ?? []).map((row) => {
    const requiredQty = round3(dec(row.requiredQty ?? rmNeeded.get(row.itemId)));
    const availableQty = round3(dec(row.freeStockQty ?? row.physicalUsableStockQty));
    const shortageQty = round3(dec(row.shortageAfterReservationQty ?? Math.max(0, requiredQty - availableQty)));
    const incomingQty = round3(dec(row.incomingQty));
    const status = rmLineStatus({ requiredQty, availableQty, shortageQty, incomingQty });
    return {
      rmItemId: Number(row.itemId),
      rmItemName: row.itemName ?? itemNameById.get(Number(row.itemId)) ?? `Item ${row.itemId}`,
      requiredQty,
      availableQty,
      shortageQty,
      incomingQty,
      status,
    };
  });

  return {
    basis: "RS_BALANCE",
    fgBalanceLines,
    lines: rmLines,
    missingBoms,
    summary: {
      requiredQty: round3(rmLines.reduce((sum, line) => sum + line.requiredQty, 0)),
      availableQty: round3(rmLines.reduce((sum, line) => sum + line.availableQty, 0)),
      shortageQty: round3(rmLines.reduce((sum, line) => sum + line.shortageQty, 0)),
      incomingQty: round3(rmLines.reduce((sum, line) => sum + line.incomingQty, 0)),
      readyLineCount: rmLines.filter((line) => line.status === "READY").length,
      partialLineCount: rmLines.filter((line) => line.status === "PARTIALLY_READY").length,
      awaitingProcurementLineCount: rmLines.filter((line) => line.status === "AWAITING_PROCUREMENT").length,
      missingBomCount: missingBoms.length,
    },
  };
}

function buildReadinessDecision({ totals, rmReadiness, existingWoSummary, released, materialRequirement }) {
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

  if (rmReadiness.summary.missingBomCount > 0 || (!rmReadiness.lines.length && totals.rsBalanceQty > EPS)) {
    const status = "BLOCKED";
    return { status, label: decisionLabel(status), reason: "RM requirement preview is blocked by missing BOM data." };
  }

  if (!released || !materialRequirement) {
    const status = "AWAITING_PROCUREMENT";
    return { status, label: decisionLabel(status), reason: "Monthly Plan procurement release or MR is not complete yet." };
  }

  if (rmReadiness.summary.shortageQty <= EPS) {
    const status = "READY_TO_PLACE_WO";
    return { status, label: decisionLabel(status), reason: "All required RM available." };
  }

  if (rmReadiness.summary.availableQty > EPS || rmReadiness.summary.incomingQty > EPS) {
    const status = "PARTIALLY_READY";
    return { status, label: decisionLabel(status), reason: "Some RM shortages still exist." };
  }

  const status = "AWAITING_PROCUREMENT";
  return { status, label: decisionLabel(status), reason: "Required RM is not available yet." };
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

  let materialRequirement = null;
  if (releasedPlan?.id) {
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

  const workOrdersRaw = await db.workOrder.findMany({
    where: { requirementSheetId: sheet.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      lines: { select: { id: true, fgItemId: true, qty: true, plannedQty: true } },
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

  const lines = (sheet.lines ?? []).map((ln) => {
    const itemId = Number(ln.itemId);
    const rsDemandQty = round3(dec(ln.requirementQty));
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

  const existingWoSummary = workOrdersRaw.map((wo) => {
    const pmr = wo.productionMaterialRequests?.[0] ?? null;
    const woQty = round3((wo.lines ?? []).reduce((s, line) => s + woLinePlacedQty(line), 0));
    const rmRequiredQty = round3((pmr?.lines ?? []).reduce((s, line) => s + dec(line.requiredQty), 0));
    const rmIssuedQty = round3((pmr?.lines ?? []).reduce((s, line) => s + dec(line.issuedQty), 0));
    return {
      workOrderId: wo.id,
      docNo: wo.docNo ?? null,
      woQty,
      woStatus: wo.status,
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

  const mrDocNo = materialRequirement?.docNo ?? null;
  const mrStatus = materialRequirement?.status ?? null;
  const [procurementProgress, rmReadiness] = await Promise.all([
    loadProcurementProgress(db, { released, materialRequirement }),
    buildRmReadiness(db, lines, deps),
  ]);
  const placement = await buildNoQtyWoBatchPlacementPreview(db, sheet);
  const readiness = buildReadinessDecision({
    totals,
    rmReadiness,
    existingWoSummary,
    released,
    materialRequirement,
  });

  return {
    requirementSheetId: sheet.id,
    salesOrderId: sheet.salesOrderId,
    cycleId: sheet.cycleId ?? null,
    periodKey: periodKey || null,
    status: sheet.status,
    release: {
      monthlyPlanId: releasedPlan?.id ?? null,
      released,
      releasedAt: releasedPlan?.releasedAt?.toISOString?.() ?? releasedPlan?.releasedAt ?? null,
      releasedRevision: releasedPlan?.releasedRevision ?? null,
      label: releasedPlan ? buildPlanDisplayLabel(releasedPlan) : null,
    },
    totals,
    lines,
    workOrders,
    readiness,
    procurementProgress,
    rmReadiness,
    existingWoSummary,
    placement,
    procurement: {
      status: released ? (mrStatus ?? "RELEASED") : "NOT_RELEASED",
      materialRequirementId: materialRequirement?.id ?? null,
      materialRequirementDocNo: mrDocNo,
      summaryLabel: procurementSummaryLabel({
        released,
        materialRequirementDocNo: mrDocNo,
        mrStatus,
      }),
    },
    rmPreview: {
      available: true,
      message: "RM readiness is calculated from RS Balance only and shown for execution decision support.",
    },
    placement,
  };
}

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
    return {
      processStageKey: null,
      processStageLabel: null,
      readyToPlaceWo: false,
      requirementSheetId: null,
      readinessStatus: null,
    };
  }

  const sheet = await db.requirementSheet.findFirst({
    where: { salesOrderId, cycleId, status: "LOCKED" },
    orderBy: [{ version: "desc" }, { id: "desc" }],
    include: {
      lines: { include: { item: { select: { id: true, itemName: true, itemType: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!sheet) {
    return {
      processStageKey: null,
      processStageLabel: null,
      readyToPlaceWo: false,
      requirementSheetId: null,
      readinessStatus: null,
    };
  }

  const existingWo = await db.workOrder.findFirst({
    where: { salesOrderId, cycleId, status: { not: "REJECTED" } },
    select: { id: true },
  });
  if (existingWo?.id) {
    return {
      processStageKey: null,
      processStageLabel: null,
      readyToPlaceWo: false,
      requirementSheetId: Number(sheet.id),
      readinessStatus: null,
    };
  }

  const periodKey = String(sheet.periodKey ?? "").trim();
  const releasedPlan = periodKey
    ? await db.monthlyProductionPlan.findFirst({
        where: { periodKey, releasedAt: { not: null } },
        orderBy: [{ releasedAt: "desc" }, { id: "desc" }],
      })
    : null;
  const released = Boolean(releasedPlan?.releasedAt);

  let materialRequirement = null;
  if (releasedPlan?.id) {
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

  const woPlacedByItem = new Map();
  const lines = (sheet.lines ?? []).map((ln) => {
    const itemId = Number(ln.itemId);
    const rsDemandQty = round3(dec(ln.requirementQty));
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

  const rmReadiness = await buildRmReadiness(db, lines, deps);
  const readiness = buildReadinessDecision({
    totals,
    rmReadiness,
    existingWoSummary: [],
    released,
    materialRequirement,
  });

  const readyToPlaceWo = readiness.status === "READY_TO_PLACE_WO";
  let processStageKey = NO_QTY_PLACEMENT_STAGE.MONTHLY_PLANNING_PENDING;
  if (readyToPlaceWo) {
    processStageKey = NO_QTY_PLACEMENT_STAGE.READY_TO_PLACE_WO;
  } else if (released && materialRequirement) {
    processStageKey = NO_QTY_PLACEMENT_STAGE.PROCUREMENT_IN_PROGRESS;
  }

  return {
    processStageKey,
    processStageLabel: NO_QTY_PLACEMENT_STAGE_LABELS[processStageKey] ?? null,
    readyToPlaceWo,
    requirementSheetId: Number(sheet.id),
    readinessStatus: readiness.status,
    periodKey: periodKey || null,
    released,
    materialRequirementId: materialRequirement?.id ?? null,
  };
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

module.exports = {
  getRequirementSheetExecutionSummary,
  assessNoQtyPlacementStageForCycle,
  batchAssessNoQtyPlacementStages,
  NO_QTY_PLACEMENT_STAGE,
  NO_QTY_PLACEMENT_STAGE_LABELS,
  buildReadinessDecision,
  woLinePlacedQty,
  procurementSummaryLabel,
};
