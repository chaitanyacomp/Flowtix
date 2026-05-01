import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  FileEdit,
  Package,
  RotateCcw,
  Truck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button, buttonVariants } from "../components/ui/button";
import { cn } from "../lib/utils";
import { useDemoMode } from "../contexts/DemoModeContext";
import {
  type DispatchBacklogRow,
  ROW_NUM_EPS,
  dashboardToneToBadgeVariant,
  dispatchBacklogLeadCellClass,
  dispatchBacklogRowEmphasis,
  dispatchBacklogStatusTone,
  maxInSlice,
} from "../lib/dispatchBacklog";
import {
  getDrillRowProps,
  qcEntryFocusHref,
  rmPoGrnFocusHref,
  salesOrdersFocusHref,
  stockFocusHref,
  workOrdersFocusHref,
} from "../lib/drillDownRoutes";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { useDrillAccessMap } from "../hooks/useDrillAccess";
import { useAuth } from "../hooks/useAuth";
import { purchasePoStatusTone, qcQueueStatusTone, rmRiskStatusTone, workOrderStatusTone } from "../lib/reportStatusTones";

/** Role-based access to dashboard API sections (aligns with future backend requireRole). */
function dashboardWidgetFlags(role: string) {
  const isAdmin = role === "ADMIN";
  const isSales = role === "SALES";
  const isDispatch = role === "DISPATCH";
  const isProduction = role === "PRODUCTION";
  const isQc = role === "QC";
  const isStore = role === "STORE";

  return {
    canViewOverallSummary: isAdmin,
    canViewDispatchBacklog: isAdmin || isSales || isDispatch,
    canViewProductionQueue: isAdmin || isProduction,
    canViewQcQueue: isAdmin || isQc,
    canViewRmRisk: isAdmin || isProduction || isStore,
    canViewPurchaseSummary: isAdmin || isStore,
    /** Aligned with backend GET /api/dashboard/continue-working and main nav Dashboard roles. */
    canViewContinueWorking: isAdmin || isSales || isProduction || isQc || isStore || role === "SUPERVISOR",
  };
}

function DashboardTableLoading() {
  return (
    <div className="flex flex-1 flex-col justify-center px-6 py-10">
      <p className="text-sm text-slate-500">Loading…</p>
    </div>
  );
}

function DashboardTableError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center px-6 py-10">
      <p className="text-sm font-medium text-red-800">Could not load this section</p>
      <p className="mt-1 text-xs text-red-700/90">{message}</p>
    </div>
  );
}

function DashboardTableEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center px-4 py-6 md:px-6">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{title}</p>
          {description ? <p className="mt-0.5 max-w-md text-xs leading-snug text-slate-500">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}

/** Dashboard shell & cards — consistent with premium ERP layout */
const DASH_SHELL = "min-h-screen bg-slate-50";
const DASH_MAX = "mx-auto w-full max-w-7xl px-3 pb-8 pt-4 md:px-6 md:py-6";
const DASH_GRID = "grid max-w-full gap-4";
const DASH_CARD = "rounded-xl border border-slate-200 bg-white shadow-sm";
const DASH_BTN_PRIMARY = "h-8 px-3 text-xs font-medium rounded-lg";
const DASH_BTN_SECONDARY =
  "inline-flex h-8 items-center justify-center px-3 text-xs font-medium rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-blue-300";
const DASH_STATUS_BADGE = "rounded-full px-2 py-0.5 text-[11px]";
const DASH_KPI_CHIP =
  "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs shadow-sm transition hover:border-blue-300 hover:bg-blue-50 cursor-pointer";

/** Table cards share minimum height on large screens so paired rows align */
const DASH_TABLE_CARD_CLASS = cn(DASH_CARD, "lg:flex lg:min-h-[288px] lg:flex-col");
const DASH_TABLE_CARD_INTERACTIVE = cn(
  DASH_TABLE_CARD_CLASS,
  "cursor-pointer transition hover:border-slate-300 hover:shadow-md",
);
const DASH_TABLE_CARD_CONTENT_CLASS = "flex flex-1 flex-col p-0";

/** Premium table shell: matches dashboard cards (rounded-xl) */
const DASH_TABLE_WRAP_BASE =
  "erp-table-wrap mt-auto max-w-full overflow-x-auto border-t border-slate-200 !rounded-xl";

