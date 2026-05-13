import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { buttonVariants } from "../components/ui/button";
import { apiFetch } from "../services/api";
import { cn } from "../lib/utils";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { PageContainer } from "../components/PageHeader";
import { formatCommercialDueDateCell } from "../lib/commercialDueDateDisplay";

type AccountsDashboardPayload = {
  billingPending: Array<{
    dispatchId: number;
    soId: number | null;
    dispatchNo: string;
    dispatchDate: string;
    customerName: string;
    dispatchedQty: number;
    itemName: string;
    draftBillId: number | null;
    hasDraftBill: boolean;
  }>;
  exportPending: {
    salesBills: Array<{
      id: number;
      docNo?: string | null;
      billNo: string | null;
      billDate: string;
      netAmount: number;
      customerName: string;
    }>;
    purchaseBills: Array<{
      id: number;
      billNo: string | null;
      billDate: string;
      netAmount: number;
      supplierName: string;
    }>;
  };
  paymentFollowUp: Array<{
    id: number;
    customer: string;
    billNo: string;
    billDate: string;
    dueDate: string | null;
    pendingAmount: number;
    daysOverdue: number | null;
    paymentStatus: string;
  }>;
  payablesFollowUp: Array<{
    id: number;
    supplier: string;
    billNo: string;
    billDate: string;
    dueDate: string | null;
    pendingAmount: number;
    daysOverdue: number | null;
    paymentStatus: string;
  }>;
  outstandingSnapshot: {
    totalReceivable: number;
    totalPayable: number;
    overdueReceivable: number;
    overduePayable: number;
  };
  stats: {
    billingPendingCount: number;
    exportSalesCount: number;
    exportPurchaseCount: number;
  };
};

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const shell = "min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100/90";
const max = "mx-auto w-full max-w-7xl px-3 py-3 md:px-6 md:py-4";
const kpiGrid = "grid gap-2 sm:grid-cols-2 lg:grid-cols-4";
const sectionTitle = "text-[11px] font-bold uppercase tracking-wider text-slate-500";

const kpiLinkInner =
  "flex min-h-[4rem] flex-col justify-between rounded-lg border border-slate-200/90 bg-white px-3 py-2 shadow-sm ring-1 ring-slate-900/[0.03] transition-colors hover:border-sky-300 hover:bg-sky-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";

