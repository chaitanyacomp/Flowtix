import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { useAuth } from "./hooks/useAuth";
import { consumeSessionExpiredMessage, describeApiOrigin, getApiUrl } from "./services/api";
import { AppLayout } from "./components/AppLayout";
import {
  BrandBanner,
  CompanyLogo,
  BRAND_PRODUCT_NAME,
  BRAND_COMPANY_NAME,
} from "./components/branding/Branding";
import { DashboardPage as DashboardScreen } from "./pages/DashboardPage";
import { ControlTowerPage } from "./pages/ControlTowerPage";
import { CustomersPage } from "./pages/CustomersPage";
import { ItemsPage } from "./pages/ItemsPage";
import { OpeningStockPage } from "./pages/OpeningStockPage";
import { UnitsPage } from "./pages/UnitsPage";
import { LocationsPage } from "./pages/LocationsPage";
import { StockPage } from "./pages/StockPage";
import { StockItemDetailPage } from "./pages/StockItemDetailPage";
import { StockAdjustmentPage } from "./pages/StockAdjustmentPage";
import { RmLedgerPage } from "./pages/RmLedgerPage";
import { StockLedgerPage } from "./pages/StockLedgerPage";
import { StockMovementHistoryPage } from "./pages/StockMovementHistoryPage";
import { CustomerPoTrackingPage } from "./pages/CustomerPoTrackingPage";
import { CustomerReturnPage } from "./pages/CustomerReturnPage";
import { CustomerReturnBucketPage } from "./pages/CustomerReturnBucketPage";
import { EnquiriesPage } from "./pages/EnquiriesPage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { QuotationsNewPage } from "./pages/QuotationsNewPage";
import { RmPoGrnPage } from "./pages/RmPoGrnPage";
import { RmPurchaseListPage } from "./pages/rmPurchase/RmPurchaseListPage";
import { RmPurchasePoDetailPage } from "./pages/rmPurchase/RmPurchasePoDetailPage";
import { GrnDetailPage } from "./pages/rmPurchase/GrnDetailPage";
import { PurchaseBillsListPage } from "./pages/PurchaseBillsListPage";
import { PurchaseBillNewPage } from "./pages/PurchaseBillNewPage";
import { PurchaseBillEditPage } from "./pages/PurchaseBillEditPage";
import { SalesBillsListPage } from "./pages/SalesBillsListPage";
import { SalesBillNewPage } from "./pages/SalesBillNewPage";
import { SalesBillEditPage } from "./pages/SalesBillEditPage";
import { WorkOrdersPage } from "./pages/WorkOrdersPage";
import { ProductionPage } from "./pages/ProductionPage";
import { ProductionFlowLandingPage } from "./pages/ProductionFlowLandingPage";
import { QcEntryPage } from "./pages/QcEntryPage";
import { QcReportPage } from "./pages/QcReportPage";
import { DispatchPage } from "./pages/DispatchPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { BomsPage } from "./pages/BomsPage";
import { SalesOrdersPage } from "./pages/SalesOrdersPage";
import { NoQtySalesOrderFromQuotationPage } from "./pages/NoQtySalesOrderFromQuotationPage";
import { RequirementSheetPage } from "./pages/RequirementSheetPage";
import { WoPlanningFromRequirementPage } from "./pages/WoPlanningFromRequirementPage";
import { RmCheckPage } from "./pages/RmCheckPage";
import { MaterialPlanningPage } from "./pages/MaterialPlanningPage";
import { RmStockPlanningPage } from "./pages/RmStockPlanningPage";
import { ProcurementPlanningPage } from "./pages/ProcurementPlanningPage";
import { MaterialIssuePage } from "./pages/MaterialIssuePage";
import { MonthlyPlanningWorkspacePage } from "./pages/MonthlyPlanningWorkspacePage";
import { ProductionMaterialRequestsPage } from "./pages/ProductionMaterialRequestsPage";
import { ProductionRmReturnsPage } from "./pages/ProductionRmReturnsPage";
import { ProductionRmVarianceReportPage } from "./pages/ProductionRmVarianceReportPage";
import { RmWastageReportPage } from "./pages/RmWastageReportPage";
import { RegularWorkOrderPlanningPage } from "./pages/RegularWorkOrderPlanningPage";
import { ScrapReportPage } from "./pages/ScrapReportPage";
import { ReportsPage } from "./pages/ReportsPage";
import { MaterialAvailabilityControlCenterPage } from "./pages/MaterialAvailabilityControlCenterPage";
import { WorkOrderTrackingReportPage } from "./pages/WorkOrderTrackingReportPage";
import { OperationsExceptionReportPage } from "./pages/OperationsExceptionReportPage";
import { SoDispatchTraceReportPage } from "./pages/SoDispatchTraceReportPage";
import { StockReconciliationReportPage } from "./pages/StockReconciliationReportPage";
import { PurchaseMatchingReportPage } from "./pages/PurchaseMatchingReportPage";
import { RmProcurementConnectivityReportPage } from "./pages/RmProcurementConnectivityReportPage";
import { RmPlanningVsReceivedReportPage } from "./pages/RmPlanningVsReceivedReportPage";
import { SalesMatchingReportPage } from "./pages/SalesMatchingReportPage";
import { CustomerSoRsReportPage } from "./pages/CustomerSoRsReportPage";
import { BatchTraceabilityReportPage } from "./pages/BatchTraceabilityReportPage";
import { ActivityLogReportPage } from "./pages/ActivityLogReportPage";
import { DispatchSummaryReportPage } from "./pages/DispatchSummaryReportPage";
import { DispatchBacklogReportPage } from "./pages/DispatchBacklogReportPage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { CompanyProfilePage } from "./pages/CompanyProfilePage";
import { ActivityPage } from "./pages/ActivityPage";
import { PlanningDashboardPage } from "./pages/PlanningDashboardPage";
import { ExportHistoryPage } from "./pages/ExportHistoryPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import {
  ALL_APP_ROLES,
  ALL_APP_ROLES_OPERATIONAL,
  REPORTS_ROLES,
  SUPPLIER_VIEW_ROLES,
  SO_WRITE_ROLES,
  SO_READ_ROLES,
  ENQUIRY_QUOTATION_WRITE_ROLES,
  RS_WRITE_ROLES,
  WO_PLAN_PREP_ROLES,
  QA_PAGE_ROLES,
  QA_REPORT_READ_ROLES,
  DISPATCH_READ_ROLES,
  CUSTOMER_RETURN_READ_ROLES,
  SALES_BILL_READ_ROLES,
  SALES_BILL_WRITE_ROLES,
  PURCHASE_BILL_READ_ROLES,
  PURCHASE_BILL_DRAFT_ROLES,
  PLANNING_DASHBOARD_ROLES,
  PROCUREMENT_PLANNING_ROLES,
  MATERIAL_ISSUE_ROLES,
  STOCK_READ_ROLES,
  MONTHLY_PLANNING_READ_ROLES,
  RM_CONTROL_CENTER_ROLES,
  RM_PO_READ_ROLES,
  STOCK_WRITE_ROLES,
} from "./config/erpRoles";
import { DatabaseCleanupPage } from "./pages/DatabaseCleanupPage";
import { BackupRestorePage } from "./pages/BackupRestorePage";
import { TallyMasterImportPage } from "./pages/TallyMasterImportPage";
import { RateContractsPage } from "./pages/RateContractsPage";
import { AccountPage } from "./pages/AccountPage";

