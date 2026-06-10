/**
 * Phase P2 — Read-only RM procurement trace (Demand → MR → PR → PO → GRN → Stock → Bill).
 */

const express = require("express");
const { prisma } = require("../utils/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { RM_PO_READ_ROLES } = require("../constants/erpRoles");
const { buildRmPoProcurementTrace } = require("../services/procurementTraceService");
const { buildProcurementConnectivityReport } = require("../services/procurementConnectivityReportService");

const procurementTraceRouter = express.Router();

procurementTraceRouter.get(
  "/rm-po/:id",
  requireAuth,
  requireRole(RM_PO_READ_ROLES),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        const err = new Error("Invalid RM PO id");
        err.statusCode = 400;
        throw err;
      }

      const trace = await buildRmPoProcurementTrace(prisma, id);
      if (!trace) {
        const err = new Error("RM PO not found");
        err.statusCode = 404;
        throw err;
      }

      return res.json(trace);
    } catch (e) {
      return next(e);
    }
  },
);

procurementTraceRouter.get(
  "/connectivity-report",
  requireAuth,
  requireRole(RM_PO_READ_ROLES),
  async (req, res, next) => {
    try {
      const report = await buildProcurementConnectivityReport(prisma, req.query);
      return res.json(report);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = { procurementTraceRouter };
