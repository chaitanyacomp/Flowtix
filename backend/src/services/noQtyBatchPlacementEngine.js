/**
 * Authoritative NO_QTY Requirement Sheet batch placement engine.
 *
 * Single business rule for execution workspace preview, RM coverage, suggested WO,
 * and Work Order creation validation. Preview and create must never diverge.
 *
 * @see docs/product/01_Product_Foundation/Chapter_04_FT_ERP_Product_Design_Principles.md §5.9
 * @see docs/product/02_Business_Architecture/Chapter_03_NO_QTY_Agreement_Planning_Pipeline.md §10
 */

const { aggregateRmDemandForFgLines, loadApprovedBomWithLines } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");
const { resolveNoQtyWoExecutableQty } = require("./noQtyWoQtyService");
const { roundFgQty } = require("./itemQtyPrecision");

const EPS = 1e-6;

const NO_QTY_PLACEMENT_ERROR = Object.freeze({
  RS_CHANGED: "NO_QTY_RS_CHANGED",
  RM_SHORTAGE: "NO_QTY_RM_SHORTAGE",
  SHARED_RM_CONFLICT: "NO_QTY_SHARED_RM_ALLOCATION_CONFLICT",
  EXCEEDS_EXECUTABLE: "NO_QTY_EXCEEDS_EXECUTABLE_QTY",
  RM_AVAILABILITY_CHANGED: "NO_QTY_RM_AVAILABILITY_CHANGED",
  MISSING_BOM: "NO_QTY_MISSING_BOM",
});

function n(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round(n(v) * 1000) / 1000;
}

function hasRmValidationSupport(db) {
  return (
    typeof db?.bom?.findFirst === "function" &&
    typeof db?.stockTransaction?.groupBy === "function" &&
    typeof db?.item?.findMany === "function" &&
    typeof db?.productionMaterialRequestLine?.findMany === "function" &&
    typeof db?.rmPurchaseOrder?.findMany === "function"
  );
}

function createPlacementConflictError(code, message, details = {}) {
  const err = new Error(message);
  err.statusCode = 409;
  err.code = code;
  err.details = details;
  return err;
}

async function loadFgItemUnitById(db, itemId) {
  const id = Number(itemId);
  if (!(id > 0) || typeof db?.item?.findFirst !== "function") return null;
  const row = await db.item.findFirst({
    where: { id },
    select: {
      unit: true,
      unitRef: { select: { unitCode: true, unitName: true } },
    },
  });
  if (!row) return null;
  return row.unitRef?.unitCode ?? row.unitRef?.unitName ?? row.unit ?? null;
}

async function loadFgItemUnitMap(db, itemIds) {
  const ids = [...new Set((itemIds ?? []).map((id) => Number(id)).filter((id) => id > 0))];
  const out = new Map();
  if (!ids.length || typeof db?.item?.findMany !== "function") return out;
  const rows = await db.item.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      unit: true,
      unitRef: { select: { unitCode: true, unitName: true } },
    },
  });
  for (const row of rows) {
    out.set(Number(row.id), row.unitRef?.unitCode ?? row.unitRef?.unitName ?? row.unit ?? null);
  }
  return out;
}

