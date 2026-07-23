/**
 * Split commercial RM PO order qty into SO/PR demand allocation vs excess general stock.
 * Excess is STOCK_REPLENISHMENT / unrestricted stock — never attached to Regular SO demand.
 */

const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

/**
 * @param {number} orderQty - commercial qty entered for one PR line (may exceed pending)
 * @param {number} pendingDemandQty - remaining PR demand (net − ordered)
 * @returns {{ demandQty: number, excessToStockQty: number, orderQty: number }}
 */
function splitOrderQtyAgainstPendingDemand(orderQty, pendingDemandQty) {
  const order = round3(qtyToNumber(orderQty));
  const pending = round3(Math.max(0, qtyToNumber(pendingDemandQty)));
  if (order <= QUEUE_EPS) {
    return { demandQty: 0, excessToStockQty: 0, orderQty: 0 };
  }
  if (order < 0 || pending < 0) {
    const err = new Error("Order quantity and pending demand must be non-negative.");
    err.statusCode = 400;
    err.code = "RM_PO_QTY_INVALID";
    throw err;
  }
  const demandQty = round3(Math.min(order, pending));
  const excessToStockQty = round3(Math.max(0, order - demandQty));
  return { demandQty, excessToStockQty, orderQty: order };
}

/**
 * After consolidating commercial lines, sum demand allocations and excess.
 * @param {Array<{ qty: number, demandQty?: number, excessToStockQty?: number }>} groupRows
 */
function summarizeConsolidatedDemandAndExcess(groupRows) {
  let orderQty = 0;
  let demandQty = 0;
  let excessToStockQty = 0;
  for (const row of groupRows || []) {
    const order = round3(qtyToNumber(row.qty));
    const demand =
      row.demandQty != null ? round3(qtyToNumber(row.demandQty)) : order;
    const excess =
      row.excessToStockQty != null
        ? round3(qtyToNumber(row.excessToStockQty))
        : round3(Math.max(0, order - demand));
    orderQty = round3(orderQty + order);
    demandQty = round3(demandQty + demand);
    excessToStockQty = round3(excessToStockQty + excess);
  }
  if (excessToStockQty < -QUEUE_EPS) {
    const err = new Error("Extra stock quantity cannot be negative.");
    err.statusCode = 400;
    err.code = "RM_PO_EXCESS_NEGATIVE";
    throw err;
  }
  excessToStockQty = round3(Math.max(0, excessToStockQty));
  // Commercial qty must equal demand + excess (within rounding).
  const reconstructed = round3(demandQty + excessToStockQty);
  if (Math.abs(reconstructed - orderQty) > QUEUE_EPS) {
    excessToStockQty = round3(Math.max(0, orderQty - demandQty));
  }
  return { orderQty, demandQty, excessToStockQty };
}

/**
 * Deterministic GRN split: demand portion first up to remaining demand allocation share,
 * remainder is excess-to-stock. Never credits more than received.
 *
 * @param {number} receivedQty - this GRN (or cumulative) receipt against the PO line
 * @param {number} poLineQty - commercial PO line qty
 * @param {number} demandAllocatedQty - sum of RmPoLineProcurementLink.allocatedQty (SO/PR demand only)
 * @param {number} [priorReceivedQty=0] - previously received on this PO line (for multi-GRN)
 */
function splitGrnReceiptAgainstDemandAndExcess(
  receivedQty,
  poLineQty,
  demandAllocatedQty,
  priorReceivedQty = 0,
) {
  const received = round3(Math.max(0, qtyToNumber(receivedQty)));
  const poQty = round3(Math.max(0, qtyToNumber(poLineQty)));
  const demandCap = round3(Math.max(0, Math.min(qtyToNumber(demandAllocatedQty), poQty)));
  const prior = round3(Math.max(0, qtyToNumber(priorReceivedQty)));
  const cumulative = round3(prior + received);

  const demandCumulative = round3(Math.min(cumulative, demandCap));
  const excessCumulative = round3(Math.max(0, Math.min(cumulative, poQty) - demandCumulative));

  const priorDemand = round3(Math.min(prior, demandCap));
  const priorExcess = round3(Math.max(0, Math.min(prior, poQty) - priorDemand));

  const demandReceivedThisGrn = round3(Math.max(0, demandCumulative - priorDemand));
  const excessReceivedThisGrn = round3(Math.max(0, excessCumulative - priorExcess));

  // Never credit more than this GRN's received qty.
  const credited = round3(demandReceivedThisGrn + excessReceivedThisGrn);
  if (credited > received + QUEUE_EPS) {
    const scale = received / credited;
    return {
      demandReceivedQty: round3(demandReceivedThisGrn * scale),
      excessToStockReceivedQty: round3(excessReceivedThisGrn * scale),
      demandReceivedCumulative: demandCumulative,
      excessToStockReceivedCumulative: excessCumulative,
    };
  }

  return {
    demandReceivedQty: demandReceivedThisGrn,
    excessToStockReceivedQty: excessReceivedThisGrn,
    demandReceivedCumulative: demandCumulative,
    excessToStockReceivedCumulative: excessCumulative,
  };
}

/**
 * Confirmation copy for Purchase before saving PO.
 * Example: "Required: 140 Kg | PO Qty: 160 Kg | Extra to RM Stock: 20 Kg"
 */
function formatRmPoExcessConfirmationLine({ requiredQty, poQty, excessToStockQty, unit }) {
  const u = String(unit ?? "").trim();
  const unitSuffix = u ? ` ${u}` : "";
  const req = round3(qtyToNumber(requiredQty));
  const po = round3(qtyToNumber(poQty));
  const excess = round3(Math.max(0, qtyToNumber(excessToStockQty)));
  return `Required: ${req}${unitSuffix} | PO Qty: ${po}${unitSuffix} | Extra to RM Stock: ${excess}${unitSuffix}`;
}

module.exports = {
  splitOrderQtyAgainstPendingDemand,
  summarizeConsolidatedDemandAndExcess,
  splitGrnReceiptAgainstDemandAndExcess,
  formatRmPoExcessConfirmationLine,
  round3,
};
