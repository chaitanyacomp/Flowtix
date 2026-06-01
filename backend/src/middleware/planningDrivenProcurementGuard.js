/**
 * Phase 4C cutover guard middleware.
 *
 * When FEATURE_PLANNING_DRIVEN_PROCUREMENT is ON, legacy/operational procurement
 * DEMAND creation paths are blocked so Monthly Planning is the single planning-driven
 * source. This only blocks procurement-demand creation — allocation, material issue,
 * RM shortage visibility, and RM Control Center operational actions are unaffected.
 *
 * Default OFF → no behavior change.
 */

const { isPlanningDrivenProcurementEnabled } = require("../config/featureFlags");

const PLANNING_DRIVEN_BLOCK_MESSAGE = "Procurement demand must be raised through Monthly Planning.";

function blockProcurementDemandWhenPlanningDriven(req, res, next) {
  if (isPlanningDrivenProcurementEnabled()) {
    return res.status(403).json({
      error: {
        code: "PLANNING_DRIVEN_PROCUREMENT_ACTIVE",
        message: PLANNING_DRIVEN_BLOCK_MESSAGE,
      },
    });
  }
  return next();
}

module.exports = {
  PLANNING_DRIVEN_BLOCK_MESSAGE,
  blockProcurementDemandWhenPlanningDriven,
};