function rmLineStatus({ requiredQty, availableQty, shortageQty, incomingQty }) {
  if (requiredQty <= EPS || shortageQty <= EPS) return "READY";
  if (availableQty > EPS || incomingQty > EPS) return "PARTIALLY_READY";
  return "AWAITING_PROCUREMENT";
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {Array<{ fgItemId: number, fgQty: number, bomMissing?: boolean }>} fgLines
 */
async function verifyBatchRmFeasibility(db, fgLines, deps = {}) {
  const aggregate = deps.aggregateRmDemandForFgLines || aggregateRmDemandForFgLines;
  const availability = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;
  const positive = (fgLines ?? []).filter((line) => n(line.fgQty) > EPS && !line.bomMissing);
  if (!positive.length) {
    return { feasible: true, rmNeeded: new Map(), shortages: [], missingChildBoms: [] };
  }

  const demand = await aggregate(db, positive);
  const missingChildBoms = demand?.missingChildBoms ?? [];
  if (missingChildBoms.length > 0) {
    return { feasible: false, rmNeeded: new Map(), shortages: [], missingChildBoms };
  }

  const rmNeeded = demand?.rmNeeded instanceof Map ? demand.rmNeeded : new Map();
  if (!rmNeeded.size) {
    return { feasible: true, rmNeeded, shortages: [], missingChildBoms: [] };
  }

  const availabilityRows = await availability({
    db,
    itemIds: [...rmNeeded.keys()],
    requiredQtyByItemId: rmNeeded,
    includeIncoming: true,
    includeIssued: false,
  });

  const shortages = (availabilityRows ?? [])
    .map((row) => {
      const rmItemId = Number(row.itemId);
      const requiredQty = round3(n(rmNeeded.get(rmItemId)));
      const availableQty = round3(n(row.freeStockQty ?? row.physicalUsableStockQty));
      const incomingQty = round3(n(row.incomingQty));
      const shortageQty = round3(Math.max(0, requiredQty - availableQty));
      return {
        rmItemId,
        rmItemName: row.itemName ?? `Item ${rmItemId}`,
        requiredQty,
        availableQty,
        incomingQty,
        shortageQty,
      };
    })
    .filter((row) => row.requiredQty > row.availableQty + EPS);

  return {
    feasible: shortages.length === 0,
    rmNeeded,
    shortages,
    missingChildBoms: [],
    availabilityRows: availabilityRows ?? [],
  };
}

/**
 * Allocate executable FG qty per line under shared RM pool constraints.
 */
async function allocateBatchExecutableQty(db, balanceLines, fgUnitByItemId, deps = {}) {
  const positive = (balanceLines ?? []).filter((line) => line.rsBalanceQty > EPS && !line.bomMissing);
  const executableByItem = new Map();
  for (const line of balanceLines ?? []) {
    executableByItem.set(line.itemId, line.bomMissing ? 0 : 0);
  }
  if (!positive.length) {
    return { executableByItem, sharedRmConflict: false, fullBalanceFeasible: true };
  }

  const fullFgLines = positive.map((line) => ({
    fgItemId: line.itemId,
    fgQty: line.rsBalanceQty,
    bomMissing: false,
  }));
  const fullCheck = await verifyBatchRmFeasibility(db, fullFgLines, deps);
  if (fullCheck.missingChildBoms?.length) {
    return {
      executableByItem,
      sharedRmConflict: false,
      fullBalanceFeasible: false,
      missingChildBoms: fullCheck.missingChildBoms,
    };
  }

  if (fullCheck.feasible) {
    for (const line of positive) executableByItem.set(line.itemId, line.rsBalanceQty);
    return { executableByItem, sharedRmConflict: false, fullBalanceFeasible: true };
  }

  const rmNeeded = fullCheck.rmNeeded;
  const freeByRm = new Map();
  for (const row of fullCheck.availabilityRows ?? []) {
    freeByRm.set(Number(row.itemId), round3(n(row.freeStockQty ?? row.physicalUsableStockQty)));
  }

  let globalScale = 1;
  for (const [rmId, required] of rmNeeded.entries()) {
    const requiredQty = round3(n(required));
    if (!(requiredQty > EPS)) continue;
    const availableQty = round3(n(freeByRm.get(Number(rmId)) ?? 0));
    globalScale = Math.min(globalScale, availableQty / requiredQty);
  }
  globalScale = Math.max(0, Math.min(1, globalScale));

  for (const line of positive) {
    const fgUnit = fgUnitByItemId.get(line.itemId) ?? null;
    executableByItem.set(
      line.itemId,
      roundFgQty(globalScale * line.rsBalanceQty, fgUnit, { mode: "floor" }),
    );
  }

  let guard = 0;
  while (guard++ < 20000) {
    const fgLines = [...executableByItem.entries()]
      .filter(([, qty]) => qty > EPS)
      .map(([fgItemId, fgQty]) => ({ fgItemId: Number(fgItemId), fgQty: n(fgQty), bomMissing: false }));
    if (!fgLines.length) break;

    const check = await verifyBatchRmFeasibility(db, fgLines, deps);
    if (check.feasible) break;

    let reduceItemId = null;
    let reduceQty = 0;
    for (const [itemId, qty] of executableByItem.entries()) {
      if (qty > reduceQty) {
        reduceQty = qty;
        reduceItemId = itemId;
      }
    }
    if (!reduceItemId || !(reduceQty > 0)) break;
    const fgUnit = fgUnitByItemId.get(reduceItemId) ?? null;
    const nextQty = roundFgQty(reduceQty - 1, fgUnit, { mode: "floor" });
    executableByItem.set(reduceItemId, nextQty);
  }

  const sharedRmConflict = positive.length > 1 && globalScale < 1 - EPS;
  return { executableByItem, sharedRmConflict, fullBalanceFeasible: false };
}

async function buildPerLineRmLines(db, itemId, executableQty, deps = {}) {
  const aggregate = deps.aggregateRmDemandForFgLines || aggregateRmDemandForFgLines;
  const availability = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;
  if (!(executableQty > EPS)) return [];

  const demand = await aggregate(db, [{ fgItemId: itemId, fgQty: executableQty, bomMissing: false }]);
  const rmNeeded = demand?.rmNeeded instanceof Map ? demand.rmNeeded : new Map();
  if (!rmNeeded.size) return [];

  const availabilityRows = await availability({
    db,
    itemIds: [...rmNeeded.keys()],
    requiredQtyByItemId: rmNeeded,
    includeIncoming: true,
    includeIssued: false,
  });

  return (availabilityRows ?? []).map((row) => {
    const rmItemId = Number(row.itemId);
    const requiredQty = round3(n(rmNeeded.get(rmItemId)));
    const availableQty = round3(n(row.freeStockQty ?? row.physicalUsableStockQty));
    const incomingQty = round3(n(row.incomingQty));
    const shortageQty = round3(Math.max(0, requiredQty - availableQty));
    return {
      rmItemId,
      rmItemName: row.itemName ?? `Item ${rmItemId}`,
      requiredQty,
      availableQty,
      shortageQty,
      incomingQty,
      status: rmLineStatus({ requiredQty, availableQty, shortageQty, incomingQty }),
    };
  });
}

function buildPlacementLineStatus(rsBalanceQty, executableQty, bomMissing, hasIncomingStock, hasAvailableStock) {
  if (bomMissing) {
    return { status: "MISSING_BOM", reason: "Approved BOM is missing for this FG line." };
  }
  if (!(rsBalanceQty > EPS)) {
    return { status: "ZERO_BALANCE", reason: "No RS balance remains for this FG line." };
  }
  if (executableQty <= EPS) {
    const status = hasIncomingStock && !hasAvailableStock ? "PARTIALLY_READY" : "AWAITING_PROCUREMENT";
    return {
      status,
      reason:
        status === "PARTIALLY_READY"
          ? "RM is still incoming, but no physical RM is available for placement yet."
          : "Required RM is not available yet.",
    };
  }
  if (executableQty + EPS < rsBalanceQty) {
    return { status: "PARTIALLY_READY", reason: "Batch RM allocation limits executable quantity for this FG line." };
  }
  return { status: "READY", reason: "All required RM is available for this FG line." };
}

function formatQtyLabel(qty, unit) {
  const q = round3(qty);
  const text = Number.isFinite(q) ? String(q) : "0";
  const u = String(unit ?? "").trim();
  return u ? `${text} ${u}` : text;
}

/**
 * Operator guidance for RM-limited suggested WO qty (display only).
 */
function buildOperatorGuidanceForLine({
  rsBalanceQty,
  suggestedExecutableQty,
  unit = null,
  limitingRmItemName = null,
}) {
  const balance = round3(rsBalanceQty);
  const suggested = round3(suggestedExecutableQty);
  const remaining = round3(Math.max(0, balance - suggested));
  const balLabel = formatQtyLabel(balance, unit);
  const sugLabel = formatQtyLabel(suggested, unit);
  const remLabel = formatQtyLabel(remaining, unit);

  if (!(balance > EPS)) {
    return {
      code: "ZERO_BALANCE",
      message: "No remaining requirement for Work Order creation.",
      limitingRmItemName: null,
    };
  }
  if (suggested <= EPS) {
    return {
      code: "NO_RM",
      message: "Work Order cannot be created currently because RM is insufficient.",
      limitingRmItemName: limitingRmItemName || null,
    };
  }
  if (suggested + EPS >= balance) {
    return {
      code: "FULL_COVER",
      message: `RM is available for the full remaining requirement of ${balLabel}.`,
      limitingRmItemName: null,
    };
  }
  const limitPart = limitingRmItemName
    ? ` Production capacity is limited by ${limitingRmItemName}.`
    : "";
  return {
    code: "PARTIAL_COVER",
    message: `You can currently produce up to ${sugLabel} with available RM. Remaining ${remLabel} requires additional RM.${limitPart}`,
    limitingRmItemName: limitingRmItemName || null,
  };
}

/**
 * Identify the BOM RM that most constrains FG production at remaining balance.
 */
async function identifyLimitingRmItem(db, itemId, rsBalanceQty, suggestedExecutableQty, deps = {}) {
  if (!(rsBalanceQty > EPS) || suggestedExecutableQty + EPS >= rsBalanceQty) return null;
  const aggregate = deps.aggregateRmDemandForFgLines || aggregateRmDemandForFgLines;
  const availability = deps.getMaterialAvailabilityByItems || getMaterialAvailabilityByItems;
  const demand = await aggregate(db, [{ fgItemId: itemId, fgQty: rsBalanceQty, bomMissing: false }]);
  const rmNeeded = demand?.rmNeeded instanceof Map ? demand.rmNeeded : new Map();
  if (!rmNeeded.size) return null;
  const availabilityRows = await availability({
    db,
    itemIds: [...rmNeeded.keys()],
    requiredQtyByItemId: rmNeeded,
    includeIncoming: true,
    includeIssued: false,
  });
  let worst = null;
  for (const row of availabilityRows ?? []) {
    const rmItemId = Number(row.itemId);
    const requiredQty = round3(n(rmNeeded.get(rmItemId)));
    if (!(requiredQty > EPS)) continue;
    const availableQty = round3(n(row.freeStockQty ?? row.physicalUsableStockQty));
    const capacityRatio = availableQty / requiredQty;
    if (!worst || capacityRatio < worst.capacityRatio) {
      worst = {
        rmItemId,
        rmItemName: row.itemName ?? `Item ${rmItemId}`,
        capacityRatio,
        shortageQty: round3(Math.max(0, requiredQty - availableQty)),
      };
    }
  }
  return worst
    ? { rmItemId: worst.rmItemId, rmItemName: worst.rmItemName, shortageQty: worst.shortageQty }
    : null;
}

function buildRmReadinessFromBatch(db, balanceLines, placementLines, batchRmAtProposed, deps = {}) {
  const missingBoms = (placementLines ?? [])
    .filter((line) => line.status === "MISSING_BOM")
    .map((line) => ({
      type: "TOP_LEVEL_MISSING_BOM",
      status: "MISSING_BOM",
      fgItemId: line.itemId,
      fgItemName: line.itemName,
      fgQty: line.suggestedExecutableQty ?? line.rsBalanceQty,
      message: line.reason || "Missing BOM for FG item. RM requirement cannot be calculated.",
    }));

  const rmLines = (batchRmAtProposed?.availabilityRows ?? []).map((row) => {
    const rmItemId = Number(row.itemId);
    const requiredQty = round3(n(batchRmAtProposed.rmNeeded?.get(rmItemId)));
    const availableQty = round3(n(row.freeStockQty ?? row.physicalUsableStockQty));
    const incomingQty = round3(n(row.incomingQty));
    const shortageQty = round3(Math.max(0, requiredQty - availableQty));
    const status = rmLineStatus({ requiredQty, availableQty, shortageQty, incomingQty });
    return {
      rmItemId,
      rmItemName: row.itemName ?? `Item ${rmItemId}`,
      requiredQty,
      availableQty,
      shortageQty,
      incomingQty,
      status,
    };
  });

  const proposedFgLines = (placementLines ?? [])
    .filter((line) => round3(n(line.suggestedExecutableQty ?? line.proposedQty)) > EPS)
    .map((line) => ({
      fgItemId: line.itemId,
      fgItemName: line.itemName,
      fgQty: round3(n(line.suggestedExecutableQty ?? line.proposedQty)),
      bomMissing: line.status === "MISSING_BOM",
    }));

  return {
    /** RM Detail for the proposed / suggested WO qty — not full RS balance. */
    basis: "PROPOSED_WO_QTY",
    fgBalanceLines: (balanceLines ?? [])
      .filter((line) => line.rsBalanceQty > EPS)
      .map((line) => ({
        fgItemId: line.itemId,
        fgItemName: line.itemName,
        fgQty: line.rsBalanceQty,
        bomMissing: Boolean(line.bomMissing),
      })),
    fgProposedLines: proposedFgLines,
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
      proposedFgQty: round3(proposedFgLines.reduce((sum, line) => sum + line.fgQty, 0)),
    },
  };
}

