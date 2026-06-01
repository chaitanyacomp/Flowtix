import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, ClipboardList, Package, Receipt, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { cn } from "../lib/utils";
import { apiFetch } from "../services/api";
import { PageContainer } from "../components/PageHeader";
import { ERP_DASHBOARD_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { ProcurementPendingDashboardCard, type ProcurementPendingRow } from "../components/erp/ProcurementPendingDashboardCard";
import { DashboardOpsClearStrip, DashboardWorkspaceHeader } from "../components/erp/foundation";
import { ErpActionButton } from "../components/erp/foundation/ErpActionButton";
import { ErpEmptyState } from "../components/erp/foundation/ErpEmptyState";
import { dashboardShell } from "../lib/dashboardShell";
import { formatCommercialDueDateCell } from "../lib/commercialDueDateDisplay";

type PurchaseSummaryRow = {
  purchaseOrderId: number;
  purchaseOrderNo: string;
  supplierName: string;
  itemId: number;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  pendingQty: number;
  status: string;
  purchaseDate: string;
};

type PurchaseDeskPayablesPayload = {
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
  exportPending: {
    purchaseBills: Array<{
      id: number;
      billNo: string | null;
      billDate: string;
      netAmount: number;
      supplierName: string;
    }>;
  };
  outstandingSnapshot: {
    totalPayable: number;
    overduePayable: number;
  };
  stats: {
    exportPurchaseCount: number;
  };
};

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

const shell = dashboardShell.page;
const max = dashboardShell.max;
const card = dashboardShell.card;

export function PurchaseDashboardPage() {
  const navigate = useNavigate();
  const liveTick = useErpRefreshTick(["dashboard"], { pollIntervalMs: ERP_DASHBOARD_POLL_MS });
  const [purchaseSummary, setPurchaseSummary] = React.useState<PurchaseSummaryRow[] | null>(null);
  const [procurementPending, setProcurementPending] = React.useState<ProcurementPendingRow[] | null>(null);
  const [payables, setPayables] = React.useState<PurchaseDeskPayablesPayload | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const [summary, procurementRes, accounts] = await Promise.all([
          apiFetch<PurchaseSummaryRow[]>("/api/dashboard/purchase-summary"),
          apiFetch<{ rows: ProcurementPendingRow[] }>("/api/dashboard/procurement-pending"),
          apiFetch<PurchaseDeskPayablesPayload>("/api/dashboard/accounts"),
        ]);
        if (cancelled) return;
        setPurchaseSummary(Array.isArray(summary) ? summary : []);
        setProcurementPending(Array.isArray(procurementRes?.rows) ? procurementRes.rows : []);
        setPayables(accounts);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load purchase desk");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liveTick]);

  const pendingPoLines = purchaseSummary?.length ?? 0;
  const procurementCount = procurementPending?.length ?? 0;
  const payablesCount = payables?.payablesFollowUp?.length ?? 0;
  const exportCount = payables?.stats?.exportPurchaseCount ?? payables?.exportPending?.purchaseBills?.length ?? 0;

  if (loading) {
    return (
      <div className={shell}>
        <PageContainer className={max}>
          <p className="text-sm text-slate-600">Loading purchase desk…</p>
        </PageContainer>
      </div>
    );
  }

  if (err) {
    return (
      <div className={shell}>
        <PageContainer className={max}>
          <p className="text-sm text-red-700">{err}</p>
        </PageContainer>
      </div>
    );
  }

  const allQuiet = pendingPoLines === 0 && procurementCount === 0 && payablesCount === 0 && exportCount === 0;

  return (
    <div className={shell}>
      <PageContainer className={max}>
        <DashboardWorkspaceHeader role="PURCHASE" />

        <div className="mb-2 flex flex-wrap gap-1.5">
          <ErpActionButton tier="primary" className="gap-1.5" onClick={() => navigate("/procurement-planning?source=dashboard")}>
            <ClipboardList className="h-3.5 w-3.5" aria-hidden />
            Procurement workspace
          </ErpActionButton>
          <ErpActionButton tier="secondary" className="gap-1.5" onClick={() => navigate("/rm-po-grn?source=dashboard")}>
            <ShoppingCart className="h-3.5 w-3.5" aria-hidden />
            RM purchase & GRN
          </ErpActionButton>
          <ErpActionButton tier="secondary" className="gap-1.5" onClick={() => navigate("/purchase-bills?source=dashboard")}>
            <Receipt className="h-3.5 w-3.5" aria-hidden />
            Purchase bills
          </ErpActionButton>
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/rm-po-grn?source=dashboard" className={cn(card, "block p-3 no-underline hover:border-sky-300")}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">PO lines pending GRN</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{pendingPoLines}</div>
          </Link>
          <Link to="/procurement-planning?source=dashboard" className={cn(card, "block p-3 no-underline hover:border-sky-300")}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Procurement queue</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{procurementCount}</div>
          </Link>
          <Link to="/purchase-bills?payment=pending" className={cn(card, "block p-3 no-underline hover:border-sky-300")}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Open payables</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{money(payables?.outstandingSnapshot?.totalPayable ?? 0)}</div>
          </Link>
          <Link to="/purchase-bills?source=dashboard" className={cn(card, "block p-3 no-underline hover:border-sky-300")}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tally export pending</div>
            <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{exportCount}</div>
          </Link>
        </div>

        {allQuiet ? <DashboardOpsClearStrip role="PURCHASE" className="mb-3" /> : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <ProcurementPendingDashboardCard rows={procurementPending} loading={false} />

          <Card className={card}>
            <CardHeader className="border-b border-slate-100 p-2.5 pb-2">
              <CardTitle className="flex items-center gap-2 text-[13px] font-extrabold text-slate-950">
                <Package className="h-4 w-4 text-violet-700" aria-hidden />
                PO receipt follow-up
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-2.5 pt-2">
              {!purchaseSummary?.length ? (
                <ErpEmptyState variant="inline" title="No open PO receipt lines" body="Ordered RM awaiting GRN will appear here." />
              ) : (
                purchaseSummary.slice(0, 8).map((row) => (
                  <Link
                    key={`${row.purchaseOrderId}-${row.itemId}`}
                    to={`/rm-po-grn/${row.purchaseOrderId}?source=dashboard`}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-[12px] no-underline hover:border-sky-300 hover:bg-sky-50/40",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900">
                        {row.purchaseOrderNo} · {row.supplierName}
                      </div>
                      <div className="truncate text-slate-600">
                        {row.itemName} · pending {fmtQty(row.pendingQty)}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card className={cn(card, "lg:col-span-2")}>
            <CardHeader className="border-b border-slate-100 p-2.5 pb-2">
              <CardTitle className="flex items-center gap-2 text-[13px] font-extrabold text-slate-950">
                <Receipt className="h-4 w-4 text-emerald-700" aria-hidden />
                Payables follow-up
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2.5 pt-2">
              {!payables?.payablesFollowUp?.length ? (
                <ErpEmptyState variant="inline" title="No outstanding supplier balances" body="Finalized purchase bills with balance due appear here." />
              ) : (
                <div className="overflow-hidden rounded-md border border-slate-200">
                  <table className="erp-table erp-table-dense w-full text-[12px]">
                    <thead>
                      <tr>
                        <th className="text-left">Supplier</th>
                        <th className="text-left">Bill</th>
                        <th className="text-left">Due</th>
                        <th className="text-right">Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payables.payablesFollowUp.slice(0, 10).map((row) => (
                        <tr key={row.id}>
                          <td className="max-w-[8rem] truncate">{row.supplier}</td>
                          <td>
                            <Link to={`/purchase-bills/${row.id}?source=dashboard`} className="font-medium text-sky-800 hover:underline">
                              {row.billNo || `#${row.id}`}
                            </Link>
                          </td>
                          <td>{formatCommercialDueDateCell(row.dueDate)}</td>
                          <td className="text-right tabular-nums font-semibold">{money(row.pendingAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-2 text-right">
                <Link to="/purchase-bills?payment=pending" className="text-[11px] font-semibold text-sky-800 hover:underline">
                  All payables →
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageContainer>
    </div>
  );
}