export function AccountsDashboardPage() {
  const [data, setData] = React.useState<AccountsDashboardPayload | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const j = (await apiFetch("/api/dashboard/accounts")) as AccountsDashboardPayload;
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load accounts dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className={shell}>
        <div className={max}>
          <p className="text-sm text-slate-600">Loading commercial snapshot…</p>
        </div>
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className={shell}>
        <div className={max}>
          <p className="text-sm text-red-700">{err ?? "No data"}</p>
        </div>
      </div>
    );
  }

  const { billingPending, exportPending, paymentFollowUp, payablesFollowUp, outstandingSnapshot } = data;

  return (
    <div className={shell}>
      <PageContainer className={max}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-slate-200/80 pb-2">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900 md:text-xl">Commercial desk</h1>
            <p className="mt-0.5 text-[11px] text-slate-600">
              Billing, Tally export readiness, and payment follow-up — operational; not statutory accounting.
            </p>
          </div>
        </div>

        <div className={cn(kpiGrid, "mb-3")}>
          <Link to="/sales-bills?payment=pending" className={cn(kpiLinkInner, "no-underline")}>
            <div className={sectionTitle}>Total receivable</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">{money(outstandingSnapshot.totalReceivable)}</div>
            <span className="text-[10px] font-medium text-sky-700">Open pending AR →</span>
          </Link>
          <Link to="/purchase-bills?payment=pending" className={cn(kpiLinkInner, "no-underline")}>
            <div className={sectionTitle}>Total payable</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">{money(outstandingSnapshot.totalPayable)}</div>
            <span className="text-[10px] font-medium text-sky-700">Open pending AP →</span>
          </Link>
          <Link to="/sales-bills?payment=overdue" className={cn(kpiLinkInner, "no-underline")}>
            <div className={sectionTitle}>Overdue receivable</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-amber-900">{money(outstandingSnapshot.overdueReceivable)}</div>
            <span className="text-[10px] font-medium text-sky-700">Open overdue AR →</span>
          </Link>
          <Link to="/purchase-bills?payment=overdue" className={cn(kpiLinkInner, "no-underline")}>
            <div className={sectionTitle}>Overdue payable</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-rose-900">{money(outstandingSnapshot.overduePayable)}</div>
            <span className="text-[10px] font-medium text-sky-700">Open overdue AP →</span>
          </Link>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="border-slate-200/90 shadow-sm">
            <CardHeader className="border-b border-slate-100 py-2">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Billing pending
                <span className="ml-2 text-xs font-normal text-slate-500">({data.stats.billingPendingCount})</span>
              </CardTitle>
              <p className="text-[11px] text-slate-600">Dispatch locked — sales bill not finalized</p>
            </CardHeader>
            <CardContent className="max-h-64 overflow-auto p-0">
              {billingPending.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-slate-600">None — all eligible dispatches are billed.</div>
              ) : (
                <table className="erp-table erp-table-dense w-full text-[12px] [&_td]:py-1 [&_th]:py-1">
                  <thead>
                    <tr>
                      <th className="text-left">Customer</th>
                      <th className="text-left">SO</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingPending.map((r) => (
                      <tr key={r.dispatchId}>
                        <td className="max-w-[9rem] truncate" title={r.customerName}>
                          {r.customerName}
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {r.soId != null ? displaySalesOrderNo(r.soId) : "—"}
                        </td>
                        <td className="text-right tabular-nums">{r.dispatchedQty}</td>
                        <td className="text-right">
                          {r.draftBillId != null ? (
                            <Link
                              to={`/sales-bills/${r.draftBillId}`}
                              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 px-2 text-[11px]")}
                            >
                              Open bill
                            </Link>
                          ) : (
                            <Link
                              to={`/sales-bills/new?from=dispatch&dispatchId=${r.dispatchId}`}
                              className={cn(buttonVariants({ size: "sm" }), "inline-flex h-7 items-center px-2 text-[11px]")}
                            >
                              Create bill
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200/90 shadow-sm">
            <CardHeader className="border-b border-slate-100 py-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Export pending (Tally)</CardTitle>
              <p className="text-[11px] text-slate-600">Finalized but not yet exported from ERP</p>
            </CardHeader>
            <CardContent className="grid max-h-64 gap-3 overflow-auto p-3">
              <div>
                <div className={cn(sectionTitle, "mb-1")}>Sales ({data.stats.exportSalesCount})</div>
                {exportPending.salesBills.length === 0 ? (
                  <div className="text-[12px] text-slate-600">None</div>
                ) : (
                  <ul className="space-y-1">
                    {exportPending.salesBills.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="min-w-0 truncate">
                          {b.customerName} · {b.billNo ?? b.docNo ?? `#${b.id}`}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                            <Link
                              to={`/sales-bills/${b.id}`}
                              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex h-7 items-center px-2 text-[11px]")}
                            >
                              Open bill
                            </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className={cn(sectionTitle, "mb-1")}>Purchase ({data.stats.exportPurchaseCount})</div>
                {exportPending.purchaseBills.length === 0 ? (
                  <div className="text-[12px] text-slate-600">None</div>
                ) : (
                  <ul className="space-y-1">
                    {exportPending.purchaseBills.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="min-w-0 truncate">
                          {b.supplierName} · {b.billNo ?? `#${b.id}`}
                        </span>
                        <Link
                          to={`/purchase-bills/${b.id}`}
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex h-7 shrink-0 items-center px-2 text-[11px]")}
                        >
                          Open bill
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-3 border-slate-200/90 shadow-sm">
          <CardHeader className="border-b border-slate-100 py-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Payment follow-up</CardTitle>
            <p className="text-[11px] text-slate-600">Outstanding customer bills (ERP-tracked receipt vs invoice)</p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {paymentFollowUp.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-slate-600">No open AR rows with pending amount.</div>
            ) : (
              <table className="erp-table erp-table-dense min-w-[640px] w-full text-[12px] [&_td]:py-1 [&_th]:py-1">
                <thead>
                  <tr>
                    <th className="text-left">Customer</th>
                    <th className="text-left">Bill</th>
                    <th className="text-left">Bill date</th>
                    <th className="text-left">Due</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Days</th>
                    <th className="text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentFollowUp.map((r) => (
                    <tr key={r.id}>
                      <td className="max-w-[10rem] truncate">{r.customer}</td>
                      <td className="whitespace-nowrap">{r.billNo}</td>
                      <td>{new Date(r.billDate).toLocaleDateString()}</td>
                      <td>{formatCommercialDueDateCell(r.dueDate)}</td>
                      <td className="text-right tabular-nums font-medium">{money(r.pendingAmount)}</td>
                      <td className="text-right tabular-nums text-slate-700">
                        {r.daysOverdue != null ? (r.daysOverdue > 0 ? r.daysOverdue : "—") : "—"}
                      </td>
                      <td className="text-right">
                        <Link
                          to={`/sales-bills/${r.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2 text-[11px] text-sky-700")}
                        >
                          Open bill
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card className="mt-3 border-slate-200/90 shadow-sm">
          <CardHeader className="border-b border-slate-100 py-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Payables follow-up</CardTitle>
            <p className="text-[11px] text-slate-600">Outstanding supplier bills (ERP-tracked payment vs invoice)</p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {payablesFollowUp.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-slate-600">No open AP rows with pending amount.</div>
            ) : (
              <table className="erp-table erp-table-dense min-w-[640px] w-full text-[12px] [&_td]:py-1 [&_th]:py-1">
                <thead>
                  <tr>
                    <th className="text-left">Supplier</th>
                    <th className="text-left">Bill</th>
                    <th className="text-left">Bill date</th>
                    <th className="text-left">Due</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Days</th>
                    <th className="text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {payablesFollowUp.map((r) => (
                    <tr key={r.id}>
                      <td className="max-w-[10rem] truncate">{r.supplier}</td>
                      <td className="whitespace-nowrap">{r.billNo}</td>
                      <td>{new Date(r.billDate).toLocaleDateString()}</td>
                      <td>{formatCommercialDueDateCell(r.dueDate)}</td>
                      <td className="text-right tabular-nums font-medium">{money(r.pendingAmount)}</td>
                      <td className="text-right tabular-nums text-slate-700">
                        {r.daysOverdue != null ? (r.daysOverdue > 0 ? r.daysOverdue : "—") : "—"}
                      </td>
                      <td className="text-right">
                        <Link
                          to={`/purchase-bills/${r.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2 text-[11px] text-sky-700")}
                        >
                          Open bill
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </div>
  );
}
