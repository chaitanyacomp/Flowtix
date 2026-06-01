/**
 * Phase 3A.1 — Stock movement / material transfer ledger (read-only).
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useDebouncedUrlStringParam, useUrlQueryState } from "../hooks/useUrlQueryState";
import { apiFetch } from "../services/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { PageSmartBackLink, StickyWorkspaceHead } from "../components/PageHeader";
import {
  OperatorPageBody,
  OperatorTopBar,
  operatorInputClass,
  operatorTableRowClass,
} from "../components/erp/OperatorWorkbench";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import { erpKpi } from "../lib/erpFoundationTokens";
import {
  MOVEMENT_HISTORY_FILTER_OPTIONS,
  ledgerMovementRowClass,
  movementActivityBadgeClass,
} from "../lib/stockLedger";

type LocationOpt = { id: number; locationName: string; locationCode: string };
type ItemOpt = { id: number; itemName: string; itemType: string; unit: string };

type MovementRow = {
  id: number;
  date: string;
  itemId: number;
  itemName: string;
  itemType: string;
  unit: string;
  transactionType: string;
  activityLabel: string;
  refId: number;
  refDisplay: string;
  stockBucket: string;
  locationId: number | null;
  locationName: string;
  fromLocationName: string;
  toLocationName: string | null;
  qtyIn: number;
  qtyOut: number;
  notes: string | null;
  sourceRoute: string | null;
  runningBalanceAfter: number | null;
  reversalOfId?: number | null;
};

type MovementResponse = {
  items: MovementRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: "asc" | "desc";
  movement: string;
  openingBalanceUsable: number | null;
  runningBalanceNote: string | null;
  currentBalance: number | null;
};

const URL_OMIT: Record<string, string> = {
  movement: "ALL",
  sort: "desc",
  page: "1",
  pageSize: "50",
  groupBy: "none",
};

type GroupBy = "none" | "item" | "location";

const FILTER_BTN = "h-8 px-3 text-[12px]";

function fmtQty(n: number, unit?: string): string {
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(3).replace(/\.000$/, "");
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${s}${u}`;
}

function fmtDate(d: string) {
  return String(d).slice(0, 10);
}

function MovementTypeBadge({ row }: { row: MovementRow }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold leading-tight",
        movementActivityBadgeClass(row.transactionType, row),
      )}
    >
      {row.activityLabel}
    </span>
  );
}

function groupRows(rows: MovementRow[], groupBy: GroupBy): Array<{ key: string; label: string; rows: MovementRow[] }> {
  if (groupBy === "none") return [{ key: "all", label: "", rows }];
  const map = new Map<string, { label: string; rows: MovementRow[] }>();
  for (const r of rows) {
    const key = groupBy === "item" ? `i-${r.itemId}` : `l-${r.locationId ?? "u"}`;
    const label =
      groupBy === "item"
        ? `${r.itemName} · ${r.itemType}`
        : r.locationName || "Unassigned";
    if (!map.has(key)) map.set(key, { label, rows: [] });
    map.get(key)!.rows.push(r);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, label: v.label, rows: v.rows }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function StockMovementHistoryPage() {
  const { patch, read } = useUrlQueryState(URL_OMIT);
  const itemId = read.int("itemId", 0);
  const locationId = read.int("locationId", 0);
  const movement = read.string("movement") || "ALL";
  const sort = read.enum("sort", ["asc", "desc"] as const, "desc");
  const page = Math.max(1, read.int("page", 1));
  const pageSize = Math.max(1, Math.min(200, read.int("pageSize", 50)));
  const groupBy = read.enum("groupBy", ["none", "item", "location"] as const, "none");
  const dateFrom = read.string("dateFrom");
  const dateTo = read.string("dateTo");
  const qItem = read.string("qItem");
  const [qItemDraft, setQItemDraft] = useDebouncedUrlStringParam({
    urlValue: qItem,
    patch,
    paramKey: "qItem",
  });

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<MovementResponse | null>(null);
  const [items, setItems] = React.useState<ItemOpt[]>([]);
  const [locations, setLocations] = React.useState<LocationOpt[]>([]);

  React.useEffect(() => {
    Promise.all([
      apiFetch<ItemOpt[]>("/api/items").catch(() => []),
      apiFetch<LocationOpt[]>("/api/locations").catch(() => []),
    ]).then(([it, loc]) => {
      setItems(Array.isArray(it) ? it : []);
      setLocations(
        (Array.isArray(loc) ? loc : []).map((l) => ({
          id: l.id,
          locationName: (l as LocationOpt).locationName,
          locationCode: (l as LocationOpt).locationCode,
        })),
      );
    });
  }, []);

  const filteredItemOptions = React.useMemo(() => {
    const q = qItemDraft.trim().toLowerCase();
    let list = items;
    if (q) list = list.filter((i) => i.itemName.toLowerCase().includes(q));
    return list.slice(0, 200);
  }, [items, qItemDraft]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sort", sort);
      params.set("movement", movement);
      if (itemId > 0) params.set("itemId", String(itemId));
      if (locationId > 0) params.set("locationId", String(locationId));
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const res = await apiFetch<MovementResponse>(`/api/stock/movement-history?${params.toString()}`);
      setData(res);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load movement history");
    } finally {
      setLoading(false);
    }
  }, [itemId, locationId, movement, sort, page, pageSize, dateFrom, dateTo]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.items ?? [];
  const groups = React.useMemo(() => groupRows(rows, groupBy), [rows, groupBy]);

  const selectedItem = itemId > 0 ? items.find((i) => i.id === itemId) : null;
  const selectedLoc = locationId > 0 ? locations.find((l) => l.id === locationId) : null;

  const filtersActive =
    itemId > 0 ||
    locationId > 0 ||
    movement !== "ALL" ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(qItem?.trim());

  function clearFilters() {
    setQItemDraft("");
    patch({
      itemId: null,
      locationId: null,
      movement: null,
      dateFrom: null,
      dateTo: null,
      qItem: null,
      page: null,
    });
  }

  return (
    <OperatorPageBody>
      <Card className="mx-auto w-full max-w-[1680px] border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-4">
          <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/stock" defaultLabel="Back to Stock Overview" />}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold tracking-tight text-slate-900">Stock Movement History</h1>
                <p className="mt-1 max-w-2xl text-[13px] leading-snug text-slate-600">
                  See how stock moved — receipts, transfers to production, consumption, and dispatch — with store and
                  department locations on every line.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" className={FILTER_BTN} disabled={loading} onClick={() => void load()}>
                Refresh
              </Button>
            </div>
          </StickyWorkspaceHead>

          {error ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</div>
          ) : null}

          {(selectedItem || selectedLoc || data) && (
            <ErpKpiStrip className={erpKpi.stripCompact} role="region" aria-label="Movement context">
              {selectedItem ? (
                <ErpKpiSegment as="div">
                  <ErpKpiLabel>Item</ErpKpiLabel>
                  <ErpKpiValue>{selectedItem.itemName}</ErpKpiValue>
                </ErpKpiSegment>
              ) : null}
              {selectedLoc ? (
                <ErpKpiSegment as="div">
                  <ErpKpiLabel>Location</ErpKpiLabel>
                  <ErpKpiValue>{selectedLoc.locationName}</ErpKpiValue>
                </ErpKpiSegment>
              ) : null}
              {data?.currentBalance != null && Number.isFinite(data.currentBalance) ? (
                <ErpKpiSegment as="div">
                  <ErpKpiLabel>Current usable</ErpKpiLabel>
                  <ErpKpiValue className="tabular-nums">{fmtQty(data.currentBalance, selectedItem?.unit)}</ErpKpiValue>
                </ErpKpiSegment>
              ) : null}
              <ErpKpiSegment as="div">
                <ErpKpiLabel>Movements (filtered)</ErpKpiLabel>
                <ErpKpiValue className="tabular-nums">{data?.total ?? 0}</ErpKpiValue>
              </ErpKpiSegment>
            </ErpKpiStrip>
          )}

          <div className="sticky top-0 z-10 -mx-1 rounded-lg border border-slate-200 bg-white/95 px-2 py-2 shadow-sm backdrop-blur-sm">
            <OperatorTopBar className="gap-2 bg-transparent p-0">
              <div className="erp-form-field min-w-[11rem] flex-1">
                <span className="text-[12px] font-medium text-slate-600">Item</span>
                <select
                  className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                  value={itemId > 0 ? String(itemId) : ""}
                  onChange={(e) => patch({ itemId: e.target.value || null, page: null })}
                >
                  <option value="">All items</option>
                  {filteredItemOptions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.itemName} ({i.itemType})
                    </option>
                  ))}
                </select>
                <Input
                  className={cn("mt-1 text-[12px]", operatorInputClass)}
                  placeholder="Search item name…"
                  value={qItemDraft}
                  onChange={(e) => setQItemDraft(e.target.value)}
                />
              </div>
              <div className="erp-form-field min-w-[11rem]">
                <span className="text-[12px] font-medium text-slate-600">Location</span>
                <select
                  className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                  value={locationId > 0 ? String(locationId) : ""}
                  onChange={(e) => patch({ locationId: e.target.value || null, page: null })}
                >
                  <option value="">All locations</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.locationName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="erp-form-field min-w-[10rem]">
                <span className="text-[12px] font-medium text-slate-600">Movement type</span>
                <select
                  className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                  value={movement}
                  onChange={(e) => patch({ movement: e.target.value === "ALL" ? null : e.target.value, page: null })}
                >
                  {MOVEMENT_HISTORY_FILTER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="erp-form-field min-w-[9rem]">
                <span className="text-[12px] font-medium text-slate-600">From date</span>
                <Input
                  type="date"
                  className={cn("mt-0.5 text-[13px]", operatorInputClass)}
                  value={dateFrom}
                  onChange={(e) => patch({ dateFrom: e.target.value || null, page: null })}
                />
              </div>
              <div className="erp-form-field min-w-[9rem]">
                <span className="text-[12px] font-medium text-slate-600">To date</span>
                <Input
                  type="date"
                  className={cn("mt-0.5 text-[13px]", operatorInputClass)}
                  value={dateTo}
                  onChange={(e) => patch({ dateTo: e.target.value || null, page: null })}
                />
              </div>
              <div className="erp-form-field min-w-[8rem]">
                <span className="text-[12px] font-medium text-slate-600">Sort</span>
                <select
                  className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                  value={sort}
                  onChange={(e) => patch({ sort: e.target.value as "asc" | "desc", page: null })}
                >
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </div>
              <div className="erp-form-field min-w-[9rem]">
                <span className="text-[12px] font-medium text-slate-600">Group by</span>
                <select
                  className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                  value={groupBy}
                  onChange={(e) => patch({ groupBy: e.target.value as GroupBy })}
                >
                  <option value="none">None</option>
                  <option value="item">Item</option>
                  <option value="location">Location</option>
                </select>
              </div>
              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={FILTER_BTN}
                  disabled={!filtersActive}
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              </div>
            </OperatorTopBar>
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
              {MOVEMENT_HISTORY_FILTER_OPTIONS.filter((o) => o.value !== "ALL").map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[10px] font-bold",
                    movement === o.value
                      ? movementActivityBadgeClass(
                          o.value === "PRODUCTION_CONSUMPTION"
                            ? "ISSUE"
                            : o.value === "REVERSAL"
                              ? "QC_REVERSAL"
                              : o.value,
                        )
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                  onClick={() =>
                    patch({
                      movement: movement === o.value ? null : o.value,
                      page: null,
                    })
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {data?.runningBalanceNote ? (
            <p className="text-xs text-amber-800">{data.runningBalanceNote}</p>
          ) : null}

          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-slate-900">Movement register</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-slate-600">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-slate-600">No movements match your filters.</p>
              ) : (
                <div className="space-y-4">
                  {groups.map((g) => (
                    <div key={g.key}>
                      {groupBy !== "none" ? (
                        <h3 className="mb-2 text-sm font-semibold text-slate-800">{g.label}</h3>
                      ) : null}
                      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                        <table className="w-full min-w-[1100px] text-[13px]">
                          <thead className="border-b border-slate-200 bg-slate-50">
                            <tr className="text-left text-[12px] text-slate-600">
                              <th className="px-2 py-2 font-medium">Date</th>
                              <th className="px-2 py-2 font-medium">Ref no</th>
                              <th className="px-2 py-2 font-medium">Type</th>
                              {groupBy !== "item" ? <th className="px-2 py-2 font-medium">Item</th> : null}
                              <th className="px-2 py-2 font-medium">From location</th>
                              <th className="px-2 py-2 font-medium">To location</th>
                              <th className="px-2 py-2 text-right font-medium">Received</th>
                              <th className="px-2 py-2 text-right font-medium">Issued</th>
                              <th className="px-2 py-2 text-right font-medium">Balance after</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows.map((r) => {
                              const tint = ledgerMovementRowClass(r.transactionType, r.stockBucket);
                              const isTransfer = r.transactionType === "LOCATION_TRANSFER";
                              return (
                                <tr
                                  key={r.id}
                                  className={cn("border-b border-slate-100", tint, operatorTableRowClass)}
                                >
                                  <td className="px-2 py-1.5 tabular-nums text-slate-700">{fmtDate(r.date)}</td>
                                  <td className="px-2 py-1.5">
                                    {r.sourceRoute ? (
                                      <Link to={r.sourceRoute} className="font-semibold text-primary hover:underline">
                                        {r.refDisplay}
                                      </Link>
                                    ) : (
                                      <span className="font-semibold text-slate-800">{r.refDisplay || "—"}</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <MovementTypeBadge row={r} />
                                  </td>
                                  {groupBy !== "item" ? (
                                    <td className="px-2 py-1.5 text-slate-800">
                                      {r.itemName}
                                      <span className="ml-1 text-slate-500">({r.itemType})</span>
                                    </td>
                                  ) : null}
                                  <td className="px-2 py-1.5 font-medium text-slate-800">
                                    {isTransfer ? r.fromLocationName : r.qtyOut > 0 ? r.locationName : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 font-medium text-slate-800">
                                    {isTransfer ? r.toLocationName || "—" : r.qtyIn > 0 ? r.locationName : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-emerald-700">
                                    {r.qtyIn > 0 ? fmtQty(r.qtyIn, r.unit) : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-red-700">
                                    {r.qtyOut > 0 ? fmtQty(r.qtyOut, r.unit) : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-800">
                                    {r.runningBalanceAfter != null
                                      ? fmtQty(r.runningBalanceAfter, r.unit)
                                      : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-600">
                <span>
                  Page {data?.page ?? page} · {rows.length} of {data?.total ?? 0} movements
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => patch({ page: String(page - 1) })}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!data || page * pageSize >= data.total || loading}
                    onClick={() => patch({ page: String(page + 1) })}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </OperatorPageBody>
  );
}
