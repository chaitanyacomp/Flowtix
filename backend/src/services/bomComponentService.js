/**
 * BOM component line validation (RM / SFG / future consumable).
 * Operational only — no explosion engine.
 */

const { BomStatus, approvedBomOrderBy } = require("./bomStatus");

const ALLOWED_LINE_ITEM_TYPES = new Set(["RM", "SFG", "CONSUMABLE"]);
const ALLOWED_HEADER_ITEM_TYPES = new Set(["FG", "SFG"]);
const MAX_CIRCULAR_DEPTH = 24;

const CIRCULAR_MSG =
  "Circular BOM detected. Item cannot reference itself through child BOM.";

function componentTypeFromItemType(itemType) {
  const t = String(itemType ?? "").toUpperCase();
  if (t === "SFG") return "SFG";
  if (t === "CONSUMABLE") return "CONSUMABLE";
  return "RM";
}

function isLineItemTypeAllowed(itemType) {
  return ALLOWED_LINE_ITEM_TYPES.has(String(itemType ?? "").toUpperCase());
}

function isHeaderItemTypeAllowed(itemType) {
  return ALLOWED_HEADER_ITEM_TYPES.has(String(itemType ?? "").toUpperCase());
}

async function findBomForCircularWalk(tx, itemId) {
  const approved = await tx.bom.findFirst({
    where: { fgItemId: itemId, status: BomStatus.APPROVED },
    orderBy: approvedBomOrderBy,
    include: { lines: { select: { rmItemId: true } } },
  });
  if (approved) return approved;
  return tx.bom.findFirst({
    where: { fgItemId: itemId, status: BomStatus.DRAFT },
    orderBy: approvedBomOrderBy,
    include: { lines: { select: { rmItemId: true } } },
  });
}

/**
 * Walk SFG child BOM chains; return true if fgItemId appears in the chain.
 */
async function detectCircularBom(tx, fgItemId, lineItemIds) {
  const rootId = Number(fgItemId);
  const ids = [...new Set(lineItemIds.map(Number).filter((id) => id > 0))];
  if (ids.includes(rootId)) return true;

  const items = await tx.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, itemType: true },
  });
  const typeById = new Map(items.map((i) => [i.id, i.itemType]));

  const visiting = new Set();

  async function walkSfgChain(currentId, depth) {
    if (depth > MAX_CIRCULAR_DEPTH) return true;
    if (currentId === rootId) return true;
    if (visiting.has(currentId)) return true;
    visiting.add(currentId);

    const bom = await findBomForCircularWalk(tx, currentId);
    if (!bom?.lines?.length) {
      visiting.delete(currentId);
      return false;
    }

    const childIds = bom.lines.map((l) => l.rmItemId);
    const childItems =
      childIds.length > 0
        ? await tx.item.findMany({
            where: { id: { in: childIds } },
            select: { id: true, itemType: true },
          })
        : [];
    const childTypeById = new Map(childItems.map((i) => [i.id, i.itemType]));

    for (const cid of childIds) {
      if (cid === rootId) {
        visiting.delete(currentId);
        return true;
      }
      if (String(childTypeById.get(cid) ?? "") === "SFG") {
        if (await walkSfgChain(cid, depth + 1)) {
          visiting.delete(currentId);
          return true;
        }
      }
    }
    visiting.delete(currentId);
    return false;
  }

  for (const id of ids) {
    if (String(typeById.get(id) ?? "") !== "SFG") continue;
    if (await walkSfgChain(id, 0)) return true;
  }
  return false;
}

async function assertBomHeaderItem(tx, fgItemId) {
  const item = await tx.item.findUnique({
    where: { id: fgItemId },
    select: { itemType: true, itemName: true },
  });
  if (!item || !isHeaderItemTypeAllowed(item.itemType)) {
    const err = new Error("BOM header must be a finished good (FG) or semi-finished (SFG) item.");
    err.statusCode = 400;
    throw err;
  }
}

async function assertBomLinesValid(tx, fgItemId, lines) {
  const ids = [...new Set(lines.map((l) => Number(l.rmItemId)).filter((id) => id > 0))];
  if (!ids.length) {
    const err = new Error("Add at least one component line.");
    err.statusCode = 400;
    throw err;
  }

  const items = await tx.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, itemType: true, itemName: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  for (const l of lines) {
    const it = byId.get(l.rmItemId);
    if (!it) {
      const err = new Error("Invalid component item on BOM line.");
      err.statusCode = 400;
      throw err;
    }
    if (!isLineItemTypeAllowed(it.itemType)) {
      const err = new Error(
        `Component "${it.itemName}" must be RM or SFG. Finished goods cannot be BOM components.`,
      );
      err.statusCode = 400;
      throw err;
    }
    if (Number(l.rmItemId) === Number(fgItemId)) {
      const err = new Error("BOM cannot include the same item as its own component.");
      err.statusCode = 400;
      throw err;
    }
  }

  if (await detectCircularBom(tx, fgItemId, ids)) {
    const err = new Error(CIRCULAR_MSG);
    err.statusCode = 400;
    throw err;
  }
}

