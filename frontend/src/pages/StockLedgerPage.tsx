import * as React from "react";
import { useLocation } from "react-router-dom";
import { useUrlQueryState } from "../hooks/useUrlQueryState";
import { apiFetch } from "../services/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { PageSmartBackLink, StickyReportBackStrip, StickyWorkspaceHead } from "../components/PageHeader";
import {
  OperatorPageBody,
  OperatorPageTitle,
  OperatorTopBar,
  operatorInputClass,
  operatorTableRowClass,
} from "../components/erp/OperatorWorkbench";
import { isReportsReturnContext } from "../lib/drillDownRoutes";
import { ledgerActivityLabel, ledgerMovementRowClass } from "../lib/stockLedger";

type Item = { id: number; itemName: string; itemType: string; unit: string };

type StockTxn = {
  id: number;
  date: string;
  itemId: number;
  transactionType: string;
  refId: number;
  stockBucket: string;
  qtyIn: string;
  qtyOut: string;
  reason?: string | null;
  reversalOfId?: number | null;
  qcRejectedDispositionId?: number | null;
  item?: Item;
  runningBalanceAfter?: number | null;
  runningUsableAfter?: number | null;
};

type LedgerResponse = {
  items: StockTxn[];
  total: number;
  page: number;
  pageSize: number;
  sort: "asc" | "desc";
  totals: { qtyInSum: number; qtyOutSum: number };
  openingBalanceAllBuckets: number | null;
  openingBalanceUsable?: number | null;
};

type StockBucketsRow = {
  itemId: number;
  item: { itemName: string; itemType: string; unit: string };
  usableQty: number;
  qcHoldQty: number;
  qcPendingQty: number;
  reworkQty: number;
  scrapQty: number;
};

const URL_OMIT: Record<string, string> = {
  sort: "desc",
  page: "1",
  pageSize: "100",
};

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(3).replace(/\.000$/, "");
}

