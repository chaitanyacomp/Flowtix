import { Link } from "react-router-dom";
import { withReportsReturnContext } from "../lib/drillDownRoutes";
import { useAuth } from "../hooks/useAuth";
import { Card, CardHeader, CardTitle } from "../components/ui/card";

export function ReportsPage() {
  const auth = useAuth();
  const role = auth.user?.role ?? "";

  const showDispatchReport = role === "ADMIN" || role === "SALES";
  const showDispatchSummary = role === "ADMIN" || role === "SALES" || role === "STORE";

  const canSeeStock = role === "ADMIN" || role === "STORE";
  const canSeeRmLedger = role === "ADMIN" || role === "STORE";
  const canSeeRmShortage = role === "ADMIN" || role === "STORE" || role === "PRODUCTION";

  const canSeePurchaseBills = role === "ADMIN" || role === "STORE";
  const canSeeRmPurchase = role === "ADMIN" || role === "STORE";

  const canSeeSalesBills = role === "ADMIN" || role === "SALES";
  const canSeeSoTrace = true;

  const canSeeWoTracking = role === "ADMIN" || role === "PRODUCTION";
  const canSeeScrap = role === "ADMIN" || role === "QC" || role === "PRODUCTION" || role === "SALES" || role === "STORE";
  const canSeeCustomerTracking = true;

  const canSeeOpsExceptions = role === "ADMIN";
  const canSeeExportHistory = role === "ADMIN" || role === "SALES";
  const canSeeActivity = role === "ADMIN";

  function ReportCard({
    to,
    title,
    description,
  }: {
    to: string;
    title: string;
    description: string;
  }) {
    return (
      <Link to={to} className="block">
        <Card className="h-full border-slate-200 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-xs font-normal leading-relaxed text-slate-600">{description}</p>
          </CardHeader>
        </Card>
      </Link>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Reports</h2>
          <p className="mt-0.5 text-sm text-slate-600">Choose a report group, then open the report you need</p>
        </div>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Stock &amp; Reconciliation</h3>
            <p className="mt-0.5 text-xs text-slate-600">Stock views and raw-material reconciliation</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              to="/reports/stock-reconciliation"
              title="Stock Reconciliation Report"
              description="Opening, movement, adjustments, and closing by item for a date range"
            />
            {canSeeRmLedger ? (
              <ReportCard
                to="/stock/rm-ledger?from=reports"
                title="RM Ledger"
                description="Raw material movement and balances"
              />
            ) : null}
            {canSeeStock ? (
              <ReportCard
                to="/stock?from=reports"
                title="Stock Overview"
                description="Current stock summary by item"
              />
            ) : null}
            {canSeeRmShortage ? (
              <ReportCard
                to="/reports/rm-shortage"
                title="RM Shortage Report"
                description="Raw material risk and pending purchase coverage"
              />
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Purchase Audit</h3>
            <p className="mt-0.5 text-xs text-slate-600">Bills and pending RM purchase follow-up</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              to="/reports/purchase-matching"
              title="Purchase Matching Report"
              description="RM Purchase vs GRN receipt vs Purchase Bill (pending receipt/billing, mismatches)"
            />
            {canSeePurchaseBills ? (
              <ReportCard
                to={withReportsReturnContext("/purchase-bills")}
                title="Purchase Bills"
                description="Search and review purchase bills"
              />
            ) : null}
            {canSeeRmPurchase ? (
              <ReportCard
                to={withReportsReturnContext("/rm-po-grn")}
                title="RM Purchase"
                description="Pending purchase orders and GRN follow-up"
              />
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Sales Audit</h3>
            <p className="mt-0.5 text-xs text-slate-600">Dispatch and billing checks</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              to="/reports/sales-matching"
              title="Sales Matching Report"
              description="Sales Order vs Dispatch vs Sales Bill (partial dispatch/billing, mismatches)"
            />
            {showDispatchSummary ? (
              <ReportCard
                to="/reports/dispatch-summary"
                title="Dispatch Summary"
                description="Ready-to-ship now (matches Dispatch) + locked dispatch history"
              />
            ) : null}
            {showDispatchReport ? (
              <ReportCard
                to="/reports/dispatch-backlog"
                title="Dispatch Backlog"
                description="Pending dispatch across active sales orders"
              />
            ) : null}
            {canSeeSalesBills ? (
              <ReportCard
                to={withReportsReturnContext("/sales-bills")}
                title="Sales Bills"
                description="Dispatch-wise customer invoices (Tally export ready)"
              />
            ) : null}
            {canSeeSoTrace ? (
              <ReportCard
                to="/reports/so-dispatch-trace"
                title="SO to Dispatch Trace"
                description="Follow a sales order through dispatch references"
              />
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Traceability &amp; Quality</h3>
            <p className="mt-0.5 text-xs text-slate-600">Production trace and scrap / QC-related views</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              to="/reports/batch-traceability"
              title="Batch Traceability"
              description="Forward/backward trace from production batch to QC and SO/dispatch (as supported)"
            />
            {canSeeWoTracking ? (
              <ReportCard
                to="/reports/work-order-tracking"
                title="Work Order Tracking"
                description="Progress from sales order through production and dispatch"
              />
            ) : null}
            {canSeeScrap ? (
              <ReportCard
                to="/scrap-report?from=reports"
                title="Scrap Report"
                description="Scrap summary and reasons"
              />
            ) : null}
            {canSeeCustomerTracking ? (
              <ReportCard
                to="/customer-tracking-flow?from=reports"
                title="Customer Tracking Report"
                description="Order journey from dispatch through billing, returns, and replacements"
              />
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Exceptions &amp; Activity</h3>
            <p className="mt-0.5 text-xs text-slate-600">Exceptions, exports, and operational log</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {canSeeOpsExceptions ? (
              <ReportCard
                to="/reports/operations-exceptions"
                title="Operations Exception Report"
                description="Cross-cutting operational exceptions"
              />
            ) : null}
            {canSeeExportHistory ? (
              <ReportCard
                to="/export-history?from=reports"
                title="Export History"
                description="Download previously exported Tally XML (sales bills)"
              />
            ) : null}
            {canSeeActivity ? (
              <ReportCard
                to="/reports/activity-log"
                title="User Activity Log"
                description="Audit-friendly log (who did what, when, and on which document)"
              />
            ) : null}
          </div>
        </section>
      </div>

      {!showDispatchReport ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-6 py-12 text-center shadow-sm">
          <p className="font-medium text-slate-800">No reports available</p>
          <p className="mt-1 max-w-md mx-auto text-sm text-slate-600">
            Your role does not include analytical reports on this page.
          </p>
        </div>
      ) : null}
    </div>
  );
}
