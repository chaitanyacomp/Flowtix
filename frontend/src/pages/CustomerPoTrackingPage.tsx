import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../services/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button, buttonVariants } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { DemoFlowBanner } from "../components/demo/DemoFlowBanner";
import { ReportPageHeader, PageContainer } from "../components/PageHeader";
import { cn } from "../lib/utils";
import { useAuth } from "../hooks/useAuth";
import { NativeSelect } from "../components/ui/native-select";
import { ReportFilterToolbar, ReportFilterField } from "../components/erp/ReportChrome";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";

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
  /** Batch QC pending total; matches QC queue (`withoutQc`) for this SO. */
  qcPendingQty?: number;
  dispatchedQty: number;
  returnedQty?: number;
  netDeliveredQty?: number;
  balanceQty: number;
  status: "Pending" | "In Process" | "Partly Delivered" | "Delivered" | "Completed";
  lastActivityDate?: string | null;
  /** REGULAR (NORMAL) SO: finalized sales bill on a dispatch for this order. */
  isCommerciallyClosed?: boolean;
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
    /** REGULAR (NORMAL) SO: at least one finalized sales bill; order is commercially complete. */
    isCommerciallyClosed?: boolean;
  };
  summaryCards: {
    orderedQty: number;
    plannedQty: number;
    producedQty: number;
    qcClearedQty: number;
    qcPendingQty?: number;
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
    qcPendingQty?: number;
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
      qcPendingBatch?: number;
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
  /** Present for NORMAL (regular) SO detail: dispatch-from-stock vs real batch QC queue. */
  regularDispatchGuidance?: {
    qtyPendingToDeliver: number;
    dispatchableNowTotal: number;
    realQcBatchPendingQty: number;
    productionInProgress: boolean;
    workOrderBacklog: boolean;
  } | null;
};

type ListResponse = { rows: PoListRow[]; hasMore: boolean; limit: number };

type DateRangeKey = "ALL_DATES" | "THIS_MONTH" | "LAST_30" | "LAST_90" | "TODAY";

function netDeliveredForListRow(r: PoListRow): number {
  if (r.netDeliveredQty != null) return Number(r.netDeliveredQty);
  return Math.max(0, Number(r.dispatchedQty || 0) - Number(r.returnedQty || 0));
}

function qtyPendingToDeliver(orderedQty: number, netDeliveredQty: number): number {
  return Math.max(0, orderedQty - netDeliveredQty);
}

type TrackingCta = { label: string; to: string };

type TrackingCtaPair = { primary: TrackingCta; secondary: TrackingCta | null };

const TRACKING_FROM = "customer-tracking";

function trackingWithSo(salesOrderId: number, path: string): string {
  return `${path}?salesOrderId=${encodeURIComponent(String(salesOrderId))}&from=${encodeURIComponent(TRACKING_FROM)}`;
}

function mapTrackingCtasForAccountsRole(
  pair: TrackingCtaPair | null,
  role: string | undefined,
  salesOrderId: number,
): TrackingCtaPair | null {
  if (!pair || role !== "ACCOUNTS") return pair;
  const salesBills = `/sales-bills?salesOrderId=${encodeURIComponent(String(salesOrderId))}&from=${encodeURIComponent(TRACKING_FROM)}`;
  const dispatch = `/dispatch?salesOrderId=${encodeURIComponent(String(salesOrderId))}&from=${encodeURIComponent(TRACKING_FROM)}`;

  function mapOne(cta: TrackingCta): TrackingCta {
    const url = cta.to;
    if (url.includes("/sales-orders")) return { label: "Sales bills & payment", to: salesBills };
    if (url.includes("/work-orders")) return { label: "Billing context (SO)", to: salesBills };
    if (url.includes("/rm-check") || url.includes("/work-orders/prepare")) return { label: "Billing context (SO)", to: salesBills };
    if (url.includes("/production")) return { label: "Dispatch (read-only)", to: dispatch };
    if (url.includes("/qc-entry")) return { label: "Dispatch / logistics", to: dispatch };
    return cta;
  }

  return {
    primary: mapOne(pair.primary),
    secondary: pair.secondary ? mapOne(pair.secondary) : null,
  };
}

/**
 * Regular (NORMAL) SO: dispatch from usable stock is not blocked by legacy produced−QC math.
 * Priority: Dispatch (stock-backed) → real batch QC queue → Production in progress →
 * RM check / WO planning for pending shortfall (same entry as Sales Orders “Create Work Order”) → View SO.
 */
function resolveRegularNormalNextCtas(
  detail: PoDetail,
  pendingDeliverQty: number,
  g: NonNullable<PoDetail["regularDispatchGuidance"]>,
): TrackingCtaPair | null {
  if (pendingDeliverQty <= 1e-9) return null;

  const sid = detail.header.salesOrderId ?? detail.header.poKey;
  const withSo = (path: string) => trackingWithSo(sid, path);
  const viewSo: TrackingCta = {
    label: "View Sales Order",
    to: `/sales-orders?salesOrderId=${encodeURIComponent(String(sid))}&from=${encodeURIComponent(TRACKING_FROM)}`,
  };

  const shortfallQtyRounded = Math.round(pendingDeliverQty * 1000) / 1000;
  const rmCheckShortfallHref = `/work-orders/prepare?${new URLSearchParams({
    salesOrderId: String(sid),
    shortfallQty: String(shortfallQtyRounded),
    from: TRACKING_FROM,
  }).toString()}`;

  const needsShortfallProduction =
    g.dispatchableNowTotal <= 1e-6 &&
    g.realQcBatchPendingQty <= 1e-6 &&
    !g.productionInProgress &&
    pendingDeliverQty > 1e-6;

  let primary: TrackingCta;
  let secondary: TrackingCta | null = null;

  if (g.dispatchableNowTotal > 1e-6) {
    const remainder = pendingDeliverQty - g.dispatchableNowTotal;
    if (remainder > 1e-6) {
      const rQ = Math.round(remainder * 1000) / 1000;
      primary = {
        label: "Go to Dispatch",
        to: `/dispatch?${new URLSearchParams({
          salesOrderId: String(sid),
          from: TRACKING_FROM,
          mode: "partial",
        }).toString()}`,
      };
      secondary = {
        label: "Produce remainder, dispatch later",
        to: `/work-orders?${new URLSearchParams({
          salesOrderId: String(sid),
          shortfallQty: String(rQ),
          from: TRACKING_FROM,
        }).toString()}`,
      };
    } else {
      primary = { label: "Go to Dispatch", to: withSo("/dispatch") };
      secondary = viewSo;
    }
  } else if (g.realQcBatchPendingQty > 1e-6) {
    primary = { label: "Go to QC", to: withSo("/qc-entry") };
  } else if (g.productionInProgress) {
    primary = { label: "Go to Production", to: withSo("/production") };
  } else if (needsShortfallProduction) {
    /** Same entry as Sales Orders “WO_PENDING” → RM check before work order. */
    primary = { label: "Create Work Order for Pending Qty", to: rmCheckShortfallHref };
  } else {
    primary = viewSo;
  }

  if (secondary == null && primary.to !== viewSo.to) {
    secondary = viewSo;
  }
  return { primary, secondary };
}

