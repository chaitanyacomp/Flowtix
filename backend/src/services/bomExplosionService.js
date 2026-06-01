/**
 * Light BOM explosion for material planning (FG → SFG → RM, max 3 levels).
 * Uses latest APPROVED BOM only — no draft/inactive, no full MRP.
 */

const { approvedBomWhere, approvedBomOrderBy } = require("./bomStatus");
const { rmRequiredForFgCount, normalizedBaseQtyPerFg } = require("./bomWeightPlanning");
const {
  componentTypeFromItemType,
  loadApprovedChildBomByFgIds,
  enrichLinesWithComponentMeta,
  summarizeComponentLines,
} = require("./bomComponentService");

const MAX_EXPLOSION_DEPTH = 3;

function round3(v) {
  return Math.round(Number(v) * 1000) / 1000;
}

function effectivePerFgUnit(bom, line) {
  return rmRequiredForFgCount(
    line.baseQty,
    1,
    bom.outputQty,
    bom.processLossPercent,
    bom.qcLossPercent,
    bom.normalizationMode,
  );
}

async function loadApprovedBomWithLines(tx, fgItemId) {
  const bom = await tx.bom.findFirst({
    where: approvedBomWhere(fgItemId),
    orderBy: approvedBomOrderBy,
    include: {
      lines: {
        include: {
          rmItem: {
            select: { id: true, itemName: true, itemType: true, unit: true },
          },
        },
      },
    },
  });
  if (!bom?.lines?.length) return bom;
  return {
    ...bom,
    lines: bom.lines.map((line) => ({
      ...line,
      baseQtyPerFg: normalizedBaseQtyPerFg(line.baseQty, bom.outputQty, bom.normalizationMode),
    })),
  };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} fgItemId
 * @param {number} fgQty
 * @param {number} depth 1-based (FG = 1)
 * @param {Map<number, number>} rmNeeded
 * @param {{ sfgItemId: number, sfgName: string }[]} missingChildBoms
 */
async function explodeRmDemand(tx, fgItemId, fgQty, depth, rmNeeded, missingChildBoms) {
  if (depth > MAX_EXPLOSION_DEPTH || fgQty <= 0) return;

  const bom = await loadApprovedBomWithLines(tx, fgItemId);
  if (!bom?.lines?.length) return;

  for (const line of bom.lines) {
    const item = line.rmItem;
    if (!item) continue;
    const perUnit = effectivePerFgUnit(bom, line);
    const lineQty = round3(perUnit * fgQty);
    if (lineQty <= 0) continue;

    const ct = componentTypeFromItemType(item.itemType);
    if (ct === "SFG") {
      const childBom = await loadApprovedBomWithLines(tx, item.id);
      if (!childBom) {
        missingChildBoms.push({ sfgItemId: item.id, sfgName: item.itemName });
        continue;
      }
      await explodeRmDemand(tx, item.id, lineQty, depth + 1, rmNeeded, missingChildBoms);
    } else if (ct === "RM" || ct === "CONSUMABLE") {
      rmNeeded.set(item.id, round3((rmNeeded.get(item.id) || 0) + lineQty));
    }
  }
}

/**
 * Build FG row meta from latest approved BOM (direct components only).
 */
async function buildFgBomMeta(tx, fgItemId) {
  const bom = await loadApprovedBomWithLines(tx, fgItemId);
  if (!bom) {
    return {
      bom: null,
      bomRevision: null,
      rmCount: 0,
      sfgCount: 0,
      childBomsLinked: 0,
      missingChildBomNames: [],
      planningStatus: "MISSING_BOM",
    };
  }

  const sfgIds = (bom.lines ?? [])
    .filter((l) => componentTypeFromItemType(l.rmItem?.itemType) === "SFG")
    .map((l) => l.rmItemId);
  const childBomByFgId = await loadApprovedChildBomByFgIds(tx, sfgIds);
  const lines = enrichLinesWithComponentMeta(bom.lines, childBomByFgId);
  const summary = summarizeComponentLines(lines);
  const missingChildBomNames = (summary.sfgWarnings ?? []).map((w) => {
    const m = /SFG item (.+) does not have approved BOM/.exec(w);
    return m ? m[1] : w;
  });

  let planningStatus = "READY";
  if (summary.sfgCount > 0 && missingChildBomNames.length > 0) {
    planningStatus = "MISSING_CHILD_BOM";
  }

  return {
    bom: { id: bom.id, docNo: bom.docNo, revisionNo: bom.revisionNo },
    bomRevision: `R${bom.revisionNo ?? 1}`,
    rmCount: summary.rmCount,
    sfgCount: summary.sfgCount,
    childBomsLinked: summary.childBomsLinked,
    missingChildBomNames,
    planningStatus,
  };
}

/**
 * Explode all FG demand into merged RM quantities.
 * @returns {{ rmNeeded: Map<number, number>, missingChildBoms: { sfgItemId: number, sfgName: string }[] }}
 */
async function aggregateRmDemandForFgLines(tx, fgLines) {
  const rmNeeded = new Map();
  const missingChildBoms = [];

  for (const row of fgLines) {
    if (row.bomMissing) continue;
    await explodeRmDemand(tx, row.fgItemId, row.fgQty, 1, rmNeeded, missingChildBoms);
  }

  const seen = new Set();
  const uniqueMissing = [];
  for (const m of missingChildBoms) {
    const key = m.sfgItemId;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueMissing.push(m);
  }

  return { rmNeeded, missingChildBoms: uniqueMissing };
}

module.exports = {
  MAX_EXPLOSION_DEPTH,
  loadApprovedBomWithLines,
  buildFgBomMeta,
  explodeRmDemand,
  aggregateRmDemandForFgLines,
  effectivePerFgUnit,
  round3,
};