/** Legacy `/planning-dashboard/production` → single planning hub (preserve query string). */
function PlanningProductionPathRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/planning-dashboard${search}`} replace />;
}

/** Old /sales-invoice links → sales orders with invoice modal (query openInvoice). */
function LegacySalesInvoiceRedirect() {
  const [searchParams] = useSearchParams();
  const soId = searchParams.get("soId");
  const to = soId ? `/sales-orders?openInvoice=${encodeURIComponent(soId)}` : "/sales-orders";
  return <Navigate to={to} replace />;
}

/** Demo-friendly aliases; list page reads `action` query (same behavior as dashboard CTAs). */
function SalesOrdersNewRedirect() {
  const [searchParams] = useSearchParams();
  if (searchParams.get("type") === "no_qty") return <Navigate to="/sales-orders?action=no-qty-so" replace />;
  return <Navigate to="/sales-orders?action=new-so" replace />;
}

function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [email, setEmail] = useState("admin@test.com");
  const [password, setPassword] = useState("123456");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ping, setPing] = useState<string | null>(null);
  const [sessionMessage] = useState<string | null>(() => consumeSessionExpiredMessage());

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPing(null);
    setLoading(true);
    try {
      await auth.login(email.trim(), password);
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[auth] navigate → /dashboard");
      }
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function onPing() {
    setPing(null);
    try {
      const res = await fetch(getApiUrl("/api/health"));
      let data: { ok?: boolean; database?: boolean; message?: string };
      try {
        data = (await res.json()) as { ok?: boolean; database?: boolean; message?: string };
      } catch {
        setPing("Server replied without JSON. Check backend logs.");
        return;
      }
      if (data.ok && data.database) {
        setPing("Backend and database OK");
        return;
      }
      if (data.database === false) {
        setPing(
          `API is running, but the database failed: ${data.message ?? "unknown error"}. Start MySQL (e.g. docker compose up -d mysql) and verify backend/.env DATABASE_URL.`,
        );
        return;
      }
      setPing(res.ok ? "Unexpected health response" : `Health check failed (${res.status})`);
    } catch (err) {
      const healthUrl = getApiUrl("/api/health");
      const detail = err instanceof Error ? err.message : String(err);
      setPing(
        `Cannot reach ${healthUrl}. ${detail ? `${detail} ` : ""}Ensure the backend is running (default port 4000) and matches ${describeApiOrigin()}.`,
      );
    }
  }

  /**
   * Dev tools are **never** shown in production. Even in DEV they are
   * hidden by default — opt-in via `?devtools=1` or `localStorage` flag
   * so the everyday dev experience matches the production sign-in screen.
   */
  const showDevtools = (() => {
    if (!import.meta.env.DEV) return false;
    if (typeof window === "undefined") return false;
    try {
      const flag = new URLSearchParams(window.location.search).get("devtools");
      if (flag === "1" || flag === "true") return true;
      return window.localStorage.getItem("erp-login-devtools") === "1";
    } catch {
      return false;
    }
  })();

  return (
    /**
     * Page-level shell — flex column so the centred branding + form area
     * (the `<main>` below) can expand to fill the viewport while the
     * `<footer>` pins to the actual bottom edge. This decouples the
     * corporate attribution from the login card layout so it behaves
     * like a real enterprise SaaS page footer.
     */
    <div className="erp-login-shell flex min-h-screen w-full flex-col">
      <main className="grid flex-1 grid-cols-1 md:grid-cols-[55%_45%]">
        {/* ──────────────── Left brand panel (md+) / top banner strip (mobile) ─ */}
        <aside className="erp-login-brand-panel flex items-center justify-center px-6 py-10 sm:px-10 md:px-12 md:py-16 lg:px-20 lg:py-20">
          <div className="erp-brand-fade-in relative z-10 flex w-full max-w-xl flex-col items-start gap-8 md:gap-10">
            {/* New banner is a wider true-alpha PNG (no baked "Enquiry to
                Dispatch" / no tall stacked composition), so it renders
                shorter at the same width. We let the `xl` token (420px)
                breathe so the hero still has presence next to the card. */}
            <BrandBanner variant="transparent" size="xl" />
            <div className="flex flex-col gap-5 md:gap-6">
              <h2 className="text-[clamp(22px,2.4vw,30px)] font-semibold leading-[1.18] tracking-tight text-slate-900">
                Built for Production.
                <span className="block text-slate-700">Designed for People.</span>
              </h2>
              {/* Optical alignment: 6px left inset + tighter max-width so the
                  lighter-weight supporting line reads as a contained block
                  sitting *under* the bold heading, not flowing past it. */}
              <p className="max-w-[380px] pl-[6px] text-[14px] leading-relaxed text-slate-500">
                Operational ERP for modern manufacturing workflows.
              </p>
            </div>
          </div>
        </aside>

        {/* ────────────────────────────────── Right form panel ──────────────── */}
        <section className="erp-login-form-panel px-5 sm:px-8 md:px-10 lg:px-12">
          <div className="erp-brand-fade-in relative z-10 flex w-full max-w-[400px] flex-col">
            <Card className="erp-login-card">
            <CardContent className="p-7 sm:p-8">
              <div className="mb-6 flex flex-col gap-1">
                <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">
                  Sign in to {BRAND_PRODUCT_NAME}
                </h1>
                <p className="text-[13px] leading-snug text-slate-500">
                  Continue to your operational workspace.
                </p>
              </div>
              <form className="grid gap-4" onSubmit={onSubmit} noValidate>
                {sessionMessage ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {sessionMessage}
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <label
                    htmlFor="login-email"
                    className="text-[12px] font-medium text-slate-700"
                  >
                    Email
                  </label>
                  <Input
                    id="login-email"
                    className="erp-login-input h-11 text-[14px]"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    inputMode="email"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label
                    htmlFor="login-password"
                    className="text-[12px] font-medium text-slate-700"
                  >
                    Password
                  </label>
                  <Input
                    id="login-password"
                    className="erp-login-input h-11 text-[14px]"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    type="password"
                    autoComplete="current-password"
                  />
                </div>
                {error ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}
                <Button
                  disabled={loading}
                  type="submit"
                  className="erp-login-submit mt-2 h-11 text-[14px] font-semibold tracking-tight"
                >
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
                {showDevtools ? (
                  <details className="group mt-1 rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2">
                    <summary className="cursor-pointer select-none list-none text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:text-slate-700">
                      Dev tools
                    </summary>
                    <div className="mt-2 grid gap-1.5 text-xs text-slate-500">
                      <div>
                        <span className="font-medium text-slate-600">API:</span> {describeApiOrigin()}
                      </div>
                      <div>
                        <span className="font-medium text-slate-600">Health URL:</span>{" "}
                        <code className="rounded bg-white px-1 py-0.5 text-[11px]">
                          {getApiUrl("/api/health")}
                        </code>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <button
                          type="button"
                          className="w-fit text-left text-xs text-slate-600 underline underline-offset-4 transition-colors hover:text-slate-900"
                          onClick={onPing}
                        >
                          Test backend connection
                        </button>
                        {ping ? <div className="text-xs leading-snug text-slate-600">{ping}</div> : null}
                      </div>
                      <div>Demo: admin@test.com / 123456</div>
                    </div>
                  </details>
                ) : null}
              </form>
            </CardContent>
          </Card>
          </div>
        </section>
      </main>

      {/* ─────────────────── Page footer: corporate attribution ───────────
          Pinned to the bottom of the viewport (outside the centred form
          area) so it behaves like a real enterprise SaaS footer instead
          of floating beneath the login card. Subtle opacity and compact
          typography keep it from competing with the product brand. */}
      <footer className="relative z-10 flex items-center justify-center gap-1.5 px-6 pb-6 pt-3 text-[10.5px] font-medium tracking-[0.01em] text-slate-500/55 sm:pb-7">
        <CompanyLogo size="xs" variant="transparent" alt="" className="opacity-50" />
        <span>Powered by {BRAND_COMPANY_NAME}</span>
      </footer>
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={auth.isAuthed ? <AppLayout /> : <Navigate to="/login" replace />}>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES]}>
              <DashboardScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/control-tower"
          element={
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES]}>
              <ControlTowerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <AccountPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/planning-dashboard"
          element={
            <ProtectedRoute allowedRoles={[...PLANNING_DASHBOARD_ROLES]}>
              <PlanningDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/planning-dashboard/production"
          element={
            <ProtectedRoute allowedRoles={[...PLANNING_DASHBOARD_ROLES]}>
              <PlanningProductionPathRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/export-history"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <ExportHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers"
          element={
            <ProtectedRoute allowedRoles={[...ENQUIRY_QUOTATION_WRITE_ROLES]}>
              <CustomersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/items"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
              <ItemsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/opening-stock"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
              <OpeningStockPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/units"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
              <UnitsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/locations"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
              <LocationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/enquiries"
          element={
            <ProtectedRoute allowedRoles={[...ENQUIRY_QUOTATION_WRITE_ROLES]}>
              <EnquiriesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quotations/new"
          element={
            <ProtectedRoute allowedRoles={[...ENQUIRY_QUOTATION_WRITE_ROLES]}>
              <QuotationsNewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quotations"
          element={
            <ProtectedRoute allowedRoles={[...ENQUIRY_QUOTATION_WRITE_ROLES]}>
              <QuotationsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/sales-pipeline" element={<Navigate to="/enquiries" replace />} />
        <Route path="/pos" element={<Navigate to="/enquiries" replace />} />
        <Route
          path="/monthly-planning"
          element={
            <ProtectedRoute allowedRoles={[...MONTHLY_PLANNING_READ_ROLES]}>
              <MonthlyPlanningWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/material-planning"
          element={
            <ProtectedRoute allowedRoles={[...PROCUREMENT_PLANNING_ROLES]}>
              <MaterialPlanningPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rm-stock-planning"
          element={
            <ProtectedRoute allowedRoles={[...PROCUREMENT_PLANNING_ROLES]}>
              <RmStockPlanningPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/procurement-planning"
          element={
            <ProtectedRoute allowedRoles={[...PROCUREMENT_PLANNING_ROLES]}>
              <ProcurementPlanningPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/material-issue"
          element={
            <ProtectedRoute allowedRoles={[...MATERIAL_ISSUE_ROLES]}>
              <MaterialIssuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rm-po-grn"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "PURCHASE", "STORE"]}>
              <RmPoGrnPage />
            </ProtectedRoute>
          }
        >
          <Route index element={<RmPurchaseListPage />} />
          <Route path="create" element={<RmPurchaseListPage />} />
          <Route path=":poId" element={<RmPurchasePoDetailPage />} />
        </Route>
        <Route
          path="/grn/:grnId"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "PURCHASE", "STORE"]}>
              <GrnDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rm-purchase/create"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "PURCHASE", "STORE"]}>
              <Navigate to="/rm-po-grn/create" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-bills"
          element={
            <ProtectedRoute allowedRoles={[...PURCHASE_BILL_READ_ROLES]}>
              <PurchaseBillsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-bills/new"
          element={
            <ProtectedRoute allowedRoles={[...PURCHASE_BILL_DRAFT_ROLES]}>
              <PurchaseBillNewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/purchase-bills/:id"
          element={
            <ProtectedRoute allowedRoles={[...PURCHASE_BILL_READ_ROLES]}>
              <PurchaseBillEditPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/sales-bills"
          element={
            <ProtectedRoute allowedRoles={[...SALES_BILL_READ_ROLES]}>
              <SalesBillsListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales-bills/new"
          element={
            <ProtectedRoute allowedRoles={[...SALES_BILL_WRITE_ROLES]}>
              <SalesBillNewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales-bills/:id"
          element={
            <ProtectedRoute allowedRoles={[...SALES_BILL_READ_ROLES]}>
              <SalesBillEditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/work-orders"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "PRODUCTION"]}>
              <WorkOrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/production"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "PRODUCTION"]}>
              <ProductionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/production/material-requests"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "PRODUCTION", "STORE"]}>
              <ProductionMaterialRequestsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/production/rm-returns"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "PRODUCTION", "STORE"]}>
              <ProductionRmReturnsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/production-entry"
          element={
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES_OPERATIONAL]}>
              <ProductionFlowLandingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/qc-entry"
          element={
            <ProtectedRoute allowedRoles={[...QA_PAGE_ROLES]}>
              <QcEntryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/qc-report"
          element={
            <ProtectedRoute allowedRoles={[...QA_REPORT_READ_ROLES]}>
              <QcReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dispatch"
          element={
            <ProtectedRoute allowedRoles={[...DISPATCH_READ_ROLES]}>
              <DispatchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock"
          element={
            <ProtectedRoute allowedRoles={[...STOCK_READ_ROLES]}>
              <StockPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/adjustment"
          element={
            <ProtectedRoute allowedRoles={[...STOCK_WRITE_ROLES]}>
              <StockAdjustmentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/rm-ledger"
          element={
            <ProtectedRoute allowedRoles={[...STOCK_WRITE_ROLES]}>
              <RmLedgerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/ledger"
          element={
            <ProtectedRoute allowedRoles={[...STOCK_WRITE_ROLES]}>
              <StockLedgerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/items/:itemId"
          element={
            <ProtectedRoute allowedRoles={[...STOCK_READ_ROLES]}>
              <StockItemDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/movement-history"
          element={
            <ProtectedRoute allowedRoles={[...STOCK_READ_ROLES]}>
              <StockMovementHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-po-tracking"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <CustomerPoTrackingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-tracking-flow"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <CustomerPoTrackingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-returns"
          element={
            <ProtectedRoute allowedRoles={[...CUSTOMER_RETURN_READ_ROLES]}>
              <CustomerReturnPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-returns/qc-hold"
          element={
            <ProtectedRoute allowedRoles={[...CUSTOMER_RETURN_READ_ROLES]}>
              <CustomerReturnBucketPage bucket="QC_HOLD" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-returns/rework"
          element={
            <ProtectedRoute allowedRoles={[...CUSTOMER_RETURN_READ_ROLES]}>
              <CustomerReturnBucketPage bucket="REWORK" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/suppliers"
          element={
            <ProtectedRoute allowedRoles={[...SUPPLIER_VIEW_ROLES]}>
              <SuppliersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/boms"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
              <BomsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales-orders/new"
          element={
            <ProtectedRoute allowedRoles={[...SO_WRITE_ROLES]}>
              <SalesOrdersNewRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales-orders"
          element={
            <ProtectedRoute allowedRoles={[...SO_READ_ROLES]}>
              <SalesOrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales-orders/no-qty/from-quotation"
          element={
            <ProtectedRoute allowedRoles={[...SO_WRITE_ROLES]}>
              <NoQtySalesOrderFromQuotationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales-orders/:id/requirement-sheets"
          element={
            // Phase 1 role discipline: Requirement Sheet workspace is owned by Planning
            // (ADMIN + STORE). Non-planning roles see a workflow-status chip on every page
            // that used to deep-link here; URL-hacking yields a clean access-denied screen
            // instead of partial-page Forbidden errors mid-render.
            <ProtectedRoute allowedRoles={[...RS_WRITE_ROLES]}>
              <RequirementSheetPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/requirement-sheets/:id/wo-plan"
          element={
            <ProtectedRoute allowedRoles={[...WO_PLAN_PREP_ROLES]}>
              <WoPlanningFromRequirementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales-invoice"
          element={
            <ProtectedRoute allowedRoles={[...SO_READ_ROLES]}>
              <LegacySalesInvoiceRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/work-orders/prepare"
          element={
            <ProtectedRoute allowedRoles={[...WO_PLAN_PREP_ROLES]}>
              <RegularWorkOrderPlanningPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rm-check"
          element={
            <ProtectedRoute allowedRoles={[...WO_PLAN_PREP_ROLES]}>
              <RmCheckPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scrap-report"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_ROLES]}>
              <ScrapReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_ROLES]}>
              <ReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/dispatch-backlog"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <DispatchBacklogReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/dispatch-summary"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_ROLES]}>
              <DispatchSummaryReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/stock-reconciliation"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE", "PRODUCTION"]}>
              <StockReconciliationReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/purchase-matching"
          element={
            <ProtectedRoute allowedRoles={[...PURCHASE_BILL_READ_ROLES]}>
              <PurchaseMatchingReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/rm-procurement-connectivity"
          element={
            <ProtectedRoute allowedRoles={[...RM_PO_READ_ROLES]}>
              <RmProcurementConnectivityReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/rm-planning-vs-actual"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "PURCHASE", "STORE"]}>
              <RmPlanningVsReceivedReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/sales-matching"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_ROLES]}>
              <SalesMatchingReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/customer-so-rs"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_ROLES]}>
              <CustomerSoRsReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/batch-traceability"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_ROLES]}>
              <BatchTraceabilityReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/rm-shortage"
          element={
            <ProtectedRoute allowedRoles={[...RM_CONTROL_CENTER_ROLES]}>
              <MaterialAvailabilityControlCenterPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/work-order-tracking"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "PRODUCTION"]}>
              <WorkOrderTrackingReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/operations-exceptions"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <OperationsExceptionReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/so-dispatch-trace"
          element={
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES]}>
              <SoDispatchTraceReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/activity-log"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <ActivityLogReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/production-rm-variance"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE", "PRODUCTION"]}>
              <ProductionRmVarianceReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/rm-wastage"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE", "PRODUCTION"]}>
              <RmWastageReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <AdminSettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/company-profile"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <CompanyProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/database-cleanup"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <DatabaseCleanupPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/backup-restore"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <BackupRestorePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/masters/tally-import"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <TallyMasterImportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/rate-contracts"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <RateContractsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <ActivityPage />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="/" element={<Navigate to={auth.isAuthed ? "/dashboard" : "/login"} replace />} />
    </Routes>
  );
}
