/**
 * REGULAR_SO only — authoritative RM issue / capacity / rounding-tolerance helpers.
 * Does not apply to NO_QTY / RS / MPRS flows.
 */

const STOCK_EPS = 1e-6;

/** Default: max rounded-down shortage = min(0.5% of theoretical, 0.5 Kg). */
const ROUNDING_TOLERANCE_PERCENT = 0.005;
const ROUNDING_TOLERANCE_MAX_KG = 0.5;

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round3(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

function isRegularSoOrderType(orderType) {
  const t = String(orderType ?? "").trim().toUpperCase();
  return t === "NORMAL" || t === "REPLACEMENT" || t === "REGULAR_SO" || t === "REGULAR";
}

/**
 * Scale approved BOM RM for SO qty onto buffered WO target.
 * Example: 210 Kg for 15,000 Nos → 15,075 × (210/15000) = 211.05 Kg.
 */
function scaleRmRequiredToWoTarget(bomRmForSalesOrderQty, salesOrderQty, woTargetQty) {
  const bomRm = n(bomRmForSalesOrderQty);
  const soQty = n(salesOrderQty);
  const woQty = n(woTargetQty);
  if (bomRm <= STOCK_EPS || soQty <= STOCK_EPS || woQty <= STOCK_EPS) return 0;
  const perFg = bomRm / soQty;
  return round3(woQty * perFg);
}

/** Consumption per FG unit from theoretical RM / WO target. */
function consumptionPerFg(theoreticalRmRequiredQty, woTargetQty) {
  const theo = n(theoreticalRmRequiredQty);
  const wo = n(woTargetQty);
  if (theo <= STOCK_EPS || wo <= STOCK_EPS) return 0;
  return theo / wo;
}

/**
 * Backend-authoritative rounded-down shortage tolerance.
 * max permitted shortage = min(0.5% × theoretical, 0.5 Kg)
 */
function computeRoundedDownToleranceQty(theoreticalRmRequiredQty) {
  const theo = round3(Math.max(0, n(theoreticalRmRequiredQty)));
  if (theo <= STOCK_EPS) return 0;
  return round3(Math.min(theo * ROUNDING_TOLERANCE_PERCENT, ROUNDING_TOLERANCE_MAX_KG));
}

function balanceToTheoretical(theoreticalRmRequiredQty, cumulativeRmIssuedQty) {
  return round3(Math.max(0, n(theoreticalRmRequiredQty) - n(cumulativeRmIssuedQty)));
}

function isWithinRoundingTolerance(theoreticalRmRequiredQty, cumulativeRmIssuedQty) {
  const theo = n(theoreticalRmRequiredQty);
  const issued = n(cumulativeRmIssuedQty);
  if (issued <= STOCK_EPS) return false;
  if (issued + STOCK_EPS >= theo) return false;
  const short = theo - issued;
  const tol = computeRoundedDownToleranceQty(theo);
  return short <= tol + STOCK_EPS;
}

/**
 * Physical FG capacity from net issued RM. Always floor — never round up past RM support.
 */
function physicalRmSupportedProductionQty(netRmIssuedQty, bomConsumptionPerFg) {
  const net = Math.max(0, n(netRmIssuedQty));
  const perFg = n(bomConsumptionPerFg);
  if (!(perFg > STOCK_EPS)) return 0;
  return Math.floor((net + STOCK_EPS) / perFg);
}

/**
 * Production maximum for REGULAR_SO:
 * - Outside tolerance: physical capacity only
 * - Within acknowledged rounding tolerance: may reach WO target (not beyond)
 * - Above WO target: only when physical capacity supports it
 */
function computeRegularSoProductionMaximum({
  netRmIssuedQty,
  bomConsumptionPerFg,
  woTargetQty,
  roundingToleranceAcknowledged = false,
}) {
  const physical = physicalRmSupportedProductionQty(netRmIssuedQty, bomConsumptionPerFg);
  const target = Math.max(0, Math.floor(n(woTargetQty)));
  if (roundingToleranceAcknowledged && physical < target) {
    return target;
  }
  return physical;
}

/**
 * Display / operational issue status for REGULAR_SO PMR lines / headers.
 * @returns {{ statusKey: string, statusLabel: string }}
 */
function deriveRegularSoRmIssueStatus({
  theoreticalRmRequiredQty,
  cumulativeRmIssuedQty = 0,
  cumulativeRmReturnedQty = 0,
  waivedQty = 0,
  shortCloseReason = null,
  reconciliationPending = false,
  closedReconciled = false,
}) {
  if (closedReconciled) {
    return { statusKey: "CLOSED_RECONCILED", statusLabel: "Closed/Reconciled" };
  }
  if (reconciliationPending) {
    return { statusKey: "RETURN_RECONCILIATION_PENDING", statusLabel: "Return/Reconciliation Pending" };
  }

  const theo = n(theoreticalRmRequiredQty);
  const issued = n(cumulativeRmIssuedQty);
  const returned = n(cumulativeRmReturnedQty);
  const net = round3(Math.max(0, issued - returned));
  const waived = n(waivedQty);
  const reason = String(shortCloseReason || "").toUpperCase();

  if (net <= STOCK_EPS && issued <= STOCK_EPS) {
    return { statusKey: "NOT_ISSUED", statusLabel: "Not Issued" };
  }

  if (reason === "ROUNDING_TOLERANCE" && waived > STOCK_EPS) {
    return {
      statusKey: "FULLY_ISSUED_WITHIN_ROUNDING_TOLERANCE",
      statusLabel: "Fully Issued – Within Rounding Tolerance",
    };
  }

  if (net + waived + STOCK_EPS >= theo) {
    if (net > theo + STOCK_EPS) {
      return { statusKey: "EXCESS_ALLOWANCE_ISSUED", statusLabel: "Excess/Allowance Issued" };
    }
    if (waived > STOCK_EPS) {
      return { statusKey: "SHORT_ISSUE_ACCEPTED", statusLabel: "Closed – Short Issue Accepted" };
    }
    return { statusKey: "FULLY_ISSUED", statusLabel: "Fully Issued" };
  }

  if (isWithinRoundingTolerance(theo, net) && waived <= STOCK_EPS) {
    // Eligible for acknowledgement — still operationally partial until Store acks.
    return { statusKey: "PARTIALLY_ISSUED", statusLabel: "Partially Issued" };
  }

  return { statusKey: "PARTIALLY_ISSUED", statusLabel: "Partially Issued" };
}

/**
 * Cumulative excess % vs theoretical RM (not per-transaction remaining).
 * Used so split issues cannot bypass 0–5 / 5–10 / >10 bands.
 */
function cumulativeAllowanceExcessPercent(theoreticalRmRequiredQty, cumulativeNetIssuedQty) {
  const theo = n(theoreticalRmRequiredQty);
  const cum = n(cumulativeNetIssuedQty);
  if (!(theo > STOCK_EPS)) return 0;
  const excess = Math.max(0, cum - theo);
  return round3((excess / theo) * 100);
}

/**
 * Assert REGULAR_SO cumulative allowance bands for an issue that would land at cumulativeNetAfter.
 * @throws Error with statusCode / code when blocked or Admin required without approval
 */
function assertRegularSoCumulativeAllowanceGate({
  theoreticalRmRequiredQty,
  cumulativeNetIssuedAfter,
  role,
  hasApprovedRequest = false,
}) {
  const pct = cumulativeAllowanceExcessPercent(theoreticalRmRequiredQty, cumulativeNetIssuedAfter);
  if (pct > 10 + STOCK_EPS) {
    const err = new Error(
      "Cumulative RM issue above 10% of theoretical requirement is not permitted. Use Additional RM Issue only within approved bands.",
    );
    err.statusCode = 409;
    err.code = "REGULAR_SO_CUMULATIVE_ALLOWANCE_BLOCKED";
    err.details = { cumulativeExcessPercent: pct };
    throw err;
  }
  if (pct > 5 + STOCK_EPS) {
    const actorRole = String(role || "").toUpperCase();
    if (actorRole !== "ADMIN" && !hasApprovedRequest) {
      const err = new Error(
        "Cumulative RM issue above 5% of theoretical requirement requires reason and Admin approval.",
      );
      err.statusCode = 403;
      err.code = "REGULAR_SO_CUMULATIVE_ALLOWANCE_ADMIN_REQUIRED";
      err.details = { cumulativeExcessPercent: pct };
      throw err;
    }
  }
  return { cumulativeExcessPercent: pct, requiresAdminApproval: pct > 5 + STOCK_EPS };
}

/**
 * Resolve FG qty for REGULAR_SO WO-prepare RM explosion.
 * Prefer buffered planned/rmPlanning qty; ignore stale plan overrides that still equal customer SO qty.
 */
function resolveRegularSoRmPlanningFgQty(fgLine, planQtyOverride) {
  const planned = Math.max(0, n(fgLine?.rmPlanningQty ?? fgLine?.plannedProductionQty ?? fgLine?.toProduce));
  const customer = Math.max(0, n(fgLine?.customerCommittedQty ?? fgLine?.orderQty));
  if (planQtyOverride == null || !Number.isFinite(Number(planQtyOverride))) {
    return planned;
  }
  const planN = Math.max(0, Number(planQtyOverride));
  // Stale client override at SO customer qty must not suppress buffered WO-target RM need.
  if (planned > planN + STOCK_EPS && Math.abs(planN - customer) <= STOCK_EPS) {
    return planned;
  }
  return planN;
}

function buildRegularSoQuantityProjection({
  salesOrderQty,
  woTargetQty,
  theoreticalRmRequiredQty,
  cumulativeRmIssuedQty = 0,
  cumulativeRmReturnedQty = 0,
  actualRmConsumedQty = 0,
  bomConsumptionPerFg = null,
  roundingToleranceAcknowledged = false,
  finalizedProducedQty = 0,
}) {
  const soQty = n(salesOrderQty);
  const woQty = n(woTargetQty);
  const theo = round3(n(theoreticalRmRequiredQty));
  const issued = round3(n(cumulativeRmIssuedQty));
  const returned = round3(n(cumulativeRmReturnedQty));
  const net = round3(Math.max(0, issued - returned));
  const perFg =
    bomConsumptionPerFg != null && n(bomConsumptionPerFg) > STOCK_EPS
      ? n(bomConsumptionPerFg)
      : consumptionPerFg(theo, woQty);
  const physical = physicalRmSupportedProductionQty(net, perFg);
  const productionMax = computeRegularSoProductionMaximum({
    netRmIssuedQty: net,
    bomConsumptionPerFg: perFg,
    woTargetQty: woQty,
    roundingToleranceAcknowledged,
  });
  const finalized = Math.max(0, n(finalizedProducedQty));
  const tol = computeRoundedDownToleranceQty(theo);
  const balance = balanceToTheoretical(theo, net);

  return {
    salesOrderQty: soQty,
    woTargetQty: woQty,
    theoreticalRmRequiredQty: theo,
    cumulativeRmIssuedQty: issued,
    cumulativeRmReturnedQty: returned,
    netRmIssuedQty: net,
    actualRmConsumedQty: round3(n(actualRmConsumedQty)),
    bomConsumptionPerFg: perFg,
    roundingToleranceQty: tol,
    balanceToTheoreticalQty: balance,
    withinRoundingTolerance: isWithinRoundingTolerance(theo, net),
    rmSupportedProductionQty: physical,
    productionMaximumQty: productionMax,
    finalizedProducedQty: finalized,
    remainingSupportedProductionQty: Math.max(0, productionMax - finalized),
  };
}

module.exports = {
  STOCK_EPS,
  ROUNDING_TOLERANCE_PERCENT,
  ROUNDING_TOLERANCE_MAX_KG,
  n,
  round3,
  isRegularSoOrderType,
  scaleRmRequiredToWoTarget,
  consumptionPerFg,
  computeRoundedDownToleranceQty,
  balanceToTheoretical,
  isWithinRoundingTolerance,
  physicalRmSupportedProductionQty,
  computeRegularSoProductionMaximum,
  deriveRegularSoRmIssueStatus,
  cumulativeAllowanceExcessPercent,
  assertRegularSoCumulativeAllowanceGate,
  resolveRegularSoRmPlanningFgQty,
  buildRegularSoQuantityProjection,
};
