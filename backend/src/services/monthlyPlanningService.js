/**
 * Monthly Planning Workspace — Phase 1 (data foundation) service.
 *
 * SCOPE (Phase 1 ONLY):
 *  - Load a Monthly Production Plan header by period (+ revision list).
 *  - Create/init a plan header for a period (DRAFT, currentRevision 0) with an
 *    empty/default lines structure.
 *
 * NOT in Phase 1 (intentionally absent): lock, RM Planning snapshot generation,
 * release-to-procurement, MR emission, variance. Those arrive in later phases.
 *
 * All functions accept an injectable `db` (Prisma client or transaction) for
 * testability; they default to the shared prisma client.
 */

const { prisma } = require("../utils/prisma");
const { DocType } = require("../prismaClientPackage");
const { allocateDocNo } = require("./docNoService");
const { aggregateRmDemandForFgLines, loadApprovedBomWithLines } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const { RM_REQUISITION_ACTIVE_STATUSES } = require("./rmRequisitionLifecycle");
const {
  buildPlanningContextMaps,
  enrichProductionLineMetrics,
  computeLockSummary,
  round3: metricsRound3,
} = require("./monthlyPlanningProductionPlanMetrics");

function resolveRequirementCompositionLoader(loadComposition) {
  if (loadComposition) return loadComposition;
  return require("./monthlyPlanningRequirementCompositionService").getRequirementComposition;
}

function resolveGreenLevelsLoader(loadGreenLevelsFn) {
  if (loadGreenLevelsFn) return loadGreenLevelsFn;
  return require("./monthlyPlanningGreenLevelService").getGreenLevels;
}

const MONTHLY_PLAN_SOURCE = "MONTHLY_PLAN";
const RELEASE_EPS = 1e-6;

const PERIOD_KEY_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

class MonthlyPlanningError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "MonthlyPlanningError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Validate a period key of the form YYYY-MM. Returns the normalized key or throws. */
function normalizePeriodKey(period) {
  const key = String(period ?? "").trim();
  if (!PERIOD_KEY_REGEX.test(key)) {
    throw new MonthlyPlanningError(
      "INVALID_PERIOD",
      "period must be in YYYY-MM format (e.g. 2026-06).",
      422,
    );
  }
  return key;
}

/** Current calendar month as YYYY-MM (local timezone, matches workspace UI). */
function getCurrentPeriodKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** True when periodKey is strictly before the current calendar month. */
function isPastPeriod(periodKey, now = new Date()) {
  const key = normalizePeriodKey(periodKey);
  return key < getCurrentPeriodKey(now);
}

/**
 * Enforce backdated-plan rules for write actions (create / edit / reopen).
 * Current and future months: allowed. Past months: STORE blocked; ADMIN needs confirmPastPeriod.
 */
function assertPeriodWriteAllowed({
  periodKey,
  actorRole = null,
  confirmPastPeriod = false,
  now = new Date(),
} = {}) {
  const key = normalizePeriodKey(periodKey);
  if (!isPastPeriod(key, now)) return key;

  const role = String(actorRole ?? "").trim().toUpperCase();
  if (role === "ADMIN") {
    if (confirmPastPeriod === true) return key;
    throw new MonthlyPlanningError(
      "PAST_PERIOD_CONFIRM_REQUIRED",
      `Period ${key} is in the past. Admin must confirm backdated planning (confirmPastPeriod: true).`,
      422,
    );
  }

  throw new MonthlyPlanningError(
    "PAST_PERIOD_NOT_ALLOWED",
    `Cannot create or edit a Monthly Production Plan for past period ${key}. Only the current month and future months are allowed.`,
    403,
  );
}

function toPlanSummary(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    docNo: plan.docNo ?? null,
    periodKey: plan.periodKey,
    status: plan.status,
    currentRevision: plan.currentRevision,
    remarks: plan.remarks ?? null,
    lockedAt: plan.lockedAt ?? null,
    reopenedAt: plan.reopenedAt ?? null,
    releasedAt: plan.releasedAt ?? null,
    releasedRevision: plan.releasedRevision ?? null,
    createdByUserId: plan.createdByUserId ?? null,
    createdAt: plan.createdAt ?? null,
    updatedAt: plan.updatedAt ?? null,
  };
}

function toPlanLine(line) {
  return {
    id: line.id,
    fgItemId: line.fgItemId,
    suggestedFgQty: line.suggestedFgQty,
    plannedFgQty: line.plannedFgQty,
    plannedQtyOverridden: Boolean(line.plannedQtyOverridden),
    source: line.source,
    remarks: line.remarks ?? null,
  };
}

function mapProductionLineResponse(line, { suggestedByFgItemId, greenByFgItemId }) {
  const storedSuggested = metricsRound3(line.suggestedFgQty);
  const liveSuggested = suggestedByFgItemId.has(line.fgItemId)
    ? suggestedByFgItemId.get(line.fgItemId)
    : storedSuggested;
  const greenCtx = greenByFgItemId.get(line.fgItemId) || { greenTarget: 0, freeFgStock: 0 };
  const metrics = enrichProductionLineMetrics({
    suggestedFgQty: liveSuggested,
    plannedFgQty: line.plannedFgQty,
    greenTarget: greenCtx.greenTarget,
    freeFgStock: greenCtx.freeFgStock,
  });

  return {
    id: line.id,
    fgItemId: line.fgItemId,
    fgItemName: line.fgItem?.itemName ?? null,
    unit: line.fgItem?.unit ?? null,
    suggestedFgQty: metrics.suggestedFgQty,
    plannedFgQty: metrics.plannedFgQty,
    plannedQtyOverridden: Boolean(line.plannedQtyOverridden),
    source: line.source,
    remarks: line.remarks ?? null,
    varianceQty: metrics.varianceQty,
    variancePct: metrics.variancePct,
    greenTarget: metrics.greenTarget,
    freeFgStock: metrics.freeFgStock,
    projectedStockAfterPlan: metrics.projectedStockAfterPlan,
    remainingGreenGap: metrics.remainingGreenGap,
  };
}

