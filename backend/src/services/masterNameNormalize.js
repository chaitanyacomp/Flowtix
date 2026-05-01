/**
 * System-wide display normalization for master **names** and unit-of-measure strings (`Item.unit`):
 * trim, collapse internal whitespace runs to a single space.
 *
 * Does not change letter casing — casing is preserved for storage.
 *
 * Used by: Item.itemName, Item.unit, Supplier.name, Customer.name.
 * Do not use for address, remarks, GSTIN, HSN, email, or long free text.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeMasterNameDisplay(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Alias for `normalizeMasterNameDisplay` (preferred name in integration docs). */
const normalizeMasterName = normalizeMasterNameDisplay;

/**
 * Comparison key for duplicate detection: display-normalized, then lowercase.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeMasterNameKey(raw) {
  return normalizeMasterNameDisplay(raw).toLowerCase();
}

module.exports = {
  normalizeMasterName,
  normalizeMasterNameDisplay,
  normalizeMasterNameKey,
};