/**
 * Live RM readiness for operator-entered proposed WO quantities (canonical BOM + availability).
 * Does not change RS balance or placement caps — preview only.
 *
 * @param {Array<{ itemId: number, qty: number }>} proposedLines
 */
async function previewRmReadinessForProposedQty(db, sheet, proposedLines, deps = {}) {
  const loadBom = deps.loadApprovedBomWithLines || loadApprovedBomWithLines;
  const placedByItem = deps.placedByItem instanceof Map ? deps.placedByItem : new Map();
  const fgUnitByItemId = await loadFgItemUnitMap(
    db,
    (sheet?.lines ?? []).map((ln) => ln.itemId),
  );
  const balanceLines = buildPlacementBalanceLines(sheet, placedByItem, fgUnitByItemId);
  const balanceByItem = new Map(balanceLines.map((l) => [l.itemId, l]));

  const placementLines = [];
  const fgLinesForRm = [];
  for (const raw of proposedLines ?? []) {
    const itemId = Number(raw.itemId);
    const bal = balanceByItem.get(itemId);
    if (!bal) continue;
    const fgUnit = bal.fgUnit ?? fgUnitByItemId.get(itemId) ?? null;
    let qty = roundFgQty(raw.qty, fgUnit, { mode: "floor" });
    if (qty > bal.rsBalanceQty + EPS) qty = bal.rsBalanceQty;
    if (!(qty > EPS)) continue;
    const bom = await loadBom(db, itemId);
    const bomMissing = !bom?.lines?.length;
    placementLines.push({
      itemId,
      itemName: bal.itemName,
      rsBalanceQty: bal.rsBalanceQty,
      suggestedExecutableQty: qty,
      proposedQty: qty,
      status: bomMissing ? "MISSING_BOM" : "READY",
      reason: bomMissing ? "Approved BOM is missing for this FG line." : null,
    });
    if (!bomMissing) {
      fgLinesForRm.push({ fgItemId: itemId, fgQty: qty, bomMissing: false });
    }
  }

  const batchRm =
    fgLinesForRm.length > 0
      ? await verifyBatchRmFeasibility(db, fgLinesForRm, deps)
      : { feasible: true, rmNeeded: new Map(), shortages: [], missingChildBoms: [], availabilityRows: [] };

  const rmReadiness = buildRmReadinessFromBatch(db, balanceLines, placementLines, batchRm, deps);

  const perLine = [];
  for (const line of placementLines) {
    const rmLines = line.status === "MISSING_BOM" ? [] : await buildPerLineRmLines(db, line.itemId, line.proposedQty, deps);
    perLine.push({
      itemId: line.itemId,
      itemName: line.itemName,
      proposedQty: line.proposedQty,
      rsBalanceQty: line.rsBalanceQty,
      rmLines,
    });
  }

  return { rmReadiness, lines: perLine, basis: "PROPOSED_WO_QTY" };
}