/**
 * Load a Monthly Production Plan by period, including its lines and revision list.
 * Returns { exists, plan, lines, revisions } — `exists:false` (not an error) when none yet.
 */
async function getMonthlyPlanByPeriod({ db = prisma, period } = {}) {
  const periodKey = normalizePeriodKey(period);
  // Header + revisions only. FG lines are loaded via GET /:id/production-lines so a line-table
  // schema mismatch cannot block plan discovery (exists / docNo / status).
  const plan = await db.monthlyProductionPlan.findUnique({
    where: { periodKey },
    include: {
      rmPlans: { select: { revision: true, recalculatedAt: true }, orderBy: { revision: "asc" } },
    },
  });

  if (!plan) {
    return { exists: false, plan: null, lines: [], revisions: [] };
  }

  return {
    exists: true,
    plan: toPlanSummary(plan),
    lines: [],
    revisions: (plan.rmPlans || []).map((r) => ({
      revision: r.revision,
      recalculatedAt: r.recalculatedAt,
    })),
  };
}

/**
 * Create/init a Monthly Production Plan header for a period.
 * Phase 1: header only (DRAFT, currentRevision 0) with an empty lines structure.
 * Throws DUPLICATE_PERIOD (409) if a plan already exists for the period.
 */
async function createMonthlyPlan({
  db = prisma,
  period,
  actorUserId = null,
  actorRole = null,
  confirmPastPeriod = false,
  remarks = null,
  now = new Date(),
} = {}) {
  const periodKey = assertPeriodWriteAllowed({ periodKey: period, actorRole, confirmPastPeriod, now });

  const run = async (tx) => {
    const existing = await tx.monthlyProductionPlan.findUnique({
      where: { periodKey },
      select: { id: true },
    });
    if (existing) {
      throw new MonthlyPlanningError(
        "DUPLICATE_PERIOD",
        `A Monthly Production Plan already exists for ${periodKey}.`,
        409,
      );
    }

    const docNo = await allocateDocNo(tx, { docType: DocType.MONTHLY_PRODUCTION_PLAN });
    const created = await tx.monthlyProductionPlan.create({
      data: {
        docNo,
        periodKey,
        status: "DRAFT",
        currentRevision: 0,
        remarks: remarks ?? null,
        createdByUserId: actorUserId ?? null,
      },
      include: { lines: true },
    });
    return created;
  };

  // Reuse an existing transaction when `db` is already a tx; otherwise open one.
  const created = typeof db.$transaction === "function" ? await db.$transaction(run) : await run(db);

  return {
    exists: true,
    plan: toPlanSummary(created),
    lines: (created.lines || []).map(toPlanLine),
    revisions: [],
  };
}

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

async function loadPlanForEdit(db, planId) {
  const id = Number(planId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id.", 422);
  }
  const plan = await db.monthlyProductionPlan.findUnique({
    where: { id },
    select: { id: true, status: true, periodKey: true },
  });
  if (!plan) {
    throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
  }
  return plan;
}

/** Load the FG demand lines for a plan (read-only) with Phase 8A variance / green-gap visibility. */
async function getProductionLines({
  db = prisma,
  planId,
  loadComposition = null,
  loadGreenLevelsFn = null,
} = {}) {
  const plan = await loadPlanForEdit(db, planId);
  const lines = await db.monthlyProductionPlanLine.findMany({
    where: { planId: plan.id },
    orderBy: { id: "asc" },
    include: { fgItem: { select: { id: true, itemName: true, itemType: true, unit: true } } },
  });

  const compositionLoader = resolveRequirementCompositionLoader(loadComposition);
  const greenLoader = resolveGreenLevelsLoader(loadGreenLevelsFn);
  const [composition, greenLevels] = await Promise.all([
    compositionLoader({ db, periodKey: plan.periodKey }),
    greenLoader({ db, periodKey: plan.periodKey }),
  ]);
  const { suggestedByFgItemId, greenByFgItemId } = buildPlanningContextMaps(composition, greenLevels);
  const mappedLines = lines.map((l) => mapProductionLineResponse(l, { suggestedByFgItemId, greenByFgItemId }));

  return {
    planId: plan.id,
    periodKey: plan.periodKey,
    status: plan.status,
    editable: plan.status === "DRAFT",
    lines: mappedLines,
    lockSummary: computeLockSummary(mappedLines),
  };
}

/**
 * Upsert / delete FG production-plan lines. DRAFT-only.
 * @param {{ upserts?: Array, deletes?: number[] }} payload
 *   upsert item: { fgItemId, plannedFgQty, plannedQtyOverridden?, source?, remarks? }
 *   suggestedFgQty is set server-side from Phase 5 composition (single source of truth).
 */