/** Demo-friendly short labels for inventory snapshot (full string in title tooltip). */
function displayShortItemName(name: string, maxLen = 28): string {
  let s = String(name ?? "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/\s+\d{10,}$/, "").trim();
  s = s.replace(/\s+[a-z]{2,}\s+\d{8,}$/i, "").trim();
  s = s.replace(/\s+[a-z]{2,}$/i, "").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

type DashboardDto = {
  rmStockAlert: { itemId: number; itemName: string; qty: number; minStockLevel: number }[];
  fgStock: { itemId: number; itemName: string; qty: number }[];
  /** Server sum of FG on-hand from ledger (same universe as fgStock list) */
  fgStockTotalQty?: number;
  pendingWorkOrders: number;
  totalRejectedQty: number;
  qcRejectionPct: number;
  lossSummary: { fgItemId: number; itemName: string; rejectedQty: number }[];
  pendingDispatchCount: number;
  purchasePending: number;
  openEnquiries: number;
  recentQcRejections: {
    id: number;
    date: string;
    itemName: string;
    rejectedQty: number;
    acceptedQty: number;
    lossQty: number;
    reason: string | null;
    scrapReusable: boolean;
  }[];
};

type ProductionQueueRow = {
  workOrderId: number;
  workOrderNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  itemId: number;
  itemName: string;
  /** SO line required qty */
  requiredQty: number;
  /** Sum of APPROVED production on the line */
  producedQty: number;
  /** max(0, requiredQty − producedQty) */
  balanceQty: number;
  status: string;
  workOrderDate: string;
  quantityMetricContext?: string;
};

type QcQueueRow = {
  qcRef: string;
  workOrderId: number;
  workOrderNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  itemId: number;
  itemName: string;
  producedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  pendingQcQty: number;
  status: string;
  qcDate: string;
  quantityMetricContext?: string;
};

type RmRiskRow = {
  itemId: number;
  itemCode: string;
  itemName: string;
  currentStockQty: number;
  requiredQty: number;
  freeQty: number;
  shortageQty: number;
  status: string;
  quantityMetricContext?: string;
};

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
  quantityMetricContext?: string;
};

type DashboardDispQueues = {
  reworkPendingSupervisor: { id: number }[];
  reworkApprovedPendingExecution?: { id: number }[];
  readyForQcRecheck: { id: number }[];
  holdStock: { id: number }[];
  scrapRegister: { id: number }[];
};

type ContinueWorkingRow = {
  key: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  itemName: string;
  orderType?: "NO_QTY" | "NORMAL" | string;
  cycleNo?: number | null;
  stageKey: "QC" | "DISPATCH" | "PRODUCTION" | "DONE" | string;
  awaitingQcQty?: number;
  dispatchableNow?: number;
  productionRemaining?: number;
  metricLabel?: string;
  metricQty?: number;
  nextStep: string;
  href: string;
};

type ActionRequiredRow = {
  key: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  itemName: string;
  orderType?: "NO_QTY" | "NORMAL" | string;
  cycleNo?: number | null;
  metricQty: number;
  href: string;
  group: "QC" | "DISPATCH" | "PRODUCTION";
};

/** If API returns duplicate SO rows, keep the highest-priority stage only (QC → Dispatch → Production). */
function dedupeContinueWorkingBySalesOrder(rows: ContinueWorkingRow[]): ContinueWorkingRow[] {
  const stageRank = (sk: string) =>
    sk === "QC" ? 0 : sk === "DISPATCH" ? 1 : sk === "PRODUCTION" ? 2 : 3;
  const bySo = new Map<number, ContinueWorkingRow>();
  for (const r of rows) {
    if (r.stageKey === "DONE" || r.nextStep === "Completed / Waiting") continue;
    const prev = bySo.get(r.salesOrderId);
    if (!prev || stageRank(String(r.stageKey)) < stageRank(String(prev.stageKey))) {
      bySo.set(r.salesOrderId, r);
    }
  }
  return [...bySo.values()];
}

/** Same SO must appear at most once across the three groups (QC beats dispatch beats production). */
function enforceUniqueSalesOrdersAcrossGroups(groups: {
  qc: ActionRequiredRow[];
  dispatch: ActionRequiredRow[];
  production: ActionRequiredRow[];
}): { qc: ActionRequiredRow[]; dispatch: ActionRequiredRow[]; production: ActionRequiredRow[] } {
  const qcIds = new Set(groups.qc.map((r) => r.salesOrderId));
  const dispatch = groups.dispatch.filter((r) => !qcIds.has(r.salesOrderId));
  const dispIds = new Set(dispatch.map((r) => r.salesOrderId));
  const production = groups.production.filter((r) => !qcIds.has(r.salesOrderId) && !dispIds.has(r.salesOrderId));
  return { qc: groups.qc, dispatch, production };
}

function partitionContinueWorkingForActions(rows: ContinueWorkingRow[]): {
  qc: ActionRequiredRow[];
  dispatch: ActionRequiredRow[];
  production: ActionRequiredRow[];
} {
  const qc: ActionRequiredRow[] = [];
  const dispatch: ActionRequiredRow[] = [];
  const production: ActionRequiredRow[] = [];
  for (const r of rows) {
    if (r.stageKey === "DONE" || r.nextStep === "Completed / Waiting") continue;

    const base = {
      key: r.key,
      salesOrderId: r.salesOrderId,
      salesOrderDocNo: r.salesOrderDocNo,
      customerName: r.customerName,
      itemName: r.itemName,
      orderType: r.orderType,
      cycleNo: r.cycleNo,
      href: r.href,
    };

    if (r.stageKey === "QC") {
      const mq = Number(r.awaitingQcQty ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      qc.push({ ...base, group: "QC", metricQty: mq });
    } else if (r.stageKey === "DISPATCH") {
      const mq = Number(r.dispatchableNow ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      dispatch.push({ ...base, group: "DISPATCH", metricQty: mq });
    } else if (r.stageKey === "PRODUCTION") {
      const mq = Number(r.productionRemaining ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      production.push({ ...base, group: "PRODUCTION", metricQty: mq });
    }
  }
  return { qc, dispatch, production };
}

/**
 * When continue-working is unavailable, mirror backend priority per sales order: QC → dispatch (dispatchable only) → production.
 */
function buildActionRequiredFromQueues(
  qcRows: QcQueueRow[] | null,
  backlogRows: DispatchBacklogRow[] | null,
  prodRows: ProductionQueueRow[] | null,
): { qc: ActionRequiredRow[]; dispatch: ActionRequiredRow[]; production: ActionRequiredRow[] } {
  const qc: ActionRequiredRow[] = [];
  const dispatch: ActionRequiredRow[] = [];
  const production: ActionRequiredRow[] = [];

  type Agg = {
    salesOrderId: number;
    awaitingQc: number;
    dispatchableNow: number;
    productionRemaining: number;
    customerName: string;
    itemName: string;
    hrefQc: string;
    hrefDisp: string;
    hrefProd: string;
  };
  const bySo = new Map<number, Agg>();

  function ensure(soId: number): Agg {
    let a = bySo.get(soId);
    if (!a) {
      const sid = encodeURIComponent(String(soId));
      a = {
        salesOrderId: soId,
        awaitingQc: 0,
        dispatchableNow: 0,
        productionRemaining: 0,
        customerName: "",
        itemName: "",
        hrefQc: `/qc-entry?salesOrderId=${sid}`,
        hrefDisp: `/dispatch?salesOrderId=${sid}`,
        hrefProd: `/production?salesOrderId=${sid}`,
      };
      bySo.set(soId, a);
    }
    return a;
  }

  if (backlogRows) {
    for (const b of backlogRows) {
      const dn = Number(b.dispatchableNow ?? 0);
      if (dn <= ROW_NUM_EPS) continue;
      const a = ensure(b.salesOrderId);
      if (dn > a.dispatchableNow) {
        a.dispatchableNow = dn;
        a.customerName = b.customerName;
        a.itemName = b.itemName;
      }
    }
  }
  if (qcRows) {
    for (const q of qcRows) {
      const pend = Number(q.pendingQcQty ?? 0);
      if (pend <= ROW_NUM_EPS) continue;
      const a = ensure(q.salesOrderId);
      if (pend > a.awaitingQc) {
        a.awaitingQc = pend;
        a.itemName = q.itemName;
      }
    }
  }
  if (prodRows) {
    for (const p of prodRows) {
      if (p.status !== "PENDING" && p.status !== "IN_PROGRESS") continue;
      const bal = Number(p.balanceQty ?? 0);
      if (bal <= ROW_NUM_EPS) continue;
      const a = ensure(p.salesOrderId);
      if (bal > a.productionRemaining) {
        a.productionRemaining = bal;
        if (!a.customerName) a.customerName = "";
        a.itemName = p.itemName;
      }
    }
  }

  const soIds = [...bySo.keys()].sort((x, y) => x - y);
  for (const soId of soIds) {
    const a = bySo.get(soId)!;
    const key = `so-${soId}`;
    if (a.awaitingQc > ROW_NUM_EPS) {
      qc.push({
        key: `${key}-qc`,
        salesOrderId: soId,
        customerName: a.customerName || "—",
        itemName: a.itemName || "—",
        metricQty: a.awaitingQc,
        href: a.hrefQc,
        group: "QC",
      });
    } else if (a.dispatchableNow > ROW_NUM_EPS) {
      dispatch.push({
        key: `${key}-disp`,
        salesOrderId: soId,
        customerName: a.customerName || "—",
        itemName: a.itemName || "—",
        metricQty: a.dispatchableNow,
        href: a.hrefDisp,
        group: "DISPATCH",
      });
    } else if (a.productionRemaining > ROW_NUM_EPS) {
      production.push({
        key: `${key}-prod`,
        salesOrderId: soId,
        customerName: a.customerName || "—",
        itemName: a.itemName || "—",
        metricQty: a.productionRemaining,
        href: a.hrefProd,
        group: "PRODUCTION",
      });
    }
  }

  return { qc, dispatch, production };
}

function ActionRequiredMetricLine({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: number;
  valueClassName?: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-x-1 tabular-nums">
      <span className="text-xs font-normal text-slate-500">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums text-slate-900", valueClassName)}>{value}</span>
    </span>
  );
}

function productionQueueRowEmphasis(r: ProductionQueueRow, slice: ProductionQueueRow[]): "high" | "low" {
  if (slice.length === 0) return "low";
  const maxB = maxInSlice(slice.map((x) => x.balanceQty));
  if (maxB <= ROW_NUM_EPS) return "low";
  return r.balanceQty >= maxB * 0.55 ? "high" : "low";
}

function qcQueueRowEmphasis(r: QcQueueRow, slice: QcQueueRow[]): "high" | "medium" | "low" {
  if (r.pendingQcQty <= ROW_NUM_EPS) return "low";
  const maxP = maxInSlice(slice.map((x) => x.pendingQcQty));
  if (maxP <= ROW_NUM_EPS) return "medium";
  return r.pendingQcQty >= maxP * 0.65 ? "high" : "medium";
}

function purchaseRowEmphasis(r: PurchaseSummaryRow, slice: PurchaseSummaryRow[]): "high" | "low" {
  if (slice.length === 0) return "low";
  const maxP = maxInSlice(slice.map((x) => x.pendingQty));
  if (maxP <= ROW_NUM_EPS) return "low";
  return r.pendingQty >= maxP * 0.6 ? "high" : "low";
}

function firstCellUrgencyClass(level: "high" | "medium" | "low", kind: "prod" | "qc" | "purchase"): string {
  if (level === "low") return "";
  const border =
    kind === "prod"
      ? "border-l-2 border-slate-500/70"
      : kind === "qc"
        ? level === "high"
          ? "border-l-[3px] border-amber-600/75"
          : "border-l-2 border-amber-500/45"
        : "border-l-2 border-slate-500/70";
  return cn(border, "border-y-0 border-r-0 border-solid pl-2");
}

export function DashboardPage() {
  const navigate = useNavigate();
  const drill = useDrillAccessMap();
  const auth = useAuth();
  const role = auth.user?.role ?? "";
  const demo = useDemoMode();

  function clickTo(to: string) {
    return {
      role: "link" as const,
      tabIndex: 0,
      onClick: () => navigate(to, { state: { from: "dashboard" } }),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(to, { state: { from: "dashboard" } });
        }
      },
    };
  }

  const {
    canViewOverallSummary,
    canViewDispatchBacklog,
    canViewProductionQueue,
    canViewQcQueue,
    canViewRmRisk,
    canViewPurchaseSummary,
    canViewContinueWorking,
  } = React.useMemo(() => dashboardWidgetFlags(role), [role]);

  const { canQuickSalesOrders, canQuickDispatch } = React.useMemo(() => {
    return {
      canQuickSalesOrders: ["ADMIN", "SALES", "STORE", "PRODUCTION"].includes(role),
      canQuickDispatch: role === "ADMIN" || role === "SALES",
    };
  }, [role]);

  const hasAnyWidget =
    canViewOverallSummary ||
    canViewDispatchBacklog ||
    canViewProductionQueue ||
    canViewQcQueue ||
    canViewRmRisk ||
    canViewPurchaseSummary ||
    canViewContinueWorking;

  const [data, setData] = React.useState<DashboardDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [backlog, setBacklog] = React.useState<DispatchBacklogRow[] | null>(null);
  const [backlogError, setBacklogError] = React.useState<string | null>(null);
  const [prodQueue, setProdQueue] = React.useState<ProductionQueueRow[] | null>(null);
  const [prodQueueError, setProdQueueError] = React.useState<string | null>(null);
  const [qcQueue, setQcQueue] = React.useState<QcQueueRow[] | null>(null);
  const [qcQueueError, setQcQueueError] = React.useState<string | null>(null);
  const [rmRisk, setRmRisk] = React.useState<RmRiskRow[] | null>(null);
  const [rmRiskError, setRmRiskError] = React.useState<string | null>(null);
  const [purchaseSummary, setPurchaseSummary] = React.useState<PurchaseSummaryRow[] | null>(null);
  const [purchaseSummaryError, setPurchaseSummaryError] = React.useState<string | null>(null);
  const [dispQueues, setDispQueues] = React.useState<DashboardDispQueues | null>(null);
  const [continueWorking, setContinueWorking] = React.useState<ContinueWorkingRow[] | null>(null);

  React.useLayoutEffect(() => {
    if (!canViewContinueWorking) {
      setContinueWorking(null);
    }
    if (!canViewDispatchBacklog) setBacklog([]);
    if (!canViewProductionQueue) setProdQueue([]);
    if (!canViewQcQueue) setQcQueue([]);
    if (!canViewRmRisk) setRmRisk([]);
    if (!canViewPurchaseSummary) setPurchaseSummary([]);
    if (!canViewQcQueue) setDispQueues({ reworkPendingSupervisor: [], readyForQcRecheck: [], holdStock: [], scrapRegister: [] });
  }, [
    canViewDispatchBacklog,
    canViewProductionQueue,
    canViewQcQueue,
    canViewRmRisk,
    canViewPurchaseSummary,
    canViewContinueWorking,
  ]);

  React.useEffect(() => {
    let mounted = true;
    setBacklogError(null);
    setProdQueueError(null);
    setQcQueueError(null);
    setRmRiskError(null);
    setPurchaseSummaryError(null);
    if (!canViewOverallSummary) setError(null);

    if (canViewContinueWorking) {
      apiFetch<ContinueWorkingRow[]>("/api/dashboard/continue-working?limit=10")
        .then((rows) => {
          if (mounted) {
            setContinueWorking(Array.isArray(rows) ? rows : []);
          }
        })
        .catch(() => {
          if (mounted) {
            setContinueWorking([]);
          }
        });
    } else {
      setContinueWorking(null);
    }

    if (canViewOverallSummary) {
      apiFetch<DashboardDto>("/api/dashboard")
        .then((d) => {
          if (mounted) setData(d);
        })
        .catch((e) => {
          if (mounted) setError(e instanceof Error ? e.message : "Failed to load");
        });
    } else {
      setData(null);
    }

    if (canViewDispatchBacklog) {
      apiFetch<DispatchBacklogRow[]>("/api/dashboard/dispatch-backlog")
        .then((rows) => {
          if (mounted) {
            setBacklog(rows);
            setBacklogError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setBacklog([]);
            setBacklogError(e instanceof Error ? e.message : "Failed to load dispatch backlog");
          }
        });
    }

    if (canViewProductionQueue) {
      apiFetch<ProductionQueueRow[]>("/api/dashboard/production-queue")
        .then((rows) => {
          if (mounted) {
            setProdQueue(rows);
            setProdQueueError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setProdQueue([]);
            setProdQueueError(e instanceof Error ? e.message : "Failed to load production queue");
          }
        });
    }

    if (canViewQcQueue) {
      apiFetch<QcQueueRow[]>("/api/dashboard/qc-queue")
        .then((rows) => {
          if (mounted) {
            setQcQueue(rows);
            setQcQueueError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setQcQueue([]);
            setQcQueueError(e instanceof Error ? e.message : "Failed to load QC queue");
          }
        });

      apiFetch<DashboardDispQueues>("/api/production/qc-rejected-dispositions/queues")
        .then((q) => {
          if (mounted) setDispQueues(q);
        })
        .catch(() => {
          if (mounted) setDispQueues({ reworkPendingSupervisor: [], readyForQcRecheck: [], holdStock: [], scrapRegister: [] });
        });
    }

    if (canViewRmRisk) {
      apiFetch<RmRiskRow[]>("/api/dashboard/rm-risk")
        .then((rows) => {
          if (mounted) {
            setRmRisk(rows);
            setRmRiskError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setRmRisk([]);
            setRmRiskError(e instanceof Error ? e.message : "Failed to load RM risk");
          }
        });
    }

    if (canViewPurchaseSummary) {
      apiFetch<PurchaseSummaryRow[]>("/api/dashboard/purchase-summary")
        .then((rows) => {
          if (mounted) {
            setPurchaseSummary(rows);
            setPurchaseSummaryError(null);
          }
        })
        .catch((e) => {
          if (mounted) {
            setPurchaseSummary([]);
            setPurchaseSummaryError(e instanceof Error ? e.message : "Failed to load purchase summary");
          }
        });
    }

    return () => {
      mounted = false;
    };
  }, [
    canViewOverallSummary,
    canViewDispatchBacklog,
    canViewProductionQueue,
    canViewQcQueue,
    canViewRmRisk,
    canViewPurchaseSummary,
    canViewContinueWorking,
  ]);

  const loading =
    (canViewOverallSummary && data === null && !error) ||
    (canViewDispatchBacklog && backlog === null) ||
    (canViewProductionQueue && prodQueue === null) ||
    (canViewQcQueue && qcQueue === null) ||
    (canViewRmRisk && rmRisk === null) ||
    (canViewPurchaseSummary && purchaseSummary === null) ||
    (canViewContinueWorking && continueWorking === null);

  const actionRequiredGroups = React.useMemo(() => {
    let g: { qc: ActionRequiredRow[]; dispatch: ActionRequiredRow[]; production: ActionRequiredRow[] };
    if (canViewContinueWorking && continueWorking !== null) {
      g = partitionContinueWorkingForActions(dedupeContinueWorkingBySalesOrder(continueWorking));
    } else {
      g = buildActionRequiredFromQueues(
        canViewQcQueue ? qcQueue : null,
        canViewDispatchBacklog ? backlog : null,
        canViewProductionQueue ? prodQueue : null,
      );
    }
    return enforceUniqueSalesOrdersAcrossGroups(g);
  }, [
    canViewContinueWorking,
    continueWorking,
    canViewQcQueue,
    qcQueue,
    canViewDispatchBacklog,
    backlog,
    canViewProductionQueue,
    prodQueue,
  ]);

  const showActionRequiredSection =
    (canViewContinueWorking && continueWorking !== null) ||
    (!canViewContinueWorking &&
      ((canViewDispatchBacklog && backlog !== null) ||
        (canViewProductionQueue && prodQueue !== null) ||
        (canViewQcQueue && qcQueue !== null)));

  if (canViewOverallSummary && error) {
    return (
      <div className={DASH_SHELL}>
        <div className={DASH_MAX}>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={DASH_SHELL}>
        <div className={DASH_MAX}>
          <p className="text-sm text-slate-600">Loading…</p>
        </div>
      </div>
    );
  }

  if (!hasAnyWidget) {
    return (
      <div className={DASH_SHELL}>
        <div className={DASH_MAX}>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            No dashboard widgets are available for your role.
          </div>
        </div>
      </div>
    );
  }

  const fgStockTotal = data
    ? data.fgStockTotalQty !== undefined
      ? data.fgStockTotalQty
      : data.fgStock.reduce((s, x) => s + Number(x.qty), 0)
    : 0;
  const backlogVisible = backlog && backlog.length > 0 ? backlog.slice(0, 10) : [];
  const prodQueueVisible = prodQueue && prodQueue.length > 0 ? prodQueue.slice(0, 8) : [];
  const qcQueueVisible = qcQueue && qcQueue.length > 0 ? qcQueue.slice(0, 8) : [];
  const rmRiskVisible = rmRisk && rmRisk.length > 0 ? rmRisk.slice(0, 8) : [];
  const purchaseVisible = purchaseSummary && purchaseSummary.length > 0 ? purchaseSummary.slice(0, 8) : [];
  const reworkDecisionCount =
    (dispQueues?.reworkPendingSupervisor?.length ?? 0) +
    (dispQueues?.holdStock?.length ?? 0) +
    (dispQueues?.readyForQcRecheck?.length ?? 0);

  const queuesBusy =
    backlogVisible.length > 0 ||
    prodQueueVisible.length > 0 ||
    qcQueueVisible.length > 0 ||
    reworkDecisionCount > 0;
  const summaryBusy =
    data != null &&
    (data.pendingDispatchCount > 0 ||
      data.pendingWorkOrders > 0 ||
      (qcQueue?.length ?? 0) > 0 ||
      data.rmStockAlert.length > 0 ||
      purchaseVisible.length > 0);
  const startNewWorkEmphasis = canViewOverallSummary && data ? !summaryBusy && !queuesBusy : !queuesBusy;

  const startNewWorkTileClass = cn(
    DASH_BTN_SECONDARY,
    "min-h-9 w-full flex flex-row items-center justify-center gap-2 text-sm font-normal no-underline transition-colors",
    startNewWorkEmphasis && "bg-slate-50/80",
  );

  const startNewWorkCard = (
    <Card className={cn(DASH_CARD, startNewWorkEmphasis && "border-slate-300/80 bg-slate-50/40")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">Start New Work</CardTitle>
        <p className="text-xs font-normal text-slate-500">Quick links to create orders and returns.</p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 pt-0">
        {canQuickSalesOrders ? (
          <Link
            to="/sales-orders?action=new-so"
            state={{ from: "dashboard" }}
            className={startNewWorkTileClass}
          >
            <FileEdit className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="text-center leading-tight">Create Sales Order</span>
          </Link>
        ) : null}
        {canQuickSalesOrders ? (
          <Link
            to="/sales-orders?action=no-qty-so"
            state={{ from: "dashboard" }}
            className={startNewWorkTileClass}
          >
            <Package className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="text-center leading-tight">No Qty Sales Order</span>
          </Link>
        ) : null}
        <Link to="/customer-returns?source=dashboard" state={{ from: "dashboard" }} className={startNewWorkTileClass}>
          <RotateCcw className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="text-center leading-tight">Customer Return</span>
        </Link>
        {canQuickDispatch ? (
          <Link to="/dispatch?source=dashboard" state={{ from: "dashboard" }} className={startNewWorkTileClass}>
            <Truck className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="text-center leading-tight">Open Dispatch</span>
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );

  const actionRequiredEmpty =
    actionRequiredGroups.qc.length === 0 &&
    actionRequiredGroups.dispatch.length === 0 &&
    actionRequiredGroups.production.length === 0;

  const actionRequiredRowClass =
    "flex min-h-[2.75rem] flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-sm text-slate-700 sm:flex-nowrap sm:justify-between";
  const actionRequiredBtnClass = cn(DASH_BTN_PRIMARY, "shrink-0 max-sm:w-full");

  const actionRequiredCard =
    showActionRequiredSection ? (
      <Card
        className={cn(
          DASH_CARD,
          "border-slate-300 shadow-md ring-1 ring-slate-200/80",
        )}
      >
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-base font-semibold text-slate-900">Action Required</CardTitle>
          <p className="text-xs font-normal text-slate-500">
            Your next operational actions, grouped by priority.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {actionRequiredEmpty ? (
            <p className="text-sm text-slate-600">No pending operational actions right now.</p>
          ) : (
            <div className="space-y-2">
              {actionRequiredGroups.qc.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-rose-200 bg-rose-50/60">
                  <div className="border-b border-rose-200/90 px-2 py-1.5 text-xs font-semibold text-rose-950">
                    Awaiting QC ({actionRequiredGroups.qc.length})
                  </div>
                  <ul className="divide-y divide-rose-200/60">
                    {actionRequiredGroups.qc.map((row) => (
                      <li key={row.key} className={actionRequiredRowClass}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className="font-semibold tabular-nums text-slate-900">
                              {displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo)}
                            </span>
                            <Badge
                              variant={row.orderType === "NO_QTY" ? "warning" : "info"}
                              className={cn(DASH_STATUS_BADGE, "leading-none")}
                            >
                              {row.orderType === "NO_QTY" ? "NO QTY" : "REGULAR"}
                            </Badge>
                            {row.orderType === "NO_QTY" && row.cycleNo != null ? (
                              <span className="text-xs font-medium text-slate-600">Cycle {row.cycleNo}</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs leading-snug text-slate-600">
                            <span className="truncate">{row.customerName}</span>
                            <span className="text-slate-300">|</span>
                            <span className="truncate">{row.itemName}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3 sm:ml-auto">
                          <ActionRequiredMetricLine
                            label="QC Pending:"
                            value={row.metricQty}
                            valueClassName="text-rose-950"
                          />
                        </div>
                        <Button
                          type="button"
                          className={actionRequiredBtnClass}
                          onClick={() => navigate(row.href, { state: { from: "dashboard" } })}
                        >
                          Continue QC
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {actionRequiredGroups.dispatch.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50/60">
                  <div className="border-b border-amber-200/90 px-2 py-1.5 text-xs font-semibold text-amber-950">
                    Ready for Dispatch ({actionRequiredGroups.dispatch.length})
                  </div>
                  <ul className="divide-y divide-amber-200/60">
                    {actionRequiredGroups.dispatch.map((row) => (
                      <li key={row.key} className={actionRequiredRowClass}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className="font-semibold tabular-nums text-slate-900">
                              {displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo)}
                            </span>
                            <Badge
                              variant={row.orderType === "NO_QTY" ? "warning" : "info"}
                              className={cn(DASH_STATUS_BADGE, "leading-none")}
                            >
                              {row.orderType === "NO_QTY" ? "NO QTY" : "REGULAR"}
                            </Badge>
                            {row.orderType === "NO_QTY" && row.cycleNo != null ? (
                              <span className="text-xs font-medium text-slate-600">Cycle {row.cycleNo}</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs leading-snug text-slate-600">
                            <span className="truncate">{row.customerName}</span>
                            <span className="text-slate-300">|</span>
                            <span className="truncate">{row.itemName}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3 sm:ml-auto">
                          <ActionRequiredMetricLine
                            label="Dispatchable:"
                            value={row.metricQty}
                            valueClassName="text-amber-950"
                          />
                        </div>
                        <Button
                          type="button"
                          className={actionRequiredBtnClass}
                          onClick={() => navigate(row.href, { state: { from: "dashboard" } })}
                        >
                          Go to Dispatch
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {actionRequiredGroups.production.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-sky-200 bg-sky-50/60">
                  <div className="border-b border-sky-200/90 px-2 py-1.5 text-xs font-semibold text-sky-950">
                    Production Pending ({actionRequiredGroups.production.length})
                  </div>
                  <ul className="divide-y divide-sky-200/60">
                    {actionRequiredGroups.production.map((row) => (
                      <li key={row.key} className={actionRequiredRowClass}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className="font-semibold tabular-nums text-slate-900">
                              {displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo)}
                            </span>
                            <Badge
                              variant={row.orderType === "NO_QTY" ? "warning" : "info"}
                              className={cn(DASH_STATUS_BADGE, "leading-none")}
                            >
                              {row.orderType === "NO_QTY" ? "NO QTY" : "REGULAR"}
                            </Badge>
                            {row.orderType === "NO_QTY" && row.cycleNo != null ? (
                              <span className="text-xs font-medium text-slate-600">Cycle {row.cycleNo}</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs leading-snug text-slate-600">
                            <span className="truncate">{row.customerName}</span>
                            <span className="text-slate-300">|</span>
                            <span className="truncate">{row.itemName}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3 sm:ml-auto">
                          <ActionRequiredMetricLine
                            label="Remaining Production:"
                            value={row.metricQty}
                            valueClassName="text-sky-950"
                          />
                        </div>
                        <Button
                          type="button"
                          className={actionRequiredBtnClass}
                          onClick={() => navigate(row.href, { state: { from: "dashboard" } })}
                        >
                          Continue Production
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    ) : null;

  return (
    <div className={DASH_SHELL}>
      <div className={DASH_MAX}>
        <div className={DASH_GRID}>
      {!demo.enabled ? (
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
      ) : null}
      {demo.enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
          <div className="min-w-0">
            <span className="font-semibold">DEMO MODE</span>{" "}
            <span className="text-sky-900/90">— Showing guided workflow (no real data)</span>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => demo.setDemoEnabled(false)}>
            Exit Demo
          </Button>
        </div>
      ) : null}
      <Card className={DASH_CARD}>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold text-slate-900">Client demo (5–7 minutes)</CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">Guided walkthrough for prospects.</p>
            </div>
            {!demo.enabled ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className={cn(buttonVariants({ variant: "default", size: "sm" }), DASH_BTN_PRIMARY)}
                  onClick={() => demo.startDemoFlow("regular")}
                >
                  Regular SO Demo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(DASH_BTN_PRIMARY, "border-slate-200 bg-white")}
                  onClick={() => demo.startDemoFlow("no_qty")}
                >
                  NO_QTY Planning Demo
                </Button>
              </div>
            ) : null}
          </div>
        </CardHeader>
        {demo.enabled ? (
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900">Demo in progress</div>
                <div className="mt-0.5 text-xs text-slate-500">Use the highlighted action to proceed step-by-step.</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("h-8 px-3 text-xs rounded-lg border-slate-200 bg-white")}
                onClick={() => demo.setDemoEnabled(false)}
              >
                Exit demo
              </Button>
            </div>
          </CardContent>
        ) : null}
      </Card>
      {/* Demo Mode: hide operational dashboard widgets completely. */}
      {/* Continue Working list removed — Action Required uses the same /api/dashboard/continue-working data. */}

      {!demo.enabled && canViewOverallSummary && data ? (
        <>
          {/* KPI strip */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              title="Counts sales order lines with dispatch backlog: Regular (NORMAL) by customer PO commitment, plus NO_QTY (cycle-driven) and replacement flows."
              className={DASH_KPI_CHIP}
              {...clickTo("/dispatch")}
              aria-label="Open Dispatch — dispatch prep (regular, No Qty, and replacement)"
            >
              <span className="text-xs font-medium text-slate-600">Dispatch prep</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{data.pendingDispatchCount}</span>
            </button>
            <button type="button" className={DASH_KPI_CHIP} {...clickTo("/work-orders")} aria-label="Open Work Orders">
              <span className="text-xs font-medium text-slate-600">WO pending</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{data.pendingWorkOrders}</span>
            </button>
            {canViewQcQueue ? (
              <button type="button" className={DASH_KPI_CHIP} {...clickTo("/qc-entry")} aria-label="Open QC">
                <span className="text-xs font-medium text-slate-600">QC pending</span>
                <span className="text-sm font-semibold tabular-nums text-slate-900">{qcQueue ? qcQueue.length : 0}</span>
              </button>
            ) : null}
            <button type="button" className={DASH_KPI_CHIP} {...clickTo("/planning-dashboard")} aria-label="Open RM risk">
              <span className="text-xs font-medium text-slate-600">RM risk</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{data.rmStockAlert.length}</span>
            </button>
            <button type="button" className={DASH_KPI_CHIP} {...clickTo("/stock")} aria-label="Open Stock">
              <span className="text-xs font-medium text-slate-600">FG usable</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{fgStockTotal.toFixed(2)}</span>
            </button>
            <button
              type="button"
              title="View rejection details"
              className={DASH_KPI_CHIP}
              {...clickTo("/qc-report?source=dashboard")}
              aria-label="View QC rejection details in QC Report"
            >
              <span className="text-xs font-medium text-slate-600">Rejection %</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{data.qcRejectionPct.toFixed(1)}%</span>
            </button>
          </div>

          {startNewWorkCard}
          {!demo.enabled ? actionRequiredCard : null}

          {/* Pending Actions (main) */}
          <Card className={DASH_CARD}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-slate-900">Pending Actions</CardTitle>
              <p className="text-xs text-slate-500">Alerts that need attention outside the Action Required pipeline.</p>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              <div className="grid gap-2">
                {canViewQcQueue && qcQueueVisible.length > 0 ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">QC pending batches</div>
                      <div className="text-xs text-slate-500">{qcQueueVisible.length} batch(es) awaiting QC</div>
                    </div>
                    <Link
                      to="/qc-entry?source=dashboard"
                      className={cn(buttonVariants({ variant: "default", size: "sm" }), DASH_BTN_PRIMARY, "no-underline")}
                    >
                      Go to QC
                    </Link>
                  </div>
                ) : null}
                {canViewQcQueue && reworkDecisionCount > 0 ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">Rework / hold decisions</div>
                      <div className="text-xs text-slate-500">{reworkDecisionCount} item(s) awaiting decision / action</div>
                    </div>
                    <Link
                      to="/qc-entry?source=dashboard"
                      className={cn(buttonVariants({ variant: "default", size: "sm" }), DASH_BTN_PRIMARY, "no-underline")}
                    >
                      Review
                    </Link>
                  </div>
                ) : null}
                {canViewRmRisk && data.rmStockAlert.length > 0 ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">RM below minimum</div>
                      <div className="text-xs text-slate-500">{data.rmStockAlert.length} item(s) below minimum</div>
                    </div>
                    <Link to="/planning-dashboard?source=dashboard" className={cn(DASH_BTN_SECONDARY, "no-underline")}>
                      Review RM
                    </Link>
                  </div>
                ) : null}
                {canViewDispatchBacklog && data.pendingDispatchCount > 0 ? (
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                    onClick={() => navigate("/dispatch?source=dashboard", { state: { from: "dashboard" } })}
                    aria-label="Open Dispatch — dispatch prep backlog"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900">Dispatch prep</div>
                      <div className="text-xs text-slate-500">
                        {data.pendingDispatchCount} line(s) with dispatch backlog — Regular (customer PO pending), No Qty
                        (cycle-driven), and/or replacement.
                      </div>
                    </div>
                  </button>
                ) : null}
                {canViewPurchaseSummary && purchaseVisible.length > 0 ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">Purchase pending</div>
                      <div className="text-xs text-slate-500">{purchaseVisible.length} PO line(s) pending receipt</div>
                    </div>
                    <Link to="/rm-po-grn?source=dashboard" className={cn(DASH_BTN_SECONDARY, "no-underline")}>
                      Go to Purchase
                    </Link>
                  </div>
                ) : null}
              </div>

              {(!canViewQcQueue || qcQueueVisible.length === 0) &&
              (!canViewQcQueue || reworkDecisionCount === 0) &&
              (!canViewRmRisk || data.rmStockAlert.length === 0) &&
              (!canViewDispatchBacklog || data.pendingDispatchCount <= 0) &&
              (!canViewPurchaseSummary || purchaseVisible.length === 0) ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  All pending actions are clear.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : !demo.enabled ? (
        <>
          {startNewWorkCard}
          {actionRequiredCard}
        </>
      ) : null}

      {!demo.enabled &&
      (canViewDispatchBacklog || canViewProductionQueue || canViewQcQueue) &&
      (backlog === null || prodQueue === null || qcQueue === null) ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Loading queues…
        </div>
      ) : null}

      {/* Queue sections: hide when empty; show small clear line when all clear */}
      {!demo.enabled && canViewDispatchBacklog && backlogVisible.length > 0 ? (
      <Card className={DASH_TABLE_CARD_INTERACTIVE}>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base font-semibold text-slate-900">Dispatch Backlog</CardTitle>
          <Link to="/reports/dispatch-backlog" className={cn(DASH_BTN_SECONDARY, "no-underline")}>
            View All
          </Link>
        </CardHeader>
        <CardContent className={DASH_TABLE_CARD_CONTENT_CLASS}>
          {backlogError ? (
            <DashboardTableError message={backlogError} />
          ) : backlog === null ? (
            <DashboardTableLoading />
          ) : backlog.length === 0 ? (
            <DashboardTableEmpty
              title="No dispatch backlog"
              description="There are no sales order lines with quantity still to dispatch for approved or in-process orders."
            />
          ) : (
            <div
              className={cn(
                DASH_TABLE_WRAP_BASE,
                "cursor-pointer hover:bg-slate-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
              )}
              tabIndex={0}
              role="link"
              aria-label="Open Dispatch backlog report"
              onClick={() => navigate("/reports/dispatch-backlog")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate("/reports/dispatch-backlog");
                }
              }}
            >
              <table className="erp-table dash-table min-w-[640px] sm:min-w-0">
                <thead>
                  <tr>
                    <th>SO No</th>
                    <th>Customer</th>
                    <th>Item</th>
                    <th className="text-right">Ordered</th>
                    <th className="text-right">Dispatched</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Dispatchable now</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {backlogVisible.map((r, idx) => {
                    const urg = dispatchBacklogRowEmphasis(r, backlogVisible);
                    return (
                      <tr
                        key={`${r.salesOrderId}-${r.itemId}-${idx}`}
                        {...getDrillRowProps({
                          onActivate: () => navigate(salesOrdersFocusHref(r.salesOrderId)),
                          ariaLabel: `Open sales order ${r.salesOrderNo}`,
                          activable: drill["sales-order"],
                        })}
                      >
                        <td
                          className={cn(
                            "whitespace-nowrap font-medium tabular-nums",
                            dispatchBacklogLeadCellClass(urg),
                          )}
                        >
                          {r.salesOrderNo}
                        </td>
                        <td className="max-w-[8rem] truncate sm:max-w-none">{r.customerName}</td>
                        <td className="max-w-[10rem] truncate">{r.itemName}</td>
                        <td className="text-right tabular-nums">{r.orderedQty}</td>
                        <td className="text-right tabular-nums">{r.dispatchedQty}</td>
                        <td
                          className={cn(
                            "text-right tabular-nums",
                            urg !== "low" ? "font-semibold text-slate-900" : "font-medium text-slate-800",
                          )}
                        >
                          {r.pendingQty}
                        </td>
                        <td className="text-right tabular-nums">
                          {(() => {
                            const dn = Number(r.dispatchableNow ?? 0) || 0;
                            return dn > ROW_NUM_EPS ? (
                              <span className="font-semibold text-slate-900">{dn}</span>
                            ) : (
                              <span className="text-slate-500">Waiting for stock/QC</span>
                            );
                          })()}
                        </td>
                        <td className="whitespace-nowrap">{new Date(r.salesOrderDate).toLocaleDateString()}</td>
                        <td className="whitespace-nowrap">
                          <Badge
                            variant={dashboardToneToBadgeVariant(dispatchBacklogStatusTone(r.status))}
                            className={DASH_STATUS_BADGE}
                          >
                            {r.status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      ) : null}

      {!demo.enabled &&
      ((canViewProductionQueue && prodQueueVisible.length > 0) || (canViewQcQueue && qcQueueVisible.length > 0)) ? (
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        {canViewProductionQueue && prodQueueVisible.length > 0 ? (
        <Card className={DASH_TABLE_CARD_INTERACTIVE}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base font-semibold text-slate-900">Production Queue</CardTitle>
            <Link to="/work-orders" className={cn(DASH_BTN_SECONDARY, "no-underline")}>
              View All
            </Link>
          </CardHeader>
          <CardContent className={DASH_TABLE_CARD_CONTENT_CLASS}>
            {prodQueueError ? (
              <DashboardTableError message={prodQueueError} />
            ) : prodQueue === null ? (
              <DashboardTableLoading />
            ) : prodQueue.length === 0 ? (
              <DashboardTableEmpty
                title="No active production queue"
                description="No work orders currently have remaining quantity to produce, or none match the dashboard filter."
              />
            ) : (
              <div
                className={cn(
                  DASH_TABLE_WRAP_BASE,
                  "cursor-pointer hover:bg-slate-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
                )}
                tabIndex={0}
                role="link"
                aria-label="Open Work Orders"
                onClick={() => navigate("/work-orders")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/work-orders");
                  }
                }}
              >
                <table className="erp-table dash-table min-w-[560px] sm:min-w-0">
                  <thead>
                    <tr>
                      <th>WO No</th>
                      <th>SO No</th>
                      <th>Item</th>
                      <th className="text-right">SO qty</th>
                      <th className="text-right">Approved</th>
                      <th className="text-right">Remaining</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prodQueueVisible.map((r, idx) => {
                      const balUrg = productionQueueRowEmphasis(r, prodQueueVisible);
                      return (
                        <tr
                          key={`${r.workOrderId}-${r.itemId}-${idx}`}
                          {...getDrillRowProps({
                            onActivate: () => navigate(workOrdersFocusHref(r.workOrderId)),
                            ariaLabel: `Open work order ${r.workOrderNo}`,
                            className: balUrg === "high" ? "[&_td]:!bg-slate-50/90" : undefined,
                            activable: drill["work-order"],
                          })}
                        >
                          <td
                            className={cn(
                              "whitespace-nowrap font-medium tabular-nums",
                              firstCellUrgencyClass(balUrg === "high" ? "high" : "low", "prod"),
                            )}
                          >
                            {r.workOrderNo}
                          </td>
                          <td className="whitespace-nowrap tabular-nums">{r.salesOrderNo}</td>
                          <td className="max-w-[10rem] truncate">{r.itemName}</td>
                          <td className="text-right tabular-nums">{r.requiredQty}</td>
                          <td className="text-right tabular-nums">{r.producedQty}</td>
                          <td
                            className={cn(
                              "text-right tabular-nums",
                              balUrg === "high" ? "font-semibold text-slate-900" : "font-medium text-slate-800",
                            )}
                          >
                            {r.balanceQty}
                          </td>
                          <td className="whitespace-nowrap">
                            <Badge
                              variant={dashboardToneToBadgeVariant(workOrderStatusTone(r.status))}
                              className={DASH_STATUS_BADGE}
                            >
                              {r.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        ) : null}

        {canViewQcQueue && qcQueueVisible.length > 0 ? (
        <Card className={DASH_TABLE_CARD_INTERACTIVE}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base font-semibold text-slate-900">QC Queue</CardTitle>
            <Link to="/qc-entry" className={cn(DASH_BTN_SECONDARY, "no-underline")}>
              View All
            </Link>
          </CardHeader>
          <CardContent className={DASH_TABLE_CARD_CONTENT_CLASS}>
            {qcQueueError ? (
              <DashboardTableError message={qcQueueError} />
            ) : qcQueue === null ? (
              <DashboardTableLoading />
            ) : qcQueue.length === 0 ? (
              <DashboardTableEmpty
                title="No pending QC queue"
                description="There are no production batches waiting for QC, or all queued items are cleared."
              />
            ) : (
              <div
                className={cn(
                  DASH_TABLE_WRAP_BASE,
                  "cursor-pointer hover:bg-slate-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
                )}
                tabIndex={0}
                role="link"
                aria-label="Open QC"
                onClick={() => navigate("/qc-entry")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/qc-entry");
                  }
                }}
              >
                <table className="erp-table dash-table min-w-[640px] sm:min-w-0">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>WO No</th>
                      <th>SO No</th>
                      <th>Item</th>
                      <th className="text-right">Accepted</th>
                      <th className="text-right">Rejected</th>
                      <th className="text-right">Pending QC</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qcQueueVisible.map((r) => {
                      const qcUrg = qcQueueRowEmphasis(r, qcQueueVisible);
                      return (
                        <tr
                          key={r.qcRef}
                          {...getDrillRowProps({
                            onActivate: () => navigate(qcEntryFocusHref(r.workOrderId)),
                            ariaLabel: `Open QC for work order ${r.workOrderNo}`,
                            className: cn(
                              qcUrg === "high" && "[&_td]:!bg-amber-50/55",
                              qcUrg === "medium" && "[&_td]:!bg-amber-50/35",
                            ),
                            activable: drill["qc-entry"],
                          })}
                        >
                          <td
                            className={cn(
                              "whitespace-nowrap font-mono text-[11px] tabular-nums sm:text-xs",
                              firstCellUrgencyClass(qcUrg, "qc"),
                            )}
                          >
                            {r.qcRef}
                          </td>
                          <td className="whitespace-nowrap tabular-nums">{r.workOrderNo}</td>
                          <td className="whitespace-nowrap tabular-nums">{r.salesOrderNo}</td>
                          <td className="max-w-[8rem] truncate sm:max-w-[10rem]">{r.itemName}</td>
                          <td className="text-right tabular-nums">{r.acceptedQty}</td>
                          <td className="text-right tabular-nums">{r.rejectedQty}</td>
                          <td
                            className={cn(
                              "text-right tabular-nums",
                              qcUrg === "high"
                                ? "font-semibold text-slate-900"
                                : qcUrg === "medium"
                                  ? "font-medium text-slate-800"
                                  : "text-slate-700",
                            )}
                          >
                            {r.pendingQcQty}
                          </td>
                          <td className="whitespace-nowrap">
                            <Badge
                              variant={dashboardToneToBadgeVariant(qcQueueStatusTone(r.status))}
                              className={DASH_STATUS_BADGE}
                            >
                              {r.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        ) : null}
      </div>
      ) : null}

      {!demo.enabled && (canViewRmRisk || canViewPurchaseSummary) ? (
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        {canViewRmRisk ? (
        <Card className={DASH_TABLE_CARD_CLASS}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base font-semibold text-slate-900">RM Risk</CardTitle>
            <Link to="/reports/rm-shortage" className={cn(DASH_BTN_SECONDARY, "no-underline")}>
              View All
            </Link>
          </CardHeader>
          <CardContent className={DASH_TABLE_CARD_CONTENT_CLASS}>
            {rmRiskError ? (
              <DashboardTableError message={rmRiskError} />
            ) : rmRisk === null ? (
              <DashboardTableLoading />
            ) : rmRisk.length === 0 ? (
              <DashboardTableEmpty
                title="No RM risk detected"
                description="No critical shortages on open work orders."
              />
            ) : (
              <div className={DASH_TABLE_WRAP_BASE}>
                <table className="erp-table dash-table min-w-[600px] sm:min-w-0">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-right">Stock</th>
                      <th className="text-right">Required</th>
                      <th className="text-right">Free</th>
                      <th className="text-right">Shortage</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rmRiskVisible.map((r) => (
                      <tr
                        key={r.itemId}
                        {...getDrillRowProps({
                          onActivate: () => navigate(stockFocusHref(r.itemId)),
                          ariaLabel: `Open stock for ${r.itemName}`,
                          className: cn(
                            r.status === "CRITICAL" &&
                              "[&_td]:!bg-red-50 [&_td]:border-b-red-100/80 [&_td]:text-slate-900",
                            r.status === "LOW_BUFFER" &&
                              "[&_td]:!bg-amber-50/70 [&_td]:border-b-amber-100/70",
                          ),
                          activable: drill.stock,
                        })}
                      >
                        <td
                          className={cn(
                            "max-w-[10rem] truncate font-medium",
                            r.status === "CRITICAL" &&
                              "border-l-[3px] border-l-red-600 border-y-0 border-r-0 border-solid pl-2",
                            r.status === "LOW_BUFFER" &&
                              "border-l-2 border-l-amber-500/80 border-y-0 border-r-0 border-solid pl-2",
                          )}
                        >
                          {r.itemName}
                        </td>
                        <td className="text-right tabular-nums">{r.currentStockQty}</td>
                        <td className="text-right tabular-nums">{r.requiredQty}</td>
                        <td className="text-right tabular-nums">{r.freeQty}</td>
                        <td
                          className={cn(
                            "text-right tabular-nums font-semibold",
                            r.shortageQty > ROW_NUM_EPS ? "text-red-800" : "text-slate-800",
                          )}
                        >
                          {r.shortageQty}
                        </td>
                        <td className="whitespace-nowrap">
                          <Badge
                            variant={dashboardToneToBadgeVariant(rmRiskStatusTone(r.status))}
                            className={DASH_STATUS_BADGE}
                          >
                            {r.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        ) : null}

        {canViewPurchaseSummary ? (
        <Card className={DASH_TABLE_CARD_CLASS}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base font-semibold text-slate-900">Purchase Summary</CardTitle>
            <Link to="/rm-po-grn" className={cn(DASH_BTN_SECONDARY, "no-underline")}>
              View All
            </Link>
          </CardHeader>
          <CardContent className={DASH_TABLE_CARD_CONTENT_CLASS}>
            {purchaseSummaryError ? (
              <DashboardTableError message={purchaseSummaryError} />
            ) : purchaseSummary === null ? (
              <DashboardTableLoading />
            ) : purchaseSummary.length === 0 ? (
              <DashboardTableEmpty
                title="No pending RM purchases"
                description="No PO lines awaiting receipt for raw materials."
              />
            ) : (
              <div className={DASH_TABLE_WRAP_BASE}>
                <table className="erp-table dash-table min-w-[640px] sm:min-w-0">
                  <thead>
                    <tr>
                      <th>PO No</th>
                      <th>Supplier</th>
                      <th>Item</th>
                      <th className="text-right">Ordered</th>
                      <th className="text-right">Received</th>
                      <th className="text-right">Pending</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseVisible.map((r, idx) => {
                      const pUrg = purchaseRowEmphasis(r, purchaseVisible);
                      return (
                        <tr
                          key={`${r.purchaseOrderId}-${r.itemId}-${idx}`}
                          {...getDrillRowProps({
                            onActivate: () => navigate(rmPoGrnFocusHref(r.purchaseOrderId)),
                            ariaLabel: `Open RM Purchase — ${r.purchaseOrderNo}`,
                            className: pUrg === "high" ? "[&_td]:!bg-slate-50/90" : undefined,
                            activable: drill["rm-po-grn"],
                          })}
                        >
                          <td
                            className={cn(
                              "whitespace-nowrap font-medium tabular-nums",
                              firstCellUrgencyClass(pUrg === "high" ? "high" : "low", "purchase"),
                            )}
                          >
                            {r.purchaseOrderNo}
                          </td>
                          <td className="max-w-[8rem] truncate sm:max-w-none">{r.supplierName}</td>
                          <td className="max-w-[8rem] truncate sm:max-w-[10rem]">{r.itemName}</td>
                          <td className="text-right tabular-nums">{r.orderedQty}</td>
                          <td className="text-right tabular-nums">{r.receivedQty}</td>
                          <td
                            className={cn(
                              "text-right tabular-nums",
                              pUrg === "high"
                                ? "font-semibold text-slate-900"
                                : "font-medium text-slate-800",
                            )}
                          >
                            {r.pendingQty}
                          </td>
                          <td className="whitespace-nowrap">
                            <Badge
                              variant={dashboardToneToBadgeVariant(purchasePoStatusTone(r.status))}
                              className={DASH_STATUS_BADGE}
                            >
                              {r.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        ) : null}
      </div>
      ) : null}

      {!demo.enabled && canViewOverallSummary && data ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
            <Card className={DASH_CARD}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-slate-900">Inventory snapshot</CardTitle>
                <p className="text-xs text-slate-500">Compact FG and RM view.</p>
              </CardHeader>
              <CardContent className="grid gap-4 pt-0 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-slate-900">FG usable stock (top)</div>
                  <div className="mt-1.5 space-y-1">
                    {data.fgStock.slice(0, 5).map((fg) => (
                      <div key={fg.itemId} className="flex min-h-8 items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-slate-700" title={fg.itemName}>
                          {displayShortItemName(fg.itemName)}
                        </span>
                        <span className="shrink-0 tabular-nums text-sm font-semibold text-slate-900">{fg.qty}</span>
                      </div>
                    ))}
                    {data.fgStock.length === 0 ? (
                      <DashboardTableEmpty title="No FG stock rows" description="Finished goods will appear here." />
                    ) : null}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900">RM below minimum (top)</div>
                  <div className="mt-1.5 space-y-1">
                    {data.rmStockAlert.slice(0, 5).map((r) => (
                      <div key={r.itemId} className="flex min-h-8 items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-slate-700" title={r.itemName}>
                          {displayShortItemName(r.itemName)}
                        </span>
                        <span className="shrink-0 tabular-nums text-sm text-slate-700">
                          {r.qty} / min {r.minStockLevel}
                        </span>
                      </div>
                    ))}
                    {data.rmStockAlert.length === 0 ? (
                      <DashboardTableEmpty title="No RM below minimum" description="Stock levels are within policy." />
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={DASH_CARD}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-slate-900">Recent QC rejections</CardTitle>
                <p className="text-xs text-slate-500">Latest losses from quality checks.</p>
              </CardHeader>
              <CardContent className="pt-0">
                {data.recentQcRejections.length === 0 ? (
                  <DashboardTableEmpty title="No recent QC rejection." />
                ) : (
                  <div className={DASH_TABLE_WRAP_BASE}>
                    <table className="erp-table dash-table min-w-[420px] sm:min-w-0">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>FG</th>
                          <th className="text-right">Rejected</th>
                          <th className="text-right">Loss</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentQcRejections.slice(0, 3).map((q) => (
                          <tr key={q.id}>
                            <td className="whitespace-nowrap">{new Date(q.date).toLocaleDateString()}</td>
                            <td className="max-w-[12rem] truncate" title={q.itemName}>
                              {displayShortItemName(q.itemName)}
                            </td>
                            <td className="text-right tabular-nums font-semibold text-slate-900">{q.rejectedQty}</td>
                            <td className="text-right tabular-nums font-semibold text-slate-900">{q.lossQty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
        </div>
      </div>
    </div>
  );
}
