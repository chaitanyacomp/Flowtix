/**
 * NO_QTY FLOW — HTTP routes for planning dashboard (requirement / cycle planning hub).
 * REGULAR WO prep uses `sales-orders/:id/rm-check` (material planning engine) and `/work-orders/prepare` in the frontend, not these endpoints.
 */
const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { getPlanningDashboard } = require("../services/planningDashboardService");
const { getProductionPlanningDashboard } = require("../services/productionPlanningDashboardService");
const { getNoQtyPlanningInbox } = require("../services/noQtyPlanningInboxService");

const { PLANNING_DASHBOARD_ROLES } = require("../constants/erpRoles");

const planningDashboardRouter = express.Router();

const PLANNING_DASHBOARD_ACCESS_DENIED =
  "Access denied. Only administrators, store, and production staff can view the planning dashboard.";
const planningDashboardRoles = requireRole([...PLANNING_DASHBOARD_ROLES], PLANNING_DASHBOARD_ACCESS_DENIED);

planningDashboardRouter.get("/", requireAuth, planningDashboardRoles, async (req, res, next) => {
  try {
    const data = await getPlanningDashboard();
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

planningDashboardRouter.get("/production", requireAuth, planningDashboardRoles, async (req, res, next) => {
  try {
    const data = await getProductionPlanningDashboard();
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

/** Store-safe NO_QTY planning inbox — no commercial SO list access required (P11-A16). */
planningDashboardRouter.get("/no-qty-inbox", requireAuth, planningDashboardRoles, async (req, res, next) => {
  try {
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.max(1, Math.floor(raw))) : 50;
    const rows = await getNoQtyPlanningInbox(undefined, {
      limit,
      userRole: req.user?.role ?? null,
    });
    return res.json({ rows });
  } catch (e) {
    return next(e);
  }
});

module.exports = { planningDashboardRouter };