async function updateProductionLines({
  db = prisma,
  planId,
  upserts = [],
  deletes = [],
  actorUserId = null,
  actorRole = null,
  confirmPastPeriod = false,
  now = new Date(),
  loadComposition = null,
  loadGreenLevelsFn = null,
} = {}) {
  const compositionLoader = resolveRequirementCompositionLoader(loadComposition);
  const greenLoader = resolveGreenLevelsLoader(loadGreenLevelsFn);
  const run = async (tx) => {
    const plan = await loadPlanForEdit(tx, planId);
    assertPeriodWriteAllowed({
      periodKey: plan.periodKey,
      actorRole,
      confirmPastPeriod,
      now,
    });
    if (plan.status !== "DRAFT") {
      throw new MonthlyPlanningError(
        "PLAN_NOT_EDITABLE",
        "Only DRAFT plans can be edited. This plan is locked.",
        409,
      );
    }

    const composition = await compositionLoader({ db: tx, periodKey: plan.periodKey });
    const { suggestedByFgItemId } = buildPlanningContextMaps(composition, { items: [] });

    const safeUpserts = Array.isArray(upserts) ? upserts : [];
    const safeDeletes = Array.isArray(deletes) ? deletes.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0) : [];

    // Validate upserts: qty >= 0, no duplicate fgItemId within payload, fgItemId must be FG.
    const seen = new Set();
    const normalized = [];
    for (const raw of safeUpserts) {
      const fgItemId = Number(raw?.fgItemId);
      if (!Number.isFinite(fgItemId) || fgItemId <= 0) {
        throw new MonthlyPlanningError("INVALID_FG_ITEM", "Each line requires a valid fgItemId.", 422);
      }
      if (seen.has(fgItemId)) {
        throw new MonthlyPlanningError("DUPLICATE_FG_ITEM", `Duplicate FG item in request: ${fgItemId}.`, 422);
      }
      seen.add(fgItemId);

      const plannedFgQty = round3(raw?.plannedFgQty ?? 0);
      if (!(plannedFgQty >= 0)) {
        throw new MonthlyPlanningError("INVALID_QTY", "plannedFgQty must be >= 0.", 422);
      }
      const suggestedFgQty = suggestedByFgItemId.has(fgItemId)
        ? suggestedByFgItemId.get(fgItemId)
        : round3(raw?.suggestedFgQty ?? 0);
      const source = raw?.source ?? "MANUAL";
      if (!["SALES_ORDER", "REQUIREMENT_SHEET", "MANUAL"].includes(source)) {
        // CUSTOMER_SCHEDULE intentionally not accepted in this phase.
        throw new MonthlyPlanningError("INVALID_SOURCE", `Unsupported source: ${source}.`, 422);
      }
      normalized.push({
        fgItemId,
        plannedFgQty,
        suggestedFgQty,
        plannedQtyOverridden: raw?.plannedQtyOverridden === true,
        source,
        remarks: raw?.remarks != null ? String(raw.remarks).slice(0, 2000) : null,
      });
    }

    if (normalized.length > 0) {
      const fgIds = normalized.map((n) => n.fgItemId);
      const items = await tx.item.findMany({
        where: { id: { in: fgIds } },
        select: { id: true, itemType: true },
      });
      const itemTypeById = new Map(items.map((i) => [i.id, i.itemType]));
      for (const n of normalized) {
        const itemType = itemTypeById.get(n.fgItemId);
        if (!itemType) {
          throw new MonthlyPlanningError("FG_ITEM_NOT_FOUND", `Item ${n.fgItemId} not found.`, 422);
        }
        if (itemType !== "FG") {
          throw new MonthlyPlanningError("NOT_FG_ITEM", `Item ${n.fgItemId} is not an FG item.`, 422);
        }
      }
    }

    for (const id of safeDeletes) {
      await tx.monthlyProductionPlanLine.deleteMany({ where: { id, planId: plan.id } });
    }

    for (const n of normalized) {
      await tx.monthlyProductionPlanLine.upsert({
        where: { planId_fgItemId: { planId: plan.id, fgItemId: n.fgItemId } },
        create: {
          planId: plan.id,
          fgItemId: n.fgItemId,
          plannedFgQty: n.plannedFgQty,
          suggestedFgQty: n.suggestedFgQty,
          plannedQtyOverridden: n.plannedQtyOverridden,
          source: n.source,
          remarks: n.remarks,
        },
        update: {
          plannedFgQty: n.plannedFgQty,
          suggestedFgQty: n.suggestedFgQty,
          plannedQtyOverridden: n.plannedQtyOverridden,
          source: n.source,
          remarks: n.remarks,
        },
      });
    }

    return plan;
  };

  const plan = typeof db.$transaction === "function" ? await db.$transaction(run) : await run(db);
  return getProductionLines({ db, planId: plan.id, loadComposition: compositionLoader, loadGreenLevelsFn: greenLoader });
}

/**
 * Lock a DRAFT Monthly Production Plan: freeze FG plan, explode BOM → RM demand,
 * snapshot stock via materialAvailabilityService, write an immutable RmPlan + RmPlanLine
 * set for the new revision. One transaction; full rollback on any failure.
 *
 * Does NOT create MaterialRequirements / touch procurement (later phase).
 */
