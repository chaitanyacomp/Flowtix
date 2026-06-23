/**
 * Phase 7A / P11 — Read-only MPRS RM Requirement Composition.
 *
 * FG Green Shortage (Phase 5) → BOM explosion → stock comparison.
 * RM Requirement = BOM(Green Shortage) — not BOM(suggestedProduction) or BOM(FG Green Level).
 */

const { prisma } = require("../utils/prisma");
const { normalizePeriodKey, MonthlyPlanningError } = require("./monthlyPlanningPeriodUtils");
const { getRequirementComposition } = require("./monthlyPlanningRequirementCompositionService");
const { aggregateRmDemandForFgLines, buildFgBomMeta } = require("./bomExplosionService");
const { getMaterialAvailabilityByItems } = require("./materialAvailabilityService");

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function mapToObject(map) {
  const out = {};
  for (const [key, value] of map.entries()) out[key] = value;
  return out;
}

/**
 * @param {Map<number, number>} consolidated
 * @param {Array<{ fgItemId: number; fgItemName: string | null; greenShortage: number; rmByItem: Map<number, number> }>} perFgDemands
 */
function buildFgSourcesForRm(rmItemId, perFgDemands) {
  const sources = [];
  for (const fg of perFgDemands) {
    const qty = round3(n(fg.rmByItem.get(rmItemId)));
    if (!(qty > 0)) continue;
    sources.push({
      fgItemId: fg.fgItemId,
      fgItemName: fg.fgItemName,
      greenShortage: fg.greenShortage,
      rmDemandQty: qty,
      bomRevision: fg.bomRevision ?? null,
      bomDocNo: fg.bomDocNo ?? null,
      bomMissing: fg.bomMissing,
      planningStatus: fg.planningStatus ?? null,
    });
  }
  sources.sort((a, b) => String(a.fgItemName ?? "").localeCompare(String(b.fgItemName ?? "")));
  return sources;
}

/**
 * @param {{
 *   db?: object;
 *   periodKey: string;
 *   loadFgComposition?: typeof getRequirementComposition;
 *   aggregateRmDemand?: typeof aggregateRmDemandForFgLines;
 *   loadFgBomMeta?: typeof buildFgBomMeta;
 *   loadAvailability?: typeof getMaterialAvailabilityByItems;
 * }} opts
 */
