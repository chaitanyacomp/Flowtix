/**
 * Commercial RM PO line consolidation (supplier-facing).
 * Multiple PR allocations for the same RM + rate become one PO line;
 * RmPoLineProcurementLink rows preserve per-source pool traceability.
 */

const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");

const RM_PO_RATE_MISMATCH_CODE = "RM_PO_RATE_MISMATCH";
const RM_PO_NO_ELIGIBLE_LINES_CODE = "RM_PO_NO_ELIGIBLE_LINES";

function roundRate2(rate) {
  const n = qtyToNumber(rate);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

function rateKey(rate) {
  const r = roundRate2(rate);
  return Number.isFinite(r) ? r.toFixed(2) : "";
}

/**
 * @typedef {object} RmPoAllocationInput
 * @property {number} purchaseRequestLineId
 * @property {number} purchaseRequestId
 * @property {string|null} [purchaseRequestDocNo]
 * @property {number} itemId
 * @property {string} [itemName]
 * @property {number} qty
 * @property {number} rate
 * @property {string} unit
 * @property {string|null} hsn
 * @property {number|string|null} gstRate
 * @property {string[]} [sourceTypes]
 * @property {string[]} [demandPools]
 */

/**
 * @typedef {object} ConsolidatedRmPoLine
 * @property {number} itemId
 * @property {string} [itemName]
 * @property {number} qty
 * @property {number} rate
 * @property {string} unit
 * @property {string|null} hsn
 * @property {string} gstRate
 * @property {string} amount
 * @property {Array<{ purchaseRequestLineId: number, purchaseRequestId: number, qty: number }>} allocations
 */

/**
 * Group validated allocation rows into consolidated commercial PO lines.
 * Same itemId must share one rate; otherwise throws RM_PO_RATE_MISMATCH.
 *
 * @param {RmPoAllocationInput[]} allocations
 * @param {{ computeLineAmount: (qty: number, rate: number) => number }} helpers
 * @returns {ConsolidatedRmPoLine[]}
 */
function consolidateRmPoAllocations(allocations, helpers) {
  const rows = (allocations || []).filter((a) => qtyToNumber(a.qty) > QUEUE_EPS);
  if (!rows.length) {
    const err = new Error("Select at least one requisition line with order quantity greater than zero.");
    err.statusCode = 400;
    err.code = RM_PO_NO_ELIGIBLE_LINES_CODE;
    throw err;
  }

  /** @type {Map<number, RmPoAllocationInput[]>} */
  const byItem = new Map();
  for (const row of rows) {
    const list = byItem.get(row.itemId) || [];
    list.push(row);
    byItem.set(row.itemId, list);
  }

  /** @type {ConsolidatedRmPoLine[]} */
  const consolidated = [];

  for (const [itemId, group] of byItem) {
    const rates = [...new Set(group.map((g) => rateKey(g.rate)))];
    if (rates.length > 1) {
      const details = group
        .map((g) => {
          const doc = g.purchaseRequestDocNo || `PR line ${g.purchaseRequestLineId}`;
          return `${doc}: rate ${roundRate2(g.rate)}`;
        })
        .join("; ");
      const label = group[0]?.itemName || `item ${itemId}`;
      const err = new Error(
        `Cannot consolidate ${label} onto one PO line — selected allocations have different rates (${details}). ` +
          `Align rates for a combined PO, or create separate POs.`,
      );
      err.statusCode = 400;
      err.code = RM_PO_RATE_MISMATCH_CODE;
      err.details = {
        itemId,
        itemName: label,
        incompatibleAllocations: group.map((g) => ({
          purchaseRequestLineId: g.purchaseRequestLineId,
          purchaseRequestDocNo: g.purchaseRequestDocNo ?? null,
          rate: roundRate2(g.rate),
          qty: qtyToNumber(g.qty),
        })),
      };
      throw err;
    }

    const rate = roundRate2(group[0].rate);
    let qtySum = 0;
    /** @type {ConsolidatedRmPoLine["allocations"]} */
    const allocs = [];
    for (const g of group) {
      const q = qtyToNumber(g.qty);
      qtySum += q;
      allocs.push({
        purchaseRequestLineId: g.purchaseRequestLineId,
        purchaseRequestId: g.purchaseRequestId,
        qty: q,
      });
    }
    qtySum = Math.round(qtySum * 1000) / 1000;
    const amount = helpers.computeLineAmount(qtySum, rate);
    consolidated.push({
      itemId,
      itemName: group[0].itemName,
      qty: qtySum,
      rate,
      unit: group[0].unit,
      hsn: group[0].hsn ?? null,
      gstRate: String(group[0].gstRate ?? ""),
      amount: String(amount),
      allocations: allocs,
    });
  }

  return consolidated;
}

module.exports = {
  RM_PO_RATE_MISMATCH_CODE,
  RM_PO_NO_ELIGIBLE_LINES_CODE,
  consolidateRmPoAllocations,
  rateKey,
  roundRate2,
};
