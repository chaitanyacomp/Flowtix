const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ALL_APP_ROLES } = require("../constants/erpRoles");
const { getControlTowerPanelMetrics } = require("../services/controlTowerService");
const {
  getNormalizedOperationalRows,
  parseControlTowerRowMode,
  parseControlTowerPagination,
  CONTROL_TOWER_ROW_MODES,
} = require("../services/controlTowerNormalizedRowsService");
const { getControlTowerBoardRows } = require("../services/controlTowerBoardService");
const {
  getControlTowerRoleQueue,
  assertRoleQueueAccess,
  RoleQueueAccessError,
  ROLE_QUEUE_ROLES,
} = require("../services/controlTowerRoleQueueService");

function parseControlTowerReadQuery(query = {}, { defaultMode }) {
  const mode = query.mode != null && String(query.mode).trim() !== ""
    ? parseControlTowerRowMode(query.mode)
    : defaultMode;

  const rawLimit = Number(query.limitPerSource);
  const limitPerSource =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(25, Math.floor(rawLimit)) : undefined;

  const { page, pageSize } = parseControlTowerPagination({
    page: query.page,
    pageSize: query.pageSize,
  });

  return { mode, limitPerSource, page, pageSize };
}

const controlTowerRouter = express.Router();

const CONTROL_TOWER_ACCESS_DENIED = "Access denied. You do not have access to the Control Tower.";

const controlTowerRoles = requireRole([...ALL_APP_ROLES], CONTROL_TOWER_ACCESS_DENIED);

function controlTowerErrorResponse(res, err, endpoint) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error("Control Tower API Error:", { endpoint, message: e.message, stack: e.stack });
  return res.status(500).json({
    success: false,
    message: "Control Tower request failed",
    endpoint,
    error: e.message,
    stack: process.env.NODE_ENV === "development" ? e.stack : undefined,
  });
}

/**
 * GET /api/control-tower/panel-metrics
 * Panel KPI counts only (read-model). Does not replace /api/dashboard.
 */
controlTowerRouter.get("/panel-metrics", requireAuth, controlTowerRoles, async (req, res, next) => {
  try {
    const payload = await getControlTowerPanelMetrics(undefined, {
      userRole: req.user?.role ?? null,
    });
    return res.json({
      success: true,
      data: payload.data,
      meta: payload.meta,
    });
  } catch (err) {
    return controlTowerErrorResponse(res, err, "/api/control-tower/panel-metrics");
  }
});

/**
 * GET /api/control-tower/normalized-rows
 * Developer verification — normalized row samples (Prompt 2). Not for production UI yet.
 */
controlTowerRouter.get("/normalized-rows", requireAuth, controlTowerRoles, async (req, res, next) => {
  try {
    const { mode, limitPerSource, page, pageSize } = parseControlTowerReadQuery(req.query, {
      defaultMode: CONTROL_TOWER_ROW_MODES.SAMPLE,
    });
    const payload = await getNormalizedOperationalRows({ mode, limitPerSource, page, pageSize });
    return res.json({
      success: true,
      count: payload.count,
      rows: payload.rows,
      meta: payload.meta,
    });
  } catch (err) {
    return controlTowerErrorResponse(res, err, "/api/control-tower/normalized-rows");
  }
});

/**
 * GET /api/control-tower/board
 * Developer verification — grouped board read model (Prompt 5). Not for production UI yet.
 */
controlTowerRouter.get("/board", requireAuth, controlTowerRoles, async (req, res, next) => {
  try {
    const { mode, limitPerSource, page, pageSize } = parseControlTowerReadQuery(req.query, {
      defaultMode: CONTROL_TOWER_ROW_MODES.FULL,
    });
    const payload = await getControlTowerBoardRows({ mode, limitPerSource, page, pageSize });
    return res.json({
      success: true,
      data: {
        groups: payload.groups,
        ungrouped: payload.ungrouped,
        meta: payload.meta,
      },
    });
  } catch (err) {
    return controlTowerErrorResponse(res, err, "/api/control-tower/board");
  }
});

/**
 * GET /api/control-tower/role-queue/:role
 * Role-scoped operational queue (Prompt 6E). Backend verification only.
 */
controlTowerRouter.get(
  "/role-queue/:role",
  requireAuth,
  requireRole([...ALL_APP_ROLES], CONTROL_TOWER_ACCESS_DENIED),
  async (req, res, next) => {
    try {
      assertRoleQueueAccess(req.user?.role, req.params.role);
      const { mode, limitPerSource, page, pageSize } = parseControlTowerReadQuery(req.query, {
        defaultMode: CONTROL_TOWER_ROW_MODES.FULL,
      });
      const payload = await getControlTowerRoleQueue(req.params.role, {
        mode,
        limitPerSource,
        page,
        pageSize,
      });
      return res.json({
        success: true,
        data: {
          role: payload.role,
          count: payload.count,
          rows: payload.rows,
          groups: payload.groups,
          ungrouped: payload.ungrouped,
          meta: payload.meta,
        },
      });
    } catch (err) {
      if (err instanceof RoleQueueAccessError) {
        return res.status(err.statusCode).json({
          success: false,
          message: err.message,
          endpoint: `/api/control-tower/role-queue/${req.params.role}`,
        });
      }
      return controlTowerErrorResponse(res, err, `/api/control-tower/role-queue/${req.params.role}`);
    }
  },
);

module.exports = { controlTowerRouter, ROLE_QUEUE_ROLES };
