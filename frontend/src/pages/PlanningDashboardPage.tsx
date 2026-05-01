import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageContainer, PageNoQtyFlowBackLink, PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button, buttonVariants } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { apiFetch } from "../services/api";
import { cn } from "../lib/utils";
import { useAuth } from "../hooks/useAuth";
import { useDemoMode } from "../contexts/DemoModeContext";
import { demoHighlightKey } from "../lib/demoFlowConfig";
import type { RmRequirementRow } from "./rmPurchase/rmPurchaseShared";

type Zone = "RED" | "YELLOW" | "GREEN" | "EXCESS";

type Row = {
  itemId: number;
  itemName: string;
  customerName: string;
  requirementQty: number;
  stockQty: number;
  gapPercent: number | null;
  suggestedWoQty: number;
  colorZone: Zone;
};

type ProductRow = {
  itemId: number;
  itemName: string;
  totalRequirementQty: number;
  availableStockQty: number;
  gapQty: number;
  gapPercent?: number;
  suggestedWoQty: number;
  colorZone: Zone;
};

type ApiResp = {
  orderWise: { items: Row[]; summary: { redCount: number; yellowCount: number; greenCount: number; excessCount: number } };
  productWise: { items: ProductRow[]; summary: { redCount: number; yellowCount: number; greenCount: number; excessCount: number } };
};