function buildPlacementStatus(positiveLines) {
  if (!positiveLines.length) {
    return { status: "ZERO_BALANCE", reason: "No RS balance remains.", canPlace: false };
  }

  const anyMissingBom = positiveLines.some((line) => line.status === "MISSING_BOM");
  const anyAwaiting = positiveLines.some((line) => line.status === "AWAITING_PROCUREMENT");
  const executableLines = positiveLines.filter((line) => line.suggestedExecutableQty > EPS);
  const allReady = positiveLines.every(
    (line) => line.status === "READY" && line.suggestedExecutableQty + EPS >= line.rsBalanceQty,
  );

  if (allReady) {
    return {
      status: "READY",
      reason: "All remaining FG lines can be placed using current RM availability.",
      canPlace: true,
    };
  }
  if (executableLines.length > 0) {
    return {
      status: "PARTIALLY_READY",
      reason: "Some FG lines can be placed now; others still need RM or BOM completion.",
      canPlace: true,
    };
  }
  if (anyMissingBom) {
    return {
      status: "MISSING_BOM",
      reason: "One or more FG lines are missing approved BOM data.",
      canPlace: false,
    };
  }
  if (anyAwaiting) {
    return {
      status: "AWAITING_PROCUREMENT",
      reason: "One or more FG lines are still waiting for procurement.",
      canPlace: false,
    };
  }
  return { status: "ZERO_BALANCE", reason: "No RS balance remains.", canPlace: false };
}