async function lockMonthlyPlan({
  db = prisma,
  planId,
  actorUserId = null,
  actorRole = null,
  confirmPastPeriod = false,
  asOf = new Date(),
  deps = {},
} = {}) {
  const explodeFn = deps.aggregateRmDemandForFgLines || aggregateRmDemandForFgLines;
  const loadBomFn = deps.loadApprovedBomWithLines || loadApprovedBomWithLines;
  const availabilityFn = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;
  const run = async (tx) => {
    const id = Number(planId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id.", 422);
    }
    const plan = await tx.monthlyProductionPlan.findUnique({
      where: { id },
      select: { id: true, status: true, currentRevision: true, periodKey: true },
    });
    if (!plan) {
      throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
    }
    assertPeriodWriteAllowed({
      periodKey: plan.periodKey,
      actorRole,
      confirmPastPeriod,
      now: asOf,
    });
    if (plan.status !== "DRAFT") {
      throw new MonthlyPlanningError("PLAN_NOT_LOCKABLE", "Only DRAFT plans can be locked.", 409);
    }

    const planLines = await tx.monthlyProductionPlanLine.findMany({
      where: { planId: plan.id },
      include: { fgItem: { select: { id: true, itemName: true, unit: true } } },
      orderBy: { id: "asc" },
    });
    const activeLines = planLines.filter((l) => Number(l.plannedFgQty) > 0);
    if (activeLines.length === 0) {
      throw new MonthlyPlanningError(
        "EMPTY_PLAN",
        "Plan must have at least one Production Plan line with planned qty > 0.",
        422,
      );
    }

    // Every FG must have an approved BOM with lines, else block the lock.
    for (const line of activeLines) {
      const bom = await loadBomFn(tx, line.fgItemId);
      if (!bom || !bom.lines || bom.lines.length === 0) {
        throw new MonthlyPlanningError(
          "MISSING_BOM",
          `BOM missing for FG item: ${line.fgItem?.itemName ?? line.fgItemId}`,
          422,
        );
      }
    }

    const fgLines = activeLines.map((l) => ({ fgItemId: l.fgItemId, fgQty: round3(l.plannedFgQty) }));
    const { rmNeeded, missingChildBoms } = await explodeFn(tx, fgLines);
    if (missingChildBoms.length > 0) {
      const names = missingChildBoms.map((m) => m.sfgName ?? m.sfgItemId).join(", ");
      throw new MonthlyPlanningError(
        "MISSING_CHILD_BOM",
        `BOM missing for component (SFG): ${names}`,
        422,
      );
    }

    const rmItemIds = [...rmNeeded.keys()];
    const requiredQtyByItemId = {};
    for (const [itemId, qty] of rmNeeded.entries()) requiredQtyByItemId[itemId] = qty;

    const [availability, rmItems] = await Promise.all([
      rmItemIds.length
        ? availabilityFn({ itemIds: rmItemIds, requiredQtyByItemId, db: tx })
        : Promise.resolve([]),
      rmItemIds.length
        ? tx.item.findMany({
            where: { id: { in: rmItemIds } },
            select: { id: true, itemName: true, unit: true, minimumStockQty: true },
          })
        : Promise.resolve([]),
    ]);
    const availabilityById = new Map(availability.map((a) => [a.itemId, a]));
    const itemMetaById = new Map(rmItems.map((i) => [i.id, i]));

    const totalFgPlannedQty = round3(activeLines.reduce((acc, l) => acc + Number(l.plannedFgQty), 0));
    const newRevision = plan.currentRevision + 1;
    const now = new Date();

    await tx.monthlyProductionPlan.update({
      where: { id: plan.id },
      data: {
        status: "LOCKED",
        currentRevision: newRevision,
        lockedAt: now,
        lockedByUserId: actorUserId ?? null,
      },
    });

    const rmPlan = await tx.rmPlan.create({
      data: {
        planId: plan.id,
        revision: newRevision,
        totalFgPlannedQty,
        recalculatedAt: now,
        recalculatedByUserId: actorUserId ?? null,
      },
    });

    const lineData = rmItemIds.map((rmItemId) => {
      const gross = round3(rmNeeded.get(rmItemId) || 0);
      const avail = availabilityById.get(rmItemId) || {};
      const meta = itemMetaById.get(rmItemId) || {};
      const freeStock = round3(avail.freeStockQty ?? 0);
      const reserved = round3(avail.effectiveReservedQty ?? 0);
      const incoming = round3(avail.incomingQty ?? 0);
      const net = round3(avail.netShortageAfterIncomingQty ?? Math.max(0, gross - freeStock - incoming));
      const minStock = meta.minimumStockQty != null ? Number(meta.minimumStockQty) : null;
      const belowMinStockFlag = minStock != null && freeStock < minStock;
      const warnings = Array.isArray(avail.warnings) ? avail.warnings : [];
      return {
        rmPlanId: rmPlan.id,
        rmItemId,
        grossDemandQty: gross,
        freeStockSnapshot: freeStock,
        reservedSnapshot: reserved,
        incomingPoSnapshot: incoming,
        minStockTopUpQty: 0, // advisory only in this phase
        netRequirementQty: net,
        unitSnapshot: meta.unit ?? null,
        leadTimeRiskFlag: false, // lead-time data not available yet
        belowMinStockFlag,
        warningsJson: warnings.length ? warnings : null,
      };
    });

    if (lineData.length) {
      await tx.rmPlanLine.createMany({ data: lineData });
    }

    await tx.monthlyProductionPlanRevisionLine.createMany({
      data: activeLines.map((l) => ({
        planId: plan.id,
        revision: newRevision,
        fgItemId: l.fgItemId,
        suggestedFgQty: round3(l.suggestedFgQty),
        plannedFgQty: round3(l.plannedFgQty),
        plannedQtyOverridden: Boolean(l.plannedQtyOverridden),
        source: l.source,
        remarks: l.remarks ?? null,
        unitSnapshot: l.fgItem?.unit ?? null,
        itemNameSnapshot: l.fgItem?.itemName ?? null,
      })),
    });

    return { planId: plan.id, revision: newRevision };
  };

  const result = typeof db.$transaction === "function" ? await db.$transaction(run) : await run(db);
  return getRmPlanning({ db, planId: result.planId, revision: result.revision });
}

/**
 * Reopen a LOCKED plan for editing the next revision draft.
 * Does not change currentRevision, delete snapshots, or touch procurement/stock.
 */
