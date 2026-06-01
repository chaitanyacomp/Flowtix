import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { Card, CardContent } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { isReportsReturnContext } from "../lib/drillDownRoutes";
import {
  OperatorPageBody,
  OperatorPageTitle,
  OperatorTopBar,
  operatorInputClass,
  operatorTableRowClass,
} from "../components/erp/OperatorWorkbench";
import { PageSmartBackLink, StickyReportBackStrip, StickyWorkspaceHead } from "../components/PageHeader";
import { ERP_REPORT_POLL_MS, useErpRefreshTick } from "../hooks/useErpRefreshTick";
import { ItemStockStatusBadge } from "../components/erp/ItemStockStatusBadge";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import {
  computeLowStockShortageQty,
  countRmInventoryHealthAlerts,
  isRmBelowLowStockAlert,
  itemStockStatusFromItemFields,
  parseLowStockLevel,
} from "../lib/itemStockStatus";
import { formatRmStockAlertBanner } from "../lib/inventoryHealth";
import { REGULAR_TERMS } from "../lib/flowTerminology";
import { erpKpi } from "../lib/erpFoundationTokens";

const STOCK_PRIMARY_BTN = "h-8 px-3 text-[12px] font-bold shadow-sm";
const STOCK_SECONDARY_BTN = "h-8 px-3 text-[12px]";

type LocationMeta = { id: number; locationName: string; locationCode?: string; locationType?: string };

type GroupedLocationRow = {
  locationId: number | null;
  locationName: string;
  locationType?: string | null;
  items: Array<{ itemId: number; itemName: string; unit: string; qty: number }>;
};

function locationChipClass(locationType?: string | null) {
  const t = String(locationType || "").toUpperCase();
  if (t === "RM_STORE" || t === "CONSUMABLE") {
    return "border-emerald-300 bg-emerald-100 text-emerald-950";
  }
  if (t === "PRODUCTION" || t === "WIP") {
    return "border-sky-300 bg-sky-100 text-sky-950";
  }
  if (t === "FG_STORE") {
    return "border-violet-300 bg-violet-100 text-violet-950";
  }
  return "border-slate-300 bg-slate-100 text-slate-900";
}

function LocationChip({ name, locationType }: { name: string; locationType?: string | null }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-[13px] font-bold tracking-tight",
        locationChipClass(locationType),
      )}
    >
      {name}
    </span>
  );
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

type ItemThresholdRow = {
  id: number;
  itemType: string;
  minimumStockQty?: string | null;
  minStockLevel?: string | null;
};

type StockBucketsRow = {
  itemId: number;
  item: { itemName: string; itemType: string; unit: string };
  usableQty: number;
  qcHoldQty: number;
  /** Awaiting QC re-check after rework (not Hold for Checking) */
  qcPendingQty: number;
  reworkQty: number;
  scrapQty: number;
};

type StockByLocationRow = {
  itemId: number;
  item: { itemName: string; itemType: string; unit: string } | null;
  locationId: number | null;
  locationName: string;
  qty: number;
};

type GodownRow = {
  itemId: number;
  itemName: string;
  itemType: string;
  unit: string;
  total: number;
  rmStore: number;
  reservedStock: number;
  freeStock: number;
  production: number;
  wip: number;
  fgStore: number;
  qcHold: number;
  scrap: number;
  unassignedUsable?: number;
};

type GodownOverview = {
  rows: GodownRow[];
  totals: GodownRow & { total: number };
};

const STOCK_URL_OMIT: Record<string, string> = { itemType: "ALL" };

const GODOWN_COLS = [
  { key: "rmStore" as const, label: "Physical", short: "Phys.", title: "Usable stock in RM store (physical)" },
  {
    key: "reservedStock" as const,
    label: "Committed",
    short: "Com.",
    title: "Committed stock is already linked to active work orders",
  },
  { key: "freeStock" as const, label: "Available", short: "Avail.", title: "Stock not yet committed — free to allocate" },
  { key: "production" as const, label: "At Production", short: "Prod." },
  { key: "wip" as const, label: "WIP", short: "WIP" },
  { key: "fgStore" as const, label: "FG Store", short: "FG" },
  { key: "qcHold" as const, label: "Under QC", short: "QC" },
  { key: "scrap" as const, label: "Scrap", short: "Scrap" },
];

