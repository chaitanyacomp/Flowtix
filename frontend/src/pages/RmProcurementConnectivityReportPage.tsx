import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Network } from "lucide-react";
import { PageContainer, ReportPageHeader, StickyReportBackStrip } from "../components/PageHeader";
import { ReportFilterToolbar, ReportFilterField } from "../components/erp/ReportChrome";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { apiFetch } from "../services/api";
import { useUrlQueryState } from "../hooks/useUrlQueryState";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { cn } from "../lib/utils";
import {
  buildConnectivityReportQuery,
  connectivityBillHref,
  connectivityBillSummary,
  connectivityGrnHref,
  connectivityPoHref,
  connectivityProcurementHref,
  CONNECTIVITY_RECEIPT_STATUSES,
  CONNECTIVITY_SOURCE_TYPES,
  formatConnectivityQty,
  receiptStatusTone,
  type ConnectivityReportRow,
} from "../lib/procurementConnectivityReportUx";

type Supplier = { id: number; name: string };
type RmItem = { id: number; itemName: string; unit?: string | null };

type ApiResp = {
  total: number;
  rows: ConnectivityReportRow[];
  filters: Record<string, unknown>;
};

function TraceChain({ chain }: { chain: string[] }) {
  if (!chain.length) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-slate-700">
      {chain.map((step, i) => (
        <React.Fragment key={`${step}-${i}`}>
          {i > 0 ? <span className="text-slate-400">→</span> : null}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium">{step}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function RowDetail({ row, returnTo }: { row: ConnectivityReportRow; returnTo: string }) {
  const billLine = row.purchaseBillLines.find((b) => b.purchaseBill?.status === "FINALIZED") ?? row.purchaseBillLines[0];
  return (
    <div className="space-y-3 border-t border-slate-100 bg-slate-50/80 px-3 py-3 text-sm">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Trace chain</p>
        <TraceChain chain={row.traceChain} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">GRN detail</p>
          <p>{row.grnSummary.label}</p>
          {row.grnSummary.reversedGrnNos.length ? (
            <p className="text-xs text-amber-700">Reversed GRNs shown for audit; qty excludes reversed receipts.</p>
          ) : null}
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Stock posted</p>
          <p>{row.stockPosted.label}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Purchase bill</p>
          <p>{connectivityBillSummary(row)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={connectivityPoHref(row)} className="text-xs font-semibold text-primary underline">
            Open PO
          </Link>
          {row.mr?.materialRequirementId ? (
            <Link to={connectivityProcurementHref(row, returnTo)} className="text-xs font-semibold text-primary underline">
              Procurement workspace
            </Link>
          ) : null}
          <Link to={connectivityGrnHref(row)} className="text-xs font-semibold text-primary underline">
            GRN on PO
          </Link>
          {billLine?.purchaseBillId ? (
            <Link to={connectivityBillHref(billLine.purchaseBillId)} className="text-xs font-semibold text-primary underline">
              Purchase bill
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DesktopTable({
  rows,
  expanded,
  onToggle,
  returnTo,
}: {
  rows: ConnectivityReportRow[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  returnTo: string;
}) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[1100px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <th className="w-8 px-2 py-2" />
            <th className="px-2 py-2">Demand source</th>
            <th className="px-2 py-2">MR</th>
            <th className="px-2 py-2">PR</th>
            <th className="px-2 py-2">RM PO</th>
            <th className="px-2 py-2">Supplier</th>
            <th className="px-2 py-2">RM item</th>
            <th className="px-2 py-2 text-right">Ordered</th>
            <th className="px-2 py-2 text-right">Received</th>
            <th className="px-2 py-2 text-right">Pending</th>
            <th className="px-2 py-2">GRN</th>
            <th className="px-2 py-2">Stock</th>
            <th className="px-2 py-2">Bill</th>
            <th className="px-2 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = expanded.has(row.rowKey);
            return (
              <React.Fragment key={row.rowKey}>
                <tr className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-slate-200"
                      aria-expanded={open}
                      onClick={() => onToggle(row.rowKey)}
                    >
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-2 py-2 font-medium text-slate-900">{row.demandSourceLabel}</td>
                  <td className="px-2 py-2">
                    {row.mr?.docNo ? (
                      <Link to={connectivityProcurementHref(row, returnTo)} className="text-primary underline">
                        {row.mr.docNo}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2">{row.pr?.docNo ?? "—"}</td>
                  <td className="px-2 py-2">
                    <Link to={connectivityPoHref(row)} className="font-semibold text-primary underline">
                      {row.rmPoDisplayNo}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{row.supplier?.name ?? "—"}</td>
                  <td className="px-2 py-2">{row.rmItem?.itemName ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatConnectivityQty(row.orderedQty, row.rmItem?.unit)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatConnectivityQty(row.receivedQty, row.rmItem?.unit)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatConnectivityQty(row.pendingQty, row.rmItem?.unit)}
                  </td>
                  <td className="px-2 py-2">
                    <Link to={connectivityGrnHref(row)} className="text-primary underline">
                      {row.grnSummary.activeGrnNos[0] ?? row.grnSummary.label}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{row.stockPosted.posted ? row.stockPosted.label : "Not posted"}</td>
                  <td className="px-2 py-2">{connectivityBillSummary(row)}</td>
                  <td className="px-2 py-2">
                    <span className={cn("rounded border px-2 py-0.5 text-xs font-semibold", receiptStatusTone(row.receiptStatus))}>
                      {row.receiptStatusLabel}
                    </span>
                  </td>
                </tr>
                {open ? (
                  <tr>
                    <td colSpan={14} className="p-0">
                      <RowDetail row={row} returnTo={returnTo} />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MobileCards({
  rows,
  expanded,
  onToggle,
  returnTo,
}: {
  rows: ConnectivityReportRow[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  returnTo: string;
}) {
  return (
    <div className="space-y-3 md:hidden" data-testid="connectivity-report-cards">
      {rows.map((row) => {
        const open = expanded.has(row.rowKey);
        return (
          <Card key={row.rowKey} className="overflow-hidden border-slate-200 shadow-sm">
            <CardContent className="p-0">
              <button
                type="button"
                className="w-full px-3 py-3 text-left"
                onClick={() => onToggle(row.rowKey)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Demand source</p>
                    <p className="font-semibold text-slate-900">{row.demandSourceLabel}</p>
                    <p className="mt-1 text-sm text-slate-700">
                      {row.mr?.docNo ?? "—"} → {row.pr?.docNo ?? "—"} →{" "}
                      <span className="font-semibold">{row.rmPoDisplayNo}</span>
                    </p>
                    <p className="text-sm text-slate-600">
                      {row.rmItem?.itemName} · {row.supplier?.name}
                    </p>
                  </div>
                  <span className={cn("shrink-0 rounded border px-2 py-0.5 text-[10px] font-bold", receiptStatusTone(row.receiptStatus))}>
                    {row.receiptStatusLabel}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
                  <div>
                    <span className="block text-[10px] uppercase text-slate-400">Ordered</span>
                    {formatConnectivityQty(row.orderedQty, row.rmItem?.unit)}
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-slate-400">Received</span>
                    {formatConnectivityQty(row.receivedQty, row.rmItem?.unit)}
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-slate-400">Pending</span>
                    {formatConnectivityQty(row.pendingQty, row.rmItem?.unit)}
                  </div>
                </div>
              </button>
              {open ? <RowDetail row={row} returnTo={returnTo} /> : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function RmProcurementConnectivityReportPage() {
  const { patch, read } = useUrlQueryState({
    sourceType: "",
    rmItemId: "",
    supplierId: "",
    rmPoId: "",
    mrId: "",
    prId: "",
    status: "",
  });

  const filters = {
    sourceType: read.string("sourceType"),
    rmItemId: read.string("rmItemId"),
    supplierId: read.string("supplierId"),
    rmPoId: read.string("rmPoId"),
    mrId: read.string("mrId"),
    prId: read.string("prId"),
    status: read.string("status"),
  };

  const [rows, setRows] = React.useState<ConnectivityReportRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [rmItems, setRmItems] = React.useState<RmItem[]>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [filterTick, setFilterTick] = React.useState(0);
  const liveTick = useErpRefreshTick(["reports", "purchase"], { pollIntervalMs: ERP_REPORT_POLL_MS });
  const returnTo = "/reports/rm-procurement-connectivity";

  React.useEffect(() => {
    apiFetch<Supplier[]>("/api/suppliers").then(setSuppliers).catch(() => setSuppliers([]));
    apiFetch<RmItem[]>("/api/items?type=RM").then(setRmItems).catch(() => setRmItems([]));
  }, [liveTick]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildConnectivityReportQuery(filters);
      const data = await apiFetch<ApiResp>(
        `/api/procurement-trace/connectivity-report${qs ? `?${qs}` : ""}`,
      );
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(Number(data.total) || 0);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : "Failed to load connectivity report");
    } finally {
      setLoading(false);
    }
  }, [filters.sourceType, filters.rmItemId, filters.supplierId, filters.rmPoId, filters.mrId, filters.prId, filters.status, filterTick, liveTick]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const toggleRow = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <PageContainer>
      <StickyReportBackStrip />
      <ReportPageHeader
        title="RM Procurement Connectivity Report"
        subtitle="Line-wise trace from demand source through MR, PR, PO, GRN, stock inward, and purchase bill."
        icon={<Network className="h-5 w-5" />}
      />

      <ReportFilterToolbar>
        <ReportFilterField label="Demand source">
          <select
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={filters.sourceType}
            onChange={(e) => patch({ sourceType: e.target.value })}
          >
            {CONNECTIVITY_SOURCE_TYPES.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="Receipt status">
          <select
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={filters.status}
            onChange={(e) => patch({ status: e.target.value })}
          >
            {CONNECTIVITY_RECEIPT_STATUSES.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="Supplier">
          <select
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={filters.supplierId}
            onChange={(e) => patch({ supplierId: e.target.value })}
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="RM item">
          <select
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={filters.rmItemId}
            onChange={(e) => patch({ rmItemId: e.target.value })}
          >
            <option value="">All RM items</option>
            {rmItems.slice(0, 300).map((it) => (
              <option key={it.id} value={String(it.id)}>
                {it.itemName}
              </option>
            ))}
          </select>
        </ReportFilterField>
        <ReportFilterField label="RM PO id">
          <input
            className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
            value={filters.rmPoId}
            onChange={(e) => patch({ rmPoId: e.target.value })}
            placeholder="e.g. 101"
          />
        </ReportFilterField>
        <ReportFilterField label="MR id">
          <input
            className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
            value={filters.mrId}
            onChange={(e) => patch({ mrId: e.target.value })}
            placeholder="Material requirement id"
          />
        </ReportFilterField>
        <ReportFilterField label="PR id">
          <input
            className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
            value={filters.prId}
            onChange={(e) => patch({ prId: e.target.value })}
            placeholder="Purchase request id"
          />
        </ReportFilterField>
        <div className="flex items-end">
          <Button type="button" variant="outline" size="sm" onClick={() => setFilterTick((t) => t + 1)}>
            Refresh
          </Button>
        </div>
      </ReportFilterToolbar>

      <Card className="border-slate-200">
        <CardContent className="p-0">
          {loading ? (
            <p className="px-4 py-8 text-sm text-slate-500">Loading connectivity report…</p>
          ) : error ? (
            <p className="px-4 py-8 text-sm text-red-600">{error}</p>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center" data-testid="connectivity-report-empty">
              <p className="text-sm font-semibold text-slate-800">No procurement connectivity rows</p>
              <p className="mt-1 text-sm text-slate-500">
                Adjust filters or create RM demand through MR → PR → PO to see trace rows here.
              </p>
            </div>
          ) : (
            <>
              <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
                {total} row{total === 1 ? "" : "s"} · read-only trace
              </p>
              <DesktopTable rows={rows} expanded={expanded} onToggle={toggleRow} returnTo={returnTo} />
              <MobileCards rows={rows} expanded={expanded} onToggle={toggleRow} returnTo={returnTo} />
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
