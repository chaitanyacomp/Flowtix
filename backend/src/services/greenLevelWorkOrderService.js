const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { aggregateRmDemandForFgLines, loadApprovedBomWithLines } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");

const GREEN_LEVEL_WO_SOURCE_TYPE = "GREEN_LEVEL_REPLENISHMENT";
const CUSTOMER_WO_SOURCE_TYPE = "CUSTOMER_REQUIREMENT";
const GL_WO_COUNT_STATUSES = Object.freeze(["PENDING", "IN_PROGRESS", "HOLD", "PAUSED", "COMPLETED", "CLOSED_WITH_SHORTFALL"]);
const EPS = 1e-6;

function n(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function isCountedGlWoStatus(status) {
  return GL_WO_COUNT_STATUSES.includes(String(status ?? ""));
}

function sumPlacedQtyByItem(workOrders) {
  const out = new Map();
  for (const wo of workOrders ?? []) {
    if (!isCountedGlWoStatus(wo.status)) continue;
    for (const line of wo.lines ?? []) {
      const itemId = Number(line.fgItemId);
      if (!(itemId > 0)) continue;
      const qty = round3(n(line.plannedQty ?? line.qty));
      out.set(itemId, round3((out.get(itemId) ?? 0) + qty));
    }
  }
  return out;
}

async function lockMonthlyPlanForGlWoPlacement(tx, planId) {
  const id = Number(planId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error("Invalid monthly plan id.");
    err.statusCode = 400;
    throw err;
  }
  if (typeof tx.$queryRaw !== "function") return;
  const rows = await tx.$queryRaw`SELECT id FROM MonthlyProductionPlan WHERE id = ${id} FOR UPDATE`;
  if (Array.isArray(rows) && rows.length === 0) {
    const err = new Error("Monthly plan not found.");
    err.statusCode = 404;
    throw err;
  }
}

async function findLatestReleasedGreenLevelPlan(db = prisma) {
  return db.monthlyProductionPlan.findFirst({
    where: {
      releasedAt: { not: null },
      lines: { some: { greenReplenishmentQty: { gt: 0 } } },
    },
    orderBy: [{ releasedAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
}

async function loadGreenLevelPlacementPlan(db, planId = null) {
  const explicitPlanId = planId != null && Number(planId) > 0 ? Number(planId) : null;
  if (explicitPlanId) {
    return db.monthlyProductionPlan.findUnique({
      where: { id: explicitPlanId },
      include: {
        lines: {
          where: { greenReplenishmentQty: { gt: 0 } },
          include: { fgItem: { select: { id: true, itemName: true, unit: true } } },
          orderBy: { id: "asc" },
        },
      },
    });
  }

  const latest = await findLatestReleasedGreenLevelPlan(db);
  if (!latest?.id) return null;
  return loadGreenLevelPlacementPlan(db, latest.id);
}

function normalizeRequestedLines(requestedLines, remainingLines) {
  const hasExplicitRequest = Array.isArray(requestedLines);
  if (!hasExplicitRequest) {
    return (remainingLines ?? [])
      .map((line) => ({ fgItemId: Number(line.fgItemId), qty: round3(n(line.remainingQty)) }))
      .filter((line) => line.qty > EPS);
  }

  const remainingByItem = new Map((remainingLines ?? []).map((line) => [Number(line.fgItemId), line]));
  const merged = new Map();
  const order = [];
  for (const raw of requestedLines ?? []) {
    const fgItemId = Number(raw?.fgItemId ?? raw?.itemId);
    const qty = round3(n(raw?.qty ?? raw?.plannedQty ?? raw?.greenReplenishmentQty));
    if (!Number.isFinite(fgItemId) || fgItemId <= 0) continue;
    if (!remainingByItem.has(fgItemId)) {
      const err = new Error("Green Level item is not available for WO placement.");
      err.statusCode = 409;
      throw err;
    }
    if (!order.includes(fgItemId)) order.push(fgItemId);
    merged.set(fgItemId, round3((merged.get(fgItemId) ?? 0) + qty));
  }
  return order.map((fgItemId) => ({ fgItemId, qty: round3(merged.get(fgItemId) ?? 0) }));
}

async function buildGreenLevelRmReadiness(db, fgLines, deps = {}) {
  const aggregate = deps.aggregateRmDemandForFgLines || aggregateRmDemandForFgLines;
  const loadTopLevelBom = deps.loadApprovedBomWithLines || loadApprovedBomWithLines;
  const availability = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;
  const positiveFgLines = (fgLines ?? [])
    .filter((line) => n(line.qty ?? line.remainingQty) > EPS)
    .map((line) => ({
      fgItemId: Number(line.fgItemId),
      fgItemName: line.itemName ?? line.fgItemName ?? `Item ${line.fgItemId}`,
      fgQty: round3(n(line.qty ?? line.remainingQty)),
      bomMissing: false,
    }));

  const missingBoms = [];
  for (const fg of positiveFgLines) {
    const bom = await loadTopLevelBom(db, fg.fgItemId);
    if (!bom?.lines?.length) {
      missingBoms.push({
        type: "TOP_LEVEL_MISSING_BOM",
        status: "MISSING_BOM",
        fgItemId: fg.fgItemId,
        fgItemName: fg.fgItemName,
        fgQty: fg.fgQty,
      });
    }
  }
  if (!positiveFgLines.length || missingBoms.length > 0) {
    return {
      lines: [],
      missingBoms,
      summary: { requiredQty: 0, availableQty: 0, shortageQty: 0, missingBomCount: missingBoms.length },
      canPlace: positiveFgLines.length > 0 && missingBoms.length === 0,
    };
  }

  const demand = await aggregate(db, positiveFgLines);
  const rmNeeded = demand?.rmNeeded instanceof Map ? demand.rmNeeded : new Map();
  const childBoms = (demand?.missingChildBoms ?? []).map((m) => ({
    type: "CHILD_MISSING_BOM",
    status: "MISSING_BOM",
    sfgItemId: m.sfgItemId,
    sfgName: m.sfgName,
  }));
  if (childBoms.length > 0) {
    return {
      lines: [],
      missingBoms: childBoms,
      summary: { requiredQty: 0, availableQty: 0, shortageQty: 0, missingBomCount: childBoms.length },
      canPlace: false,
    };
  }

  const itemIds = [...rmNeeded.keys()].filter((id) => Number(id) > 0);
  const availabilityRows = itemIds.length
    ? await availability({ db, itemIds, requiredQtyByItemId: rmNeeded, includeIncoming: true, includeIssued: false })
    : [];
  const lines = (availabilityRows ?? []).map((row) => {
    const requiredQty = round3(n(rmNeeded.get(Number(row.itemId))));
    const availableQty = round3(n(row.freeStockQty ?? row.physicalUsableStockQty));
    return {
      rmItemId: Number(row.itemId),
      rmItemName: row.itemName ?? `Item ${row.itemId}`,
      requiredQty,
      availableQty,
      shortageQty: round3(Math.max(0, requiredQty - availableQty)),
    };
  });
  const summary = {
    requiredQty: round3(lines.reduce((sum, line) => sum + line.requiredQty, 0)),
    availableQty: round3(lines.reduce((sum, line) => sum + line.availableQty, 0)),
    shortageQty: round3(lines.reduce((sum, line) => sum + line.shortageQty, 0)),
    missingBomCount: 0,
  };
  return { lines, missingBoms: [], summary, canPlace: summary.shortageQty <= EPS };
}

async function buildGreenLevelWoPlacement(db = prisma, input = {}, deps = {}) {
  const plan = await loadGreenLevelPlacementPlan(db, input.planId ?? null);
  if (!plan || !plan.releasedAt || !(plan.lines ?? []).length) {
    return {
      available: false,
      plan: null,
      lines: [],
      workOrders: [],
      rmReadiness: { lines: [], missingBoms: [], summary: { requiredQty: 0, availableQty: 0, shortageQty: 0, missingBomCount: 0 }, canPlace: false },
      summary: { selectedQty: 0, placedQty: 0, remainingQty: 0, canCreateWorkOrder: false },
    };
  }

  const existingWorkOrders = await db.workOrder.findMany({
    where: {
      sourceType: GREEN_LEVEL_WO_SOURCE_TYPE,
      monthlyProductionPlanId: plan.id,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      lines: { include: { fgItem: { select: { id: true, itemName: true, unit: true } } } },
      productionMaterialRequests: { orderBy: { id: "desc" }, take: 1, select: { id: true, docNo: true, status: true } },
    },
  });
  const placedByItem = sumPlacedQtyByItem(existingWorkOrders);
  const lines = (plan.lines ?? []).map((line) => {
    const fgItemId = Number(line.fgItemId);
    const selectedQty = round3(n(line.greenReplenishmentQty));
    const placedQty = round3(placedByItem.get(fgItemId) ?? 0);
    const remainingQty = round3(Math.max(0, selectedQty - placedQty));
    return {
      fgItemId,
      itemName: line.fgItem?.itemName ?? `Item ${fgItemId}`,
      unit: line.fgItem?.unit ?? "",
      selectedQty,
      placedQty,
      remainingQty,
    };
  });
  const remainingLines = lines.filter((line) => line.remainingQty > EPS);
  const rmReadiness = await buildGreenLevelRmReadiness(db, remainingLines, deps);
  const workOrders = existingWorkOrders.map((wo) => ({
    id: wo.id,
    docNo: wo.docNo ?? null,
    sourceType: wo.sourceType ?? GREEN_LEVEL_WO_SOURCE_TYPE,
    status: wo.status,
    createdAt: wo.createdAt?.toISOString?.() ?? wo.createdAt ?? null,
    totalQty: round3((wo.lines ?? []).reduce((sum, line) => sum + n(line.plannedQty ?? line.qty), 0)),
    lines: (wo.lines ?? []).map((line) => ({
      fgItemId: Number(line.fgItemId),
      itemName: line.fgItem?.itemName ?? `Item ${line.fgItemId}`,
      qty: round3(n(line.plannedQty ?? line.qty)),
    })),
    pmrId: wo.productionMaterialRequests?.[0]?.id ?? null,
    pmrDocNo: wo.productionMaterialRequests?.[0]?.docNo ?? null,
    pmrStatus: wo.productionMaterialRequests?.[0]?.status ?? null,
  }));
  const summary = {
    selectedQty: round3(lines.reduce((sum, line) => sum + line.selectedQty, 0)),
    placedQty: round3(lines.reduce((sum, line) => sum + line.placedQty, 0)),
    remainingQty: round3(lines.reduce((sum, line) => sum + line.remainingQty, 0)),
    canCreateWorkOrder: remainingLines.length > 0 && rmReadiness.canPlace === true,
  };

  return {
    available: summary.selectedQty > EPS,
    plan: {
      id: plan.id,
      periodKey: plan.periodKey,
      docNo: plan.docNo ?? null,
      releasedAt: plan.releasedAt?.toISOString?.() ?? plan.releasedAt ?? null,
    },
    lines,
    workOrders,
    rmReadiness,
    summary,
  };
}

async function createGreenLevelWorkOrdersFromPlan(tx, input = {}, deps = {}) {
  const planId = Number(input.planId);
  if (!Number.isFinite(planId) || planId <= 0) {
    const err = new Error("monthly plan id is required.");
    err.statusCode = 400;
    throw err;
  }

  await lockMonthlyPlanForGlWoPlacement(tx, planId);
  const placement = await buildGreenLevelWoPlacement(tx, { planId }, deps);
  if (!placement.available || !placement.plan) {
    return { created: false, workOrderId: null, workOrders: [], skippedReason: "NO_SELECTED_GREEN_LEVEL_ITEMS" };
  }
  const remainingLines = placement.lines.filter((line) => line.remainingQty > EPS);
  const requested = normalizeRequestedLines(input.lines, remainingLines).filter((line) => line.qty > EPS);
  if (!requested.length) {
    return { created: false, workOrderId: null, workOrders: [], skippedReason: "ZERO_EXECUTABLE_QTY" };
  }
  const remainingByItem = new Map(remainingLines.map((line) => [Number(line.fgItemId), line]));
  for (const line of requested) {
    const rem = remainingByItem.get(Number(line.fgItemId));
    if (!rem || line.qty > rem.remainingQty + EPS) {
      const err = new Error("Green Level WO balance changed while you were editing. Refresh and try again.");
      err.statusCode = 409;
      throw err;
    }
  }

  const requestedWithNames = requested.map((line) => {
    const rem = remainingByItem.get(Number(line.fgItemId));
    return { ...line, itemName: rem?.itemName ?? `Item ${line.fgItemId}` };
  });
  const rmReadiness = await buildGreenLevelRmReadiness(tx, requestedWithNames, deps);
  if (rmReadiness.summary.missingBomCount > 0) {
    const err = new Error("Approved BOM is missing for one or more Green Level FG lines.");
    err.statusCode = 409;
    throw err;
  }
  if (rmReadiness.summary.shortageQty > EPS) {
    const err = new Error("Required RM is not available for Green Level WO placement.");
    err.statusCode = 409;
    throw err;
  }

  const createdWorkOrders = [];
  for (const line of requested) {
    const qty = round3(line.qty);
    const created = await tx.workOrder.create({
      data: {
        sourceType: GREEN_LEVEL_WO_SOURCE_TYPE,
        monthlyProductionPlanId: planId,
        salesOrderId: null,
        requirementSheetId: null,
        cycleId: null,
        status: "PENDING",
        docNo: await allocateDocNo(tx, { docType: DocType.WORK_ORDER, date: new Date() }),
        lines: {
          create: [
            {
              fgItemId: Number(line.fgItemId),
              qty: String(qty),
              plannedQty: String(qty),
            },
          ],
        },
      },
      select: { id: true, docNo: true },
    });
    createdWorkOrders.push({
      workOrderId: created.id,
      workOrderDocNo: created.docNo ?? null,
      sourceType: GREEN_LEVEL_WO_SOURCE_TYPE,
      monthlyProductionPlanId: planId,
      fgItemId: Number(line.fgItemId),
      qty,
    });
  }

  return {
    created: createdWorkOrders.length > 0,
    workOrderId: createdWorkOrders[0]?.workOrderId ?? null,
    workOrderDocNo: createdWorkOrders[0]?.workOrderDocNo ?? null,
    workOrders: createdWorkOrders,
    skippedReason: null,
  };
}

module.exports = {
  GREEN_LEVEL_WO_SOURCE_TYPE,
  CUSTOMER_WO_SOURCE_TYPE,
  GL_WO_COUNT_STATUSES,
  isCountedGlWoStatus,
  sumPlacedQtyByItem,
  buildGreenLevelWoPlacement,
  createGreenLevelWorkOrdersFromPlan,
  buildGreenLevelRmReadiness,
};
