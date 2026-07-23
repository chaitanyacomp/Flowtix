/**
 * Authoritative ERP inventory item types — must match Prisma `ItemType` enum.
 * Packing / Scrap / Tool / etc. are not first-class types until schema expands
 * (Tally PACKING currently resolves to CONSUMABLE).
 */

const ITEM_TYPE_CODES = Object.freeze(["RM", "FG", "SFG", "CONSUMABLE"]);

const ITEM_TYPE_LABELS = Object.freeze({
  RM: "Raw Material",
  FG: "Finished Good",
  SFG: "Semi-finished Good",
  CONSUMABLE: "Consumable",
});

/** @param {unknown} value */
function isItemTypeCode(value) {
  return typeof value === "string" && ITEM_TYPE_CODES.includes(value);
}

/** Zod-friendly enum tuple for create/update. */
function itemTypeZodEnum() {
  return /** @type {[string, ...string[]]} */ ([...ITEM_TYPE_CODES]);
}

module.exports = {
  ITEM_TYPE_CODES,
  ITEM_TYPE_LABELS,
  isItemTypeCode,
  itemTypeZodEnum,
};