function buildPlacementSnapshot(placedByItem, balanceLines, placement) {
  return {
    totalWoPlacedQty: round3(placement?.summary?.totalWoPlacedQty ?? 0),
    totalRsBalanceQty: round3(placement?.summary?.totalRsBalanceQty ?? 0),
    totalExecutableQty: round3(placement?.summary?.totalExecutableQty ?? 0),
    placementStatus: placement?.status ?? null,
    woPlacedByItem: Object.fromEntries(
      [...(placedByItem instanceof Map ? placedByItem.entries() : Object.entries(placedByItem ?? {}))].map(
        ([itemId, qty]) => [String(itemId), round3(n(qty))],
      ),
    ),
    lines: (placement?.lines ?? []).map((line) => ({
      itemId: line.itemId,
      rsBalanceQty: round3(line.rsBalanceQty),
      suggestedExecutableQty: round3(line.suggestedExecutableQty),
    })),
  };
}

/**
 * Build balance lines from sheet + placed WO qty (authoritative RS balance caps).
 */
function buildPlacementBalanceLines(sheet, placedByItem, fgUnitByItemId) {
  return (sheet?.lines ?? [])
    .map((ln) => {
      const itemId = Number(ln.itemId);
      const rsDemandQty = round3(n(resolveNoQtyWoExecutableQty(ln)));
      const woPlacedQty = round3(n(placedByItem.get(itemId) ?? 0));
      const fgUnit = fgUnitByItemId.get(itemId) ?? ln.item?.unit ?? null;
      const rsBalanceQty = roundFgQty(Math.max(0, rsDemandQty - woPlacedQty), fgUnit, { mode: "floor" });
      return {
        itemId,
        itemName: ln.item?.itemName ?? `Item ${itemId}`,
        rsDemandQty,
        woPlacedQty,
        rsBalanceQty,
        fgUnit,
        bomMissing: false,
      };
    })
    .filter((line) => Number.isFinite(line.itemId) && line.itemId > 0);
}

