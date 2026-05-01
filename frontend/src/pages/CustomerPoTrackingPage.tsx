import * as React from "react";
import { apiFetch } from "../services/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { ReportPageHeader } from "../components/PageHeader";
import { cn } from "../lib/utils";

type Customer = { id: number; name: string };

type PoListRow = {
  /** Sales order id (detail API key); legacy bookmarks may still use customer PO id when linked. */
  poKey: number;
  salesOrderId?: number;
  orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY" | null;
  poNumber: string;
  poDate: string;
  requiredDate?: string | null;
  customer: { id: number; name: string };
  orderedQty: number;
  plannedQty: number;
  producedQty: number;
  qcClearedQty: number;
  dispatchedQty: number;
  returnedQty?: number;
  netDeliveredQty?: number;
  balanceQty: number;
  status: "Pending" | "In Process" | "Partly Delivered" | "Delivered";
  lastActivityDate?: string | null;
};

type JourneyStage = {
  name: string;
  qty: number;
  done: boolean;
  lastAt: string | null;
  state: "completed" | "in_progress" | "not_started" | "not_required" | "exception";
};

type PoDetail = {
  header: {
    poKey: number;
    salesOrderId?: number;
    orderType?: "NORMAL" | "REPLACEMENT" | "NO_QTY" | null;
    poNumber: string;
    poDate: string;
    requiredDate?: string | null;
    customer: { id: number; name: string };
    status: string;
  };
  summaryCards: {
    orderedQty: number;
    plannedQty: number;
    producedQty: number;
    qcClearedQty: number;
    dispatchedQty: number;
    returnedQty?: number;
    netDeliveredQty?: number;
    balanceQty: number;
  };
  journey: JourneyStage[];
  items: Array<{
    itemId: number;
    itemName: string;
    poQty: number;
    soQty: number;
    plannedQty: number;
    producedQty: number;
    qcClearedQty: number;
    dispatchedQty: number;
    returnedQty?: number;
    netDeliveredQty?: number;
    balanceQty: number;
    status: string;
    detail: {
      ordered: number;
      planned: number;
      produced: number;
      qcCleared: number;
      dispatched: number;
      returned?: number;
      netDelivered?: number;
      remainingToDeliver: number;
      salesOrderNo: string | null;
      workOrders: Array<{
        workOrderId: number;
        status: string;
        lines: Array<{
          workOrderLineId: number;
          requiredQty: number;
          plannedQty: number;
          approvedProducedQty: number;
        }>;
      }>;
    };
  }>;
  dispatchHistory: Array<{
    type?: "DISPATCH" | "RETURN" | "REVERSAL";
    dispatchNo: string;
    date: string;
    itemId: number;
    itemName: string;
    qty: number;
    vehicleOrRefNo: string | null;
    remarks: string | null;
  }>;
  exceptions: string[];
};

type ListResponse = { rows: PoListRow[]; hasMore: boolean; limit: number };

type DateRangeKey = "THIS_MONTH" | "LAST_30" | "LAST_90" | "TODAY";

function toIsoDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function badgeForStatus(s: string) {
  if (s === "Delivered") return <Badge variant="success">Delivered</Badge>;
  if (s === "Partly Delivered") return <Badge variant="warning">Partly Delivered</Badge>;
  if (s === "In Process") return <Badge variant="default">In Process</Badge>;
  return <Badge variant="info">Pending</Badge>;
}

