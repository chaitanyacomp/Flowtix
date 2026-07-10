/**
 * Sales order terminal internal statuses (NO_QTY + shared guards).
 * Batch 3A: CLOSED_WITH_WAIVER replaces MANUALLY_CLOSED; both kept during dual-read window.
 */
const SALES_ORDER_TERMINAL_STATUSES = Object.freeze([
  "COMPLETED",
  "CLOSED",
  "MANUALLY_CLOSED",
  "CLOSED_WITH_WAIVER",
]);

function isSalesOrderTerminalStatus(internalStatus) {
  return SALES_ORDER_TERMINAL_STATUSES.includes(String(internalStatus ?? ""));
}

function isSalesOrderManualOrWaiverClosed(internalStatus) {
  const s = String(internalStatus ?? "");
  return s === "MANUALLY_CLOSED" || s === "CLOSED_WITH_WAIVER" || s === "CLOSED";
}

module.exports = {
  SALES_ORDER_TERMINAL_STATUSES,
  isSalesOrderTerminalStatus,
  isSalesOrderManualOrWaiverClosed,
};