/**
 * Next-step links for non–regular-SO flows (e.g. REPLACEMENT). Does not infer billing.
 */
function resolvePendingDeliveryCtas(detail: PoDetail, pendingDeliverQty: number): TrackingCtaPair | null {
  if (pendingDeliverQty <= 1e-9) return null;

  const sid = detail.header.salesOrderId ?? detail.header.poKey;
  const withSo = (path: string) => trackingWithSo(sid, path);
  const viewSo: TrackingCta = {
    label: "View Sales Order",
    to: `/sales-orders?salesOrderId=${encodeURIComponent(String(sid))}&from=${encodeURIComponent(TRACKING_FROM)}`,
  };

  const planned = Number(detail.summaryCards.plannedQty || 0);
  const produced = Number(detail.summaryCards.producedQty || 0);
  const qc = Number(detail.summaryCards.qcClearedQty || 0);
  const qcPendingOrder =
    detail.summaryCards.qcPendingQty != null
      ? Number(detail.summaryCards.qcPendingQty)
      : Math.max(0, produced - qc);

  const prodPending = Math.max(0, planned - produced);
  const qcPending = qcPendingOrder;

  let primary: TrackingCta;
  if (prodPending > 1e-6) {
    primary = { label: "Go to Work Order", to: withSo("/work-orders") };
  } else if (qcPending > 1e-6) {
    primary = { label: "Go to QC", to: withSo("/qc-entry") };
  } else if (pendingDeliverQty > 1e-6) {
    primary = { label: "Go to Dispatch", to: withSo("/dispatch") };
  } else {
    primary = viewSo;
  }

  const secondary = primary.to === viewSo.to ? null : viewSo;
  return { primary, secondary };
}

function regularNormalExceptionLeadCopy(pending: number, g: NonNullable<PoDetail["regularDispatchGuidance"]>): string {
  const p = Math.round(pending * 1000) / 1000;
  if (g.dispatchableNowTotal > 1e-6) {
    return `${p} Qty pending to deliver. Stock is available. Dispatch can be created now.`;
  }
  if (g.realQcBatchPendingQty > 1e-6) {
    return `${p} Qty pending to deliver. Production output is waiting for QC.`;
  }
  return `${p} Qty pending to deliver. No dispatchable stock is available. Create production for pending qty.`;
}

/** Hide backend QC/dispatch-pool lines for NORMAL when stock-backed dispatch makes them misleading. */
function filterExceptionsForRegularNormal(detail: PoDetail): string[] {
  const raw = Array.isArray(detail.exceptions) ? detail.exceptions : [];
  if (detail.header.orderType !== "NORMAL" || !detail.regularDispatchGuidance) return raw;
  const g = detail.regularDispatchGuidance;
  return raw.filter((m) => {
    if (g.dispatchableNowTotal > 1e-6) {
      if (/waiting for QC/i.test(m)) return false;
      if (/ready for dispatch/i.test(m)) return false;
    }
    if (g.dispatchableNowTotal <= 1e-6 && g.realQcBatchPendingQty <= 1e-6 && /waiting for QC/i.test(m)) return false;
    return true;
  });
}

function toIsoDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function badgeForStatus(s: string) {
  if (s === "Completed") return <Badge variant="success">Completed</Badge>;
  if (s === "Delivered") return <Badge variant="success">Delivered</Badge>;
  if (s === "Partly Delivered") return <Badge variant="warning">Partly Delivered</Badge>;
  if (s === "In Process") return <Badge variant="default">In Process</Badge>;
  return <Badge variant="info">Pending</Badge>;
}

/** SO has a finalized sales bill on a dispatch for this order — not active commercial backlog. */
function isCommerciallyShortClosed(
  row: { isCommerciallyClosed?: boolean } | null | undefined,
): boolean {
  return row?.isCommerciallyClosed === true;
}

