const { QUEUE_EPS, qtyToNumber } = require("./rmPurchaseHelpers");

function round3(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
}

/** Outstanding procurement balance = demand target − received − short closed. */
function outstandingProcurement(targetQty, receivedQty, shortClosedQty = 0) {
  const target = qtyToNumber(targetQty);
  const received = qtyToNumber(receivedQty);
  const shortClosed = qtyToNumber(shortClosedQty);
  return Math.max(0, round3(target - received - shortClosed));
}

function isProcurementBalanceSatisfied(targetQty, receivedQty, shortClosedQty = 0) {
  return outstandingProcurement(targetQty, receivedQty, shortClosedQty) <= QUEUE_EPS;
}

function poLineOutstanding(orderedQty, receivedQty, shortClosedQty = 0) {
  return outstandingProcurement(orderedQty, receivedQty, shortClosedQty);
}

function deriveProcurementStatusLabel({ targetQty, receivedQty, shortClosedQty = 0 }) {
  const target = qtyToNumber(targetQty);
  const received = qtyToNumber(receivedQty);
  const shortClosed = qtyToNumber(shortClosedQty);
  if (target <= QUEUE_EPS) return "NOT_APPLICABLE";
  if (isProcurementBalanceSatisfied(target, received, shortClosed)) {
    if (shortClosed > QUEUE_EPS && received + QUEUE_EPS < target) {
      return "PARTIALLY_PROCURED_SHORT_CLOSED";
    }
    if (shortClosed > QUEUE_EPS) return "PARTIALLY_PROCURED_SHORT_CLOSED";
    return "FULLY_PROCURED";
  }
  if (received > QUEUE_EPS || shortClosed > QUEUE_EPS) return "PARTIALLY_PROCURED";
  return "PROCUREMENT_PENDING";
}

function procurementStatusDisplayLabel(statusKey) {
  switch (String(statusKey ?? "").trim()) {
    case "PARTIALLY_PROCURED_SHORT_CLOSED":
      return "PARTIALLY PROCURED (SHORT CLOSED)";
    case "FULLY_PROCURED":
      return "Fully Procured";
    case "PARTIALLY_PROCURED":
      return "Partially Procured";
    case "PROCUREMENT_PENDING":
      return "Procurement Pending";
    default:
      return statusKey ? String(statusKey).replaceAll("_", " ") : "—";
  }
}

function derivePoProcurementClosureKind(poStatus, lines = [], receivedByLine = new Map()) {
  if (String(poStatus ?? "") !== "COMPLETED") return null;
  const hasShortClosed = (lines || []).some((line) => qtyToNumber(line.shortClosedQty) > QUEUE_EPS);
  if (!hasShortClosed) return "FULL_RECEIPT";
  const anyPartialReceipt = (lines || []).some((line) => {
    const ordered = qtyToNumber(line.qty);
    const received = receivedByLine.get?.(line.id) ?? 0;
    const shortClosed = qtyToNumber(line.shortClosedQty);
    return received > QUEUE_EPS && received + shortClosed + QUEUE_EPS < ordered;
  });
  return anyPartialReceipt || hasShortClosed ? "SHORT_CLOSED" : "FULL_RECEIPT";
}

module.exports = {
  round3,
  outstandingProcurement,
  isProcurementBalanceSatisfied,
  poLineOutstanding,
  deriveProcurementStatusLabel,
  procurementStatusDisplayLabel,
  derivePoProcurementClosureKind,
};
