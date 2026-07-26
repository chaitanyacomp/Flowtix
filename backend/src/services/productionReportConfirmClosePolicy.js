/**
 * Authoritative Production Report confirm/close flow branching.
 *
 * NO_QTY: finish execution; shortfall → CARRY_FORWARD recovery (Keep/Waive later).
 * GREEN_LEVEL: finish execution (planning path; no NO_QTY recovery row).
 * REGULAR_SO (and other non–NO_QTY / non–GL): permanent report close — never NO_QTY recovery.
 */

const REPORT_CONFIRM_CLOSE_EPS = 1e-6;

/**
 * @param {{
 *   salesOrderOrderType?: string | null;
 *   isGreenLevel?: boolean;
 *   closeWorkOrder?: boolean;
 *   executionStatus?: string | null;
 *   remainderQty?: number | null;
 * }} input
 * @returns {{
 *   flow: "NO_QTY" | "GREEN_LEVEL" | "REGULAR_SO" | "OTHER";
 *   action: "FINISH_PRODUCTION_EXECUTION" | "REGULAR_REPORT_CLOSE" | "NOOP";
 *   shortfallOutcome: "CARRY_FORWARD" | null;
 *   createsNoQtyShortageRecovery: boolean;
 * }}
 */
function resolveProductionReportConfirmCloseAction(input = {}) {
  const orderType = String(input.salesOrderOrderType ?? "")
    .trim()
    .toUpperCase();
  const exec = String(input.executionStatus ?? "")
    .trim()
    .toUpperCase();
  const remRaw = Number(input.remainderQty);
  const remainder = Number.isFinite(remRaw) ? remRaw : 0;
  const closeWorkOrder = input.closeWorkOrder === true;
  const isGreenLevel = input.isGreenLevel === true;
  const isNoQty = orderType === "NO_QTY";

  if (closeWorkOrder && exec !== "COMPLETED" && (isNoQty || isGreenLevel)) {
    const shortfallOutcome = remainder > REPORT_CONFIRM_CLOSE_EPS ? "CARRY_FORWARD" : null;
    return {
      flow: isNoQty ? "NO_QTY" : "GREEN_LEVEL",
      action: "FINISH_PRODUCTION_EXECUTION",
      shortfallOutcome,
      // Green Level finish may use CARRY_FORWARD outcome but skips createProductionShortRecovery.
      createsNoQtyShortageRecovery: isNoQty && shortfallOutcome === "CARRY_FORWARD",
    };
  }

  if (!isNoQty && !isGreenLevel) {
    return {
      flow: "REGULAR_SO",
      action: "REGULAR_REPORT_CLOSE",
      shortfallOutcome: null,
      createsNoQtyShortageRecovery: false,
    };
  }

  return {
    flow: isNoQty ? "NO_QTY" : isGreenLevel ? "GREEN_LEVEL" : "OTHER",
    action: "NOOP",
    shortfallOutcome: null,
    createsNoQtyShortageRecovery: false,
  };
}

module.exports = {
  REPORT_CONFIRM_CLOSE_EPS,
  resolveProductionReportConfirmCloseAction,
};
