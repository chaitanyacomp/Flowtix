/**
 * RM Purchase PO line tax / unit resolution + testing-mode relaxed fallbacks.
 * @module services/rmPoTaxFields
 */

const DEFAULT_HSN_FALLBACK = "0000";
const DEFAULT_UNIT_FALLBACK = "Nos";

function isTruthyString(v) {
  return v != null && String(v).trim() !== "";
}

function isTestingModeRelaxed() {
  const v = process.env.TESTING_MODE_RELAXED_TAX_FIELDS;
  return v === "true" || v === "1";
}

/**
 * @param {object} item — Prisma Item with optional unitRef { unitName }
 */
function resolveUnitFromItem(item) {
  const fromRef = item?.unitRef?.unitName;
  if (isTruthyString(fromRef)) return String(fromRef).trim();
  if (isTruthyString(item?.unit)) return String(item.unit).trim();
  return null;
}

/**
 * Resolve unit / HSN / GST for a PO line from the item master.
 * @returns {{ unit: string, hsn: string, gstRate: number, warnings: string[] }}
 */
function resolveLineTaxFromItem(item, options = {}) {
  const relaxed = options.relaxed != null ? options.relaxed : isTestingModeRelaxed();
  const warnings = [];

  let unit = resolveUnitFromItem(item);
  if (!unit) {
    unit = DEFAULT_UNIT_FALLBACK;
    if (relaxed) {
      warnings.push('Item master missing unit; temporary fallback "Nos" applied in testing mode.');
    } else {
      const err = new Error("Item master is missing unit. Set unit on the item before creating a purchase order.");
      err.statusCode = 400;
      throw err;
    }
  }

  let hsn = item?.hsnCode != null ? String(item.hsnCode).trim() : "";
  if (!hsn) {
    hsn = DEFAULT_HSN_FALLBACK;
    if (relaxed) {
      warnings.push("Item master missing HSN; temporary fallback applied in testing mode.");
    } else {
      const err = new Error("Item master is missing HSN code. Complete the item master before creating a purchase order.");
      err.statusCode = 400;
      throw err;
    }
  }

  let gstRate = item?.gstRate != null ? Number(item.gstRate) : NaN;
  if (!Number.isFinite(gstRate)) {
    gstRate = 0;
    if (relaxed) {
      warnings.push("Item master missing GST Rate; temporary fallback 0 applied in testing mode.");
    } else {
      const err = new Error("Item master is missing GST rate. Complete the item master before creating a purchase order.");
      err.statusCode = 400;
      throw err;
    }
  }
  if (gstRate < 0 || gstRate > 100) {
    const err = new Error("Item GST rate must be between 0 and 100.");
    err.statusCode = 400;
    throw err;
  }

  return { unit, hsn, gstRate, warnings };
}

function roundMoney2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function computeLineAmount(qty, rate) {
  return roundMoney2(Number(qty) * Number(rate));
}

/**
 * Supplier state snapshots for PO header (non-blocking in relaxed mode).
 * @param {object} supplier — Supplier with optional stateRef
 */
function resolveSupplierSnapshots(supplier, options = {}) {
  const relaxed = options.relaxed != null ? options.relaxed : isTestingModeRelaxed();
  const warnings = [];
  let stateName = supplier?.stateName?.trim() || supplier?.state?.trim() || supplier?.stateRef?.stateName?.trim() || "";
  let stateCode = supplier?.stateCode?.trim() || supplier?.stateRef?.stateCode?.trim() || "";

  if (!stateName && !stateCode && supplier?.stateRef) {
    stateName = supplier.stateRef.stateName?.trim() || stateName;
    stateCode = supplier.stateRef.stateCode?.trim() || stateCode;
  }

  if ((!stateName || !stateCode) && relaxed) {
    if (!stateName && !stateCode) {
      warnings.push("Supplier state / state code missing; saved blank in testing mode.");
    }
  }

  return {
    supplierStateSnapshot: stateName || null,
    supplierStateCodeSnapshot: stateCode || null,
    warnings,
  };
}

/**
 * Validate new PO line input (rate must be > 0).
 */
function assertPositiveRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) {
    const err = new Error("Each line must have rate greater than zero.");
    err.statusCode = 400;
    throw err;
  }
}

module.exports = {
  isTestingModeRelaxed,
  resolveLineTaxFromItem,
  resolveUnitFromItem,
  computeLineAmount,
  resolveSupplierSnapshots,
  assertPositiveRate,
  DEFAULT_HSN_FALLBACK,
  DEFAULT_UNIT_FALLBACK,
};
