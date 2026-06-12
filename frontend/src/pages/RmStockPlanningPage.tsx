import * as React from "react";
import { Link } from "react-router-dom";
import { CheckSquare, RefreshCw, Square, Truck } from "lucide-react";
import { apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { PageContainer, StickyWorkspaceHead } from "../components/PageHeader";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import { cn } from "../lib/utils";
import { ErpModal } from "../components/erp/ErpModal";
import {
  getRmStockPlanningRowStatus,
  isRowOrderQtyLocked,
  isRowSelectableForReplenishmentMr,
  REPLENISHMENT_IN_PROGRESS_LABEL,
  STOCK_SUFFICIENT_LABEL,
} from "../lib/rmStockPlanningUx";

type RmStockPlanningRow = {
  itemId: number;
  itemName: string;
  generatedDisplayCode: string;
  unit: string;
  usableStock: number;
  minimumStockQty: number;
  pendingReplenishmentQty: number;
  netAvailableQty: number;
  shortageQty: number;
  suggestedOrderQty: number;
};

type RmStockPlanningResponse = {
  rows: RmStockPlanningRow[];
  summary: {
    rmItemsBelowMinimum: number;
    totalShortageQty: number;
    openReplenishmentMrs: number;
  };
  openReplenishmentMrs: ReplenishmentMrRow[];
};

type ReplenishmentMrRow = {
  id: number;
  docNo: string | null;
  status: string;
  createdAt: string;
  createdByName: string | null;
  lineCount: number;
  totalQty: number;
  hasPurchaseRequest: boolean;
  purchaseRequestRefs: string[];
  canCancel: boolean;
  cancelBlockReason: string | null;
};

function fmtQty(value: number, unit?: string) {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "0";
  return unit?.trim() ? `${text} ${unit}` : text;
}

function parseQty(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function RmStockPlanningPage() {
  const { showSuccess, showError } = useToast();
  const { flags } = useFeatureFlags();
  const planningDrivenProcurement = flags.planningDrivenProcurement;
  const auth = useAuth();
  const [data, setData] = React.useState<RmStockPlanningResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<number>>(() => new Set());
  const [qtyByItemId, setQtyByItemId] = React.useState<Record<number, string>>({});
  const [cancelTarget, setCancelTarget] = React.useState<ReplenishmentMrRow | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [cancelling, setCancelling] = React.useState(false);

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const next = await apiFetch<RmStockPlanningResponse>("/api/rm-stock-planning");
      setData(next);
      setQtyByItemId((prev) => {
        const out: Record<number, string> = { ...prev };
        for (const row of next.rows) {
          const locked = isRowOrderQtyLocked(row);
          if (locked) {
            out[row.itemId] = "0";
          } else if (out[row.itemId] == null || out[row.itemId] === "") {
            out[row.itemId] = row.suggestedOrderQty > 0 ? String(row.suggestedOrderQty) : "0";
          }
        }
        return out;
      });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to load RM stock planning");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [showError]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!data?.rows.length) return;
    setSelected((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        const row = data.rows.find((r) => r.itemId === id);
        if (!row) {
          changed = true;
          continue;
        }
        const qty = parseQty(qtyByItemId[row.itemId] ?? "0");
        if (isRowSelectableForReplenishmentMr(row, qty)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [data, qtyByItemId]);

  const rows = data?.rows ?? [];
  const selectableRows = rows.filter((row) =>
    isRowSelectableForReplenishmentMr(row, parseQty(qtyByItemId[row.itemId] ?? "0")),
  );
  const selectedItems = rows.filter((row) => selected.has(row.itemId));
  const validSelected = selectedItems.filter((row) =>
    isRowSelectableForReplenishmentMr(row, parseQty(qtyByItemId[row.itemId] ?? "0")),
  );

  function toggleRow(row: RmStockPlanningRow) {
    const qty = parseQty(qtyByItemId[row.itemId] ?? "0");
    if (!isRowSelectableForReplenishmentMr(row, qty)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.itemId)) next.delete(row.itemId);
      else next.add(row.itemId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const allSelected = selectableRows.length > 0 && selectableRows.every((row) => prev.has(row.itemId));
      if (allSelected) return new Set();
      return new Set(selectableRows.map((row) => row.itemId));
    });
  }

  async function createReplenishmentMr() {
    const lines = validSelected
      .filter((row) => isRowSelectableForReplenishmentMr(row, parseQty(qtyByItemId[row.itemId] ?? "0")))
      .map((row) => ({ itemId: row.itemId, qty: parseQty(qtyByItemId[row.itemId] ?? "0") }))
      .filter((line) => line.qty > 0);
    if (!lines.length) {
      showError("Select at least one RM item with order qty greater than zero.");
      return;
    }

    setCreating(true);
    try {
      const out = await apiFetch<{ materialRequirement?: { docNo?: string | null; id: number } }>(
        "/api/rm-stock-planning/replenishment-mrs",
        {
          method: "POST",
          body: JSON.stringify({ lines }),
        },
      );
      setSelected(new Set());
      showSuccess(`Replenishment MR ${out.materialRequirement?.docNo ?? ""} created.`);
      await load({ silent: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to create replenishment MR");
    } finally {
      setCreating(false);
    }
  }

  async function cancelReplenishmentMr() {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      showError("Enter a reversal reason before cancelling.");
      return;
    }
    setCancelling(true);
    try {
      await apiFetch(`/api/rm-stock-planning/replenishment-mrs/${cancelTarget.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      showSuccess(`Replenishment MR ${cancelTarget.docNo ?? `MR-${cancelTarget.id}`} cancelled.`);
      setCancelTarget(null);
      setCancelReason("");
      await load({ silent: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to cancel replenishment MR");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <PageContainer className="min-w-0 space-y-4">
      <StickyWorkspaceHead className="border-b border-slate-200/80 bg-white px-1 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">RM Stock Planning</h1>
            <p className="text-xs font-medium text-slate-600">
              Minimum stock replenishment for raw materials.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            {planningDrivenProcurement ? (
              <span
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-800"
                title="Procurement demand must be raised through Monthly Planning."
              >
                Procurement via Monthly Planning
              </span>
            ) : (
              <Button type="button" size="sm" disabled={creating || validSelected.length === 0} onClick={() => void createReplenishmentMr()}>
                <Truck className="mr-2 h-4 w-4" />
                {creating ? "Creating..." : "Create Replenishment MR"}
              </Button>
            )}
          </div>
        </div>

        <ErpKpiStrip className="max-w-full pt-2">
          <ErpKpiSegment>
            <ErpKpiLabel>RM Items Below Minimum</ErpKpiLabel>
            <ErpKpiValue tone={(data?.summary.rmItemsBelowMinimum ?? 0) > 0 ? "warn" : "muted"}>
              {data?.summary.rmItemsBelowMinimum ?? 0}
            </ErpKpiValue>
          </ErpKpiSegment>
          <ErpKpiSegment>
            <ErpKpiLabel>Total Shortage Qty</ErpKpiLabel>
            <ErpKpiValue tone={(data?.summary.totalShortageQty ?? 0) > 0 ? "warn" : "muted"}>
              {fmtQty(data?.summary.totalShortageQty ?? 0)}
            </ErpKpiValue>
          </ErpKpiSegment>
          <ErpKpiSegment>
            <ErpKpiLabel>Selected Items</ErpKpiLabel>
            <ErpKpiValue tone={validSelected.length > 0 ? "default" : "muted"}>{validSelected.length}</ErpKpiValue>
          </ErpKpiSegment>
          <ErpKpiSegment>
            <ErpKpiLabel>Open Replenishment MRs</ErpKpiLabel>
            <ErpKpiValue tone={(data?.summary.openReplenishmentMrs ?? 0) > 0 ? "warn" : "muted"}>
              {data?.summary.openReplenishmentMrs ?? 0}
            </ErpKpiValue>
          </ErpKpiSegment>
        </ErpKpiStrip>
      </StickyWorkspaceHead>

      <section className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">RM replenishment list</h2>
            <p className="text-[11px] text-slate-600">Current stock plus open replenishment is compared with minimum stock.</p>
          </div>
          <Link to="/procurement-planning?demandPool=STOCK_REPLENISHMENT" className="text-xs font-semibold text-primary underline underline-offset-4">
            Open Procurement Workspace
          </Link>
        </div>

        <div className="min-w-0 overflow-x-auto">
          <table className="erp-table erp-table-dense w-full min-w-[74rem] text-[12px] [&_td]:align-middle [&_td]:py-2 [&_th]:py-2">
            <thead>
              <tr>
                <th className="w-10 text-center">
                  <button type="button" className="inline-flex rounded p-1 text-slate-600 hover:bg-slate-100" onClick={toggleAll} aria-label="Select all eligible RM items">
                    {selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.itemId)) ? (
                      <CheckSquare className="h-4 w-4" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </th>
                <th className="text-left">RM Code</th>
                <th className="text-left">Item Name</th>
                <th className="text-left">Unit</th>
                <th className="text-right">Current Stock</th>
                <th className="text-right">Minimum Stock</th>
                <th className="text-right">Pending Replenishment</th>
                <th className="text-right">Net Available</th>
                <th className="text-right">Shortage</th>
                <th className="text-right">Suggested Qty</th>
                <th className="text-right">Order Qty</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-sm text-slate-500">
                    Loading RM stock planning...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-sm text-slate-500">
                    No RM items found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const shortage = row.shortageQty > 0;
                  const statusLabel = getRmStockPlanningRowStatus(row);
                  const qtyLocked = isRowOrderQtyLocked(row);
                  const orderQty = qtyLocked ? "0" : (qtyByItemId[row.itemId] ?? "0");
                  const canSubmit = isRowSelectableForReplenishmentMr(row, parseQty(orderQty));
                  return (
                    <tr
                      key={row.itemId}
                      className={cn(
                        shortage && "bg-amber-50/45",
                        qtyLocked && statusLabel === REPLENISHMENT_IN_PROGRESS_LABEL && "bg-sky-50/50",
                        qtyLocked && statusLabel === STOCK_SUFFICIENT_LABEL && "bg-emerald-50/40",
                      )}
                    >
                      <td className="text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                          checked={selected.has(row.itemId)}
                          disabled={!canSubmit}
                          onChange={() => toggleRow(row)}
                          aria-label={`Select ${row.itemName}`}
                        />
                      </td>
                      <td className="font-semibold text-slate-800">{row.generatedDisplayCode}</td>
                      <td className="max-w-[18rem]">
                        <span className="block truncate font-medium text-slate-900" title={row.itemName}>
                          {row.itemName}
                        </span>
                        {statusLabel ? (
                          <span
                            className={cn(
                              "mt-0.5 block text-[11px] font-semibold",
                              statusLabel === REPLENISHMENT_IN_PROGRESS_LABEL
                                ? "text-sky-800"
                                : "text-emerald-800",
                            )}
                          >
                            {statusLabel}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-slate-600">{row.unit || "-"}</td>
                      <td className="text-right tabular-nums">{fmtQty(row.usableStock)}</td>
                      <td className="text-right tabular-nums">{fmtQty(row.minimumStockQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(row.pendingReplenishmentQty)}</td>
                      <td className="text-right tabular-nums">{fmtQty(row.netAvailableQty)}</td>
                      <td className="text-right tabular-nums">
                        <Badge variant={shortage ? "warning" : "default"} className="justify-end tabular-nums">
                          {fmtQty(row.shortageQty)}
                        </Badge>
                      </td>
                      <td className="text-right tabular-nums">{fmtQty(row.suggestedOrderQty)}</td>
                      <td className="text-right">
                        {qtyLocked ? (
                          <span
                            className={cn(
                              "text-[11px] font-medium",
                              statusLabel === REPLENISHMENT_IN_PROGRESS_LABEL
                                ? "text-sky-800"
                                : "text-emerald-800",
                            )}
                          >
                            {statusLabel ?? STOCK_SUFFICIENT_LABEL}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={orderQty}
                            disabled={qtyLocked}
                            onChange={(e) => {
                              const value = e.target.value;
                              setQtyByItemId((prev) => ({ ...prev, [row.itemId]: value }));
                              if (!isRowSelectableForReplenishmentMr(row, parseQty(value))) {
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  next.delete(row.itemId);
                                  return next;
                                });
                              }
                            }}
                            className="h-8 w-28 rounded-md border border-slate-200 bg-white px-2 text-right text-xs tabular-nums shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                          />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Open replenishment MRs</h2>
            <p className="text-[11px] text-slate-600">ADMIN can cancel only before a purchase request is created.</p>
          </div>
          <Badge variant={(data?.openReplenishmentMrs.length ?? 0) > 0 ? "warning" : "default"} className="tabular-nums">
            {data?.openReplenishmentMrs.length ?? 0}
          </Badge>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="erp-table erp-table-dense w-full min-w-[46rem] text-[12px] [&_td]:py-2 [&_th]:py-2">
            <thead>
              <tr>
                <th className="text-left">MR No.</th>
                <th className="text-left">Created</th>
                <th className="text-right">Lines</th>
                <th className="text-right">Qty</th>
                <th className="text-left">PR status</th>
                <th className="text-right">Admin action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-500">
                    Loading open replenishment MRs...
                  </td>
                </tr>
              ) : (data?.openReplenishmentMrs ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-500">
                    No open replenishment MRs.
                  </td>
                </tr>
              ) : (
                (data?.openReplenishmentMrs ?? []).map((mr) => (
                  <tr key={mr.id}>
                    <td className="font-semibold text-slate-900">{mr.docNo ?? `MR-${mr.id}`}</td>
                    <td className="text-slate-600">
                      {new Date(mr.createdAt).toLocaleDateString()} {mr.createdByName ? `· ${mr.createdByName}` : ""}
                    </td>
                    <td className="text-right tabular-nums">{mr.lineCount}</td>
                    <td className="text-right tabular-nums">{fmtQty(mr.totalQty)}</td>
                    <td>
                      {mr.hasPurchaseRequest ? (
                        <Badge variant="info">{mr.purchaseRequestRefs.join(", ")}</Badge>
                      ) : (
                        <Badge variant="default">Not created</Badge>
                      )}
                    </td>
                    <td className="text-right">
                      {auth.user?.role === "ADMIN" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={!mr.canCancel}
                          title={mr.cancelBlockReason ?? "Cancel replenishment MR"}
                          onClick={() => {
                            setCancelTarget(mr);
                            setCancelReason("");
                          }}
                        >
                          Cancel MR
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-500">Admin only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {cancelTarget ? (
        <ErpModal onClose={() => setCancelTarget(null)} aria-labelledby="cancel-replenishment-title">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 id="cancel-replenishment-title" className="text-sm font-bold text-slate-900">
                Cancel replenishment MR
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                {cancelTarget.docNo ?? `MR-${cancelTarget.id}`} will stay visible with reversal audit details.
              </p>
            </div>
            <div className="space-y-2 px-4 py-3">
              <label className="text-xs font-semibold text-slate-700" htmlFor="cancel-replenishment-reason">
                Reversal reason
              </label>
              <textarea
                id="cancel-replenishment-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Reason required"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
              <Button type="button" variant="outline" size="sm" disabled={cancelling} onClick={() => setCancelTarget(null)}>
                Close
              </Button>
              <Button type="button" size="sm" disabled={cancelling || cancelReason.trim().length < 3} onClick={() => void cancelReplenishmentMr()}>
                {cancelling ? "Cancelling..." : "Confirm cancel"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}
    </PageContainer>
  );
}