/** Approved child BOM lookup for SFG lines (for UI meta). */
async function loadApprovedChildBomByFgIds(tx, fgItemIds) {
  const ids = [...new Set(fgItemIds.map(Number).filter((id) => id > 0))];
  if (!ids.length) return new Map();
  const rows = await tx.bom.findMany({
    where: { fgItemId: { in: ids }, status: BomStatus.APPROVED },
    select: { id: true, fgItemId: true, docNo: true, revisionNo: true },
    orderBy: approvedBomOrderBy,
  });
  const byFg = new Map();
  for (const row of rows) {
    const cur = byFg.get(row.fgItemId);
    if (!cur || (row.revisionNo ?? 0) > (cur.revisionNo ?? 0)) byFg.set(row.fgItemId, row);
  }
  return byFg;
}

function enrichLinesWithComponentMeta(lines, childBomByFgId) {
  return (lines ?? []).map((ln) => {
    const item = ln.rmItem ?? null;
    const itemType = item?.itemType ?? "RM";
    const componentType = componentTypeFromItemType(itemType);
    let childBom = null;
    if (componentType === "SFG" && item?.id) {
      const hit = childBomByFgId.get(item.id);
      childBom = hit
        ? {
            id: hit.id,
            docNo: hit.docNo,
            revisionNo: hit.revisionNo,
            revisionLabel: `R${hit.revisionNo ?? 1}`,
          }
        : null;
    }
    return {
      ...ln,
      componentType,
      childBomAvailable: componentType === "SFG" ? !!childBom : null,
      childBom,
    };
  });
}

function summarizeComponentLines(lines) {
  let rmCount = 0;
  let sfgCount = 0;
  let consumableCount = 0;
  let childBomsLinked = 0;
  const sfgWarnings = [];

  for (const ln of lines ?? []) {
    const ct = ln.componentType ?? componentTypeFromItemType(ln.rmItem?.itemType);
    if (ct === "SFG") {
      sfgCount += 1;
      if (ln.childBomAvailable) childBomsLinked += 1;
      else if (ln.rmItem?.itemName) {
        sfgWarnings.push(`SFG item ${ln.rmItem.itemName} does not have approved BOM.`);
      }
    } else if (ct === "CONSUMABLE") consumableCount += 1;
    else rmCount += 1;
  }

  return { rmCount, sfgCount, consumableCount, childBomsLinked, sfgWarnings };
}

async function enrichBomRowWithComponents(tx, bom) {
  const sfgIds = (bom.lines ?? [])
    .filter((l) => componentTypeFromItemType(l.rmItem?.itemType) === "SFG")
    .map((l) => l.rmItemId);
  const childBomByFgId = await loadApprovedChildBomByFgIds(tx, sfgIds);
  const lines = enrichLinesWithComponentMeta(bom.lines, childBomByFgId);
  const componentSummary = summarizeComponentLines(lines);
  return { ...bom, lines, componentSummary };
}

/** Lines that consume stock on production approve (RM now; consumable later). */
async function filterBomLinesForRmIssue(tx, bom) {
  if (!bom?.lines?.length) return [];
  const ids = bom.lines.map((l) => l.rmItemId);
  const items = await tx.item.findMany({
    where: { id: { in: ids } },
    select: { id: true, itemType: true },
  });
  const allowed = new Set(
    items.filter((i) => i.itemType === "RM" || i.itemType === "CONSUMABLE").map((i) => i.id),
  );
  const legacyMode = String(bom.normalizationMode ?? "PER_PIECE").toUpperCase() === "LEGACY_BATCH";
  const outputQty = Math.max(1e-9, Number(bom.outputQty ?? 1));
  return bom.lines
    .filter((l) => allowed.has(l.rmItemId))
    .map((l) => ({
      ...l,
      baseQtyPerFg: legacyMode ? Number(l.baseQty ?? 0) / outputQty : Number(l.baseQty ?? 0),
    }));
}

module.exports = {
  ALLOWED_LINE_ITEM_TYPES,
  ALLOWED_HEADER_ITEM_TYPES,
  CIRCULAR_MSG,
  componentTypeFromItemType,
  isLineItemTypeAllowed,
  isHeaderItemTypeAllowed,
  detectCircularBom,
  assertBomHeaderItem,
  assertBomLinesValid,
  enrichBomRowWithComponents,
  summarizeComponentLines,
  enrichLinesWithComponentMeta,
  loadApprovedChildBomByFgIds,
  filterBomLinesForRmIssue,
};
