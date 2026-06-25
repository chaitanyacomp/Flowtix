/**
 * Phase P4B / P11 — RM Planning snapshot for plan-document approval (and shared lock path).
 *
 * APPROVED plan documents use a fixed snapshot revision per planId (revision 1).
 * Legacy LOCKED plans continue to use currentRevision increments from lockMonthlyPlan.
 *
 * RM gross demand = BOM(plannedFgQty) frozen at snapshot time — planned qty already
 * includes RS + carry forward + green shortage; do not explode green shortage again.
 */

const { aggregateRmDemandForFgLines, loadApprovedBomWithLines } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const { getRequirementComposition } = require("./monthlyPlanningRequirementCompositionService");

/** Snapshot revision for APPROVED plan documents (one immutable snapshot per planId). */
const APPROVED_PLAN_SNAPSHOT_REVISION = 1;

function planningCore() {
  return require("./monthlyPlanningService");
}

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function canReadRmPlanningStatus(status) {
  return status === "APPROVED" || status === "LOCKED";
}

function isLegacyLockedPlan(plan) {
  return String(plan?.status ?? "") === "LOCKED" && Number(plan?.currentRevision ?? 0) >= 1;
}

function isApprovedPlanDocument(plan) {
  return String(plan?.status ?? "") === "APPROVED";
}

function canReleasePlanStatus(status) {
  return status === "APPROVED" || status === "LOCKED";
}

/**
 * @param {{ status: string; currentRevision?: number }} plan
 * @param {{ revision?: number | null } | null} [existingRmPlan]
 */
function resolveRmSnapshotRevision(plan, existingRmPlan = null) {
  if (isLegacyLockedPlan(plan)) {
    return Number(plan.currentRevision);
  }
  if (isApprovedPlanDocument(plan)) {
    if (existingRmPlan?.revision != null) return Number(existingRmPlan.revision);
    return APPROVED_PLAN_SNAPSHOT_REVISION;
  }
  return null;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | object} db
 * @param {{ id: number; status: string; currentRevision?: number }} plan
 */
async function findExistingRmPlanSnapshot(db, plan) {
  const revision = resolveRmSnapshotRevision(plan);
  if (revision == null || revision <= 0) return null;
  return db.rmPlan.findUnique({
    where: { planId_revision: { planId: plan.id, revision } },
    include: { lines: true },
  });
}

/**
 * Build MR / trace label for a monthly plan release.
 * APPROVED plan documents use display label; legacy LOCKED keeps revision wording.
 */
function buildMonthlyPlanReleaseLabel(plan, revision) {
  const { buildPlanDisplayLabel } = require("./monthlyPlanningPlanLifecycleService");
  const display = buildPlanDisplayLabel(plan);
  if (isApprovedPlanDocument(plan) || (plan?.planSequenceNo != null && Number(plan.currentRevision) === 0)) {
    return display;
  }
  return `${display} (rev ${revision})`;
}

/**
 * @param {object} db
 * @param {string} periodKey
 * @param {typeof getRequirementComposition} [loadFgComposition]
 */
async function loadFgGreenShortageInputs(db, periodKey, loadFgComposition = getRequirementComposition) {
  const composition = await loadFgComposition({ db, periodKey });
  return (composition.items || [])
    .filter((item) => n(item.greenShortage) > 0)
    .map((item) => ({
      fgItemId: item.itemId,
      fgItemName: item.itemName ?? null,
      greenShortage: round3(n(item.greenShortage)),
    }));
}

/**
 * Create (or return existing) RM snapshot from approved plan FG lines → BOM.
 *
 * @param {{
 *   db: object;
 *   planId: number;
 *   revision: number;
 *   actorUserId?: number | null;
 *   asOf?: Date;
 *   writeRevisionLines?: boolean;
 *   deps?: object;
 * }} opts
 */