async function reopenMonthlyPlan({
  db = prisma,
  planId,
  actorUserId = null,
  actorRole = null,
  confirmPastPeriod = false,
  asOf = new Date(),
} = {}) {
  const run = async (tx) => {
    const id = Number(planId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id.", 422);
    }
    const plan = await tx.monthlyProductionPlan.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        currentRevision: true,
        periodKey: true,
        docNo: true,
        remarks: true,
        lockedAt: true,
        reopenedAt: true,
        releasedAt: true,
        releasedRevision: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!plan) {
      throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
    }
    assertPeriodWriteAllowed({
      periodKey: plan.periodKey,
      actorRole,
      confirmPastPeriod,
      now: asOf,
    });
    if (plan.status !== "LOCKED") {
      throw new MonthlyPlanningError(
        "PLAN_NOT_REOPENABLE",
        "Only LOCKED plans can be reopened.",
        409,
      );
    }
    if (plan.currentRevision < 1) {
      throw new MonthlyPlanningError(
        "PLAN_NOT_REOPENABLE",
        "Plan has no locked revision to reopen from.",
        409,
      );
    }

    const reopenedAt = new Date();
    const updated = await tx.monthlyProductionPlan.update({
      where: { id: plan.id },
      data: {
        status: "DRAFT",
        reopenedAt,
        reopenedByUserId: actorUserId ?? null,
      },
    });

    return {
      planId: plan.id,
      status: updated.status,
      currentRevision: plan.currentRevision,
      draftForRevision: plan.currentRevision + 1,
      plan: toPlanSummary(updated),
    };
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

/**
 * Discard a reopened draft and restore the last locked revision's FG lines.
 * Does not change currentRevision, RM snapshots, revision history, or procurement.
 */
async function cancelReopenMonthlyPlan({
  db = prisma,
  planId,
  actorUserId = null,
  actorRole = null,
  confirmPastPeriod = false,
  now = new Date(),
} = {}) {
  const run = async (tx) => {
    const id = Number(planId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id.", 422);
    }
    const plan = await tx.monthlyProductionPlan.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        currentRevision: true,
        periodKey: true,
        reopenedAt: true,
      },
    });
    if (!plan) {
      throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
    }
    assertPeriodWriteAllowed({
      periodKey: plan.periodKey,
      actorRole,
      confirmPastPeriod,
      now,
    });
    if (plan.status !== "DRAFT") {
      throw new MonthlyPlanningError(
        "PLAN_NOT_CANCELLABLE",
        "Only a reopened DRAFT plan can cancel reopen.",
        409,
      );
    }
    if (plan.currentRevision < 1) {
      throw new MonthlyPlanningError(
        "PLAN_NOT_CANCELLABLE",
        "Plan has no locked revision to restore.",
        409,
      );
    }
    if (!plan.reopenedAt) {
      throw new MonthlyPlanningError(
        "PLAN_NOT_CANCELLABLE",
        "Plan was not reopened — cancel reopen is not available.",
        409,
      );
    }

    const snapshotLines = await tx.monthlyProductionPlanRevisionLine.findMany({
      where: { planId: plan.id, revision: plan.currentRevision },
      orderBy: { id: "asc" },
    });
    if (!snapshotLines.length) {
      throw new MonthlyPlanningError(
        "REVISION_SNAPSHOT_MISSING",
        `FG revision snapshot missing for revision ${plan.currentRevision}. Cannot restore.`,
        422,
      );
    }

    await tx.monthlyProductionPlanLine.deleteMany({ where: { planId: plan.id } });
    await tx.monthlyProductionPlanLine.createMany({
      data: snapshotLines.map((l) => ({
        planId: plan.id,
        fgItemId: l.fgItemId,
        suggestedFgQty: round3(l.suggestedFgQty),
        plannedFgQty: round3(l.plannedFgQty),
        plannedQtyOverridden: Boolean(l.plannedQtyOverridden),
        source: l.source,
        remarks: l.remarks ?? null,
      })),
    });

    const updated = await tx.monthlyProductionPlan.update({
      where: { id: plan.id },
      data: {
        status: "LOCKED",
        reopenedAt: null,
        reopenedByUserId: null,
      },
    });

    return {
      planId: plan.id,
      status: updated.status,
      currentRevision: plan.currentRevision,
      restoredRevision: plan.currentRevision,
      restoredLineCount: snapshotLines.length,
      plan: toPlanSummary(updated),
    };
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

function toRevisionFgLine(line) {
  return {
    fgItemId: line.fgItemId,
    itemName: line.itemNameSnapshot ?? line.fgItem?.itemName ?? null,
    unit: line.unitSnapshot ?? line.fgItem?.unit ?? null,
    suggestedFgQty: round3(line.suggestedFgQty),
    plannedFgQty: round3(line.plannedFgQty),
    plannedQtyOverridden: Boolean(line.plannedQtyOverridden),
    source: line.source,
    remarks: line.remarks ?? null,
  };
}

/**
 * Read-only revision history: FG snapshots per revision + RM snapshot metadata.
 */