/**
 * Authoritative batch placement assessment for a locked Requirement Sheet.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {{ id: number, lines?: Array<{ itemId: number, requirementQty?: number, item?: { itemName?: string, unit?: string } }> }} sheet
 * @param {{
 *   placedByItem?: Map<number, number>,
 *   aggregateRmDemandForFgLines?: typeof aggregateRmDemandForFgLines,
 *   loadApprovedBomWithLines?: typeof loadApprovedBomWithLines,
 *   getMaterialAvailabilityByItems?: typeof getMaterialAvailabilityByItems,
 * }} [deps]
 */
async function assessNoQtyBatchPlacement(db, sheet, deps = {}) {
  const loadBom = deps.loadApprovedBomWithLines || loadApprovedBomWithLines;
  const placedByItem = deps.placedByItem instanceof Map ? deps.placedByItem : new Map();
  const fgUnitByItemId = await loadFgItemUnitMap(
    db,
    (sheet?.lines ?? []).map((ln) => ln.itemId),
  );
  const balanceLines = buildPlacementBalanceLines(sheet, placedByItem, fgUnitByItemId);

  if (!hasRmValidationSupport(db)) {
    const lines = balanceLines.map((line) => ({
      itemId: line.itemId,
      itemName: line.itemName,
      rsDemandQty: line.rsDemandQty,
      woPlacedQty: line.woPlacedQty,
      rsBalanceQty: line.rsBalanceQty,
      suggestedExecutableQty: 0,
      executableQty: 0,
      status: line.rsBalanceQty > EPS ? "MISSING_BOM" : "ZERO_BALANCE",
      reason: "RM preview is unavailable in this context.",
      rmLines: [],
    }));
    const placementStatus = buildPlacementStatus(lines.filter((line) => line.rsBalanceQty > EPS));
    const placement = {
      ...placementStatus,
      summary: {
        totalRsDemandQty: round3(balanceLines.reduce((sum, line) => sum + line.rsDemandQty, 0)),
        totalWoPlacedQty: round3(balanceLines.reduce((sum, line) => sum + line.woPlacedQty, 0)),
        totalRsBalanceQty: round3(balanceLines.reduce((sum, line) => sum + line.rsBalanceQty, 0)),
        totalExecutableQty: 0,
      },
      lines,
      sharedRmConflict: false,
    };
    return {
      balanceLines,
      fgUnitByItemId,
      placedByItem,
      totals: {
        rsDemandQty: placement.summary.totalRsDemandQty,
        woPlacedQty: placement.summary.totalWoPlacedQty,
        rsBalanceQty: placement.summary.totalRsBalanceQty,
      },
      placement,
      rmReadiness: buildRmReadinessFromBatch(db, balanceLines, lines, null, deps),
      snapshot: buildPlacementSnapshot(placedByItem, balanceLines, placement),
    };
  }

  for (const line of balanceLines) {
    if (!(line.rsBalanceQty > EPS)) continue;
    const bom = await loadBom(db, line.itemId);
    line.bomMissing = !bom?.lines?.length;
  }

  const allocation = await allocateBatchExecutableQty(db, balanceLines, fgUnitByItemId, deps);
  const fullFgLines = balanceLines
    .filter((line) => line.rsBalanceQty > EPS && !line.bomMissing)
    .map((line) => ({ fgItemId: line.itemId, fgQty: line.rsBalanceQty, bomMissing: false }));
  // Still evaluate full-balance RM for allocation diagnostics; primary RM Detail uses proposed WO qty.
  if (fullFgLines.length) {
    await verifyBatchRmFeasibility(db, fullFgLines, deps);
  }

  const placementLines = [];
  for (const line of balanceLines) {
    const executableQty = line.bomMissing ? 0 : round3(n(allocation.executableByItem.get(line.itemId) ?? 0));
    const rmLines = line.bomMissing ? [] : await buildPerLineRmLines(db, line.itemId, executableQty, deps);
    const hasAvailableStock = rmLines.some((row) => row.availableQty > EPS);
    const hasIncomingStock = rmLines.some((row) => row.incomingQty > EPS);
    const { status, reason } = buildPlacementLineStatus(
      line.rsBalanceQty,
      executableQty,
      line.bomMissing,
      hasIncomingStock,
      hasAvailableStock,
    );
    const limitingRm = line.bomMissing
      ? null
      : await identifyLimitingRmItem(db, line.itemId, line.rsBalanceQty, executableQty, deps);
    const guidance = buildOperatorGuidanceForLine({
      rsBalanceQty: line.rsBalanceQty,
      suggestedExecutableQty: executableQty,
      unit: line.fgUnit,
      limitingRmItemName: limitingRm?.rmItemName ?? null,
    });
    placementLines.push({
      itemId: line.itemId,
      itemName: line.itemName,
      unit: line.fgUnit ?? null,
      rsDemandQty: line.rsDemandQty,
      woPlacedQty: line.woPlacedQty,
      rsBalanceQty: line.rsBalanceQty,
      rmLimitedCapacityQty: executableQty,
      suggestedExecutableQty: executableQty,
      executableQty,
      status,
      reason,
      rmLines,
      limitingRmItemId: limitingRm?.rmItemId ?? null,
      limitingRmItemName: limitingRm?.rmItemName ?? null,
      operatorGuidance: guidance,
    });
  }

  const positiveLines = placementLines.filter((line) => line.rsBalanceQty > EPS);
  const placementStatus = buildPlacementStatus(positiveLines);
  const placement = {
    ...placementStatus,
    summary: {
      totalRsDemandQty: round3(balanceLines.reduce((sum, line) => sum + line.rsDemandQty, 0)),
      totalWoPlacedQty: round3(balanceLines.reduce((sum, line) => sum + line.woPlacedQty, 0)),
      totalRsBalanceQty: round3(balanceLines.reduce((sum, line) => sum + line.rsBalanceQty, 0)),
      totalExecutableQty: round3(placementLines.reduce((sum, line) => sum + line.suggestedExecutableQty, 0)),
      totalRmLimitedCapacityQty: round3(
        placementLines.reduce((sum, line) => sum + line.rmLimitedCapacityQty, 0),
      ),
      woCount: null,
    },
    lines: placementLines,
    sharedRmConflict: Boolean(allocation.sharedRmConflict),
  };

  const proposedFgLines = placementLines
    .filter((line) => line.suggestedExecutableQty > EPS && line.status !== "MISSING_BOM")
    .map((line) => ({ fgItemId: line.itemId, fgQty: line.suggestedExecutableQty, bomMissing: false }));
  const batchRmAtProposed = proposedFgLines.length
    ? await verifyBatchRmFeasibility(db, proposedFgLines, deps)
    : { feasible: true, rmNeeded: new Map(), shortages: [], missingChildBoms: [], availabilityRows: [] };

  return {
    balanceLines,
    fgUnitByItemId,
    placedByItem,
    totals: {
      rsDemandQty: placement.summary.totalRsDemandQty,
      woPlacedQty: placement.summary.totalWoPlacedQty,
      rsBalanceQty: placement.summary.totalRsBalanceQty,
      rmLimitedCapacityQty: placement.summary.totalRmLimitedCapacityQty,
    },
    placement,
    rmReadiness: buildRmReadinessFromBatch(db, balanceLines, placementLines, batchRmAtProposed, deps),
    snapshot: buildPlacementSnapshot(placedByItem, balanceLines, placement),
  };
}

