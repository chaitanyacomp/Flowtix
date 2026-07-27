const express = require("express");
const cors = require("cors");
const { prisma } = require("./utils/prisma");
const { errorHandler } = require("./middleware/errorHandler");
const { performanceLoggingMiddleware } = require("./middleware/performanceLogging");
const { authRouter } = require("./routes/auth");
const { poRouter } = require("./routes/pos");
const { customerRouter } = require("./routes/customers");
const { itemRouter } = require("./routes/items");
const { bomRouter } = require("./routes/boms");
const { stockRouter, postStockAdjustment, STOCK_ADJUSTMENT_ACCESS_DENIED } = require("./routes/stock");
const { requireAuth, requireRole } = require("./middleware/auth");
const { purchaseRouter } = require("./routes/purchase");
const { purchaseBillsRouter } = require("./routes/purchaseBills");
const { salesBillsRouter } = require("./routes/salesBills");
const { productionRouter } = require("./routes/production");
const { qcRejectedDispositionsRouter } = require("./routes/qcRejectedDispositions");
const { qcLegacyRejectedClassificationsRouter } = require("./routes/qcLegacyRejectedClassifications");
const { dispatchRouter } = require("./routes/dispatch");
const { dashboardRouter } = require("./routes/dashboard");
const { controlTowerRouter } = require("./routes/controlTower");
const { pendingActionsRouter } = require("./routes/pendingActions");
const { planningDashboardRouter } = require("./routes/planningDashboard");
const { exportHistoryRouter } = require("./routes/exportHistory");
const { reportsRouter } = require("./routes/reports");
const { enquiryRouter } = require("./routes/enquiries");
const { quotationRouter } = require("./routes/quotations");
const { supplierRouter } = require("./routes/suppliers");
const { salesOrderRouter } = require("./routes/salesOrders");
const { requirementSheetsRouter } = require("./routes/requirementSheets");
const { scrapRouter } = require("./routes/scrap");
const { settingsRouter } = require("./routes/settings");
const { companyProfileRouter } = require("./routes/companyProfile");
const { activityRouter } = require("./routes/activity");
const { activityLogsRouter } = require("./routes/activityLogs");
const { customerPoTrackingRouter } = require("./routes/customerPoTracking");
const { customerReturnsRouter } = require("./routes/customerReturns");
const { qcReportRouter } = require("./routes/qcReport");
const { searchRouter } = require("./routes/search");
const { statesRouter } = require("./routes/states");
const { unitsRouter } = require("./routes/units");
const { wastageTypesRouter } = require("./routes/wastageTypes");
const { locationsRouter } = require("./routes/locations");
const { adminDatabaseCleanupRouter } = require("./routes/adminDatabaseCleanup");
const { adminBackupsRouter } = require("./routes/adminBackups");
const { adminSecurityRouter } = require("./routes/adminSecurity");
const { adminUsersRouter } = require("./routes/adminUsers");
const { tallyMasterImportRouter } = require("./routes/tallyMasterImport");
const { openingStockRouter } = require("./routes/openingStock");
const { rateContractsRouter } = require("./routes/rateContracts");
const { noQtyNextActionRouter } = require("./routes/noQtyNextAction");
const { materialPlanningRouter } = require("./routes/materialPlanning");
const { materialAvailabilityRouter } = require("./routes/materialAvailability");
const { procurementPlanningRouter } = require("./routes/procurementPlanning");
const { rmStockPlanningRouter } = require("./routes/rmStockPlanning");
const { monthlyPlanningRouter } = require("./routes/monthlyPlanning");
const { procurementTraceRouter } = require("./routes/procurementTrace");
const { isMonthlyPlanningEnabled, isPlanningDrivenProcurementEnabled } = require("./config/featureFlags");
const { registerHealthRoutes } = require("./runtime/health");
const {
  resolveStaticHostingOptions,
  registerStaticHosting,
} = require("./runtime/staticHosting");