async function createRmPlanSnapshot({
  db,
  planId,
  revision,
  actorUserId = null,
  asOf = new Date(),
  writeRevisionLines = false,
  deps = {},
} = {}) {
  const { MonthlyPlanningError } = planningCore();
  const explodeFn = deps.aggregateRmDemandForFgLines || aggregateRmDemandForFgLines;
  const loadBomFn = deps.loadApprovedBomWithLines || loadApprovedBomWithLines;
  const availabilityFn = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;

  const id = Number(planId);
  const rev = Number(revision);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(rev) || rev <= 0) {
    throw new MonthlyPlanningError("INVALID_PLAN_ID", "Invalid plan id or snapshot revision.", 422);
  }

  const existing = await db.rmPlan.findUnique({
    where: { planId_revision: { planId: id, revision: rev } },
    include: { lines: true },
  });
  if (existing) {
    return { planId: id, revision: rev, rmPlanId: existing.id, created: false, lineCount: existing.lines?.length ?? 0 };
  }

  const plan = await db.monthlyProductionPlan.findUnique({
    where: { id },
    select: { id: true, periodKey: true, status: true, planSequenceNo: true, planKind: true },
  });
  if (!plan) {
    throw new MonthlyPlanningError("PLAN_NOT_FOUND", "Monthly Production Plan not found.", 404);
  }

  const planLines = await db.monthlyProductionPlanLine.findMany({
    where: { planId: id },
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

  for (const line of activeLines) {
    const bom = await loadBomFn(db, line.fgItemId);
    if (!bom || !bom.lines || bom.lines.length === 0) {
      throw new MonthlyPlanningError(
        "MISSING_BOM",
        `BOM missing for planned FG item: ${line.fgItem?.itemName ?? line.fgItemId}`,
        422,
      );
    }
  }

  const fgLines = activeLines.map((line) => ({
    fgItemId: line.fgItemId,
    fgQty: round3(Number(line.plannedFgQty)),
  }));
  const { rmNeeded, missingChildBoms } = await explodeFn(db, fgLines);
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

  const availability =
    rmItemIds.length > 0
      ? await availabilityFn({ itemIds: rmItemIds, requiredQtyByItemId, db })
      : [];
  const availabilityById = new Map(availability.map((a) => [a.itemId, a]));

  const rmItems =
    rmItemIds.length > 0
      ? await db.item.findMany({
          where: { id: { in: rmItemIds } },
          select: { id: true, itemName: true, unit: true },
        })
      : [];
  const itemMetaById = new Map(rmItems.map((i) => [i.id, i]));

  const totalFgPlannedQty = round3(activeLines.reduce((acc, l) => acc + Number(l.plannedFgQty), 0));
  const now = asOf instanceof Date ? asOf : new Date();

  const rmPlan = await db.rmPlan.create({
    data: {
      planId: id,
      revision: rev,
      totalFgPlannedQty,
      recalculatedAt: now,
      recalculatedByUserId: actorUserId ?? null,
    },
  });

  const lineData = rmItemIds.map((rmItemId) => {
    const gross = round3(rmNeeded.get(rmItemId) || 0);
    const avail = availabilityById.get(rmItemId) || {};
    const meta = itemMetaById.get(rmItemId) || {};
    const availableRmStock = round3(n(avail.physicalUsableStockQty ?? avail.freeStockQty ?? 0));
    const freeStock = round3(avail.freeStockQty ?? 0);
    const reserved = round3(avail.effectiveReservedQty ?? 0);
    const incoming = round3(avail.incomingQty ?? 0);
    const net = round3(Math.max(0, gross - availableRmStock));
    const warnings = Array.isArray(avail.warnings) ? avail.warnings : [];
    return {
      rmPlanId: rmPlan.id,
      rmItemId,
      grossDemandQty: gross,
      freeStockSnapshot: freeStock,
      reservedSnapshot: reserved,
      incomingPoSnapshot: incoming,
      minStockTopUpQty: 0,
      netRequirementQty: net,
      unitSnapshot: meta.unit ?? null,
      leadTimeRiskFlag: false,
      belowMinStockFlag: false,
      warningsJson: warnings.length ? warnings : null,
    };
  });

  if (lineData.length) {
    await db.rmPlanLine.createMany({ data: lineData });
  }

  if (writeRevisionLines) {
    await db.monthlyProductionPlanRevisionLine.createMany({
      data: activeLines.map((l) => ({
        planId: id,
        revision: rev,
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
  }

  return {
    planId: id,
    revision: rev,
    rmPlanId: rmPlan.id,
    created: true,
    lineCount: lineData.length,
    totalFgPlannedQty,
  };
}

/**
 * Idempotent RM snapshot for an APPROVED plan document (called from purchaseApprovePlan).
 */
async function ensureApprovedPlanRmSnapshot({
  db,
  planId,
  actorUserId = null,
  asOf = new Date(),
  deps = {},
} = {}) {
  return createRmPlanSnapshot({
    db,
    planId,
    revision: APPROVED_PLAN_SNAPSHOT_REVISION,
    actorUserId,
    asOf,
    writeRevisionLines: false,
    deps,
  });
}

module.exports = {
  APPROVED_PLAN_SNAPSHOT_REVISION,
  canReadRmPlanningStatus,
  canReleasePlanStatus,
  isLegacyLockedPlan,
  isApprovedPlanDocument,
  resolveRmSnapshotRevision,
  findExistingRmPlanSnapshot,
  buildMonthlyPlanReleaseLabel,
  loadFgGreenShortageInputs,
  createRmPlanSnapshot,
  ensureApprovedPlanRmSnapshot,
};
