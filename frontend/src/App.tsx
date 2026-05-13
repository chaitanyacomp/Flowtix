import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { useAuth } from "./hooks/useAuth";
import { consumeSessionExpiredMessage, describeApiOrigin, getApiUrl } from "./services/api";
import { AppLayout } from "./components/AppLayout";
import { DashboardPage as DashboardScreen } from "./pages/DashboardPage";
import { CustomersPage } from "./pages/CustomersPage";
import { ItemsPage } from "./pages/ItemsPage";
import { OpeningStockPage } from "./pages/OpeningStockPage";
import { UnitsPage } from "./pages/UnitsPage";
import { StockPage } from "./pages/StockPage";
import { StockAdjustmentPage } from "./pages/StockAdjustmentPage";
import { RmLedgerPage } from "./pages/RmLedgerPage";
import { StockLedgerPage } from "./pages/StockLedgerPage";
import { CustomerPoTrackingPage } from "./pages/CustomerPoTrackingPage";
import { CustomerReturnPage } from "./pages/CustomerReturnPage";
import { CustomerReturnBucketPage } from "./pages/CustomerReturnBucketPage";
import { EnquiriesPage } from "./pages/EnquiriesPage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { QuotationsNewPage } from "./pages/QuotationsNewPage";
import { RmPoGrnPage } from "./pages/RmPoGrnPage";
import { RmPurchaseListPage } from "./pages/rmPurchase/RmPurchaseListPage";
import { RmPurchasePoDetailPage } from "./pages/rmPurchase/RmPurchasePoDetailPage";
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
import { RegularWorkOrderPlanningPage } from "./pages/RegularWorkOrderPlanningPage";
import { ScrapReportPage } from "./pages/ScrapReportPage";
import { ReportsPage } from "./pages/ReportsPage";
import { RMShortageReportPage } from "./pages/RMShortageReportPage";
import { WorkOrderTrackingReportPage } from "./pages/WorkOrderTrackingReportPage";
import { OperationsExceptionReportPage } from "./pages/OperationsExceptionReportPage";
import { SoDispatchTraceReportPage } from "./pages/SoDispatchTraceReportPage";
import { StockReconciliationReportPage } from "./pages/StockReconciliationReportPage";
import { PurchaseMatchingReportPage } from "./pages/PurchaseMatchingReportPage";
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
  ALL_APP_ROLES_NO_ACCOUNTS,
  REPORTS_WITH_ACCOUNTS_ROLES,
  SUPPLIER_VIEW_ROLES,
  SO_WRITE_ROLES,
  SO_READ_ROLES,
  ENQUIRY_QUOTATION_WRITE_ROLES,
  RS_WRITE_ROLES,
  WO_PLAN_PREP_ROLES,
  QC_PAGE_ROLES,
  DISPATCH_READ_ROLES,
  CUSTOMER_RETURN_READ_ROLES,
  SALES_BILL_READ_ROLES,
  SALES_BILL_WRITE_ROLES,
  PURCHASE_BILL_READ_ROLES,
  PURCHASE_BILL_DRAFT_ROLES,
  PLANNING_DASHBOARD_ROLES,
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

  return (
    <div className="min-h-full bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Mini ERP Login</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={onSubmit}>
              {sessionMessage ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {sessionMessage}
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <div className="text-sm font-medium">Email</div>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@test.com" />
              </div>
              <div className="grid gap-1.5">
                <div className="text-sm font-medium">Password</div>
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="123456"
                  type="password"
                />
              </div>
              {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
              <Button disabled={loading} type="submit">
                {loading ? "Logging in..." : "Login"}
              </Button>
              <div className="grid gap-2">
                <div className="text-xs text-slate-500">
                  <span className="font-medium text-slate-600">API:</span> {describeApiOrigin()}
                </div>
                <div className="text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Health URL:</span>{" "}
                  <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{getApiUrl("/api/health")}</code>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <button
                    type="button"
                    className="w-fit text-left text-xs text-slate-600 underline underline-offset-4 hover:text-slate-900"
                    onClick={onPing}
                  >
                    Test backend connection
                  </button>
                  {ping ? <div className="text-xs leading-snug text-slate-600">{ping}</div> : null}
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Demo: admin@test.com / 123456
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
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
          path="/account"
          element={
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES]}>
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
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES]}>
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
          path="/rm-po-grn"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
              <RmPoGrnPage />
            </ProtectedRoute>
          }
        >
          <Route index element={<RmPurchaseListPage />} />
          <Route path="create" element={<RmPurchaseListPage />} />
          <Route path=":poId" element={<RmPurchasePoDetailPage />} />
        </Route>
        <Route
          path="/rm-purchase/create"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
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
          path="/production-entry"
          element={
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES_NO_ACCOUNTS]}>
              <ProductionFlowLandingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/qc-entry"
          element={
            <ProtectedRoute allowedRoles={[...QC_PAGE_ROLES]}>
              <QcEntryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/qc-report"
          element={
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES_NO_ACCOUNTS]}>
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
            <ProtectedRoute allowedRoles={["ADMIN", "STORE", "PRODUCTION", "QC", "SALES"]}>
              <StockPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/adjustment"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
              <StockAdjustmentPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/rm-ledger"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
              <RmLedgerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stock/ledger"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE"]}>
              <StockLedgerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-po-tracking"
          element={
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES]}>
              <CustomerPoTrackingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer-tracking-flow"
          element={
            <ProtectedRoute allowedRoles={[...ALL_APP_ROLES]}>
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
            <ProtectedRoute allowedRoles={["ADMIN", "STORE", "PRODUCTION", "SALES", "QC"]}>
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
            <ProtectedRoute allowedRoles={["ADMIN", "QC", "PRODUCTION", "SALES", "STORE"]}>
              <ScrapReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_WITH_ACCOUNTS_ROLES]}>
              <ReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/dispatch-backlog"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "SALES"]}>
              <DispatchBacklogReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/dispatch-summary"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_WITH_ACCOUNTS_ROLES]}>
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
          path="/reports/sales-matching"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_WITH_ACCOUNTS_ROLES]}>
              <SalesMatchingReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/customer-so-rs"
          element={
            <ProtectedRoute allowedRoles={[...REPORTS_WITH_ACCOUNTS_ROLES]}>
              <CustomerSoRsReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/batch-traceability"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "SALES", "STORE", "PRODUCTION", "QC"]}>
              <BatchTraceabilityReportPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports/rm-shortage"
          element={
            <ProtectedRoute allowedRoles={["ADMIN", "STORE", "PRODUCTION"]}>
              <RMShortageReportPage />
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