/**
 * Express app with all API routes (shared by server.js and integration tests).
 * @param {{
 *   getReleaseMeta?: () => object,
 *   staticHosting?: boolean,
 *   webDir?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
function createApp(options = {}) {
  const app = express();
  const env = options.env || process.env;
  const staticOpts = resolveStaticHostingOptions({
    staticHosting: options.staticHosting,
    webDir: options.webDir,
    env,
  });

  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  // Default JSON body limit (Express / body-parser default: 100kb).
  // Tally Confirm Import uses a route-specific higher limit only for mapping tables —
  // the XML upload remains multer 72 MB on the preview route alone.
  // Keep in sync with TALLY_APPLY_JSON_LIMIT in tallyMasterImportService.js
  const TALLY_APPLY_JSON_LIMIT = "256kb";
  app.use((req, res, next) => {
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    if (req.method === "POST" && /\/api\/admin\/tally-import\/apply\/?$/.test(path)) {
      return express.json({ limit: TALLY_APPLY_JSON_LIMIT })(req, res, next);
    }
    return express.json({ limit: "100kb" })(req, res, next);
  });
  app.use(performanceLoggingMiddleware);

  // Dev / API-only: JSON root. Production with packaged web/: SPA owns "/".
  if (!staticOpts.enabled) {
    app.get("/", (req, res) => {
      res.status(200).json({ message: "Mini ERP Backend Running" });
    });
  }

  // FT-DEP-001 Batch 2 — lightweight ops health (version, uptime, DB status; no secrets).
  registerHealthRoutes(app, { prisma, getMeta: options.getReleaseMeta });

  app.get("/api/health/live", (req, res) => {
    res.json({ ok: true, database: null });
  });

  // Runtime feature flags for the client (additive; no auth needed — exposes booleans only).
  app.get("/api/config/feature-flags", (req, res) => {
    res.json({
      monthlyPlanning: isMonthlyPlanningEnabled(),
      planningDrivenProcurement: isPlanningDrivenProcurementEnabled(),
    });
  });

  // Existing readiness probe (kept for clients/tests). Prefer GET /health for ops metadata.
  app.get("/api/health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return res.json({ ok: true, database: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[health] database check failed:", err?.message || err);
      return res.status(503).json({
        ok: false,
        database: false,
        message:
          process.env.NODE_ENV === "production"
            ? "Database unavailable"
            : err?.message || "Database connection failed",
      });
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api/pos", poRouter);
  app.use("/api/customers", customerRouter);
  app.use("/api/items", itemRouter);
  app.use("/api/boms", bomRouter);
  app.use("/api/stock", stockRouter);
  app.post("/api/stock-adjustment", requireAuth, requireRole(["ADMIN", "STORE"], STOCK_ADJUSTMENT_ACCESS_DENIED), postStockAdjustment);
  app.use("/api/purchase", purchaseRouter);
  app.use("/api/purchase-bills", purchaseBillsRouter);
  app.use("/api/sales-bills", salesBillsRouter);
  app.use("/api/rate-contracts", rateContractsRouter);
  app.use("/api/production", productionRouter);
  app.use("/api/production", qcRejectedDispositionsRouter);
  app.use("/api/production", qcLegacyRejectedClassificationsRouter);
  app.use("/api/dispatch", dispatchRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/control-tower", controlTowerRouter);
  app.use("/api/pending-actions", pendingActionsRouter);
  app.use("/api/planning-dashboard", planningDashboardRouter);
  app.use("/api/export-history", exportHistoryRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/enquiries", enquiryRouter);
  app.use("/api/quotations", quotationRouter);
  app.use("/api/suppliers", supplierRouter);
  app.use("/api/sales-orders", salesOrderRouter);
  app.use("/api/material-availability", materialAvailabilityRouter);
  app.use("/api/material-planning", materialPlanningRouter);
  app.use("/api/procurement-planning", procurementPlanningRouter);
  app.use("/api/procurement-trace", procurementTraceRouter);
  app.use("/api/rm-stock-planning", rmStockPlanningRouter);
  // Monthly Planning Workspace (Phase 1 foundation) — gated behind FEATURE_MONTHLY_PLANNING (default OFF).
  app.use("/api/monthly-planning", monthlyPlanningRouter);
  const { materialIssueRouter } = require("./routes/materialIssues");
  app.use("/api/material-issues", materialIssueRouter);
  const { pmrRouter } = require("./routes/productionMaterialRequests");
  app.use("/api/production-material-requests", pmrRouter);
  const { rmAllowanceApprovalRouter } = require("./routes/rmAllowanceApprovals");
  app.use("/api/rm-allowance-approvals", rmAllowanceApprovalRouter);
  const { regularSoBufferApprovalRouter } = require("./routes/regularSoBufferApprovals");
  app.use("/api/regular-so-buffer-approvals", regularSoBufferApprovalRouter);
  const { productionMaterialReturnRouter } = require("./routes/productionMaterialReturns");
  app.use("/api/production-material-returns", productionMaterialReturnRouter);
  app.use("/api/no-qty", noQtyNextActionRouter);
  app.use("/api", requirementSheetsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/company-profile", companyProfileRouter);
  app.use("/api/states", statesRouter);
  app.use("/api/units", unitsRouter);
  app.use("/api/wastage-types", wastageTypesRouter);
  app.use("/api/locations", locationsRouter);
  app.use("/api/scrap", scrapRouter);
  app.use("/api/activity", activityRouter);
  app.use("/api", activityLogsRouter);
  app.use("/api/customer-po-tracking", customerPoTrackingRouter);
  app.use("/api/customer-returns", customerReturnsRouter);
  app.use("/api/qc", qcReportRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/admin", adminDatabaseCleanupRouter);
  app.use("/api/admin", adminBackupsRouter);
  app.use("/api/admin", adminSecurityRouter);
  app.use("/api/admin", adminUsersRouter);
  app.use("/api/admin", tallyMasterImportRouter);
  app.use("/api", openingStockRouter);

  // FT-DEP-001 Milestone 2 — packaged SPA (after /api + /health; before error handler).
  if (staticOpts.enabled && staticOpts.webDir) {
    registerStaticHosting(app, { webDir: staticOpts.webDir });
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
