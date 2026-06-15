const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ALL_APP_ROLES } = require("../constants/erpRoles");
const { getPendingActions } = require("../services/pendingActionsService");

const pendingActionsRouter = express.Router();

const ACCESS_DENIED = "Access denied. You do not have access to pending actions.";

pendingActionsRouter.get(
  "/",
  requireAuth,
  requireRole([...ALL_APP_ROLES], ACCESS_DENIED),
  async (req, res, next) => {
    try {
      const payload = await getPendingActions({ userRole: req.user?.role ?? null });
      return res.json(payload);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error("Pending Actions API Error:", { message: e.message, stack: e.stack });
      return res.status(500).json({
        message: "Pending actions failed",
        error: e.message,
        stack: process.env.NODE_ENV === "development" ? e.stack : undefined,
      });
    }
  },
);

module.exports = { pendingActionsRouter };