export function StockLedgerPage() {
  const location = useLocation();
  const fromReportsHub = isReportsReturnContext(location.search);
  const { patch, read } = useUrlQueryState(URL_OMIT);
  const itemId = read.int("itemId", 0);
  const sort = read.enum("sort", ["asc", "desc"] as const, "desc");
  const page = Math.max(1, read.int("page", 1));
  const pageSize = Math.max(1, Math.min(200, read.int("pageSize", 100)));

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<StockTxn[]>([]);
  const [total, setTotal] = React.useState(0);
  const [openingBal, setOpeningBal] = React.useState<number | null>(null);
  const [bucketRow, setBucketRow] = React.useState<StockBucketsRow | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sort", sort);
      if (itemId > 0) params.set("itemId", String(itemId));
      const data = await apiFetch<LedgerResponse>(`/api/stock/ledger?${params.toString()}`);
      setRows(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total) || 0);
      setOpeningBal(
        data.openingBalanceAllBuckets != null && Number.isFinite(Number(data.openingBalanceAllBuckets))
          ? Number(data.openingBalanceAllBuckets)
          : null,
      );

      if (itemId > 0) {
        const summary = await apiFetch<StockBucketsRow[]>("/api/stock/summary-buckets");
        const match = (Array.isArray(summary) ? summary : []).find((r) => Number(r.itemId) === Number(itemId)) ?? null;
        setBucketRow(match);
      } else {
        setBucketRow(null);
      }
    } catch (e) {
      setRows([]);
      setTotal(0);
      setOpeningBal(null);
      setBucketRow(null);
      setError(e instanceof Error ? e.message : "Could not load movement.");
    } finally {
      setLoading(false);
    }
  }, [itemId, page, pageSize, sort]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const item = rows.find((r) => r.item)?.item ?? null;
  const summaryAllBuckets = React.useMemo(() => {
    if (!bucketRow) return null;
    return (
      Number(bucketRow.usableQty || 0) +
      Number(bucketRow.qcHoldQty || 0) +
      Number(bucketRow.qcPendingQty || 0) +
      Number(bucketRow.reworkQty || 0) +
      Number(bucketRow.scrapQty || 0)
    );
  }, [bucketRow]);

  const usableAfterByTxnId = React.useMemo(() => {
    // Operational balance is USABLE bucket only.
    // - sort=asc: backend supplies runningUsableAfter (page-accurate with correct opening).
    // - sort=desc: compute by walking backward from current usable stock total.
    const out = new Map<number, number>();
    if (itemId <= 0 || rows.length === 0) return out;
    if (sort === "asc") {
      for (const r of rows) {
        const rb = r.runningUsableAfter;
        if (rb != null && Number.isFinite(Number(rb))) out.set(r.id, Number(rb));
      }
      return out;
    }
    const currentUsable = bucketRow?.usableQty;
    if (currentUsable == null || !Number.isFinite(Number(currentUsable))) return out;
    let after = Number(currentUsable);
    for (const r of rows) {
      out.set(r.id, after);
      const qIn = Number(r.qtyIn) || 0;
      const qOut = Number(r.qtyOut) || 0;
      if (String(r.stockBucket).toUpperCase() === "USABLE") {
        // Going backward in time: before = after - qtyIn + qtyOut.
        after = after - qIn + qOut;
      }
    }
    return out;
  }, [bucketRow?.usableQty, itemId, rows, sort]);

  const ledgerTitleRow = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <OperatorPageTitle>Stock Movement</OperatorPageTitle>
        <p className="mt-0.5 text-[12px] text-slate-600">Shows all ledger movements for the selected item (FG or RM).</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          Refresh
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
              {ledgerTitleRow}
            </>
          ) : (
            <StickyWorkspaceHead lead={<PageSmartBackLink defaultTo="/stock" defaultLabel="Back to Stock Summary" />}>
              {ledgerTitleRow}
            </StickyWorkspaceHead>
          )}

          {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</div> : null}

          <OperatorTopBar className="mt-1 rounded border border-slate-200 bg-slate-50/90 p-2">
            <div className="erp-form-field min-w-[10rem]">
              <span className="text-[12px] font-medium text-slate-600">Item ID</span>
              <input
                className={cn("erp-input mt-0.5 w-full text-[13px]", operatorInputClass)}
                value={itemId > 0 ? String(itemId) : ""}
                onChange={(e) => patch({ itemId: e.target.value.trim() || null, page: null })}
                placeholder="Enter itemId…"
              />
            </div>
            <div className="erp-form-field min-w-[8rem]">
              <span className="text-[12px] font-medium text-slate-600">Sort</span>
              <select
                className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                value={sort}
                onChange={(e) => patch({ sort: e.target.value as "asc" | "desc", page: null })}
              >
                <option value="asc">Oldest → newest</option>
                <option value="desc">Newest → oldest</option>
              </select>
            </div>
            <div className="erp-form-field min-w-[8rem]">
              <span className="text-[12px] font-medium text-slate-600">Page size</span>
              <select
                className={cn("erp-select mt-0.5 w-full text-[13px]", operatorInputClass)}
                value={String(pageSize)}
                onChange={(e) => patch({ pageSize: e.target.value, page: null })}
              >
                {[50, 100, 200].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </OperatorTopBar>

          {item ? (
            <div className="rounded border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700">
              <span className="font-semibold text-slate-900">{item.itemName}</span>{" "}
              <span className="text-slate-500">({item.itemType} · {item.unit})</span>
              {bucketRow ? (
                <div className="mt-1 text-[12px] text-slate-600">
                  Usable stock: <span className="font-semibold tabular-nums">{fmtQty(Number(bucketRow.usableQty || 0))}</span>{" "}
                  <span className="text-slate-400">·</span> Total stock:{" "}
                  <span className="font-semibold tabular-nums">{fmtQty(summaryAllBuckets ?? 0)}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {bucketRow ? (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-md border border-emerald-200/90 bg-emerald-50/80 px-2.5 py-2 shadow-sm ring-1 ring-emerald-100/70">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-900/85">Usable</div>
                <div className="mt-0.5 text-xl font-bold tabular-nums text-emerald-950">
                  {fmtQty(Number(bucketRow.usableQty || 0))}
                </div>
              </div>
              <div className="rounded border border-slate-200/90 bg-slate-50/60 px-2 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">QC Hold</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-800">{fmtQty(Number(bucketRow.qcHoldQty || 0))}</div>
              </div>
              <div className="rounded border border-slate-200/90 bg-slate-50/60 px-2 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">QC Pending</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-800">{fmtQty(Number(bucketRow.qcPendingQty || 0))}</div>
              </div>
              <div className="rounded border border-violet-100/90 bg-violet-50/40 px-2 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-900/80">Rework</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-800">{fmtQty(Number(bucketRow.reworkQty || 0))}</div>
              </div>
              <div className="rounded border border-slate-200/90 bg-slate-100/70 px-2 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Scrap</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-800">{fmtQty(Number(bucketRow.scrapQty || 0))}</div>
              </div>
              <div className="rounded border border-slate-200/90 bg-white px-2 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</div>
                <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{fmtQty(Number(summaryAllBuckets || 0))}</div>
              </div>
            </div>
          ) : null}

          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Movements</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-sm text-slate-600">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="text-sm text-slate-600">No movements found.</div>
              ) : (
                <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                  <table className="w-full min-w-[980px] text-[13px]">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr className="text-left text-[12px] text-slate-600">
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Ref</th>
                        <th className="px-3 py-2 font-medium">Bucket</th>
                        <th className="px-3 py-2 text-right font-medium">Qty IN</th>
                        <th className="px-3 py-2 text-right font-medium">Qty OUT</th>
                        <th className="px-2 py-1.5 text-right font-medium text-emerald-900">Usable after txn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => {
                        const qIn = Number(r.qtyIn) || 0;
                        const qOut = Number(r.qtyOut) || 0;
                        const running = usableAfterByTxnId.has(r.id) ? usableAfterByTxnId.get(r.id)! : null;
                        const refText =
                          r.refId && Number(r.refId) > 0 ? `#${r.refId}` : r.qcRejectedDispositionId ? `Disp #${r.qcRejectedDispositionId}` : "—";
                        const isLatestRow = sort === "desc" && idx === 0;
                        const movementTint = ledgerMovementRowClass(r.transactionType, r.stockBucket);
                        const isUsableBucket = String(r.stockBucket).toUpperCase() === "USABLE";
                        return (
                          <tr
                            key={r.id}
                            className={cn(
                              "border-b border-slate-100 align-middle",
                              movementTint,
                              isLatestRow && isUsableBucket && "ring-1 ring-inset ring-emerald-200/80",
                              operatorTableRowClass,
                            )}
                            title={isLatestRow ? "Latest movement — current usable balance" : undefined}
                          >
                            <td className="px-2 py-1.5 tabular-nums text-slate-700">{String(r.date).slice(0, 10)}</td>
                            <td className="px-2 py-1.5 font-medium text-slate-800">{ledgerActivityLabel(r.transactionType, r)}</td>
                            <td className="px-2 py-1.5 text-slate-700">{refText}</td>
                            <td
                              className={cn(
                                "px-2 py-1.5 font-mono text-[11px]",
                                isUsableBucket ? "font-semibold text-emerald-900" : "text-slate-600",
                              )}
                            >
                              {r.stockBucket}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{qIn > 0 ? fmtQty(qIn) : "—"}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-red-700">{qOut > 0 ? fmtQty(qOut) : "—"}</td>
                            <td
                              className={cn(
                                "px-2 py-1.5 text-right tabular-nums",
                                isUsableBucket ? "font-bold text-emerald-900" : "text-slate-600",
                              )}
                            >
                              {running != null && Number.isFinite(running) ? fmtQty(running) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-slate-600">
                <div>
                  Total rows: <span className="font-semibold tabular-nums">{total}</span>
                </div>
                {openingBal != null ? (
                  <div>
                    Opening balance (all buckets): <span className="font-semibold tabular-nums">{fmtQty(openingBal)}</span>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </OperatorPageBody>
  );
}