async function getRmRequirementComposition({
  db = prisma,
  periodKey,
  loadFgComposition = getRequirementComposition,
  aggregateRmDemand = aggregateRmDemandForFgLines,
  loadFgBomMeta = buildFgBomMeta,
  loadAvailability = getMaterialAvailabilityByItems,
} = {}) {
  const normalized = normalizePeriodKey(periodKey);
  const dbArg = { db, periodKey: normalized };

  const fgComposition = await loadFgComposition(dbArg);
  const fgInputs = (fgComposition.items || [])
    .filter((item) => n(item.greenShortage) > 0)
    .map((item) => ({
      fgItemId: item.itemId,
      fgItemName: item.itemName ?? null,
      unit: item.unit ?? null,
      greenShortage: round3(n(item.greenShortage)),
      greenTarget: round3(n(item.greenTarget ?? 0)),
      freeFgStock: round3(n(item.freeFgStock ?? 0)),
    }));

  const fgMetaRows = await Promise.all(
    fgInputs.map(async (fg) => {
      const meta = await loadFgBomMeta(db, fg.fgItemId);
      const bomMissing = meta.planningStatus === "MISSING_BOM";
      return {
        ...fg,
        bomMissing,
        planningStatus: meta.planningStatus,
        bomRevision: meta.bomRevision ?? null,
        bomDocNo: meta.bom?.docNo ?? null,
        missingChildBomNames: meta.missingChildBomNames ?? [],
      };
    }),
  );

  const explodeRows = fgMetaRows.map((fg) => ({
    fgItemId: fg.fgItemId,
    fgQty: fg.greenShortage,
    bomMissing: fg.bomMissing,
  }));

  const { rmNeeded, missingChildBoms } = await aggregateRmDemand(db, explodeRows);

  const perFgDemands = [];
  for (const fg of fgMetaRows) {
    if (fg.bomMissing) {
      perFgDemands.push({
        fgItemId: fg.fgItemId,
        fgItemName: fg.fgItemName,
        greenShortage: fg.greenShortage,
        bomMissing: true,
        planningStatus: fg.planningStatus,
        bomRevision: fg.bomRevision,
        bomDocNo: fg.bomDocNo,
        rmByItem: new Map(),
      });
      continue;
    }
    const { rmNeeded: perFgMap } = await aggregateRmDemand(db, [
      { fgItemId: fg.fgItemId, fgQty: fg.greenShortage, bomMissing: false },
    ]);
    perFgDemands.push({
      fgItemId: fg.fgItemId,
      fgItemName: fg.fgItemName,
      greenShortage: fg.greenShortage,
      bomMissing: false,
      planningStatus: fg.planningStatus,
      bomRevision: fg.bomRevision,
      bomDocNo: fg.bomDocNo,
      rmByItem: perFgMap,
    });
  }

  const rmItemIds = [...rmNeeded.keys()];
  const requiredQtyByItemId = mapToObject(rmNeeded);

  const [availabilityRows, rmItems] = await Promise.all([
    rmItemIds.length
      ? loadAvailability({
          db,
          itemIds: rmItemIds,
          requiredQtyByItemId,
          includeIncoming: true,
          includeIssued: false,
        })
      : Promise.resolve([]),
    rmItemIds.length
      ? db.item.findMany({
          where: { id: { in: rmItemIds } },
          select: {
            id: true,
            itemName: true,
            unit: true,
            itemType: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const itemById = new Map(rmItems.map((i) => [i.id, i]));
  const availabilityById = new Map(availabilityRows.map((row) => [row.itemId, row]));

  const items = [];
  for (const rmItemId of rmItemIds) {
    const item = itemById.get(rmItemId);
    const availability = availabilityById.get(rmItemId);
    const rmRequirement = round3(n(rmNeeded.get(rmItemId)));
    const availableRmStock = round3(n(availability?.physicalUsableStockQty ?? availability?.freeStockQty ?? 0));
    const freeStock = round3(n(availability?.freeStockQty ?? 0));
    const reserved = round3(n(availability?.effectiveReservedQty ?? 0));
    const incomingPo = round3(n(availability?.incomingQty ?? 0));
    const netRmRequirement = round3(Math.max(0, rmRequirement - availableRmStock));

    items.push({
      rmItemId,
      itemName: item?.itemName ?? null,
      unit: item?.unit ?? null,
      itemType: item?.itemType ?? null,
      /** @deprecated Use rmRequirement — same value, green-shortage-driven BOM total. */
      totalRmDemand: rmRequirement,
      rmRequirement,
      availableRmStock,
      physicalStock: availableRmStock,
      freeStock,
      reserved,
      incomingPo,
      /** @deprecated Use availableRmStock */
      netAvailable: availableRmStock,
      /** @deprecated Use netRmRequirement */
      netGap: netRmRequirement,
      netRmRequirement,
      fgSources: buildFgSourcesForRm(rmItemId, perFgDemands),
      warnings: availability?.warnings ?? [],
    });
  }

  items.sort((a, b) => String(a.itemName ?? "").localeCompare(String(b.itemName ?? "")));

  const missingBomCount = fgMetaRows.filter((fg) => fg.bomMissing).length;
  const rmLinesWithGap = items.filter((row) => row.netRmRequirement > 0).length;

  return {
    periodKey: normalized,
    anchorPeriodKey: fgComposition.anchorPeriodKey ?? normalized,
    fgCompositionItemCount: fgComposition.itemCount ?? 0,
    demandDriver: "FG_GREEN_SHORTAGE",
    summary: {
      fgItemsWithGreenShortage: fgInputs.length,
      /** @deprecated Use fgItemsWithGreenShortage */
      fgItemsPlanned: fgInputs.length,
      rmItemsRequired: items.length,
      rmLinesWithGap,
      missingBomCount,
      missingChildBomCount: missingChildBoms.length,
    },
    fgInputs: fgMetaRows.map((fg) => ({
      fgItemId: fg.fgItemId,
      fgItemName: fg.fgItemName,
      unit: fg.unit,
      greenShortage: fg.greenShortage,
      greenTarget: fg.greenTarget,
      freeFgStock: fg.freeFgStock,
      bomMissing: fg.bomMissing,
      planningStatus: fg.planningStatus,
      bomRevision: fg.bomRevision,
      bomDocNo: fg.bomDocNo,
      missingChildBomNames: fg.missingChildBomNames,
    })),
    items,
  };
}

module.exports = {
  getRmRequirementComposition,
  buildFgSourcesForRm,
  MonthlyPlanningError,
};