/**
 * Validate requested placement lines against a fresh batch assessment.
 *
 * @param {Awaited<ReturnType<typeof assessNoQtyBatchPlacement>>} assessment
 * @param {Array<{ itemId?: number, fgItemId?: number, qty: number }>} requestedLines
 * @param {{ snapshot?: object } | null} [options]
 */
function validateNoQtyPlacementRequest(assessment, requestedLines, options = {}) {
  const clientSnapshot = options?.snapshot ?? null;
  const linesByItem = new Map((assessment?.placement?.lines ?? []).map((line) => [line.itemId, line]));
  const clientLinesByItem = new Map((clientSnapshot?.lines ?? []).map((line) => [Number(line.itemId), line]));

  for (const raw of requestedLines ?? []) {
    const fgItemId = Number(raw?.itemId ?? raw?.fgItemId);
    const fgUnit = assessment.fgUnitByItemId.get(fgItemId) ?? null;
    const requestedQty = roundFgQty(raw?.qty, fgUnit, { mode: "floor" });
    if (!(requestedQty > EPS)) continue;

    const line = linesByItem.get(fgItemId);
    if (!line) {
      throw createPlacementConflictError(
        NO_QTY_PLACEMENT_ERROR.RS_CHANGED,
        "Requirement Sheet changed while you were editing.",
        { fgItemId, requestedQty },
      );
    }

    if (line.status === "MISSING_BOM") {
      throw createPlacementConflictError(
        NO_QTY_PLACEMENT_ERROR.MISSING_BOM,
        "Approved BOM is missing for this FG line.",
        { fgItemId },
      );
    }

    const balanceCap = round3(line.rsBalanceQty);
    const executableCap = round3(line.suggestedExecutableQty);
    const clientLine = clientLinesByItem.get(fgItemId);

    if (requestedQty > balanceCap + EPS) {
      throw createPlacementConflictError(
        NO_QTY_PLACEMENT_ERROR.RS_CHANGED,
        "Requirement Sheet changed while you were editing.",
        { fgItemId, requestedQty, balanceCap },
      );
    }

    if (requestedQty > executableCap + EPS) {
      const clientExecutable = clientLine ? round3(n(clientLine.suggestedExecutableQty)) : null;
      const clientBalance = clientLine ? round3(n(clientLine.rsBalanceQty)) : null;
      if (
        clientExecutable != null &&
        clientBalance != null &&
        requestedQty <= clientBalance + EPS &&
        requestedQty <= clientExecutable + EPS &&
        executableCap + EPS < clientExecutable
      ) {
        throw createPlacementConflictError(
          NO_QTY_PLACEMENT_ERROR.RM_AVAILABILITY_CHANGED,
          "RM availability changed after the execution workspace loaded. The workspace has been refreshed — review the updated suggested quantity.",
          { fgItemId, requestedQty, executableCap, priorExecutableCap: clientExecutable },
        );
      }
      if (assessment.placement?.sharedRmConflict && executableCap + EPS < balanceCap) {
        throw createPlacementConflictError(
          NO_QTY_PLACEMENT_ERROR.SHARED_RM_CONFLICT,
          "Shared RM is not sufficient to place the requested quantity across FG lines. Reduce quantities or refresh the workspace for updated allocation.",
          { fgItemId, requestedQty, executableCap, balanceCap },
        );
      }
      if (executableCap + EPS < balanceCap) {
        throw createPlacementConflictError(
          NO_QTY_PLACEMENT_ERROR.RM_SHORTAGE,
          "Insufficient RM for the requested Work Order quantity.",
          { fgItemId, requestedQty, executableCap, balanceCap },
        );
      }
      throw createPlacementConflictError(
        NO_QTY_PLACEMENT_ERROR.EXCEEDS_EXECUTABLE,
        "Requested quantity exceeds executable quantity.",
        { fgItemId, requestedQty, executableCap },
      );
    }
  }
}

module.exports = {
  NO_QTY_PLACEMENT_ERROR,
  EPS,
  assessNoQtyBatchPlacement,
  validateNoQtyPlacementRequest,
  buildPlacementBalanceLines,
  buildPlacementSnapshot,
  verifyBatchRmFeasibility,
  createPlacementConflictError,
  loadFgItemUnitMap,
  loadFgItemUnitById,
  previewRmReadinessForProposedQty,
  buildOperatorGuidanceForLine,
  identifyLimitingRmItem,
  buildPerLineRmLines,
};