function lineItemCustomerStatusLabel(
  poQty: number,
  netLine: number,
  pendLine: number,
  commerciallyClosed: boolean,
): string {
  if (commerciallyClosed) return "Completed";
  if (poQty > 1e-9 && netLine + 1e-9 >= poQty) return "Completed";
  if (pendLine > 1e-9) return netLine > 1e-9 ? "Partly Delivered" : "Pending";
  return "Completed";
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
  const auth = useAuth();
  const accountsRole = auth.user?.role === "ACCOUNTS";
  const [urlSearch] = useSearchParams();
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = React.useState("");
  const [customerId, setCustomerId] = React.useState(0);

  const customerSeedRef = React.useRef(false);
  React.useEffect(() => {
    const cid = Number(urlSearch.get("customerId") ?? 0);
    if (customerSeedRef.current || !Number.isFinite(cid) || cid <= 0) return;
    customerSeedRef.current = true;
    setCustomerId(cid);
  }, [urlSearch]);

  const [dateRange, setDateRange] = React.useState<DateRangeKey>("THIS_MONTH");
  const [dateFrom, setDateFrom] = React.useState(() => toIsoDateInput(startOfMonth(new Date())));
  const [dateTo, setDateTo] = React.useState(() => toIsoDateInput(new Date()));

  const accountsDateDefaultRef = React.useRef(false);
  React.useEffect(() => {
    if (auth.user?.role !== "ACCOUNTS" || accountsDateDefaultRef.current) return;
    accountsDateDefaultRef.current = true;
    setDateRange("ALL_DATES");
    setDateFrom("");
    setDateTo("");
  }, [auth.user?.role]);

  const [status, setStatus] = React.useState<
    "All" | "Pending" | "In Process" | "Partly Delivered" | "Delivered" | "Completed"
  >("All");
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
  const liveTick = useErpRefreshTick(["reports", "customer-tracking", "dashboard", "production", "qc", "dispatch"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });

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
    if (dateRange === "ALL_DATES") {
      setDateFrom("");
      setDateTo("");
      return;
    }
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
      if (accountsRole) qs.set("includeNoQty", "1");
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

  /** Server applies poSearch and NO_QTY inclusion (ACCOUNTS); optional client narrow on loaded rows. */
  const visiblePoRows = React.useMemo(() => {
    const base = poRows || [];
    const q = poSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => (r.poNumber || "").toLowerCase().includes(q));
  }, [poRows, poSearch]);

  const customerSummary = React.useMemo(() => {
    const rows = visiblePoRows || [];
    const sum = (key: keyof Pick<PoListRow, "orderedQty" | "producedQty" | "qcClearedQty" | "dispatchedQty">) =>
      rows.reduce((s, r) => s + Number(r[key] || 0), 0);
    const totalNetDelivered = rows.reduce((s, r) => s + netDeliveredForListRow(r), 0);
    let totalActivePendingToDeliver = 0;
    let totalShortClosedQty = 0;
    for (const r of rows) {
      const pend = qtyPendingToDeliver(r.orderedQty, netDeliveredForListRow(r));
      if (isCommerciallyShortClosed(r)) totalShortClosedQty += pend;
      else totalActivePendingToDeliver += pend;
    }
    return {
      totalOrders: rows.length,
      totalOrderedQty: sum("orderedQty"),
      totalProducedQty: sum("producedQty"),
      totalQcClearedQty: sum("qcClearedQty"),
      /** Gross outward dispatch (before returns), summed from list rows. */
      totalDispatchedQty: sum("dispatchedQty"),
      totalNetDeliveredQty: totalNetDelivered,
      /** Excludes commercially short-closed rows (finalized bill); those qty counts move to short-closed tile. */
      totalPendingToDeliverQty: totalActivePendingToDeliver,
      /** Sum of (Ordered − Net Delivered) for rows with finalized bill (informational). */
      totalShortClosedQty,
    };
  }, [visiblePoRows]);

  const dateFilterActive = React.useMemo(
    () => Boolean((dateFrom && dateFrom.trim() !== "") || (dateTo && dateTo.trim() !== "")),
    [dateFrom, dateTo],
  );

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
  }, [customerId, dateFrom, dateTo, status, poSearch, accountsRole, liveTick]);

  React.useEffect(() => {
    if (!selectedPoKey) return;
    void loadDetail(selectedPoKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoKey, liveTick]);

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
    const qcPend = Number(sum.qcPendingQty ?? Math.max(0, produced - qc));
    const directFromStock = dispatched > 0 && planned <= 0 && produced <= 0 && qc <= 0 && qcPend <= 1e-6;

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
    // Backend summary `dispatchedQty` is net total; gross = sum of line-level dispatched qty.
    const itemGrossDispatch = (detail.items || []).reduce((s, r) => s + Number(r.dispatchedQty || 0), 0);
    const payloadGrossDispatch =
      itemGrossDispatch > 0 ? itemGrossDispatch : Number(detail.summaryCards.dispatchedQty || 0);
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
    const qcPendingOrder =
      detail.summaryCards.qcPendingQty != null
        ? Number(detail.summaryCards.qcPendingQty)
        : Math.max(0, produced - qc);
    const netDelivered = Number(deliveryNumbers.netDelivered || 0);
    const ordered = Number(detail.summaryCards.orderedQty || 0);

    const commerciallyClosed =
      detail.header.isCommerciallyClosed === true || detail.header.status === "Completed";

    const directFromStock = produced <= 0 && qc <= 0 && qcPendingOrder <= 1e-6 && netDelivered > 0;

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
      directFromStock
        ? "not_required"
        : produced <= 1e-6
          ? "not_started"
          : qcPendingOrder <= 1e-6
            ? "completed"
            : "in_progress";

    const dispatchBaseline = ordered;
    const dispatchDeliveredComplete =
      commerciallyClosed || (dispatchBaseline > 0 && netDelivered >= dispatchBaseline);
    const dispatchState: JourneyStage["state"] =
      !commerciallyClosed && netDelivered <= 0
        ? "not_started"
        : dispatchDeliveredComplete
          ? "completed"
          : "in_progress";

    return [
      stage("Order / PO recorded", ordered, true, pickLastAt("Order / PO recorded"), "completed"),
      stage("Sales Order", ordered, true, pickLastAt("Sales Order"), "completed"),
      stage("Production Plan", planned, planned > 0 && produced >= planned, pickLastAt("Production Plan"), productionState),
      stage(
        "QC Cleared",
        qc,
        qcPendingOrder <= 1e-6 && produced > 1e-6,
        pickLastAt("QC Cleared"),
        qcState,
      ),
      stage(
        "Dispatch",
        netDelivered,
        netDelivered > 0 || commerciallyClosed,
        pickLastAt("Dispatch"),
        dispatchState,
      ),
      stage("Delivered", netDelivered, dispatchDeliveredComplete, pickLastAt("Delivered"), dispatchState),
    ];
  }, [detail, deliveryNumbers]);

  const pendingDeliveryCtas = React.useMemo(() => {
    if (!detail || !deliveryNumbers) return null;
    if (detail.header.isCommerciallyClosed === true) {
      return null;
    }
    if (detail.header.orderType === "NORMAL" && detail.header.status === "Completed") {
      return null;
    }
    if (detail.header.orderType === "NORMAL" && detail.regularDispatchGuidance) {
      return mapTrackingCtasForAccountsRole(
        resolveRegularNormalNextCtas(detail, deliveryNumbers.pendingRegular, detail.regularDispatchGuidance),
        auth.user?.role,
        detail.header.salesOrderId ?? detail.header.poKey,
      );
    }
    return mapTrackingCtasForAccountsRole(
      resolvePendingDeliveryCtas(detail, deliveryNumbers.pendingRegular),
      auth.user?.role,
      detail.header.salesOrderId ?? detail.header.poKey,
    );
  }, [detail, deliveryNumbers, auth.user?.role]);

  const trackingExceptionsFiltered = React.useMemo(() => {
    if (!detail) return [];
    return filterExceptionsForRegularNormal(detail);
  }, [detail]);

  const detailCommerciallyClosed = React.useMemo(() => isCommerciallyShortClosed(detail?.header), [detail]);

  const selectedSalesOrderId = detail ? (detail.header.salesOrderId ?? detail.header.poKey) : 0;

  const deliveryHero = React.useMemo(() => {
    if (!detail || !deliveryNumbers) return null;
    const ordered = Number(detail.summaryCards.orderedQty || 0);
    const net = Number(deliveryNumbers.netDelivered || 0);
    const pend = Math.max(0, ordered - net);
    if (ordered > 1e-9 && net + 1e-9 >= ordered) {
      return {
        deliveryLabel: "Completed" as const,
        tone: "success" as const,
        fulfilledMsg: "100% order fulfilled as per customer requirement.",
        pendingQty: 0,
        variant: "full" as const,
      };
    }
    if (detailCommerciallyClosed && pend > 1e-9) {
      return {
        deliveryLabel: "Closed Short" as const,
        tone: "neutral" as const,
        fulfilledMsg: undefined,
        pendingQty: pend,
        note: "Order is commercially closed. Remaining qty is not active delivery backlog.",
        variant: "closed_short" as const,
      };
    }
    if (pend > 1e-9) {
      return {
        deliveryLabel: (net > 1e-9 ? "Partly Delivered" : "Pending") as "Partly Delivered" | "Pending",
        tone: "warning" as const,
        fulfilledMsg: undefined,
        pendingQty: pend,
        variant: "pending" as const,
      };
    }
    return {
      deliveryLabel: "Completed" as const,
      tone: "success" as const,
      fulfilledMsg: undefined,
      pendingQty: 0,
      variant: "full" as const,
    };
  }, [detail, deliveryNumbers, detailCommerciallyClosed]);

  const customerJourneySteps = React.useMemo(() => {
    if (!detail || !deliveryNumbers) return [];
    const planned = Number(detail.summaryCards.plannedQty || 0);
    const produced = Number(detail.summaryCards.producedQty || 0);
    const qc = Number(detail.summaryCards.qcClearedQty || 0);
    const qcPend =
      detail.summaryCards.qcPendingQty != null
        ? Number(detail.summaryCards.qcPendingQty)
        : Math.max(0, produced - qc);
    const ordered = Number(detail.summaryCards.orderedQty || 0);
    const net = Number(deliveryNumbers.netDelivered || 0);
    const isNormal = detail.header.orderType === "NORMAL";
    const commercial = detail.header.isCommerciallyClosed === true;

    const directFromStock =
      produced <= 1e-6 && qc <= 1e-6 && qcPend <= 1e-6 && net > 1e-6 && planned <= 1e-6;

    const productionDone =
      directFromStock ||
      (planned > 1e-6 && produced + 1e-6 >= planned) ||
      (planned <= 1e-6 && produced <= 1e-6 && net > 1e-6);
    const productionActive = !productionDone && planned > 1e-6 && produced + 1e-6 < planned;

    const qcDone = directFromStock || (produced > 1e-6 && qcPend <= 1e-6);
    const qcActive = !qcDone && produced > 1e-6 && qcPend > 1e-6;

    const dispatchDone = (ordered > 1e-9 && net + 1e-9 >= ordered) || (isNormal && commercial);
    const dispatchActive = !dispatchDone && net > 1e-9;

    const billingDone = isNormal && commercial;
    const billingActive = isNormal && !billingDone && net > 1e-9;

    const completedDone = (ordered > 1e-9 && net + 1e-9 >= ordered) || billingDone;

    function state(done: boolean, active: boolean): "done" | "active" | "todo" {
      if (done) return "done";
      if (active) return "active";
      return "todo";
    }

    return [
      { label: "Order Created", st: "done" as const },
      { label: "Production", st: state(productionDone, productionActive) },
      { label: "QC", st: state(qcDone, qcActive) },
      { label: "Dispatch", st: state(dispatchDone, dispatchActive) },
      { label: "Billing", st: isNormal ? state(billingDone, billingActive) : ("todo" as const) },
      { label: "Completed", st: state(completedDone, false) },
    ];
  }, [detail, deliveryNumbers]);

  const dispatchForwardTotal = React.useMemo(() => {
    if (!detail?.dispatchHistory?.length) return null;
    const rows = detail.dispatchHistory.filter((h) => (h.type ?? "DISPATCH") === "DISPATCH");
    const sum = rows.reduce((s, h) => s + Math.max(0, Number(h.qty || 0)), 0);
    return sum;
  }, [detail]);

  /** Commercial closure panel: only when API sets the flag (not inferred from status alone). */
  const strictCommercialClosureCard = React.useMemo(
    () => Boolean(detail?.header.isCommerciallyClosed === true),
    [detail],
  );

  return (
    <PageContainer>
      <DemoFlowBanner />
      <ReportPageHeader
        title="Customer Tracking Report"
        purpose={
          accountsRole
            ? "Track customer order, dispatch, billing and payment follow-up."
            : "Customer order qty, delivery, billing status, and dispatch history. Production detail is optional."
        }
      />

      <ReportFilterToolbar
        leftExtras={
          customerOptions.length > 50 ? (
            <span className="text-[11px] text-slate-500">
              Showing first 50 customer matches. Keep typing to narrow.
            </span>
          ) : null
        }
      >
        <ReportFilterField label="Customer (search)">
          <Input
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="Type customer name…"
          />
        </ReportFilterField>
        <ReportFilterField label="Customer">
          <NativeSelect
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
          </NativeSelect>
        </ReportFilterField>
        <ReportFilterField label="Date range">
          <NativeSelect value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)}>
            <option value="ALL_DATES">All dates</option>
            <option value="THIS_MONTH">This Month</option>
            <option value="LAST_30">Last 30 Days</option>
            <option value="LAST_90">Last 90 Days</option>
            <option value="TODAY">Today</option>
          </NativeSelect>
        </ReportFilterField>
        <ReportFilterField label="Status">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="All">All</option>
            <option value="Pending">Pending</option>
            <option value="In Process">In Process</option>
            <option value="Partly Delivered">Partly Delivered</option>
            <option value="Delivered">Delivered</option>
            <option value="Completed">Completed</option>
          </NativeSelect>
        </ReportFilterField>
        <ReportFilterField label="From">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            disabled={dateRange === "ALL_DATES"}
          />
        </ReportFilterField>
        <ReportFilterField label="To">
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            disabled={dateRange === "ALL_DATES"}
          />
        </ReportFilterField>
        <ReportFilterField label="Order ref / PO No (optional)" span={2}>
          <Input
            value={poSearch}
            onChange={(e) => setPoSearch(e.target.value)}
            placeholder={customerId ? "SO no., customer PO ref, or PO number…" : "Select a customer first"}
            disabled={!customerId}
          />
        </ReportFilterField>
      </ReportFilterToolbar>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-stretch">
        <Card className="flex h-full min-w-0 flex-col border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Customer Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            {!customerId ? <p className="text-sm text-slate-600">Select a customer to load PO list.</p> : null}
            {customerId ? (
              <div
                className={cn(
                  "grid gap-2 sm:grid-cols-2",
                  customerSummary.totalShortClosedQty > 1e-9 ? "lg:grid-cols-5" : "lg:grid-cols-4",
                )}
              >
                {(
                  [
                    ["Orders loaded", customerSummary.totalOrders],
                    ["Customer Ordered Qty", customerSummary.totalOrderedQty],
                    ["Net Delivered Qty", customerSummary.totalNetDeliveredQty],
                  ] as const
                ).map(([label, val]) => (
                  <div key={label} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="text-xs font-medium text-slate-600">{label}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{val}</div>
                  </div>
                ))}
                <div
                  className={cn(
                    "rounded-md border p-3 sm:col-span-2 lg:col-span-1",
                    customerSummary.totalPendingToDeliverQty > 0
                      ? "border-amber-200 bg-amber-50/90"
                      : "border-emerald-200 bg-emerald-50/80",
                  )}
                >
                  <div className="text-xs font-medium text-slate-700">Active Pending Qty</div>
                  <div
                    className={cn(
                      "mt-1 text-xl font-bold tabular-nums",
                      customerSummary.totalPendingToDeliverQty > 0 ? "text-amber-950" : "text-emerald-900",
                    )}
                  >
                    {customerSummary.totalPendingToDeliverQty}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-600">
                    Active backlog only (excludes short-closed billed orders on loaded rows)
                  </div>
                </div>
                {customerSummary.totalShortClosedQty > 1e-9 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50/90 p-3 sm:col-span-2 lg:col-span-1">
                    <div className="text-xs font-medium text-slate-600">Short closed qty</div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">
                      {Math.round(customerSummary.totalShortClosedQty * 1000) / 1000}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      Commercially closed orders (finalized bill on dispatch); informational
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {customerId && poRows.length ? (
              <div className="text-xs text-slate-500">
                Showing latest {limit} records. Load more if needed.
                {hasMore ? " (Summary is based on loaded records.)" : ""}
              </div>
            ) : null}
            {listError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{listError}</div> : null}
            {customerId && !loadingList && !listError && poRows.length > 0 && !visiblePoRows.length && poSearch.trim() ? (
              <p className="text-sm text-slate-600">
                No loaded orders match the order ref / PO filter. Clear the search box to see all loaded rows.
              </p>
            ) : null}
            {customerId && !loadingList && !listError && !poRows.length && dateFilterActive ? (
              <div className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
                <p>No orders found in this date range (sales order created date). Try all dates or widen the range.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    setDateRange("ALL_DATES");
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  Show all dates
                </Button>
              </div>
            ) : null}
            {customerId && !loadingList && !listError && !poRows.length && !dateFilterActive ? (
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
                      {(() => {
                        const netD = netDeliveredForListRow(r);
                        const pend = qtyPendingToDeliver(r.orderedQty, netD);
                        const closedGap =
                          r.isCommerciallyClosed === true ||
                          (r.orderType === "NORMAL" && r.status === "Completed");
                        return (
                          <>
                            <div className="mt-1 text-xs text-slate-600">
                              Delivered:{" "}
                              <span className="font-medium tabular-nums text-slate-800">
                                {netD} / {r.orderedQty}
                              </span>
                            </div>
                            {closedGap && pend > 1e-9 ? (
                              <div className="mt-0.5 text-xs text-slate-600">
                                Closed short: {Math.round(pend * 1000) / 1000}
                              </div>
                            ) : (
                              <div
                                className={cn(
                                  "mt-0.5 text-xs font-semibold tabular-nums",
                                  pend > 0 ? "text-amber-900" : "text-slate-600",
                                )}
                              >
                                Qty Pending to Deliver: {pend}
                              </div>
                            )}
                          </>
                        );
                      })()}
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

        <div className="flex h-full min-w-0 flex-col gap-3">
          {!selectedPoKey ? (
            <Card className="flex flex-1 flex-col border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">PO Tracking</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col text-sm text-slate-600">
                <p>Select an order on the left to see full tracking.</p>
              </CardContent>
            </Card>
          ) : detailLoading ? (
            <Card className="flex flex-1 flex-col border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">PO Tracking</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col text-sm text-slate-600">
                Loading order details…
              </CardContent>
            </Card>
          ) : detailError ? (
            <Card className="flex flex-1 flex-col border-slate-200 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">PO Tracking</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{detailError}</div>
              </CardContent>
            </Card>
          ) : detail ? (
            <>
              <section className="rounded-md border border-slate-200 bg-gradient-to-br from-white to-slate-50/80 p-3 shadow-sm min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer Order Status</div>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="text-xs text-slate-500">PO / Order No</div>
                    <div className="text-lg font-semibold text-slate-900">{rightIdentity?.orderRef}</div>
                    <div className="pt-1 text-xs text-slate-500">Customer</div>
                    <div className="text-base font-medium text-slate-800">{rightIdentity?.customerName}</div>
                    {rightIdentity?.orderType ? (
                      <Badge variant="default" className="mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                        {rightIdentity.orderType === "NORMAL" ? "Regular" : rightIdentity.orderType}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="max-w-[min(100%,280px)] shrink-0 text-right">
                    {deliveryHero ? (
                      <div className="space-y-2">
                        <Badge
                          variant={
                            deliveryHero.tone === "success"
                              ? "success"
                              : deliveryHero.tone === "warning"
                                ? "warning"
                                : "default"
                          }
                          className="text-sm"
                        >
                          {deliveryHero.deliveryLabel}
                        </Badge>
                        {deliveryHero.fulfilledMsg ? (
                          <p className="text-left text-sm font-medium leading-snug text-emerald-800">{deliveryHero.fulfilledMsg}</p>
                        ) : null}
                        {deliveryHero.variant === "closed_short" && deliveryHero.note ? (
                          <p className="text-left text-xs leading-snug text-slate-600">{deliveryHero.note}</p>
                        ) : null}
                        {deliveryHero.variant === "pending" && deliveryHero.pendingQty > 1e-9 ? (
                          <p className="text-left text-xs tabular-nums text-amber-900">
                            Pending to deliver: {Math.round(deliveryHero.pendingQty * 1000) / 1000}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      badgeForStatus(detail.header.status)
                    )}
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-xs font-medium text-slate-600">Customer Ordered Qty</div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{detail.summaryCards.orderedQty}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="text-xs font-medium text-slate-600">Net Delivered Qty</div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                      {deliveryNumbers?.netDelivered ?? (detail.summaryCards.netDeliveredQty ?? 0)}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "rounded-md border p-3 shadow-sm",
                      deliveryHero?.tone === "success"
                        ? "border-emerald-200 bg-emerald-50/90"
                        : deliveryHero?.tone === "warning"
                          ? "border-amber-200 bg-amber-50/90"
                          : "border-slate-200 bg-slate-50/90",
                    )}
                  >
                    <div className="text-xs font-medium text-slate-600">Delivery Status</div>
                    <div
                      className={cn(
                        "mt-1 text-base font-bold leading-snug",
                        deliveryHero?.tone === "success" ? "text-emerald-900" : deliveryHero?.tone === "warning" ? "text-amber-950" : "text-slate-800",
                      )}
                    >
                      {deliveryHero?.deliveryLabel ?? "—"}
                    </div>
                    {deliveryHero?.variant === "pending" && deliveryHero.pendingQty > 1e-9 ? (
                      <div className="mt-1 text-xs tabular-nums text-amber-900">
                        Pending qty {Math.round(deliveryHero.pendingQty * 1000) / 1000}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="rounded-md border border-slate-200 bg-white shadow-sm min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 min-w-0 sm:grid-cols-3">
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium text-slate-600">Customer Ordered Qty</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{detail.summaryCards.orderedQty}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium text-slate-600">Net Delivered</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                        {deliveryNumbers?.netDelivered ?? (detail.summaryCards.netDeliveredQty ?? 0)}
                      </div>
                    </div>
                    {(() => {
                      const ordQ = Number(detail.summaryCards.orderedQty || 0);
                      const netQ = Number(deliveryNumbers?.netDelivered ?? 0);
                      const pendQ = Math.max(0, ordQ - netQ);
                      const fullOk = ordQ > 1e-9 && netQ + 1e-9 >= ordQ;
                      if (fullOk) {
                        return (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/85 p-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Active Pending Qty</div>
                            <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">0</div>
                          </div>
                        );
                      }
                      if (detailCommerciallyClosed && pendQ > 1e-9) {
                        return (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">Closed Short Qty</div>
                            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-800">
                              {Math.round(pendQ * 1000) / 1000}
                            </div>
                            <p className="mt-2 text-[11px] leading-snug text-slate-600">
                              Not active delivery backlog — order is commercially closed.
                            </p>
                          </div>
                        );
                      }
                      return (
                        <div
                          className={cn(
                            "rounded-lg border p-4",
                            pendQ > 1e-9 ? "border-amber-200 bg-amber-50/90" : "border-emerald-200 bg-emerald-50/85",
                          )}
                        >
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">Active Pending Qty</div>
                          <div
                            className={cn(
                              "mt-1 text-2xl font-bold tabular-nums",
                              pendQ > 1e-9 ? "text-amber-950" : "text-emerald-900",
                            )}
                          >
                            {Math.round(pendQ * 1000) / 1000}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Customer Ordered Qty is from the SO / PO commitment. Active Pending = Customer Ordered − Net Delivered (when not
                    commercially closed).
                  </p>
                </CardContent>
              </section>

              <section className="rounded-md border border-slate-200 bg-white shadow-sm min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Customer order journey</CardTitle>
                  <p className="text-xs font-normal text-slate-500">High-level steps; internal ratios stay in the collapsed section.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap justify-between gap-3">
                    {customerJourneySteps.map((step) => (
                      <div key={step.label} className="flex min-w-[72px] flex-1 flex-col items-center gap-1.5 text-center">
                        <div
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-full border-2",
                            step.st === "done" && "border-emerald-500 bg-emerald-50 text-emerald-700",
                            step.st === "active" && "border-amber-400 bg-amber-50 text-amber-800",
                            step.st === "todo" && "border-slate-200 bg-slate-50 text-slate-400",
                          )}
                          aria-hidden
                        >
                          {step.st === "done" ? (
                            <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
                          ) : step.st === "active" ? (
                            <Clock className="h-5 w-5" strokeWidth={2} />
                          ) : (
                            <Circle className="h-5 w-5" strokeWidth={2} />
                          )}
                        </div>
                        <div className="max-w-[88px] text-[11px] font-medium leading-tight text-slate-700">{step.label}</div>
                      </div>
                    ))}
                  </div>

                  <details className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                    <summary className="cursor-pointer text-xs font-medium text-slate-700">Technical journey detail (internal ratios)</summary>
                    <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3 min-w-0">
                    {(derivedJourney ?? rightFlow?.stages ?? detail.journey).map((s) => {
                      const ordered = Number(detail.summaryCards.orderedQty || 0);
                      const net = Number(deliveryNumbers?.netDelivered ?? 0);
                      const pending = Number(deliveryNumbers?.pendingRegular ?? 0);
                      const isDispatchCard = s.name === "Dispatch" || s.name === "Delivered";

                      if (isDispatchCard) {
                        if (detailCommerciallyClosed) {
                          const shortClosed = pending > 1e-9 ? Math.round(pending * 1000) / 1000 : 0;
                          return (
                            <div key={s.name} className="rounded-md border border-slate-200 bg-white p-2">
                              <div className="text-xs font-medium text-slate-900">{s.name}</div>
                              <div className="mt-1 space-y-0.5 text-xs tabular-nums text-slate-800">
                                <div>
                                  Delivered {net} / {ordered}
                                </div>
                                {shortClosed > 0 ? (
                                  <div className="text-slate-600">Short closed {shortClosed}</div>
                                ) : null}
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <div className="text-[11px] text-slate-500">
                                  {s.lastAt ? `Updated: ${new Date(s.lastAt).toLocaleDateString()}` : "—"}
                                </div>
                                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
                                  Done
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={s.name} className="rounded-md border border-slate-200 bg-white p-2">
                            <div className="text-xs font-medium text-slate-900">{s.name}</div>
                            <div className="mt-1 space-y-0.5 text-xs tabular-nums text-slate-800">
                              <div>
                                Delivered {net} / {ordered}
                              </div>
                              <div className={pending > 1e-9 ? "font-semibold text-amber-900" : "text-slate-600"}>
                                Pending {Math.round(pending * 1000) / 1000}
                              </div>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <div className="text-[11px] text-slate-500">
                                {s.lastAt ? `Updated: ${new Date(s.lastAt).toLocaleDateString()}` : "—"}
                              </div>
                              {pending > 1e-9 ? (
                                <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                                  In progress
                                </span>
                              ) : (
                                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
                                  Done
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={s.name} className="rounded-md border border-slate-200 bg-white p-2">
                          <div className="text-xs font-medium text-slate-900">{s.name}</div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <div className="text-xs tabular-nums text-slate-700">
                              {s.name === "QC Cleared" &&
                              Number(detail.summaryCards.plannedQty || 0) > 0 &&
                              Number(detail.summaryCards.qcClearedQty || 0) > 0
                                ? `${Number(detail.summaryCards.qcClearedQty || 0)} / ${Number(detail.summaryCards.plannedQty || 0)}`
                                : s.qty}
                            </div>
                            {stagePill(s)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {s.lastAt ? `Updated: ${new Date(s.lastAt).toLocaleDateString()}` : "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </details>
                </CardContent>
              </section>

              <section className="rounded-md border border-slate-200 bg-white shadow-sm min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Line items &amp; progress</CardTitle>
                  <p className="text-xs font-normal text-slate-500">
                    Delivery focus per line; expand work orders when you need production detail.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {detail.items.map((r) => {
                    const netLine = Number(r.netDeliveredQty ?? Number(r.dispatchedQty || 0) - Number(r.returnedQty || 0));
                    const pendLine = qtyPendingToDeliver(r.poQty, netLine);
                    const statusLabel = lineItemCustomerStatusLabel(r.poQty, netLine, pendLine, detailCommerciallyClosed);
                    return (
                    <div key={r.itemId} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 shadow-sm">
                      <div className="text-sm font-semibold text-slate-900">
                        <span className="font-normal text-slate-500">Item: </span>
                        {r.itemName}
                      </div>
                      <dl className="mt-3 space-y-2.5 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                          <dt className="text-slate-600">Customer Ordered</dt>
                          <dd className="font-semibold tabular-nums text-slate-900">{r.poQty}</dd>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                          <dt className="text-slate-600">Net Delivered</dt>
                          <dd className="font-semibold tabular-nums text-slate-900">{netLine}</dd>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <dt className="text-slate-600">Status</dt>
                          <dd className="font-semibold text-slate-900">{statusLabel}</dd>
                        </div>
                        {!detailCommerciallyClosed && pendLine > 1e-9 ? (
                          <div className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
                            Pending to Deliver:{" "}
                            <span className="font-bold tabular-nums">{Math.round(pendLine * 1000) / 1000}</span>
                          </div>
                        ) : null}
                        {detailCommerciallyClosed && pendLine > 1e-9 ? (
                          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                            Closed Short: <span className="font-bold tabular-nums">{Math.round(pendLine * 1000) / 1000}</span>
                          </div>
                        ) : null}
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
                    );
                  })}
                </CardContent>
              </section>

              {detail.dispatchHistory.length ? (
                <section className="rounded-md border border-slate-200 bg-white shadow-sm min-w-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Dispatch History</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="hidden gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,0.55fr)_minmax(0,0.75fr)]">
                      <span>Dispatch No</span>
                      <span>Date</span>
                      <span>Item</span>
                      <span className="text-right">Qty</span>
                      <span>Status</span>
                    </div>
                    <div className="space-y-2">
                      {detail.dispatchHistory.map((d) => {
                        const isRv = d.type === "RETURN" || d.type === "REVERSAL";
                        const statusLabel = d.type === "REVERSAL" ? "Reversal" : d.type === "RETURN" ? "Return" : "Dispatch";
                        const qtyShow = d.qty < 0 ? `−${Math.abs(d.qty)}` : String(d.qty);
                        return (
                          <div
                            key={`${d.dispatchNo}-${d.date}-${d.itemId}`}
                            className={cn(
                              "grid gap-2 rounded-lg border p-3 text-sm shadow-sm sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,0.55fr)_minmax(0,0.75fr)] sm:items-center",
                              isRv ? "border-amber-200 bg-amber-50/25" : "border-slate-200 bg-white",
                            )}
                          >
                            <span className="font-mono text-xs font-medium text-slate-900">{d.dispatchNo}</span>
                            <span className="text-xs text-slate-600">{d.date ? new Date(d.date).toLocaleDateString() : "—"}</span>
                            <span className="min-w-0 text-slate-800">{d.itemName}</span>
                            <span className={cn("text-right tabular-nums font-semibold sm:text-left sm:text-right", d.qty < 0 ? "text-amber-900" : "text-slate-800")}>
                              {qtyShow}
                            </span>
                            <span>
                              <Badge variant={isRv ? "warning" : "success"} className="rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                {statusLabel}
                              </Badge>
                            </span>
                            {(d.vehicleOrRefNo || d.remarks) && (
                              <div className="col-span-full text-[11px] text-slate-500 sm:col-span-5">
                                {d.vehicleOrRefNo ? <span className="mr-3">Ref: {d.vehicleOrRefNo}</span> : null}
                                {d.remarks ? <span>{d.remarks}</span> : null}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="rounded-md border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-800">
                      <span className="font-medium">Total Dispatched </span>
                      <span className="tabular-nums font-semibold">
                        {dispatchForwardTotal != null
                          ? Math.round(dispatchForwardTotal * 1000) / 1000
                          : Math.round((deliveryNumbers?.grossDispatch ?? 0) * 1000) / 1000}
                      </span>
                      <span className="text-xs text-slate-500"> (forward dispatch qty)</span>
                    </div>
                  </CardContent>
                </section>
              ) : null}

              {strictCommercialClosureCard && deliveryNumbers ? (
                <section className="rounded-md border border-slate-200 bg-slate-50/80 shadow-sm min-w-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base text-slate-900">Commercially Closed</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm leading-relaxed text-slate-700">
                      This order is billed and closed. Any extra production, scrap, rework, or usable stock is handled in internal
                      production/stock reports and does not affect customer delivery status.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        className={cn(buttonVariants({ variant: "default", size: "sm" }), "no-underline")}
                        to={`/sales-bills?salesOrderId=${encodeURIComponent(String(selectedSalesOrderId))}`}
                      >
                        View Sales Bill
                      </Link>
                      {accountsRole ? null : (
                        <Link
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}
                          to={trackingWithSo(selectedSalesOrderId, "/sales-orders")}
                        >
                          Back to Sales Orders
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </section>
              ) : null}

              {!detailCommerciallyClosed && deliveryNumbers && deliveryNumbers.pendingRegular > 1e-9 && pendingDeliveryCtas ? (
                <section className="rounded-md border border-amber-200 bg-amber-50/40 shadow-sm min-w-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Exceptions / Next Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {detail.header.orderType === "NORMAL" && detail.regularDispatchGuidance ? (
                      <p className="text-sm font-medium text-amber-950">
                        {regularNormalExceptionLeadCopy(deliveryNumbers.pendingRegular, detail.regularDispatchGuidance)}
                        <span className="mt-1 block text-xs font-normal text-slate-700">
                          {detail.header.customer.name} / {detail.header.poNumber}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm font-medium text-amber-950">
                        {Math.round(deliveryNumbers.pendingRegular * 1000) / 1000} Qty pending to deliver for{" "}
                        {detail.header.customer.name} / {detail.header.poNumber}.
                      </p>
                    )}
                    {trackingExceptionsFiltered.length ? (
                      <ul className="list-inside list-disc text-xs text-slate-700">
                        {trackingExceptionsFiltered.map((m, idx) => (
                          <li key={idx}>{m}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Link
                        className={cn(buttonVariants({ variant: "default", size: "sm" }), "no-underline")}
                        to={pendingDeliveryCtas.primary.to}
                      >
                        {pendingDeliveryCtas.primary.label}
                      </Link>
                      {pendingDeliveryCtas.secondary ? (
                        <Link
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}
                          to={pendingDeliveryCtas.secondary.to}
                        >
                          {pendingDeliveryCtas.secondary.label}
                        </Link>
                      ) : null}
                    </div>
                  </CardContent>
                </section>
              ) : null}

              <details className="rounded-md border border-dashed border-slate-200 bg-slate-50/50 p-3 shadow-sm min-w-0">
                <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800">Internal Production Details</summary>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-md border border-white bg-white p-3 shadow-sm">
                    <div className="text-xs font-medium text-slate-500">Planned Qty</div>
                    <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{detail.summaryCards.plannedQty}</div>
                  </div>
                  <div className="rounded-md border border-white bg-white p-3 shadow-sm">
                    <div className="text-xs font-medium text-slate-500">Produced Qty</div>
                    <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{detail.summaryCards.producedQty}</div>
                  </div>
                  <div className="rounded-md border border-white bg-white p-3 shadow-sm">
                    <div className="text-xs font-medium text-slate-500">QC Accepted Qty</div>
                    <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{detail.summaryCards.qcClearedQty}</div>
                  </div>
                  <div className="rounded-md border border-white bg-white p-3 shadow-sm">
                    <div className="text-xs font-medium text-slate-500">QC Pending (batches)</div>
                    <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{detail.summaryCards.qcPendingQty ?? "—"}</div>
                  </div>
                </div>
                {deliveryNumbers ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Reference: gross dispatch {deliveryNumbers.grossDispatch}, customer returns (abs) {deliveryNumbers.customerReturnAbs}.
                  </p>
                ) : null}
              </details>
            </>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}

