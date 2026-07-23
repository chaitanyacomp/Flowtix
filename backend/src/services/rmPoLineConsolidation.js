/**
 * Commercial RM PO line consolidation (supplier-facing).
 * Multiple PR allocations for the same RM + rate become one PO line;
 * RmPoLineProcurementLink rows preserve per-source pool traceability (demand only).
 * Excess above pending demand is STOCK_REPLENISHMENT / general stock on the PO line.
 */

const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");
const {
  splitOrderQtyAgainstPendingDemand,
  summarizeConsolidatedDemandAndExcess,
} = require("./rmPoDemandExcessSplit");

const RM_PO_RATE_MISMATCH_CODE = "RM_PO_RATE_MISMATCH";
const RM_PO_NO_ELIGIBLE_LINES_CODE = "RM_PO_NO_ELIGIBLE_LINES";
const RM_PO_UOM_MISMATCH_CODE = "RM_PO_UOM_MISMATCH";
const RM_PO_REGULAR_SO_MPRS_MIX_CODE = "RM_PO_REGULAR_SO_MPRS_MIX";

function roundRate2(rate) {
  const n = qtyToNumber(rate);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

function rateKey(rate) {
  const r = roundRate2(rate);
  return Number.isFinite(r) ? r.toFixed(2) : "";
}

function normalizeUnitKey(unit) {
  return String(unit ?? "")
    .trim()
    .toUpperCase();
}

/**
 * @typedef {object} RmPoAllocationInput
 * @property {number} purchaseRequestLineId
 * @property {number} purchaseRequestId
 * @property {string|null} [purchaseRequestDocNo]
 * @property {number} itemId
 * @property {string} [itemName]
 * @property {number} qty - commercial order qty (may exceed pending demand)
 * @property {number} [pendingDemandQty] - remaining PR demand; defaults to qty (no excess)
 * @property {number} [demandQty] - pre-split demand portion
 * @property {number} [excessToStockQty] - pre-split excess portion
 * @property {number} rate
 * @property {string} unit
 * @property {string|null} hsn
 * @property {number|string|null} gstRate
 * @property {string[]} [sourceTypes]
 * @property {string[]} [demandPools]
 * @property {string|null} [salesOrderDocNo]
 * @property {number|null} [salesOrderId]
 * @property {number|null} [materialRequirementLineId]
 */

/**
 * @typedef {object} ConsolidatedRmPoLine
 * @property {number} itemId
 * @property {string} [itemName]
 * @property {number} qty - commercial PO line qty (demand + excess)
 * @property {number} demandQty - SO/PR demand allocation total
 * @property {number} excessToStockQty - Extra to RM stock (STOCK_REPLENISHMENT / general)
 * @property {number} rate
 * @property {string} unit
 * @property {string|null} hsn
 * @property {string} gstRate
 * @property {string} amount
 * @property {Array<{ purchaseRequestLineId: number, purchaseRequestId: number, qty: number, salesOrderDocNo?: string|null, salesOrderId?: number|null, materialRequirementLineId?: number|null }>} allocations
 */

/**
 * Group validated allocation rows into consolidated commercial PO lines.
 * Same itemId must share one rate and UOM; otherwise throws.
 * Procurement links use demand qty only; excess stays on the commercial line.
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

    const units = [...new Set(group.map((g) => normalizeUnitKey(g.unit)).filter(Boolean))];
    if (units.length > 1) {
      const label = group[0]?.itemName || `item ${itemId}`;
      const err = new Error(
        `Cannot consolidate ${label} onto one PO line — selected allocations have different units (${units.join(", ")}).`,
      );
      err.statusCode = 400;
      err.code = RM_PO_UOM_MISMATCH_CODE;
      throw err;
    }

    const rate = roundRate2(group[0].rate);
    /** @type {Array<{ qty: number, demandQty: number, excessToStockQty: number }>} */
    const splitRows = [];
    /** @type {ConsolidatedRmPoLine["allocations"]} */
    const allocs = [];

    for (const g of group) {
      const split =
        g.demandQty != null && g.excessToStockQty != null
          ? {
              orderQty: qtyToNumber(g.qty),
              demandQty: qtyToNumber(g.demandQty),
              excessToStockQty: qtyToNumber(g.excessToStockQty),
            }
          : splitOrderQtyAgainstPendingDemand(
              g.qty,
              g.pendingDemandQty != null ? g.pendingDemandQty : g.qty,
            );

      splitRows.push({
        qty: split.orderQty,
        demandQty: split.demandQty,
        excessToStockQty: split.excessToStockQty,
      });

      if (split.demandQty > QUEUE_EPS) {
        allocs.push({
          purchaseRequestLineId: g.purchaseRequestLineId,
          purchaseRequestId: g.purchaseRequestId,
          qty: split.demandQty,
          salesOrderDocNo: g.salesOrderDocNo ?? null,
          salesOrderId: g.salesOrderId ?? null,
          materialRequirementLineId: g.materialRequirementLineId ?? null,
        });
      }
    }

    const summary = summarizeConsolidatedDemandAndExcess(splitRows);
    const amount = helpers.computeLineAmount(summary.orderQty, rate);
    consolidated.push({
      itemId,
      itemName: group[0].itemName,
      qty: summary.orderQty,
      demandQty: summary.demandQty,
      excessToStockQty: summary.excessToStockQty,
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

/**
 * Regular SO demand must not mix with MPRS on one commercial PO.
 * STOCK_REPLENISHMENT (excess-to-stock) may accompany REGULAR_SO.
 */
function assertRegularSoNotMixedWithMprs(sourceTypes) {
  const types = new Set((sourceTypes || []).map((s) => String(s ?? "").trim()).filter(Boolean));
  const hasRegular = types.has("SALES_ORDER") || types.has("WORK_ORDER_PLANNING");
  const hasMprs = types.has("MONTHLY_PLAN");
  if (hasRegular && hasMprs) {
    const err = new Error(
      "Cannot combine Regular Sales Order demand with Monthly Plan (MPRS) on one RM PO. Create separate POs.",
    );
    err.statusCode = 400;
    err.code = RM_PO_REGULAR_SO_MPRS_MIX_CODE;
    throw err;
  }
}

module.exports = {
  RM_PO_RATE_MISMATCH_CODE,
  RM_PO_NO_ELIGIBLE_LINES_CODE,
  RM_PO_UOM_MISMATCH_CODE,
  RM_PO_REGULAR_SO_MPRS_MIX_CODE,
  consolidateRmPoAllocations,
  assertRegularSoNotMixedWithMprs,
  rateKey,
  roundRate2,
};