function stagePill(stage: JourneyStage) {
  const base = "rounded-md border px-2 py-1 text-xs";
  if (stage.state === "completed") return <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-900`}>Done</span>;
  if (stage.state === "in_progress") return <span className={`${base} border-amber-200 bg-amber-50 text-amber-900`}>In progress</span>;
  if (stage.state === "exception") return <span className={`${base} border-red-200 bg-red-50 text-red-900`}>Attention</span>;
  if (stage.state === "not_required") return <span className={`${base} border-slate-200 bg-slate-50 text-slate-700`}>Not required</span>;
  return <span className={`${base} border-slate-200 bg-slate-50 text-slate-700`}>Not started</span>;
}

export function CustomerPoTrackingPage() {
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = React.useState("");
  const [customerId, setCustomerId] = React.useState(0);

  const [dateRange, setDateRange] = React.useState<DateRangeKey>("THIS_MONTH");
  const [dateFrom, setDateFrom] = React.useState(() => toIsoDateInput(startOfMonth(new Date())));
  const [dateTo, setDateTo] = React.useState(() => toIsoDateInput(new Date()));

  const [status, setStatus] = React.useState<"All" | "Pending" | "In Process" | "Partly Delivered" | "Delivered">("All");
  const [poSearch, setPoSearch] = React.useState("");

  const [loadingList, setLoadingList] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);
  const [poRows, setPoRows] = React.useState<PoListRow[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [limit, setLimit] = React.useState(50);

  const [selectedPoKey, setSelectedPoKey] = React.useState<number | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<PoDetail | null>(null);

  // (was used for a small header suffix; removed to avoid unused var)

  const customerOptions = React.useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    const list = Array.isArray(customers) ? customers : [];
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, customerSearch]);

  React.useEffect(() => {
    apiFetch<Customer[]>("/api/customers")
      .then((c) => setCustomers(Array.isArray(c) ? c : []))
      .catch(() => setCustomers([]));
  }, []);

  React.useEffect(() => {
    const now = new Date();
    if (dateRange === "TODAY") {
      const s = toIsoDateInput(now);
      setDateFrom(s);
      setDateTo(s);
      return;
    }
    if (dateRange === "THIS_MONTH") {
      setDateFrom(toIsoDateInput(startOfMonth(now)));
      setDateTo(toIsoDateInput(now));
      return;
    }
    if (dateRange === "LAST_30") {
      setDateFrom(toIsoDateInput(new Date(Date.now() - 30 * 24 * 3600 * 1000)));
      setDateTo(toIsoDateInput(now));
      return;
    }
    if (dateRange === "LAST_90") {
      setDateFrom(toIsoDateInput(new Date(Date.now() - 90 * 24 * 3600 * 1000)));
      setDateTo(toIsoDateInput(now));
    }
  }, [dateRange]);

  async function loadPoList(nextLimit: number) {
    if (!customerId) {
      setPoRows([]);
      setHasMore(false);
      setLimit(nextLimit);
      return;
    }
    setLoadingList(true);
    setListError(null);
    setSelectedPoKey(null);
    setDetail(null);
    setDetailError(null);
    setLimit(nextLimit);
    try {
      const qs = new URLSearchParams();
      qs.set("customerId", String(customerId));
      if (status !== "All") qs.set("status", status);
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      if (poSearch.trim()) qs.set("poSearch", poSearch.trim());
      qs.set("limit", String(nextLimit));
      const data = await apiFetch<ListResponse>(`/api/customer-po-tracking?${qs.toString()}`);
      setPoRows(Array.isArray(data?.rows) ? data.rows : []);
      setHasMore(Boolean(data?.hasMore));
    } catch (e) {
      setPoRows([]);
      setHasMore(false);
      setListError("Could not load customer PO tracking.");
    } finally {
      setLoadingList(false);
    }
  }

  /** Server applies poSearch; keep client filter as a quick narrow on the loaded page. */
  const visiblePoRows = React.useMemo(() => {
    const base = (poRows || []).filter((r) => r.orderType !== "NO_QTY");
    const q = poSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => (r.poNumber || "").toLowerCase().includes(q));
  }, [poRows, poSearch]);

  const customerSummary = React.useMemo(() => {
    const rows = visiblePoRows || [];
    const sum = (key: keyof Pick<
      PoListRow,
      "orderedQty" | "producedQty" | "qcClearedQty" | "dispatchedQty" | "balanceQty"
    >) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);
    return {
      totalOrders: rows.length,
      totalOrderedQty: sum("orderedQty"),
      totalProducedQty: sum("producedQty"),
      totalQcClearedQty: sum("qcClearedQty"),
      totalDispatchedQty: sum("dispatchedQty"),
      pendingQty: sum("balanceQty"),
    };
  }, [visiblePoRows]);

  React.useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      loadPoList(50).catch(() => {
        if (!cancelled) setListError("Could not load customer PO tracking.");
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [customerId, dateFrom, dateTo, status, poSearch]);

  async function loadDetail(poKey: number) {
    setSelectedPoKey(poKey);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const data = await apiFetch<PoDetail>(`/api/customer-po-tracking/${poKey}`);
      setDetail(data);
    } catch {
      setDetailError("Could not load PO details. Please refresh and try again.");
    } finally {
      setDetailLoading(false);
    }
  }

  const rightIdentity = React.useMemo(() => {
    if (!detail) return null;
    const orderRef = detail.header.poNumber;
    const customerName = detail.header.customer.name;
    const dateLabel = detail.header.poDate ? new Date(detail.header.poDate).toLocaleDateString() : "—";
    const orderType = detail.header.orderType ?? null;
    return { orderRef, customerName, dateLabel, orderType };
  }, [detail]);

  const rightFlow = React.useMemo(() => {
    if (!detail) return null;
    const sum = detail.summaryCards;
    const dispatched = Number(sum.dispatchedQty || 0);
    const planned = Number(sum.plannedQty || 0);
    const produced = Number(sum.producedQty || 0);
    const qc = Number(sum.qcClearedQty || 0);
    const directFromStock = dispatched > 0 && planned <= 0 && produced <= 0 && qc <= 0;

    const stages = Array.isArray(detail.journey) ? detail.journey : [];
    if (!directFromStock) return { directFromStock, stages };

    const mapped = stages.map((s) => {
      if (["Production Plan", "Production Done", "QC Cleared"].includes(s.name)) {
        return { ...s, state: "not_required" as const, done: true };
      }
      return s;
    });
    return { directFromStock, stages: mapped };
  }, [detail]);

  const deliveryNumbers = React.useMemo(() => {
    if (!detail) return null;
    const history = Array.isArray(detail.dispatchHistory) ? detail.dispatchHistory : [];
    // Safety: dispatchHistory is a *display* feed and may be incomplete (pagination/filtering/joins).
    // Summary cards must remain correct even if history is partial, so prefer backend summary totals.
    const payloadGrossDispatch = Number(detail.summaryCards.dispatchedQty || 0);
    const payloadCustomerReturnAbs = Math.abs(Number(detail.summaryCards.returnedQty || 0));
    const payloadNetDelivered =
      detail.summaryCards.netDeliveredQty != null
        ? Number(detail.summaryCards.netDeliveredQty || 0)
        : payloadGrossDispatch - payloadCustomerReturnAbs;

    // If backend doesn't provide net/return (legacy), compute a best-effort from history.
    const historyGrossDispatch = history
      .filter((h) => (h.type ?? "DISPATCH") === "DISPATCH")
      .reduce((s, h) => s + Math.max(0, Number(h.qty || 0)), 0);
    const historyReversals = history
      .filter((h) => (h.type ?? "") === "REVERSAL")
      .reduce((s, h) => s + Math.min(0, Number(h.qty || 0)), 0); // negative
    const historyCustomerReturn = history
      .filter((h) => (h.type ?? "") === "RETURN")
      .reduce((s, h) => s + Math.min(0, Number(h.qty || 0)), 0); // negative
    const historyNetDelivered = historyGrossDispatch + historyReversals + historyCustomerReturn;

    const useHistory =
      (detail.summaryCards.returnedQty == null && detail.summaryCards.netDeliveredQty == null) && history.length > 0;

    const grossDispatch = useHistory ? historyGrossDispatch : payloadGrossDispatch;
    const customerReturnAbs = useHistory ? Math.abs(historyCustomerReturn) : payloadCustomerReturnAbs;
    const netDelivered = useHistory ? Math.max(0, historyNetDelivered) : Math.max(0, payloadNetDelivered);

    const ordered = Number(detail.summaryCards.orderedQty || 0);
    const pendingRegular = Math.max(0, ordered - netDelivered);

    return {
      grossDispatch,
      customerReturnAbs,
      netDelivered,
      pendingRegular,
    };
  }, [detail]);

  const derivedJourney = React.useMemo<JourneyStage[] | null>(() => {
    if (!detail || !deliveryNumbers) return null;

    const planned = Number(detail.summaryCards.plannedQty || 0);
    const produced = Number(detail.summaryCards.producedQty || 0);
    const qc = Number(detail.summaryCards.qcClearedQty || 0);
    const netDelivered = Number(deliveryNumbers.netDelivered || 0);
    const ordered = Number(detail.summaryCards.orderedQty || 0);

    const directFromStock = produced <= 0 && qc <= 0 && netDelivered > 0;

    const stage = (name: JourneyStage["name"], qty: number, done: boolean, lastAt: string | null, state: JourneyStage["state"]) => ({
      name,
      qty,
      done,
      lastAt,
      state,
    });

    const base = Array.isArray(detail.journey) ? detail.journey : [];
    const byName = new Map(base.map((s) => [s.name, s]));
    const pickLastAt = (name: string) => byName.get(name)?.lastAt ?? null;

    const productionState: JourneyStage["state"] =
      directFromStock ? "not_required" : planned > 0 ? (produced >= planned ? "completed" : produced > 0 ? "in_progress" : "not_started") : "not_started";
    const qcState: JourneyStage["state"] =
      directFromStock ? "not_required" : qc > 0 ? (planned > 0 && qc >= planned ? "completed" : "in_progress") : "not_started";

    const dispatchBaseline = ordered;
    const dispatchState: JourneyStage["state"] =
      netDelivered <= 0 ? "not_started" : dispatchBaseline > 0 && netDelivered >= dispatchBaseline ? "completed" : "in_progress";

    return [
      stage("Order / PO recorded", ordered, true, pickLastAt("Order / PO recorded"), "completed"),
      stage("Sales Order", ordered, true, pickLastAt("Sales Order"), "completed"),
      stage("Production Plan", planned, planned > 0 && produced >= planned, pickLastAt("Production Plan"), productionState),
      stage("QC Cleared", qc, qc > 0 && planned > 0 && qc >= planned, pickLastAt("QC Cleared"), qcState),
      stage("Dispatch", netDelivered, netDelivered > 0 && dispatchBaseline > 0 && netDelivered >= dispatchBaseline, pickLastAt("Dispatch"), dispatchState),
      stage("Delivered", netDelivered, netDelivered > 0 && dispatchBaseline > 0 && netDelivered >= dispatchBaseline, pickLastAt("Delivered"), dispatchState),
    ];
  }, [detail, deliveryNumbers]);

  const visibleExceptions = React.useMemo(() => {
    if (!detail) return [];
    if (!deliveryNumbers) return [];

    // Hide when nothing is pending / actionable.
    if (deliveryNumbers.pendingRegular <= 1e-9) return [];

    return [`${Math.round(deliveryNumbers.pendingRegular * 1000) / 1000} pending to deliver (Ordered − Net Delivered)`];
  }, [detail, deliveryNumbers]);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-3 px-1 sm:px-0">
      <DemoFlowBanner />
      <ReportPageHeader
        title="Customer Tracking Report"
        purpose="Shows the full customer order journey from order to dispatch, billing, return, and replacement."
      />

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50/80 p-3 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="grid gap-1 text-xs font-medium text-slate-600">Customer (search)</div>
              <Input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Type customer name…" />
              <div className="mt-2">
                <select
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                  value={customerId || ""}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    setCustomerId(v);
                  }}
                >
                  <option value="">Select customer</option>
                  {customerOptions.slice(0, 50).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {customerOptions.length > 50 ? (
                  <div className="mt-1 text-[11px] text-slate-500">Showing first 50 matches. Keep typing to narrow.</div>
                ) : null}
              </div>
            </div>

            <label className="grid gap-1 text-xs font-medium text-slate-600 lg:col-span-2">
              Date range
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
              >
                <option value="THIS_MONTH">This Month</option>
                <option value="LAST_30">Last 30 Days</option>
                <option value="LAST_90">Last 90 Days</option>
                <option value="TODAY">Today</option>
              </select>
            </label>

            <label className="grid gap-1 text-xs font-medium text-slate-600 lg:col-span-2">
              From
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600 lg:col-span-2">
              To
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>

            <label className="grid gap-1 text-xs font-medium text-slate-600 lg:col-span-1">
              Status
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="All">All</option>
                <option value="Pending">Pending</option>
                <option value="In Process">In Process</option>
                <option value="Partly Delivered">Partly Delivered</option>
                <option value="Delivered">Delivered</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-xs font-medium text-slate-600 md:col-span-2">
              Order ref / PO No (optional)
              <Input
                value={poSearch}
                onChange={(e) => setPoSearch(e.target.value)}
                placeholder={customerId ? "SO no., customer PO ref, or PO number…" : "Select a customer first"}
                disabled={!customerId}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,42%)_minmax(0,58%)] gap-6 items-start">
        <Card className="min-w-0 border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Customer Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!customerId ? <p className="text-sm text-slate-600">Select a customer to load PO list.</p> : null}
            {customerId ? (
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  ["Total rows", customerSummary.totalOrders],
                  ["Total Ordered Qty", customerSummary.totalOrderedQty],
                  ["Total Produced Qty", customerSummary.totalProducedQty],
                  ["Total QC Cleared Qty", customerSummary.totalQcClearedQty],
                  ["Total Dispatched Qty", customerSummary.totalDispatchedQty],
                  ["Pending Qty", customerSummary.pendingQty],
                ].map(([label, val]) => (
                  <div key={label} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="text-xs font-medium text-slate-600">{label}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{val as number}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {customerId && poRows.length ? (
              <div className="text-xs text-slate-500">
                Showing latest {limit} records. Load more if needed.
                {hasMore ? " (Summary is based on loaded records.)" : ""}
              </div>
            ) : null}
            {listError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{listError}</div> : null}
            {customerId && !loadingList && !visiblePoRows.length && !listError ? (
              <p className="text-sm text-slate-600">No customer orders found for this customer and filters.</p>
            ) : null}
            <div className="space-y-2">
              {visiblePoRows.map((r) => (
                <button
                  key={r.poKey}
                  type="button"
                  onClick={() => loadDetail(r.poKey)}
                  className={[
                    "w-full rounded-md border p-3 text-left transition-colors cursor-pointer",
                    "focus:outline-none focus:ring-2 focus:ring-primary/25",
                    selectedPoKey === r.poKey
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70",
                  ].join(" ")}
                  aria-current={selectedPoKey === r.poKey ? "true" : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 truncate text-sm font-medium text-slate-900">{r.poNumber}</div>
                        {selectedPoKey === r.poKey ? (
                          <Badge variant="default" className="rounded-full px-2 py-0.5 text-[10px] font-semibold">
                            Viewing
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-600">
                        Order / PO date: {r.poDate ? new Date(r.poDate).toLocaleDateString() : "—"}
                        {r.requiredDate ? ` · Required: ${new Date(r.requiredDate).toLocaleDateString()}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        Ordered <span className="tabular-nums">{r.orderedQty}</span> · Dispatched{" "}
                        <span className="tabular-nums">{r.dispatchedQty}</span>
                        {Number(r.returnedQty ?? 0) > 0 ? (
                          <>
                            {" "}· Returned <span className="tabular-nums">{r.returnedQty}</span>
                          </>
                        ) : null}
                        {" "}· Net Delivered{" "}
                        <span className="tabular-nums">{r.netDeliveredQty ?? r.dispatchedQty}</span> · Balance{" "}
                        <span className="tabular-nums">{r.balanceQty}</span>
                      </div>
                    </div>
                    <div className="shrink-0">{badgeForStatus(r.status)}</div>
                  </div>
                </button>
              ))}
            </div>
            {customerId && hasMore ? (
              <div className="pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadPoList(limit + 50)}
                  disabled={loadingList}
                >
                  {loadingList ? "Loading…" : "Load More"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6">
          {!selectedPoKey ? (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">PO Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600">Select an order on the left to see full tracking.</p>
              </CardContent>
            </Card>
          ) : detailLoading ? (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">PO Tracking</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-600">Loading order details…</CardContent>
            </Card>
          ) : detailError ? (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">PO Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{detailError}</div>
              </CardContent>
            </Card>
          ) : detail ? (
            <>
              <section className="rounded-2xl border bg-white p-5 shadow-sm min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Selected Order Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{rightIdentity?.orderRef}</div>
                      <div className="mt-0.5 text-xs text-slate-600">
                        {rightIdentity?.customerName} · Date: {rightIdentity?.dateLabel}
                        {rightIdentity?.orderType ? (
                          <span className="text-slate-400"> · </span>
                        ) : null}
                        {rightIdentity?.orderType ? (
                          <Badge variant="default" className="rounded-full px-2 py-0.5 text-[10px] font-semibold">
                            {rightIdentity.orderType === "NORMAL" ? "Regular" : rightIdentity.orderType}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        Showing details for this order
                      </div>
                    </div>
                    <div className="shrink-0">{badgeForStatus(detail.header.status)}</div>
                  </div>
                </CardContent>
              </section>

              <section className="rounded-2xl border bg-white p-5 shadow-sm min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 min-w-0">
                    {[
                      ["Ordered Qty", detail.summaryCards.orderedQty],
                      ["Planned Qty", detail.summaryCards.plannedQty],
                      ["Produced Qty", detail.summaryCards.producedQty],
                      ["Gross Dispatch", deliveryNumbers?.grossDispatch ?? 0],
                      ["Customer Return", deliveryNumbers?.customerReturnAbs ?? 0],
                      ["Net Delivered", deliveryNumbers?.netDelivered ?? (detail.summaryCards.netDeliveredQty ?? 0)],
                    ].map(([label, val]) => (
                      <div key={label} className="rounded-md border border-slate-200 bg-white p-3">
                        <div className="text-xs font-medium text-slate-600">{label}</div>
                        <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{val as number}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-500">Net Delivered = Gross Dispatch − Customer Return</div>
                </CardContent>
              </section>

              <section className="rounded-2xl border bg-white p-5 shadow-sm min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Order Progress Flow</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 min-w-0">
                    {(derivedJourney ?? rightFlow?.stages ?? detail.journey).map((s) => (
                      <div key={s.name} className="rounded-md border border-slate-200 bg-white p-2">
                        <div className="text-xs font-medium text-slate-900">{s.name}</div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <div className="text-xs tabular-nums text-slate-700">
                            {s.name === "QC Cleared" && Number(detail.summaryCards.plannedQty || 0) > 0 && Number(detail.summaryCards.qcClearedQty || 0) > 0
                              ? `${Number(detail.summaryCards.qcClearedQty || 0)} / ${Number(detail.summaryCards.plannedQty || 0)}`
                              : s.qty}
                          </div>
                          {stagePill(s)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {s.lastAt ? `Updated: ${new Date(s.lastAt).toLocaleDateString()}` : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </section>

              <section className="rounded-2xl border bg-white p-5 shadow-sm min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Line items &amp; progress</CardTitle>
                  <p className="text-xs font-normal text-slate-500">
                    One card per ordered item — key quantities first; open work order details when you need line-level context.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {detail.items.map((r) => (
                    <div key={r.itemId} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200/90 pb-2">
                        <div className="min-w-0 text-sm font-semibold leading-snug text-slate-900">{r.itemName}</div>
                        <div className="shrink-0">{badgeForStatus(r.status)}</div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
                        {(
                          [
                            ["PO qty", r.poQty],
                            ["SO qty", r.soQty],
                            ["Planned", r.plannedQty],
                            ["Produced", r.producedQty],
                            ["QC cleared", r.qcClearedQty],
                            ["Gross dispatch", r.dispatchedQty],
                            ["Return", r.returnedQty ?? 0],
                            [
                              "Net delivered",
                              r.netDeliveredQty ?? Number(r.dispatchedQty || 0) - Number(r.returnedQty || 0),
                            ],
                            ["Balance", r.balanceQty],
                          ] as const
                        ).map(([label, val]) => (
                          <div key={label}>
                            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                            <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{val}</dd>
                          </div>
                        ))}
                      </dl>
                      {r.detail.workOrders.length ? (
                        <details className="mt-3 rounded-md border border-slate-200 bg-white p-2">
                          <summary className="cursor-pointer text-xs font-medium text-slate-700">Work order details</summary>
                          <div className="mt-2 space-y-2 text-xs text-slate-800">
                            <div className="text-slate-600">Sales Order: {r.detail.salesOrderNo ?? "—"}</div>
                            {r.detail.workOrders.map((w) => (
                              <div key={w.workOrderId} className="rounded-md border border-slate-100 p-2">
                                <div className="font-medium text-slate-900">
                                  WO-{w.workOrderId} · {w.status}
                                </div>
                                <div className="mt-1 space-y-1 text-slate-700">
                                  {w.lines.map((ln) => (
                                    <div key={ln.workOrderLineId} className="flex flex-wrap gap-x-3 gap-y-1">
                                      <span className="font-mono text-[11px]">Line {ln.workOrderLineId}</span>
                                      <span>Required {ln.requiredQty}</span>
                                      <span>Target {ln.plannedQty}</span>
                                      <span>Produced {ln.approvedProducedQty}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </section>

              {detail.dispatchHistory.length ? (
                <section className="rounded-2xl border bg-white p-5 shadow-sm min-w-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Dispatch History</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detail.dispatchHistory.map((d) => (
                      <div
                        key={`${d.dispatchNo}-${d.date}-${d.itemId}`}
                        className={cn(
                          "rounded-lg border p-3 text-sm shadow-sm",
                          d.type === "RETURN" || d.type === "REVERSAL"
                            ? "border-amber-200 bg-amber-50/30"
                            : "border-slate-200 bg-white",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            {d.type === "RETURN" || d.type === "REVERSAL" ? (
                              <Badge variant="warning" className="rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                Return / reversal
                              </Badge>
                            ) : (
                              <Badge variant="success" className="rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                Dispatch
                              </Badge>
                            )}
                            <span className="font-mono text-xs text-slate-900">{d.dispatchNo}</span>
                            <span className="text-xs text-slate-500">{d.date ? new Date(d.date).toLocaleDateString() : "—"}</span>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 tabular-nums text-sm font-semibold",
                              d.qty < 0 ? "text-amber-900" : "text-slate-800",
                            )}
                          >
                            Qty {d.qty < 0 ? `−${Math.abs(d.qty)}` : d.qty}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-slate-800">
                          <span className="font-medium text-slate-700">Item:</span> {d.itemName}
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                          <div className="min-w-0 break-words">
                            <span className="font-medium text-slate-700">Vehicle / ref:</span> {d.vehicleOrRefNo ?? "—"}
                          </div>
                          <div className="min-w-0 break-words">
                            <span className="font-medium text-slate-700">Remarks:</span> {d.remarks ?? "—"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </section>
              ) : null}

              {visibleExceptions.length ? (
                <section className="rounded-2xl border bg-white p-5 shadow-sm min-w-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Exceptions / Next Actions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-inside list-disc text-sm text-slate-800">
                      {visibleExceptions.map((m, idx) => (
                        <li key={idx}>{m}</li>
                      ))}
                    </ul>
                  </CardContent>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