function fmtPct(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function zoneBadge(zone: Zone) {
  if (zone === "RED") return { label: "Red", variant: "rejected" as const };
  if (zone === "YELLOW") return { label: "Yellow", variant: "warning" as const };
  if (zone === "EXCESS") return { label: "Excess", variant: "info" as const };
  return { label: "Green", variant: "success" as const };
}

function zoneRank(z: Zone) {
  if (z === "RED") return 1;
  if (z === "YELLOW") return 2;
  if (z === "GREEN") return 3;
  return 4;
}

/** UI-only demo row (NO_QTY planning step). Never sent to the API. */
const DEMO_PLANNING_MOCK_ITEM_ID = -9001;

const DEMO_PLANNING_MOCK_ORDER_ROW: Row = {
  itemId: DEMO_PLANNING_MOCK_ITEM_ID,
  itemName: "FG JOURNEY",
  customerName: "ABC Industries",
  requirementQty: 500,
  stockQty: 300,
  gapPercent: 40,
  suggestedWoQty: 200,
  colorZone: "YELLOW",
};

const DEMO_PLANNING_MOCK_PRODUCT_ROW: ProductRow = {
  itemId: DEMO_PLANNING_MOCK_ITEM_ID,
  itemName: "FG JOURNEY",
  totalRequirementQty: 500,
  availableStockQty: 300,
  gapQty: 200,
  gapPercent: 40,
  suggestedWoQty: 200,
  colorZone: "YELLOW",
};

function isDemoPlanningMockRow(itemId: number) {
  return itemId === DEMO_PLANNING_MOCK_ITEM_ID;
}

export function PlanningDashboardPage() {
  const [sp] = useSearchParams();
  const fromNoQtySo = (sp.get("source") ?? "") === "no_qty_so";
  const auth = useAuth();
  const demo = useDemoMode();
  const planningDemoHl = demoHighlightKey(demo.enabled, demo.flow, demo.step, "no_qty", 2);
  const canSeeRmRequirements = auth.user?.role === "ADMIN" || auth.user?.role === "STORE";
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rmRequirements, setRmRequirements] = React.useState<RmRequirementRow[]>([]);
  const [rmReqError, setRmReqError] = React.useState<string | null>(null);

  const [view, setView] = React.useState<"ORDER" | "PRODUCT">("ORDER");
  const [customerFilter, setCustomerFilter] = React.useState<string>("ALL");
  const [q, setQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | Zone>("ALL");
  const [onlyShortage, setOnlyShortage] = React.useState(true); // default: Red+Yellow

  React.useEffect(() => {
    setBusy(true);
    setError(null);
    apiFetch<ApiResp>("/api/planning-dashboard")
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setBusy(false));
  }, []);

  React.useEffect(() => {
    if (!canSeeRmRequirements) {
      setRmRequirements([]);
      setRmReqError(null);
      return;
    }
    setRmReqError(null);
    apiFetch<RmRequirementRow[]>("/api/purchase/rm-requirements")
      .then((rows) => setRmRequirements(Array.isArray(rows) ? rows : []))
      .catch((e) => setRmReqError(e instanceof Error ? e.message : "Could not load RM requirements"));
  }, [canSeeRmRequirements]);

  const customers = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.orderWise?.items || []) set.add(r.customerName || "—");
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filteredOrderWise = React.useMemo(() => {
    const query = q.trim().toLowerCase();
    let rows = (data?.orderWise?.items || []).slice();

    if (onlyShortage) rows = rows.filter((r) => r.colorZone === "RED" || r.colorZone === "YELLOW");
    if (customerFilter !== "ALL") rows = rows.filter((r) => r.customerName === customerFilter);
    if (statusFilter !== "ALL") rows = rows.filter((r) => r.colorZone === statusFilter);
    if (query) rows = rows.filter((r) => r.itemName.toLowerCase().includes(query));

    rows.sort((a, b) => {
      const zr = zoneRank(a.colorZone) - zoneRank(b.colorZone);
      if (zr !== 0) return zr;
      const ga = typeof a.gapPercent === "number" ? a.gapPercent : -Infinity;
      const gb = typeof b.gapPercent === "number" ? b.gapPercent : -Infinity;
      return gb - ga;
    });
    return rows;
  }, [data, onlyShortage, customerFilter, statusFilter, q]);

  const filteredProductWise = React.useMemo(() => {
    const query = q.trim().toLowerCase();
    let rows = (data?.productWise?.items || []).slice();
    if (onlyShortage) rows = rows.filter((r) => r.colorZone === "RED" || r.colorZone === "YELLOW");
    if (statusFilter !== "ALL") rows = rows.filter((r) => r.colorZone === statusFilter);
    if (query) rows = rows.filter((r) => r.itemName.toLowerCase().includes(query));
    rows.sort((a, b) => {
      const zr = zoneRank(a.colorZone) - zoneRank(b.colorZone);
      if (zr !== 0) return zr;
      return (b.gapQty ?? 0) - (a.gapQty ?? 0);
    });
    return rows;
  }, [data, onlyShortage, statusFilter, q]);

  const showDemoPlanningMock = demo.enabled && demo.flow === "no_qty" && demo.step === 2;

  /** When NO_QTY demo is on planning step and the table would be empty, show one mock requirement (no API). */
  const displayOrderWise = React.useMemo(() => {
    if (showDemoPlanningMock && filteredOrderWise.length === 0) return [DEMO_PLANNING_MOCK_ORDER_ROW];
    return filteredOrderWise;
  }, [showDemoPlanningMock, filteredOrderWise]);

  const displayProductWise = React.useMemo(() => {
    if (showDemoPlanningMock && filteredProductWise.length === 0) return [DEMO_PLANNING_MOCK_PRODUCT_ROW];
    return filteredProductWise;
  }, [showDemoPlanningMock, filteredProductWise]);

  const summary = view === "PRODUCT" ? data?.productWise?.summary : data?.orderWise?.summary;
  const hasAnyData = Boolean((data?.orderWise?.items?.length ?? 0) > 0 || (data?.productWise?.items?.length ?? 0) > 0);

  const filtersActive =
    customerFilter !== "ALL" || q.trim() !== "" || statusFilter !== "ALL" || !onlyShortage;

  const kpiTotal =
    (summary?.redCount ?? 0) +
    (summary?.yellowCount ?? 0) +
    (summary?.greenCount ?? 0) +
    (summary?.excessCount ?? 0);
  const showKpiStrip = busy || kpiTotal > 0;

  function resetFilters() {
    setCustomerFilter("ALL");
    setQ("");
    setStatusFilter("ALL");
    setOnlyShortage(true);
  }

  function tableEmptyMessage(): string {
    if (busy) return "Loading…";
    if (filtersActive) return "No items match the selected filters.";
    if (!hasAnyData && !showDemoPlanningMock) {
      return "Planning is clear. No items require work order right now.";
    }
    return "No items in this view. Try Show All or adjust filters.";
  }

  const planningWoNeedCount = view === "ORDER" ? displayOrderWise.length : displayProductWise.length;

  const showDemoPlanningContinue = showDemoPlanningMock;

  return (
    <PageContainer className="erp-flow-page -mt-2 space-y-2.5 pb-6">
      <StickyWorkspaceHead
        lead={
          fromNoQtySo ? (
            <PageNoQtyFlowBackLink step="PLANNING" />
          ) : (
            <PageSmartBackLink defaultTo="/dashboard" defaultLabel="Back to Dashboard" />
          )
        }
      >
        <div className="min-w-0 space-y-0.5">
          <h1 className="text-base font-semibold leading-tight tracking-tight text-slate-900">Planning Dashboard</h1>
          <p className="text-xs leading-snug text-slate-600">Review shortages, stock gaps, and create work orders.</p>
        </div>
      </StickyWorkspaceHead>

      {showDemoPlanningContinue ? (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-md border border-sky-200 bg-sky-50/95 px-3 py-2">
          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0 font-semibold"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("demo:action-complete"));
            }}
          >
            Continue Demo → Work Order
          </Button>
        </div>
      ) : null}

      {canSeeRmRequirements ? (
        <>
          {rmReqError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">{rmReqError}</div>
          ) : !rmRequirements.length ? (
            <p className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-emerald-200/80 bg-emerald-50/70 px-2 py-1 text-[11px] leading-tight text-emerald-900">
              <span aria-hidden="true" className="select-none">
                ✅
              </span>
              <span>
                <span className="font-semibold text-emerald-950">RM OK</span>
                <span className="text-emerald-800"> — No shortages right now</span>
              </span>
            </p>
          ) : (
            <div className="rounded-md border border-amber-200/90 bg-amber-50/80 px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-amber-950">RM Shortage</div>
                  <p className="text-xs text-amber-900/90">Material purchase required before production.</p>
                </div>
                <Link
                  to="/rm-po-grn"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "h-8 shrink-0 border-amber-300 bg-white text-xs text-amber-950 hover:bg-amber-50",
                  )}
                >
                  Go to RM Purchase
                </Link>
              </div>
              <div className="mt-2 overflow-x-auto rounded border border-amber-100 bg-white/80">
                <table className="w-full min-w-[560px] border-collapse text-xs">
                  <thead className="sticky top-0 z-[1] border-b border-amber-100 bg-amber-50/90">
                    <tr className="text-left font-medium uppercase tracking-wide text-amber-900/80">
                      <th className="px-2 py-1.5">Item</th>
                      <th className="px-2 py-1.5 text-right">Required</th>
                      <th className="px-2 py-1.5 text-right">Usable</th>
                      <th className="px-2 py-1.5 text-right">Shortage</th>
                      <th className="px-2 py-1.5 text-right">Suggested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rmRequirements.map((r) => (
                      <tr key={r.itemId} className="border-b border-amber-50 last:border-0 hover:bg-amber-50/40">
                        <td className="px-2 py-1.5 font-medium text-slate-900">{r.itemName}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.requiredQty}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.usableQty}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-amber-900">{r.shortage}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{r.suggested}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}

      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}

      {showKpiStrip ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
          <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Red</div>
            <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{summary?.redCount ?? (busy ? "…" : 0)}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Yellow</div>
            <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{summary?.yellowCount ?? (busy ? "…" : 0)}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Green</div>
            <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{summary?.greenCount ?? (busy ? "…" : 0)}</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Excess</div>
            <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{summary?.excessCount ?? (busy ? "…" : 0)}</div>
          </div>
        </div>
      ) : null}

      <Card
        className="min-w-0 overflow-hidden border-slate-200 shadow-sm"
        {...(planningDemoHl ? { "data-demo-highlight": planningDemoHl } : {})}
      >
        <CardHeader className="space-y-1 border-b border-slate-100 bg-slate-50/50 px-3.5 py-2.5">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold tracking-tight text-slate-900">Planning Required</CardTitle>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 sm:ml-auto">
              <p className="whitespace-nowrap text-right text-[11px] tabular-nums text-slate-500" title="Rows in the table below (current view & filters)">
                {busy ? "…" : `${planningWoNeedCount} ${planningWoNeedCount === 1 ? "item" : "items"} need WO`}
              </p>
              <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={cn(
                  "h-8 rounded-md border px-2.5 text-xs font-medium",
                  view === "ORDER" ? "border-slate-300 bg-white text-slate-900 shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
                onClick={() => setView("ORDER")}
              >
                Order-wise
              </button>
              <button
                type="button"
                className={cn(
                  "h-8 rounded-md border px-2.5 text-xs font-medium",
                  view === "PRODUCT"
                    ? "border-slate-300 bg-white text-slate-900 shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
                onClick={() => setView("PRODUCT")}
              >
                Product-wise
              </button>
              </div>
            </div>
          </div>
          <p className="text-[11px] leading-snug text-slate-500">Latest requirement sheets · FG · shortage-first when “Show Only Shortage” is on</p>
        </CardHeader>
        <CardContent className="space-y-2.5 px-3.5 py-2.5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 lg:items-end lg:gap-x-2">
            <div className="grid gap-1">
              <span className="text-[11px] font-medium text-slate-600">Customer</span>
              <select
                className="erp-flow-filter-input h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm"
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                disabled={view === "PRODUCT"}
              >
                <option value="ALL">All</option>
                {customers.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <span className="text-[11px] font-medium text-slate-600">Item search</span>
              <Input className="erp-flow-filter-input h-9 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item…" />
            </div>
            <div className="grid gap-1">
              <span className="text-[11px] font-medium text-slate-600">Status</span>
              <select
                className="erp-flow-filter-input h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "ALL" | Zone)}
              >
                <option value="ALL">All</option>
                <option value="RED">Red</option>
                <option value="YELLOW">Yellow</option>
                <option value="GREEN">Green</option>
                <option value="EXCESS">Excess</option>
              </select>
            </div>
            <div className="grid gap-1 sm:col-span-2 lg:col-span-1">
              <span className="text-[11px] font-medium text-slate-600">Actions</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="erp-flow-filter-input h-9 flex-1 min-w-[7rem] px-2 text-xs"
                  onClick={() => setOnlyShortage((v) => !v)}
                >
                  {onlyShortage ? "Show All" : "Shortage only"}
                </Button>
                <Button type="button" variant="secondary" className="erp-flow-filter-input h-9 flex-1 min-w-[7rem] px-2 text-xs" onClick={resetFilters}>
                  Reset
                </Button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            {view === "ORDER" ? (
              <table className="w-full min-w-[920px] border-collapse text-[13px]">
                <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-1.5">Item</th>
                    <th className="px-3 py-1.5">Customer</th>
                    <th className="px-3 py-1.5 text-right">Requirement</th>
                    <th className="px-3 py-1.5 text-right">Stock</th>
                    <th className="px-3 py-1.5 text-right">Gap %</th>
                    <th className="px-3 py-1.5 text-right">Suggested WO</th>
                    <th className="px-3 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayOrderWise.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-5 text-center text-xs leading-relaxed text-slate-600">
                        {tableEmptyMessage()}
                      </td>
                    </tr>
                  ) : (
                    displayOrderWise.map((r) => {
                      const b = zoneBadge(r.colorZone);
                      const gapClass =
                        r.gapPercent == null
                          ? "text-slate-500"
                          : r.gapPercent < 0
                            ? "text-sky-800"
                            : r.colorZone === "RED"
                              ? "text-red-700 font-semibold"
                              : r.colorZone === "YELLOW"
                                ? "text-amber-800 font-semibold"
                                : "text-emerald-800";
                      return (
                        <tr
                          key={`${r.itemId}:${r.customerName}`}
                          className="border-b border-slate-100 transition-colors hover:bg-slate-50/90"
                        >
                          <td className="px-3 py-1.5 text-[13px] font-medium text-slate-900">{r.itemName}</td>
                          <td className="px-3 py-1.5 text-[13px] text-slate-800">{r.customerName}</td>
                          <td className="px-3 py-1.5 text-right text-[13px] tabular-nums">{r.requirementQty}</td>
                          <td className="px-3 py-1.5 text-right text-[13px] tabular-nums">{r.stockQty}</td>
                          <td className={cn("px-3 py-1.5 text-right text-[13px] tabular-nums", gapClass)}>
                            {fmtPct(r.gapPercent)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-[13px] font-bold tabular-nums text-slate-900">{r.suggestedWoQty}</td>
                          <td className="px-3 py-1.5">
                            {isDemoPlanningMockRow(r.itemId) ? (
                              <Badge variant="warning" className="text-[10px]">
                                Planning Required
                              </Badge>
                            ) : (
                              <Badge variant={b.variant} className="text-[10px]">
                                {b.label}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[920px] border-collapse text-[13px]">
                <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-1.5">Item</th>
                    <th className="px-3 py-1.5 text-right">Total requirement</th>
                    <th className="px-3 py-1.5 text-right">Available stock</th>
                    <th className="px-3 py-1.5 text-right">Gap</th>
                    <th className="px-3 py-1.5 text-right">Gap %</th>
                    <th className="px-3 py-1.5 text-right">Suggested WO</th>
                    <th className="px-3 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayProductWise.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-5 text-center text-xs leading-relaxed text-slate-600">
                        {tableEmptyMessage()}
                      </td>
                    </tr>
                  ) : (
                    displayProductWise.map((r) => {
                      const b = zoneBadge(r.colorZone);
                      const gapClass =
                        r.gapQty < 0
                          ? "text-sky-800"
                          : r.colorZone === "RED"
                            ? "text-red-700 font-semibold"
                            : r.colorZone === "YELLOW"
                              ? "text-amber-800 font-semibold"
                              : "text-emerald-800";
                      return (
                        <tr key={r.itemId} className="border-b border-slate-100 transition-colors hover:bg-slate-50/90">
                          <td className="px-3 py-1.5 text-[13px] font-medium text-slate-900">{r.itemName}</td>
                          <td className="px-3 py-1.5 text-right text-[13px] tabular-nums">{r.totalRequirementQty}</td>
                          <td className="px-3 py-1.5 text-right text-[13px] tabular-nums">{r.availableStockQty}</td>
                          <td className={cn("px-3 py-1.5 text-right text-[13px] tabular-nums", gapClass)}>{r.gapQty}</td>
                          <td className={cn("px-3 py-1.5 text-right text-[13px] tabular-nums", gapClass)}>{fmtPct(r.gapPercent ?? null)}</td>
                          <td className="px-3 py-1.5 text-right text-[13px] font-bold tabular-nums text-slate-900">{r.suggestedWoQty}</td>
                          <td className="px-3 py-1.5">
                            {isDemoPlanningMockRow(r.itemId) ? (
                              <Badge variant="warning" className="text-[10px]">
                                Planning Required
                              </Badge>
                            ) : (
                              <Badge variant={b.variant} className="text-[10px]">
                                {b.label}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      <details className="rounded-md border border-slate-200 bg-slate-50/90 px-3 py-1.5 text-xs text-slate-700">
        <summary className="cursor-pointer select-none font-medium text-slate-800">How planning zones are calculated</summary>
        <div className="mt-2 space-y-2 text-slate-600 [&_p]:leading-relaxed">
          <p className="text-slate-700">Thresholds are inclusive: when gap % reaches a threshold exactly, that zone applies.</p>
          <p>
            <strong>Gap %</strong> is shortage as a percent of requirement: (requirement − stock) ÷ requirement × 100 (when stock covers demand, gap is 0% or excess
            is shown separately).
          </p>
          <p>
            <strong>Zone rule (both views):</strong> compare gap % to red and yellow <em>boundaries</em> using <strong>≥</strong> (inclusive). If gap% ≥ red boundary
            → <strong>Red</strong>; else if gap% ≥ yellow boundary → <strong>Yellow</strong>; else <strong>Green</strong>. Excess stock (negative gap) →{" "}
            <strong>Excess</strong>.
          </p>
          <p>
            <strong>Order-wise</strong> uses legacy Item fields <strong>Planning Gap Green %</strong> and <strong>Planning Gap Yellow %</strong> (same as requirement
            sheets). Despite the name, &quot;Green %&quot; is stored as the <strong>red</strong> boundary; defaults <strong>50 %</strong> / <strong>30 %</strong> when
            unset.
          </p>
          <p>
            <strong>Product-wise</strong> aggregates demand per FG and uses <strong>Red / Yellow Threshold %</strong> on the item, then legacy gap columns, then
            defaults <strong>10 %</strong> / <strong>5 %</strong>.
          </p>
        </div>
      </details>
    </PageContainer>
  );
}