async function getPlanRevisions({ db = prisma, planId } = {}) {
  const id = Number(planId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id.", 422);
  }

  const plan = await db.monthlyProductionPlan.findUnique({
    where: { id },
    select: {
      id: true,
      periodKey: true,
      status: true,
      currentRevision: true,
      releasedRevision: true,
      lockedAt: true,
      lockedByUserId: true,
      lockedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!plan) {
    throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
  }

  const [rmPlans, revisionLines] = await Promise.all([
    db.rmPlan.findMany({
      where: { planId: plan.id },
      orderBy: { revision: "desc" },
      include: {
        recalculatedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    db.monthlyProductionPlanRevisionLine.findMany({
      where: { planId: plan.id },
      orderBy: [{ revision: "desc" }, { id: "asc" }],
      include: { fgItem: { select: { id: true, itemName: true, unit: true } } },
    }),
  ]);

  const fgLinesByRevision = new Map();
  for (const line of revisionLines) {
    if (!fgLinesByRevision.has(line.revision)) fgLinesByRevision.set(line.revision, []);
    fgLinesByRevision.get(line.revision).push(toRevisionFgLine(line));
  }

  const revisions = rmPlans.map((rmPlan) => {
    const isCurrent = plan.status === "LOCKED" && rmPlan.revision === plan.currentRevision;
    const statusLabel = isCurrent ? "CURRENT" : "LOCKED";
    return {
      revision: rmPlan.revision,
      lockedAt: rmPlan.recalculatedAt,
      lockedByUserId: rmPlan.recalculatedByUserId ?? null,
      lockedByName: rmPlan.recalculatedBy?.name ?? rmPlan.recalculatedBy?.email ?? null,
      totalFgPlannedQty: round3(rmPlan.totalFgPlannedQty),
      released: plan.releasedRevision != null && plan.releasedRevision === rmPlan.revision,
      status: statusLabel,
      isCurrent,
      hasRmSnapshot: true,
      fgLines: fgLinesByRevision.get(rmPlan.revision) ?? [],
    };
  });

  return {
    planId: plan.id,
    periodKey: plan.periodKey,
    status: plan.status,
    currentRevision: plan.currentRevision,
    releasedRevision: plan.releasedRevision ?? null,
    draftForRevision: plan.status === "DRAFT" && plan.currentRevision >= 1 ? plan.currentRevision + 1 : null,
    lastLockedRevision: plan.currentRevision >= 1 ? plan.currentRevision : null,
    revisions,
  };
}

/**
 * Read the immutable RM Planning snapshot for a plan revision (defaults to currentRevision).
 * Returns a clear empty state when the plan is not locked yet.
 */
async function getRmPlanning({ db = prisma, planId, revision = null } = {}) {
  const id = Number(planId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id.", 422);
  }
  const plan = await db.monthlyProductionPlan.findUnique({
    where: { id },
    select: { id: true, status: true, currentRevision: true, periodKey: true, lockedAt: true },
  });
  if (!plan) {
    throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
  }

  if (plan.status !== "LOCKED" || plan.currentRevision < 1) {
    return {
      locked: false,
      exists: false,
      planId: plan.id,
      status: plan.status,
      currentRevision: plan.currentRevision,
      revision: null,
      rmPlan: null,
      lines: [],
      availableRevisions: [],
    };
  }

  const wanted = revision != null && Number(revision) > 0 ? Number(revision) : plan.currentRevision;
  const allRevisions = await db.rmPlan.findMany({
    where: { planId: plan.id },
    select: { revision: true, recalculatedAt: true },
    orderBy: { revision: "asc" },
  });

  const rmPlan = await db.rmPlan.findUnique({
    where: { planId_revision: { planId: plan.id, revision: wanted } },
    include: {
      lines: {
        orderBy: { id: "asc" },
        include: { rmItem: { select: { id: true, itemName: true, unit: true } } },
      },
    },
  });

  if (!rmPlan) {
    return {
      locked: true,
      exists: false,
      planId: plan.id,
      status: plan.status,
      currentRevision: plan.currentRevision,
      revision: wanted,
      rmPlan: null,
      lines: [],
      availableRevisions: allRevisions.map((r) => r.revision),
    };
  }

  return {
    locked: true,
    exists: true,
    planId: plan.id,
    status: plan.status,
    currentRevision: plan.currentRevision,
    revision: rmPlan.revision,
    rmPlan: {
      id: rmPlan.id,
      revision: rmPlan.revision,
      totalFgPlannedQty: rmPlan.totalFgPlannedQty,
      recalculatedAt: rmPlan.recalculatedAt,
    },
    availableRevisions: allRevisions.map((r) => r.revision),
    lines: (rmPlan.lines || []).map((l) => ({
      id: l.id,
      rmItemId: l.rmItemId,
      rmItemName: l.rmItem?.itemName ?? null,
      unit: l.unitSnapshot ?? l.rmItem?.unit ?? null,
      grossDemandQty: l.grossDemandQty,
      freeStockSnapshot: l.freeStockSnapshot,
      reservedSnapshot: l.reservedSnapshot,
      incomingPoSnapshot: l.incomingPoSnapshot,
      minStockTopUpQty: l.minStockTopUpQty,
      netRequirementQty: l.netRequirementQty,
      belowMinStockFlag: l.belowMinStockFlag,
      leadTimeRiskFlag: l.leadTimeRiskFlag,
      warnings: Array.isArray(l.warningsJson) ? l.warningsJson : [],
    })),
  };
}

function derivePurchaseStatus(net, alreadyRequisitioned) {
  if (alreadyRequisitioned <= 0) return "NOT_RELEASED";
  if (alreadyRequisitioned > net) return "OVER_RELEASED";
  if (alreadyRequisitioned >= net) return "FULLY_RELEASED";
  return "PARTIALLY_RELEASED";
}

/**
 * Phase 8C — Map one RM line for Purchase Planning with delta clarity aliases.
 * Does not alter the underlying delta engine (net − already released).
 */
function mapPurchasePlanningLine(line, agg) {
  const currentRequirementQty = round3(Number(line.netRequirementQty));
  const previouslyReleasedQty = round3(agg.requisitioned);
  const alreadyProcuredQty = round3(agg.procured);
  const deltaQty = round3(currentRequirementQty - previouslyReleasedQty);
  const additionalRequirementQty = round3(Math.max(0, deltaQty));
  const reductionQty = round3(Math.max(0, -deltaQty));
  const varianceQty = deltaQty;
  const suggestedPurchaseQty = additionalRequirementQty;

  return {
    rmItemId: line.rmItemId,
    rmItemName: line.rmItemName,
    unit: line.unit,
    grossDemandQty: round3(Number(line.grossDemandQty)),
    freeStockSnapshot: round3(Number(line.freeStockSnapshot)),
    reservedSnapshot: round3(Number(line.reservedSnapshot)),
    incomingPoSnapshot: round3(Number(line.incomingPoSnapshot)),
    netRequirementQty: currentRequirementQty,
    alreadyRequisitionedQty: previouslyReleasedQty,
    alreadyProcuredQty,
    varianceQty,
    suggestedPurchaseQty,
    currentRequirementQty,
    previouslyReleasedQty,
    additionalRequirementQty,
    reductionQty,
    deltaQty,
    procurementStatus: derivePurchaseStatus(currentRequirementQty, previouslyReleasedQty),
    vendorSuggestion: null,
    belowMinStockFlag: line.belowMinStockFlag,
    leadTimeRiskFlag: line.leadTimeRiskFlag,
    warnings: line.warnings,
  };
}

function summarizePurchasePlanningLines(lines) {
  const totals = {
    rmItemCount: lines.length,
    currentRequirementTotal: 0,
    previouslyReleasedTotal: 0,
    additionalRequirementTotal: 0,
    reductionTotal: 0,
  };
  for (const line of lines) {
    totals.currentRequirementTotal = round3(totals.currentRequirementTotal + line.currentRequirementQty);
    totals.previouslyReleasedTotal = round3(totals.previouslyReleasedTotal + line.previouslyReleasedQty);
    totals.additionalRequirementTotal = round3(
      totals.additionalRequirementTotal + line.additionalRequirementQty,
    );
    totals.reductionTotal = round3(totals.reductionTotal + line.reductionQty);
  }
  totals.coveragePct =
    totals.currentRequirementTotal > 0
      ? round3((totals.previouslyReleasedTotal / totals.currentRequirementTotal) * 100)
      : null;
  return totals;
}

/**
 * Sum of requiredQty / procuredQty per RM item across non-reversed MONTHLY_PLAN
 * MaterialRequirements linked to this plan. Single source of truth for both the
 * Purchase Planning review and the Release delta calculation.
 */
async function sumRequisitionedByItem(db, planId) {
  const rows = await db.materialRequirementLine.groupBy({
    by: ["rmItemId"],
    where: {
      materialRequirement: {
        monthlyProductionPlanId: planId,
        sourceType: MONTHLY_PLAN_SOURCE,
        reversedAt: null,
      },
    },
    _sum: { requiredQty: true, procuredQty: true },
  });
  return new Map(
    rows.map((r) => [
      r.rmItemId,
      {
        requisitioned: round3(Number(r._sum?.requiredQty ?? 0)),
        procured: round3(Number(r._sum?.procuredQty ?? 0)),
      },
    ]),
  );
}

/**
 * Phase 4A / 8C: read-only Purchase Planning review for the current locked revision only.
 * Computes per-RM delta against any existing MONTHLY_PLAN MaterialRequirements
 * linked to this plan. No writes, no release, no MaterialRequirement creation.
 */
async function getPurchasePlanning({ db = prisma, planId, revision = null } = {}) {
  if (revision != null && Number(revision) > 0) {
    throw new MonthlyPlanningError(
      "PURCHASE_REVISION_NOT_SUPPORTED",
      "Purchase Planning always uses the current locked revision. Omit the revision query param.",
      422,
    );
  }

  const rm = await getRmPlanning({ db, planId, revision: null });
  if (!rm.locked || !rm.exists) {
    return {
      locked: rm.locked,
      exists: false,
      planId: rm.planId,
      status: rm.status,
      currentRevision: rm.currentRevision,
      revision: rm.revision,
      usesCurrentRevisionOnly: true,
      availableRevisions: rm.availableRevisions,
      rmPlan: rm.rmPlan,
      lines: [],
      totals: summarizePurchasePlanningLines([]),
    };
  }

  const requisitionedByItem = await sumRequisitionedByItem(db, rm.planId);

  const lines = rm.lines.map((l) => {
    const agg = requisitionedByItem.get(l.rmItemId) || { requisitioned: 0, procured: 0 };
    return mapPurchasePlanningLine(l, agg);
  });

  return {
    locked: true,
    exists: true,
    planId: rm.planId,
    status: rm.status,
    currentRevision: rm.currentRevision,
    revision: rm.revision,
    usesCurrentRevisionOnly: true,
    availableRevisions: rm.availableRevisions,
    rmPlan: rm.rmPlan,
    lines,
    totals: summarizePurchasePlanningLines(lines),
  };
}

/**
 * Phase 4B: Release the locked plan's RM demand into the existing MaterialRequirement
 * chain (MR → PR → PO → GRN unchanged). Full-plan release only, delta-based, idempotent.
 *
 * - Emits only (netRequirementQty - alreadyRequisitionedQty) per RM item.
 * - Reuses one open MONTHLY_PLAN MR per plan (no MR sprawl); creates one if none.
 * - Negative delta reduces only the open (un-procured) portion; never cancels PO-backed
 *   demand. Remaining excess is reported as surplus.
 */
async function releaseToProcurement({ db = prisma, planId, revision = null, confirm = false, actorUserId = null } = {}) {
  if (confirm !== true) {
    throw new MonthlyPlanningError("CONFIRM_REQUIRED", "Release requires explicit confirmation.", 422);
  }

  const run = async (tx) => {
    const id = Number(planId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id.", 422);
    }
    const plan = await tx.monthlyProductionPlan.findUnique({
      where: { id },
      select: { id: true, status: true, currentRevision: true, periodKey: true },
    });
    if (!plan) {
      throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
    }
    if (plan.status !== "LOCKED") {
      throw new MonthlyPlanningError("PLAN_NOT_LOCKED", "Only a LOCKED plan can be released.", 409);
    }
    if (revision != null && Number(revision) !== plan.currentRevision) {
      throw new MonthlyPlanningError(
        "REVISION_MISMATCH",
        `Release revision must equal the current revision (${plan.currentRevision}).`,
        409,
      );
    }
    const rev = plan.currentRevision;

    const rmPlan = await tx.rmPlan.findUnique({
      where: { planId_revision: { planId: plan.id, revision: rev } },
      include: { lines: true },
    });
    if (!rmPlan) {
      throw new MonthlyPlanningError("SNAPSHOT_NOT_FOUND", "RM Planning snapshot not found for revision.", 404);
    }
    const hasPositiveNet = rmPlan.lines.some((l) => Number(l.netRequirementQty) > RELEASE_EPS);
    if (!hasPositiveNet) {
      throw new MonthlyPlanningError("NO_DEMAND", "No positive net requirement to release.", 422);
    }

    const requisitionedByItem = await sumRequisitionedByItem(tx, plan.id);

    // Reuse one open MONTHLY_PLAN MR for this plan (avoid sprawl).
    let mr = await tx.materialRequirement.findFirst({
      where: {
        sourceType: MONTHLY_PLAN_SOURCE,
        monthlyProductionPlanId: plan.id,
        reversedAt: null,
        status: { in: RM_REQUISITION_ACTIVE_STATUSES },
      },
      include: { lines: true },
      orderBy: { id: "desc" },
    });
    const lineByItem = new Map((mr?.lines || []).map((l) => [l.rmItemId, l]));

    const released = [];
    const skipped = [];
    const surplus = [];
    let totalDeltaQty = 0;
    const now = new Date();

    async function ensureMrHeader() {
      if (mr) return mr;
      const docNo = await allocateDocNo(tx, { docType: DocType.MATERIAL_REQUIREMENT, date: now });
      mr = await tx.materialRequirement.create({
        data: {
          docNo,
          status: "APPROVED",
          approvedByUserId: actorUserId ?? null,
          approvedAt: now,
          approvalRemarks: `Released from Monthly Production Plan ${plan.periodKey} (rev ${rev}).`,
          sourceType: MONTHLY_PLAN_SOURCE,
          monthlyProductionPlanId: plan.id,
          sourceRevision: rev,
          createdByUserId: actorUserId ?? null,
          raisedByUserId: actorUserId ?? null,
          requisitionRemarks: `Monthly planning release for ${plan.periodKey} (rev ${rev}).`,
          remarks: `Monthly planning release for ${plan.periodKey} (rev ${rev}).`,
        },
        include: { lines: true },
      });
      return mr;
    }

    for (const line of rmPlan.lines) {
      const rmItemId = line.rmItemId;
      const net = round3(Number(line.netRequirementQty));
      const agg = requisitionedByItem.get(rmItemId) || { requisitioned: 0, procured: 0 };
      const already = round3(agg.requisitioned);
      const delta = round3(net - already);
      const freeSnapshot = round3(Number(line.freeStockSnapshot));

      if (delta > RELEASE_EPS) {
        await ensureMrHeader();
        const existing = lineByItem.get(rmItemId);
        if (existing) {
          const newRequired = round3(Number(existing.requiredQty) + delta);
          const updated = await tx.materialRequirementLine.update({
            where: { id: existing.id },
            data: {
              requiredQty: String(newRequired),
              shortageQty: String(newRequired),
              availableQtySnapshot: String(freeSnapshot),
            },
          });
          lineByItem.set(rmItemId, updated);
        } else {
          const created = await tx.materialRequirementLine.create({
            data: {
              materialRequirementId: mr.id,
              rmItemId,
              requiredQty: String(delta),
              shortageQty: String(delta),
              availableQtySnapshot: String(freeSnapshot),
              unitSnapshot: line.unitSnapshot ?? null,
            },
          });
          lineByItem.set(rmItemId, created);
        }
        totalDeltaQty = round3(totalDeltaQty + delta);
        released.push({ rmItemId, deltaQty: delta, netRequirementQty: net });
      } else if (delta < -RELEASE_EPS) {
        const excess = round3(-delta);
        const existing = lineByItem.get(rmItemId);
        const openQty = existing ? Math.max(0, round3(Number(existing.requiredQty) - Number(existing.procuredQty))) : 0;
        const reduce = round3(Math.min(excess, openQty));
        if (reduce > RELEASE_EPS && existing) {
          const newRequired = round3(Number(existing.requiredQty) - reduce);
          const updated = await tx.materialRequirementLine.update({
            where: { id: existing.id },
            data: { requiredQty: String(newRequired), shortageQty: String(newRequired) },
          });
          lineByItem.set(rmItemId, updated);
        }
        const surplusQty = round3(excess - reduce);
        surplus.push({ rmItemId, reducedQty: reduce, surplusQty, netRequirementQty: net });
      } else {
        skipped.push({ rmItemId, netRequirementQty: net });
      }
    }

    if (mr) {
      await tx.materialRequirement.update({
        where: { id: mr.id },
        data: { sourceRevision: rev },
      });
    }

    await tx.monthlyProductionPlan.update({
      where: { id: plan.id },
      data: { releasedAt: now, releasedByUserId: actorUserId ?? null, releasedRevision: rev },
    });

    return {
      planId: plan.id,
      revision: rev,
      materialRequirementId: mr?.id ?? null,
      materialRequirementDocNo: mr?.docNo ?? null,
      releasedLineCount: released.length,
      skippedLineCount: skipped.length,
      surplusLineCount: surplus.length,
      totalDeltaQty,
      released,
      skipped,
      surplus,
    };
  };

  return typeof db.$transaction === "function" ? db.$transaction(run) : run(db);
}

module.exports = {
  PERIOD_KEY_REGEX,
  MonthlyPlanningError,
  normalizePeriodKey,
  getCurrentPeriodKey,
  isPastPeriod,
  assertPeriodWriteAllowed,
  getMonthlyPlanByPeriod,
  createMonthlyPlan,
  getProductionLines,
  updateProductionLines,
  lockMonthlyPlan,
  reopenMonthlyPlan,
  cancelReopenMonthlyPlan,
  getPlanRevisions,
  getRmPlanning,
  getPurchasePlanning,
  mapPurchasePlanningLine,
  summarizePurchasePlanningLines,
  releaseToProcurement,
};