function fmtQtyStock(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // UI-only: keep numbers readable (max 2 decimals)
  return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function StockPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromReportsHub = isReportsReturnContext(location.search);
  const { patch, read } = useUrlQueryState(STOCK_URL_OMIT);
  const itemTypeFilterVal = read.enum("itemType", ["ALL", "FG", "RM"] as const, "ALL");
  const qFromUrl = read.string("q");
  const fromDashboardRmAlert = read.string("source") === "dashboard";
  const [qDraft, setQDraft] = useDebouncedUrlStringParam({ urlValue: qFromUrl, patch, paramKey: "q" });
  const [showFilter, setShowFilter] = React.useState<"ALL" | "IN_STOCK" | "ZERO_STOCK" | "LOW_STOCK">("ALL");

  const [rows, setRows] = React.useState<StockBucketsRow[]>([]);
  const [itemThresholdsById, setItemThresholdsById] = React.useState<
    Map<number, { itemType: string; minimumStockQty?: string | null; minStockLevel?: string | null }>
  >(() => new Map());
  const [allItemsLoaded, setAllItemsLoaded] = React.useState(false);
  const [summaryLoaded, setSummaryLoaded] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"godown" | "item" | "location">("godown");
  const [godown, setGodown] = React.useState<GodownOverview | null>(null);
  const [godownLoaded, setGodownLoaded] = React.useState(false);
  const [locationLayout, setLocationLayout] = React.useState<"flat" | "grouped">("flat");
  const [byLocationRows, setByLocationRows] = React.useState<StockByLocationRow[]>([]);
  const [byLocationGrouped, setByLocationGrouped] = React.useState<GroupedLocationRow[]>([]);
  const [byLocationLoaded, setByLocationLoaded] = React.useState(false);
  const [locationMetaById, setLocationMetaById] = React.useState<Map<number, LocationMeta>>(() => new Map());
  const [transfersToday, setTransfersToday] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const liveTick = useErpRefreshTick(["reports", "stock", "qc", "production", "dispatch"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });

  function loadGodown() {
    setGodownLoaded(false);
    const qs = new URLSearchParams();
    if (itemTypeFilterVal !== "ALL") qs.set("itemType", itemTypeFilterVal);
    if (qDraft.trim()) qs.set("q", qDraft.trim());
    return apiFetch<GodownOverview>(`/api/stock/godown-overview?${qs}`)
      .then((data) => setGodown(data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load godown stock"))
      .finally(() => setGodownLoaded(true));
  }

  function loadSummary() {
    return apiFetch<StockBucketsRow[]>("/api/stock/summary-buckets")
      .then((data) =>
        setRows(
          (Array.isArray(data) ? data : []).map((row) => ({
            ...row,
            qcPendingQty: row.qcPendingQty ?? 0,
          })),
        ),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setSummaryLoaded(true));
  }

  function loadByLocation(layout: "flat" | "grouped" = locationLayout) {
    setByLocationLoaded(false);
    if (layout === "grouped") {
      return apiFetch<GroupedLocationRow[]>("/api/material-issues/stock-by-location-grouped")
        .then((data) => setByLocationGrouped(Array.isArray(data) ? data : []))
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load location stock"))
        .finally(() => setByLocationLoaded(true));
    }
    return apiFetch<StockByLocationRow[]>("/api/stock/summary-by-location")
      .then((data) => setByLocationRows(Array.isArray(data) ? data : []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load location stock"))
      .finally(() => setByLocationLoaded(true));
  }

  function loadKpiExtras() {
    const today = todayIsoDate();
    return Promise.all([
      apiFetch<GroupedLocationRow[]>("/api/material-issues/stock-by-location-grouped").catch(() => []),
      apiFetch<LocationMeta[]>("/api/locations").catch(() => []),
      apiFetch<{ items: Array<{ transactionType: string; refId: number; qtyOut: number }>; total: number }>(
        `/api/stock/movement-history?movement=LOCATION_TRANSFER&dateFrom=${today}&dateTo=${today}&pageSize=200&page=1`,
      ).catch(() => ({ items: [], total: 0 })),
    ]).then(([grouped, locs, transfers]) => {
      setByLocationGrouped(Array.isArray(grouped) ? grouped : []);
      const locMap = new Map<number, LocationMeta>();
      for (const l of Array.isArray(locs) ? locs : []) {
        locMap.set(l.id, l);
      }
      setLocationMetaById(locMap);
      const refs = new Set<number>();
      for (const it of transfers.items || []) {
        if (it.transactionType === "LOCATION_TRANSFER" && it.refId > 0 && Number(it.qtyOut) > 0) {
          refs.add(it.refId);
        }
      }
      setTransfersToday(refs.size);
    });
  }

  React.useEffect(() => {
    void loadGodown();
    void loadSummary();
    void loadKpiExtras();
    apiFetch<ItemThresholdRow[]>("/api/items")
      .then((items) => {
        const m = new Map<
          number,
          { itemType: string; minimumStockQty?: string | null; minStockLevel?: string | null }
        >();
        for (const it of Array.isArray(items) ? items : []) {
          m.set(it.id, {
            itemType: it.itemType,
            minimumStockQty: it.minimumStockQty,
            minStockLevel: it.minStockLevel,
          });
        }
        setItemThresholdsById(m);
      })
      .catch(() => setItemThresholdsById(new Map()))
      .finally(() => setAllItemsLoaded(true));
  }, [liveTick]);

  React.useEffect(() => {
    if (!fromDashboardRmAlert) return;
    patch({ itemType: "RM" });
    setShowFilter("LOW_STOCK");
  }, [fromDashboardRmAlert, patch]);

  const visibleStockRows = React.useMemo(() => {
    const q = qDraft.trim().toLowerCase();
    return rows.filter((r) => {
      if (itemTypeFilterVal !== "ALL" && r.item.itemType !== itemTypeFilterVal) return false;
      if (q && !r.item.itemName.toLowerCase().includes(q)) return false;
      const currentStock = Number(r.usableQty) || 0;
      const th = itemThresholdsById.get(r.itemId);
      if (showFilter === "IN_STOCK" && currentStock <= 0) return false;
      if (showFilter === "ZERO_STOCK" && currentStock > 0) return false;
      if (
        showFilter === "LOW_STOCK" &&
        !isRmBelowLowStockAlert({
          usableStock: currentStock,
          minimumStockQty: th?.minimumStockQty,
          minStockLevel: th?.minStockLevel,
        })
      ) {
        return false;
      }
      return true;
    });
  }, [rows, itemTypeFilterVal, qDraft, showFilter, itemThresholdsById]);

  const stockListFiltersActive =
    itemTypeFilterVal !== "ALL" || qDraft.trim().length > 0 || showFilter !== "ALL";

  function clearStockListFilters() {
    setQDraft("");
    setShowFilter("ALL");
    patch({ q: null, itemType: null });
  }

  const rmLowStockPolicyCount = React.useMemo(() => {
    let n = 0;
    for (const th of itemThresholdsById.values()) {
      if (th.itemType === "RM" && parseLowStockLevel(th.minStockLevel) != null) n += 1;
    }
    return n;
  }, [itemThresholdsById]);

  const operationalKpis = React.useMemo(() => {
    let totalRmStock = 0;
    for (const r of rows) {
      const usable = Number(r.usableQty) || 0;
      if (r.item.itemType === "RM") totalRmStock += usable;
    }
    const rmAlertCounts = countRmInventoryHealthAlerts(rows, itemThresholdsById);
    let productionLocationStock = 0;
    for (const loc of byLocationGrouped) {
      const t = String(loc.locationType || locationMetaById.get(loc.locationId ?? -1)?.locationType || "").toUpperCase();
      if (t === "PRODUCTION" || t === "WIP") {
        productionLocationStock += loc.items.reduce((s, it) => s + Number(it.qty || 0), 0);
      }
    }
    return {
      totalRmStock,
      productionLocationStock,
      rmAlertCounts,
      lowStockItems: rmAlertCounts.total,
    };
  }, [rows, itemThresholdsById, byLocationGrouped, locationMetaById]);

  function openMovementHistory(itemId: number, locationId?: number | null) {
    const params = new URLSearchParams();
    params.set("itemId", String(itemId));
    params.set("sort", "desc");
    if (locationId != null && locationId > 0) params.set("locationId", String(locationId));
    navigate(`/stock/movement-history?${params.toString()}`);
  }

  function openByLocationForItem(itemName: string, itemType: string) {
    setViewMode("location");
    setLocationLayout("grouped");
    setQDraft(itemName);
    patch({ itemType: itemType === "RM" ? "RM" : itemType === "FG" ? "FG" : null, q: itemName });
    void loadByLocation("grouped");
  }

  function openItemDrilldown(itemId: number) {
    navigate(`/stock/items/${itemId}`);
  }

  const godownRmRows = React.useMemo(
    () => (godown?.rows ?? []).filter((r) => r.itemType === "RM"),
    [godown],
  );
  const godownFgRows = React.useMemo(
    () => (godown?.rows ?? []).filter((r) => r.itemType === "FG"),
    [godown],
  );

  function sumGodownSection(rows: GodownRow[]): GodownRow {
    const t: GodownRow = {
      itemId: 0,
      itemName: "",
      itemType: "",
      unit: "",
      total: 0,
      rmStore: 0,
      reservedStock: 0,
      freeStock: 0,
      production: 0,
      wip: 0,
      fgStore: 0,
      qcHold: 0,
      scrap: 0,
      unassignedUsable: 0,
    };
    for (const r of rows) {
      t.total += r.total;
      for (const c of GODOWN_COLS) t[c.key] += r[c.key];
      t.unassignedUsable = (t.unassignedUsable ?? 0) + (r.unassignedUsable ?? 0);
    }
    return t;
  }

  const godownRmTotals = React.useMemo(() => sumGodownSection(godownRmRows), [godownRmRows]);
  const godownFgTotals = React.useMemo(() => sumGodownSection(godownFgRows), [godownFgRows]);

  React.useEffect(() => {
    if (viewMode === "godown") void loadGodown();
  }, [itemTypeFilterVal, qDraft, liveTick, viewMode]);

  function renderGodownTable(sectionRows: GodownRow[], totals: GodownRow | null, title: string) {
    if (!sectionRows.length) return null;
    return (
      <div className="space-y-1">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-slate-700">{title}</h3>
        <div className="overflow-hidden rounded border border-slate-200 bg-white">
          <table className="w-full table-fixed text-[12px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-600">
              <tr>
                <th className="w-[28%] px-2 py-1.5 text-left font-medium">Item</th>
                <th className="w-[10%] px-1 py-1.5 text-right font-medium">Total</th>
                {GODOWN_COLS.map((c) => (
                  <th
                    key={c.key}
                    className="px-1 py-1.5 text-right font-medium"
                    title={"title" in c && c.title ? String(c.title) : c.label}
                  >
                    <span className="hidden sm:inline">{c.label}</span>
                    <span className="sm:hidden">{c.short}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sectionRows.map((r) => (
                <tr
                  key={r.itemId}
                  className={cn(
                    "cursor-pointer border-b border-slate-100 hover:bg-sky-50/60",
                    operatorTableRowClass,
                  )}
                  onClick={() => openItemDrilldown(r.itemId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openItemDrilldown(r.itemId);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <td className="truncate px-2 py-1.5 font-medium text-slate-900" title={r.itemName}>
                    {r.itemName}
                  </td>
                  <td className="px-1 py-1.5 text-right tabular-nums font-bold text-slate-900">
                    {fmtQtyStock(r.total)}
                  </td>
                  {GODOWN_COLS.map((c) => (
                    <td key={c.key} className="px-1 py-1.5 text-right tabular-nums text-slate-800">
                      {r[c.key] > 0 ? fmtQtyStock(r[c.key]) : <span className="text-slate-300">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              {totals ? (
                <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold">
                  <td className="px-2 py-1.5 text-slate-700">Total</td>
                  <td className="px-1 py-1.5 text-right tabular-nums">{fmtQtyStock(totals.total)}</td>
                  {GODOWN_COLS.map((c) => (
                    <td key={c.key} className="px-1 py-1.5 text-right tabular-nums">
                      {totals[c.key] > 0 ? fmtQtyStock(totals[c.key]) : "—"}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const stockSummaryTitleRow = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <OperatorPageTitle>Stock Summary</OperatorPageTitle>
        <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-600">
          See where stock sits by godown — store, production, QC, and scrap. Click an item for movement detail.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          className={STOCK_PRIMARY_BTN}
          onClick={() => navigate("/stock/movement-history")}
        >
          Stock Movement History
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(STOCK_SECONDARY_BTN, "font-semibold")}
          onClick={() => navigate("/stock/adjustment")}
        >
          Stock Adjustments
        </Button>
      </div>
    </div>
  );

  return (
    <OperatorPageBody>
      <Card className="mx-auto w-full max-w-[1680px] border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-4">
          {fromReportsHub ? (
            <>
              <StickyReportBackStrip className="-mx-4 px-4" />
              {stockSummaryTitleRow}
            </>
          ) : (
            <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/dashboard" defaultLabel="Back to Dashboard" />}>
              {stockSummaryTitleRow}
            </StickyWorkspaceHead>
          )}
          {error ? <div className="text-[13px] text-red-700">{error}</div> : null}

          {fromDashboardRmAlert && summaryLoaded ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
              <span className="font-semibold">Stock replenishment:</span>{" "}
              {formatRmStockAlertBanner(
                operationalKpis.rmAlertCounts.critical,
                operationalKpis.rmAlertCounts.warning,
              ) ?? "filtered list"}
              <p className="mt-1 text-[12px] text-amber-900/90">{REGULAR_TERMS.DASHBOARD_STOCK_REPLENISHMENT_TOOLTIP}</p>
            </div>
          ) : null}

          {summaryLoaded ? (
            <ErpKpiStrip className={erpKpi.stripCompact} role="region" aria-label="Stock operational metrics">
              <ErpKpiSegment as="div">
                <ErpKpiLabel>Total RM stock</ErpKpiLabel>
                <ErpKpiValue className="tabular-nums">{fmtQtyStock(operationalKpis.totalRmStock)}</ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment as="div">
                <ErpKpiLabel>Production location stock</ErpKpiLabel>
                <ErpKpiValue className="tabular-nums">{fmtQtyStock(operationalKpis.productionLocationStock)}</ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment as="div">
                <ErpKpiLabel>{REGULAR_TERMS.DASHBOARD_RM_CRITICAL_LABEL}</ErpKpiLabel>
                <ErpKpiValue
                  tone={operationalKpis.rmAlertCounts.critical > 0 ? "crit" : "default"}
                  className="tabular-nums"
                >
                  {operationalKpis.rmAlertCounts.critical}
                </ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment as="div">
                <ErpKpiLabel>{REGULAR_TERMS.DASHBOARD_RM_WARNING_LABEL}</ErpKpiLabel>
                <ErpKpiValue
                  tone={operationalKpis.rmAlertCounts.warning > 0 ? "warn" : "default"}
                  className="tabular-nums"
                >
                  {operationalKpis.rmAlertCounts.warning}
                </ErpKpiValue>
              </ErpKpiSegment>
              <ErpKpiSegment as="div">
                <ErpKpiLabel>Material transfers today</ErpKpiLabel>
                <ErpKpiValue className="tabular-nums">{transfersToday ?? "—"}</ErpKpiValue>
              </ErpKpiSegment>
            </ErpKpiStrip>
          ) : null}

          <OperatorTopBar className="rounded border border-slate-200 bg-slate-50/90 p-2">
            <div className="erp-form-field min-w-[8rem]">
              <span className="text-[12px] font-medium text-slate-600">Item type</span>
              <select
                className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                value={itemTypeFilterVal}
                onChange={(e) => {
                  patch({ itemType: e.target.value as typeof itemTypeFilterVal });
                }}
              >
                <option value="ALL">All</option>
                <option value="FG">FG</option>
                <option value="RM">RM</option>
              </select>
            </div>
            <div className="erp-form-field min-w-[12rem] flex-1">
              <span className="text-[12px] font-medium text-slate-600">Search item</span>
              <Input
                className={cn("mt-0.5 text-[13px]", operatorInputClass)}
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                placeholder="Type item name…"
              />
            </div>
            <div className="erp-form-field min-w-[10rem]">
              <span className="text-[12px] font-medium text-slate-600">Show</span>
              <select
                className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                value={showFilter}
                onChange={(e) => setShowFilter(e.target.value as typeof showFilter)}
                disabled={viewMode === "location" || viewMode === "godown"}
              >
                <option value="ALL">All</option>
                <option value="IN_STOCK">In stock</option>
                <option value="ZERO_STOCK">Zero stock</option>
                <option value="LOW_STOCK">RM stock alerts (critical or warning)</option>
              </select>
            </div>
            <div className="erp-form-field min-w-[11rem]">
              <span className="text-[12px] font-medium text-slate-600">View</span>
              <select
                className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                value={viewMode}
                onChange={(e) => {
                  const m = e.target.value as "godown" | "item" | "location";
                  setViewMode(m);
                  if (m === "location") void loadByLocation(locationLayout);
                  if (m === "godown") void loadGodown();
                }}
              >
                <option value="godown">Godown overview</option>
                <option value="item">By item (buckets)</option>
                <option value="location">By location</option>
              </select>
            </div>
            {viewMode === "location" ? (
              <div className="erp-form-field min-w-[12rem]">
                <span className="text-[12px] font-medium text-slate-600">Location layout</span>
                <select
                  className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                  value={locationLayout}
                  onChange={(e) => {
                    const layout = e.target.value as "flat" | "grouped";
                    setLocationLayout(layout);
                    void loadByLocation(layout);
                  }}
                >
                  <option value="flat">Flat list</option>
                  <option value="grouped">Grouped by location</option>
                </select>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(STOCK_SECONDARY_BTN, operatorInputClass)}
                disabled={!stockListFiltersActive}
                onClick={clearStockListFilters}
              >
                Clear filters
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(STOCK_SECONDARY_BTN, operatorInputClass)}
                onClick={() => {
                  void loadGodown();
                  void loadSummary();
                  void loadKpiExtras();
                  if (viewMode === "location") void loadByLocation();
                }}
              >
                Refresh
              </Button>
            </div>
          </OperatorTopBar>

          <div className="space-y-2">
            {viewMode === "item" && rows.length > 0 ? (
              <p className="text-xs text-slate-500">
                Showing <span className="font-semibold tabular-nums text-slate-700">{visibleStockRows.length}</span> of{" "}
                <span className="tabular-nums">{rows.length}</span> items
              </p>
            ) : null}
            {viewMode === "location" ? (
              <p className="text-xs text-slate-500">
                Usable stock per location — use grouped view to see RM Store vs production departments side by side.
              </p>
            ) : null}

            {viewMode === "godown" ? (
              <div className="space-y-4">
                {!godownLoaded ? (
                  <p className="text-sm text-slate-600">Loading godown stock…</p>
                ) : godownRmRows.length === 0 && godownFgRows.length === 0 ? (
                  <p className="text-sm text-slate-600">No stock on hand for the current filters.</p>
                ) : (
                  <>
                    {itemTypeFilterVal !== "FG" ? (
                      <div className="space-y-1">
                        {renderGodownTable(godownRmRows, godownRmTotals, "Raw materials")}
                        <p className="text-[11px] leading-snug text-slate-600">
                          <span className="font-semibold text-slate-700">Physical</span> — stock in RM store.{" "}
                          <span className="font-semibold text-slate-700">Committed</span> — already linked to active work
                          orders. <span className="font-semibold text-slate-700">Available</span> — free to allocate on new
                          work.
                        </p>
                      </div>
                    ) : null}
                    {itemTypeFilterVal !== "RM" ? renderGodownTable(godownFgRows, godownFgTotals, "Finished goods") : null}
                  </>
                )}
              </div>
            ) : null}

            {viewMode === "location" && locationLayout === "grouped" ? (
              <div className="space-y-3">
                {byLocationGrouped
                  .map((loc) => ({
                    ...loc,
                    items: loc.items.filter((it) => {
                      const q = qDraft.trim().toLowerCase();
                      if (q && !it.itemName.toLowerCase().includes(q)) return false;
                      return true;
                    }),
                  }))
                  .filter((loc) => loc.items.length > 0)
                  .map((loc) => (
                    <div key={loc.locationId ?? "u"} className="overflow-hidden rounded border border-slate-200 bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                        <LocationChip
                          name={loc.locationName}
                          locationType={loc.locationType ?? locationMetaById.get(loc.locationId ?? -1)?.locationType}
                        />
                        <span className="text-[11px] font-medium text-slate-500">
                          {loc.items.length} item{loc.items.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <table className="w-full text-[13px]">
                        <tbody>
                          {loc.items.map((it) => (
                            <tr key={`${loc.locationId}-${it.itemId}`} className={cn("border-b border-slate-100", operatorTableRowClass)}>
                              <td className="px-3 py-1.5 font-medium text-slate-900">{it.itemName}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                                {fmtQtyStock(it.qty)}
                                {it.unit ? <span className="ml-1 font-normal text-slate-500">{it.unit}</span> : null}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 px-2 text-[11px] font-bold"
                                    onClick={() => openMovementHistory(it.itemId, loc.locationId)}
                                  >
                                    Movement History
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                {byLocationLoaded && byLocationGrouped.length === 0 ? (
                  <p className="text-sm text-slate-600">No location stock found.</p>
                ) : null}
              </div>
            ) : null}

            {viewMode === "location" && locationLayout === "flat" ? (
              <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr className="text-left text-[12px] text-slate-600">
                      <th className="px-2 py-1.5 font-medium">Item</th>
                      <th className="px-2 py-1.5 font-medium">Type</th>
                      <th className="px-2 py-1.5 font-medium">Location</th>
                      <th className="px-2 py-1.5 text-right font-medium">Usable qty</th>
                      <th className="px-2 py-1.5 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byLocationRows
                      .filter((r) => {
                        const q = qDraft.trim().toLowerCase();
                        if (itemTypeFilterVal !== "ALL" && r.item?.itemType !== itemTypeFilterVal) return false;
                        if (q && !String(r.item?.itemName ?? "").toLowerCase().includes(q)) return false;
                        return true;
                      })
                      .map((r) => (
                        <tr key={`${r.itemId}-${r.locationId ?? "u"}`} className={cn("border-b border-slate-100", operatorTableRowClass)}>
                          <td className="px-2 py-1.5 font-medium text-slate-900">{r.item?.itemName ?? `Item #${r.itemId}`}</td>
                          <td className="px-2 py-1.5 text-slate-600">{r.item?.itemType ?? "—"}</td>
                          <td className="px-2 py-1.5">
                            <LocationChip
                              name={r.locationName}
                              locationType={
                                r.locationId != null
                                  ? locationMetaById.get(r.locationId)?.locationType
                                  : null
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">{fmtQtyStock(r.qty)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 px-2 text-[11px] font-bold"
                              onClick={() => openMovementHistory(r.itemId, r.locationId)}
                            >
                              Movement History
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {byLocationLoaded && byLocationRows.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-slate-600">No location stock rows found.</p>
                ) : null}
              </div>
            ) : null}

            {viewMode === "item" ? (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full min-w-[980px] text-[13px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr className="text-left text-[12px] text-slate-600">
                    <th className="px-2 py-1.5 font-medium">Item ID</th>
                    <th className="px-2 py-1.5 font-medium">Item name</th>
                    <th className="px-2 py-1.5 font-medium">Type</th>
                    <th className="px-2 py-1.5 font-medium">Unit</th>
                    <th className="px-2 py-1.5 font-medium whitespace-nowrap">Stock status</th>
                    <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">Usable stock</th>
                    <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap text-slate-500">Low stock level</th>
                    <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">Shortage qty</th>
                    <th className="px-2 py-1.5 text-right font-medium">QC hold</th>
                    <th className="px-2 py-1.5 text-right font-medium">QC pending</th>
                    <th className="px-2 py-1.5 text-right font-medium">Rework</th>
                    <th className="px-2 py-1.5 text-right font-medium">Scrap</th>
                    <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">Total (all buckets)</th>
                    <th className="px-2 py-1.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStockRows.map((r) => {
                    const th = itemThresholdsById.get(r.itemId);
                    const usable = Number(r.usableQty) || 0;
                    const lowLevel = parseLowStockLevel(th?.minStockLevel);
                    const shortage = computeLowStockShortageQty({
                      usableStock: usable,
                      minStockLevel: th?.minStockLevel,
                    });
                    const stockStatus = itemStockStatusFromItemFields({
                      currentQty: usable,
                      minimumStockQty: th?.minimumStockQty,
                      minStockLevel: th?.minStockLevel,
                    });
                    const isShortageRow = stockStatus !== "HEALTHY";
                    const isCriticalRow =
                      stockStatus === "OUT_OF_STOCK" || stockStatus === "CRITICAL";
                    return (
                    <tr
                      key={r.itemId}
                      className={cn(
                        "border-b border-slate-100 align-middle",
                        operatorTableRowClass,
                        isCriticalRow && "bg-red-50/90",
                        isShortageRow && !isCriticalRow && "bg-amber-50/90",
                        fromDashboardRmAlert &&
                          isShortageRow &&
                          (isCriticalRow
                            ? "ring-1 ring-inset ring-red-300/80"
                            : "ring-1 ring-inset ring-amber-300/80"),
                      )}
                    >
                      <td className="px-2 py-1.5 font-mono text-slate-700">{r.itemId}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-900">{r.item.itemName}</td>
                      <td className="px-2 py-1.5">
                        <Badge
                          variant={r.item.itemType === "FG" ? "success" : "default"}
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        >
                          {r.item.itemType}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{r.item.unit}</td>
                      <td className="px-2 py-1.5">
                        <ItemStockStatusBadge
                          currentQty={usable}
                          minimumStockQty={th?.minimumStockQty}
                          minStockLevel={th?.minStockLevel}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {usable <= 0 ? (
                          <span className="inline-flex items-center justify-end gap-1.5 font-bold text-red-700">
                            <span className="tabular-nums">{fmtQtyStock(0)}</span>
                            <span className="rounded border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-semibold text-red-800">
                              Out of stock
                            </span>
                          </span>
                        ) : (
                          <span className="font-bold text-slate-900">{fmtQtyStock(usable)}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                        {lowLevel != null ? fmtQtyStock(lowLevel) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {shortage > 0 ? (
                          <span className="font-semibold text-red-700">{fmtQtyStock(shortage)}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtQtyStock(r.qcHoldQty || 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtQtyStock(r.qcPendingQty || 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtQtyStock(r.reworkQty || 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtQtyStock(r.scrapQty || 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                        {fmtQtyStock(
                          usable +
                            Number(r.qcHoldQty || 0) +
                            Number(r.qcPendingQty || 0) +
                            Number(r.reworkQty || 0) +
                            Number(r.scrapQty || 0),
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-2 text-[11px] font-bold"
                            onClick={(e) => {
                              e.stopPropagation();
                              openItemDrilldown(r.itemId);
                            }}
                          >
                            Godown detail
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              openMovementHistory(r.itemId);
                            }}
                          >
                            Movements
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              openByLocationForItem(r.item.itemName, r.item.itemType);
                            }}
                          >
                            By Location
                          </Button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            ) : null}

            {viewMode === "item" && summaryLoaded && allItemsLoaded && rows.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                {rmLowStockPolicyCount === 0 ? (
                  <p>
                    <span className="font-semibold text-slate-900">No items configured.</span> No RM items have a low
                    stock level set on the Item master. Configure minimum / low stock on{" "}
                    <button
                      type="button"
                      className="font-semibold text-sky-800 underline"
                      onClick={() => navigate("/items")}
                    >
                      Items
                    </button>{" "}
                    to track shortages here and on the dashboard.
                  </p>
                ) : (
                  <p>
                    <span className="font-semibold text-slate-900">Items exist but stock is zero.</span>{" "}
                    {rmLowStockPolicyCount} RM item{rmLowStockPolicyCount === 1 ? "" : "s"} have a low stock policy but
                    no stock ledger rows yet — they should appear in the table above after refresh.
                  </p>
                )}
              </div>
            ) : null}
            {viewMode === "item" && summaryLoaded && rows.length > 0 && visibleStockRows.length === 0 ? (
              <p className="text-sm text-slate-600">
                No rows match the current filters.{" "}
                <button type="button" className="font-semibold text-sky-800 underline" onClick={clearStockListFilters}>
                  Clear filters
                </button>
              </p>
            ) : null}
            {rows.length > 0 ? (
              <p className="text-sm text-slate-600">
                Use <strong>Movement History</strong> on each row, or open <strong>Stock Movement History</strong> above for all transfers and receipts.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </OperatorPageBody>
  );
}
