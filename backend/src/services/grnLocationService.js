/**
 * GRN receiving location: suggestions, validation, and labels.
 * Stock buckets remain separate from physical locations.
 */

const { mapLocationRow } = require("./locationService");

const UNASSIGNED_LOCATION_LABEL = "Unassigned Location";

function locationAllowsItemType(loc, itemType) {
  if (!loc || !loc.isActive) return false;
  if (itemType === "RM" || itemType === "SFG") return Boolean(loc.allowRm);
  if (itemType === "FG") return Boolean(loc.allowFg);
  if (itemType === "CONSUMABLE") return Boolean(loc.allowConsumable);
  return false;
}

function nameHintsThirdPartyRm(name) {
  const n = String(name || "").toLowerCase();
  return n.includes("third") && n.includes("party");
}

/**
 * Pick best default receiving location for an item from active GRN-eligible locations.
 * @param {{ id: number; locationType: string; locationName: string; locationCode?: string; allowRm?: boolean; allowConsumable?: boolean; isActive?: boolean }[]} locations
 * @param {{ itemType: string; itemName?: string }} item
 */
function suggestReceivingLocationId(locations, item) {
  const active = (locations || []).filter((l) => l.isActive !== false);
  if (!active.length) return null;

  const type = item?.itemType || "RM";
  const eligible = active.filter((l) => locationAllowsItemType(l, type));
  const pool = eligible.length ? eligible : active;

  const score = (loc) => {
    let s = 0;
    if (type === "CONSUMABLE") {
      if (loc.locationType === "CONSUMABLE") s += 100;
      if (String(loc.locationName || "").toLowerCase().includes("consumable")) s += 50;
    } else if (type === "RM" || type === "SFG") {
      if (nameHintsThirdPartyRm(item?.itemName)) {
        if (loc.locationType === "VENDOR" && loc.allowRm) s += 100;
        if (nameHintsThirdPartyRm(loc.locationName)) s += 80;
        if (loc.locationCode === "LOC-THIRD-PARTY-RM") s += 90;
      } else {
        if (loc.locationType === "RM_STORE") s += 100;
        if (loc.locationCode === "LOC-RM-STORE") s += 90;
        if (String(loc.locationName || "").toLowerCase().includes("rm store")) s += 40;
      }
    }
    if (loc.isSystem) s += 5;
    return s;
  };

  let best = pool[0];
  let bestScore = score(best);
  for (let i = 1; i < pool.length; i++) {
    const sc = score(pool[i]);
    if (sc > bestScore) {
      best = pool[i];
      bestScore = sc;
    }
  }
  return best?.id ?? null;
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 */
async function loadGrnReceivingLocations(db) {
  const rows = await db.location.findMany({
    where: {
      isActive: true,
      OR: [{ allowRm: true }, { allowConsumable: true }, { allowSfg: true }],
    },
    orderBy: [{ isSystem: "desc" }, { locationName: "asc" }],
  });
  return rows.map(mapLocationRow);
}

/**
 * @param {import('@prisma/client').PrismaClient | import('@prisma/client').Prisma.TransactionClient} db
 * @param {number} locationId
 * @param {number} itemId
 */
async function assertValidGrnReceivingLocation(db, locationId, itemId) {
  const locId = Number(locationId);
  if (!Number.isFinite(locId) || locId <= 0) {
    const err = new Error("Receiving location is required for each GRN line.");
    err.statusCode = 400;
    err.code = "GRN_LOCATION_REQUIRED";
    throw err;
  }

  const [loc, item] = await Promise.all([
    db.location.findUnique({ where: { id: locId } }),
    db.item.findUnique({ where: { id: itemId }, select: { id: true, itemType: true, itemName: true } }),
  ]);

  if (!item) {
    const err = new Error("Item not found");
    err.statusCode = 400;
    throw err;
  }
  if (!loc || !loc.isActive) {
    const err = new Error("Receiving location must be an active location.");
    err.statusCode = 400;
    err.code = "GRN_LOCATION_INACTIVE";
    throw err;
  }
  if (!locationAllowsItemType(loc, item.itemType)) {
    const err = new Error(
      `Location "${loc.locationName}" does not allow item type ${item.itemType} for goods receipt.`,
    );
    err.statusCode = 400;
    err.code = "GRN_LOCATION_ITEM_TYPE";
    throw err;
  }
  return { location: loc, item };
}

function locationDisplayLabel(locationRow) {
  if (!locationRow) return UNASSIGNED_LOCATION_LABEL;
  return locationRow.locationName || locationRow.locationCode || UNASSIGNED_LOCATION_LABEL;
}

module.exports = {
  UNASSIGNED_LOCATION_LABEL,
  locationAllowsItemType,
  suggestReceivingLocationId,
  loadGrnReceivingLocations,
  assertValidGrnReceivingLocation,
  locationDisplayLabel,
  nameHintsThirdPartyRm,
};
