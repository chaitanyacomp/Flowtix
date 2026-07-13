import * as React from "react";
import { Link } from "react-router-dom";
import { CheckSquare, RefreshCw, Square, Truck } from "lucide-react";
import { apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { PageContainer, StickyWorkspaceHead } from "../components/PageHeader";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import { cn } from "../lib/utils";
import { ErpModal } from "../components/erp/ErpModal";
import {
  canRaisePurchaseRequestForRow,
  isRowCheckboxEnabled,
  isRowOrderQtyLocked,
  isRowSelectableForReplenishmentMr,
} from "../lib/rmStockPlanningUx";

type RmStockPlanningRow = {
  itemId: number;
  itemName: string;
  generatedDisplayCode: string;
  unit: string;
  usableStock: number;
  currentStock?: number;
  minimumStockQty: number;
  targetStockQty?: number | null;
  pendingReplenishmentQty: number;
  openStockReplenishmentQty?: number;
  netAvailableQty: number;
  shortageQty: number;
  suggestedOrderQty: number;
  suggestedPurchaseQty?: number;
  monitorStatus?: "BELOW_MINIMUM" | "HEALTHY";
  monitorStatusLabel?: string;
  canRaisePurchaseRequest?: boolean;
  eligibleForRequest?: boolean;
  raiseBlockReason?: string | null;
};

type ReplenishmentMrRow = {
  id: number;
  docNo: string | null;
  status: string;
  createdAt: string;
  createdByName: string | null;
  lineCount: number;
  itemCount?: number;
  totalQty: number;
  requestedQty?: number;
  pendingQty?: number;
  hasPurchaseRequest: boolean;
  purchaseRequestRefs: string[];
  purchaseRequestNos?: string[];
  poNos?: string[];
  procurementStatus?: string;
  canCancel: boolean;
  cancelBlockReason: string | null;
};

type RmStockPlanningResponse = {
  rows: RmStockPlanningRow[];
  summary: {
    rmItemsBelowMinimum: number;
    eligibleForRequest?: number;
    openReplenishmentMrs: number;
    openRequests?: number;
  };
  openReplenishmentMrs: ReplenishmentMrRow[];
  openRequests?: ReplenishmentMrRow[];
  sourceType?: string;
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
  const auth = useAuth();
  const [data, setData] = React.useState<RmStockPlanningResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<number>>(() => new Set());
  const [qtyByItemId, setQtyByItemId] = React.useState<Record<number, string>>({});
  const [cancelTarget, setCancelTarget] = React.useState<ReplenishmentMrRow | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [cancelling, setCancelling] = React.useState(false);

  const load = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const next = await apiFetch<RmStockPlanningResponse>("/api/rm-stock-planning");
        setData(next);
        setQtyByItemId((prev) => {
          const out: Record<string, string> = { ...prev };
          for (const row of next.rows) {
            if (isRowOrderQtyLocked(row)) {
              out[row.itemId] = "0";
            } else if (out[row.itemId] == null || out[row.itemId] === "") {
              const suggested = row.suggestedPurchaseQty ?? row.suggestedOrderQty;
              out[row.itemId] = suggested > 0 ? String(suggested) : "0";
            }
          }
          return out;
        });
      } catch (e) {
        showError(e instanceof Error ? e.message : "Failed to load RM Stock Monitor");
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [showError],
  );

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
        if (!row || !isRowCheckboxEnabled(row)) {
          changed = true;
          continue;
        }
        next.add(id);
      }
      return changed ? next : prev;
    });
  }, [data]);

  const rows = data?.rows ?? [];
  const openRequests = data?.openRequests ?? data?.openReplenishmentMrs ?? [];
  const checkboxEnabledRows = rows.filter((row) => isRowCheckboxEnabled(row));
  const validSelected = rows.filter(
    (row) => selected.has(row.itemId) && isRowSelectableForReplenishmentMr(row, parseQty(qtyByItemId[row.itemId] ?? "0")),
  );
  const eligibleCount =
    data?.summary.eligibleForRequest ?? rows.filter((r) => canRaisePurchaseRequestForRow(r)).length;

  function toggleRow(row: RmStockPlanningRow) {
    if (!isRowCheckboxEnabled(row)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.itemId)) next.delete(row.itemId);
      else next.add(row.itemId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const allSelected =
        checkboxEnabledRows.length > 0 && checkboxEnabledRows.every((row) => prev.has(row.itemId));
      if (allSelected) return new Set();
      return new Set(checkboxEnabledRows.map((row) => row.itemId));
    });
  }

  async function raiseReplenishmentRequest() {
    const lines = validSelected
      .map((row) => ({ itemId: row.itemId, qty: parseQty(qtyByItemId[row.itemId] ?? "0") }))
      .filter((line) => line.qty > 0);
    if (!lines.length) {
      showError("Select at least one eligible RM item with purchase qty greater than zero.");
      return;
    }

    setCreating(true);
    try {
      const out = await apiFetch<{
        purchaseRequest?: { docNo?: string | null; id: number };
        materialRequirement?: { docNo?: string | null; id: number };
      }>("/api/rm-stock-planning/raise-purchase-request", {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
      setSelected(new Set());
      showSuccess(
        `Replenishment request raised — ${out.materialRequirement?.docNo ?? ""} → ${out.purchaseRequest?.docNo ?? ""}.`,
      );
      await load({ silent: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to raise replenishment request");
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
      showSuccess(`Replenishment request ${cancelTarget.docNo ?? cancelTarget.id} cancelled.`);
      setCancelTarget(null);
      setCancelReason("");
      await load({ silent: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to cancel replenishment request");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <PageContainer className="min-w-0 space-y-4">
      <StickyWorkspaceHead className="border-b border-slate-200/80 bg-white px-1 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">RM Stock Monitor</h1>
            <p className="text-xs font-medium text-slate-600">
              Independent RM stock replenishment — separate from Order RM and Monthly Planning.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={creating || validSelected.length === 0}
              onClick={() => void raiseReplenishmentRequest()}
            >
              <Truck className="mr-2 h-4 w-4" />
              {creating ? "Raising…" : "Raise Replenishment Request"}
            </Button>
          </div>
        </div>

        <ErpKpiStrip className="max-w-full pt-2">
          <ErpKpiSegment>
            <ErpKpiLabel>Below Minimum</ErpKpiLabel>
            <ErpKpiValue tone={(data?.summary.rmItemsBelowMinimum ?? 0) > 0 ? "warn" : "muted"}>
              {data?.summary.rmItemsBelowMinimum ?? 0}
            </ErpKpiValue>
          </ErpKpiSegment>
          <ErpKpiSegment>
            <ErpKpiLabel>Eligible for Request</ErpKpiLabel>
            <ErpKpiValue tone={eligibleCount > 0 ? "warn" : "muted"}>{eligibleCount}</ErpKpiValue>
          </ErpKpiSegment>
          <ErpKpiSegment>
            <ErpKpiLabel>Selected</ErpKpiLabel>
            <ErpKpiValue tone={validSelected.length > 0 ? "default" : "muted"}>{validSelected.length}</ErpKpiValue>
          </ErpKpiSegment>
          <ErpKpiSegment>
            <ErpKpiLabel>Open Requests</ErpKpiLabel>
            <ErpKpiValue
              tone={(data?.summary.openRequests ?? data?.summary.openReplenishmentMrs ?? 0) > 0 ? "warn" : "muted"}
            >
              {data?.summary.openRequests ?? data?.summary.openReplenishmentMrs ?? 0}
            </ErpKpiValue>
          </ErpKpiSegment>
        </ErpKpiStrip>
      </StickyWorkspaceHead>

      <section className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">RM stock status</h2>
            <p className="text-[11px] text-slate-600">
              Raise Replenishment Request when Current Stock is below Minimum and open requests do not already cover the
              gap.
            </p>
          </div>
          <Link
            to="/procurement-planning?demandPool=STOCK_REPLENISHMENT"
            className="text-xs font-semibold text-primary underline underline-offset-4"
          >
            Open Procurement Workspace (Stock Replenishment)
          </Link>
        </div>

        <div className="min-w-0 overflow-x-auto">
          <table className="erp-table erp-table-dense w-full min-w-[70rem] text-[12px] [&_td]:align-middle [&_td]:py-2 [&_th]:py-2">
            <thead>
              <tr>
                <th className="w-10 text-center">
                  <button
                    type="button"
                    className="inline-flex rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    onClick={toggleAll}
                    disabled={checkboxEnabledRows.length === 0}
                    aria-label="Select all eligible RM items"
                  >
                    {checkboxEnabledRows.length > 0 &&
                    checkboxEnabledRows.every((row) => selected.has(row.itemId)) ? (
                      <CheckSquare className="h-4 w-4" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </th>
                <th className="text-left">Item</th>
                <th className="text-left">Unit</th>
                <th className="text-right">Current Stock</th>
                <th className="text-right">Minimum Stock</th>
                <th className="text-left">Status</th>
                <th className="text-right">Suggested Qty</th>
                <th className="text-right">Request Qty</th>
                <th className="text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                    Loading RM Stock Monitor…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                    No RM items found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const eligible = isRowCheckboxEnabled(row);
                  const qtyLocked = isRowOrderQtyLocked(row);
                  const suggested = row.suggestedPurchaseQty ?? row.suggestedOrderQty;
                  const orderQty = qtyLocked ? "0" : (qtyByItemId[row.itemId] ?? "0");
                  const current = row.currentStock ?? row.usableStock;
                  const statusLabel = row.monitorStatusLabel ?? (row.monitorStatus === "BELOW_MINIMUM" ? "Below Minimum" : "Healthy");
                  const actionLabel = eligible
                    ? "Raise Replenishment Request"
                    : row.raiseBlockReason === "Not required" || row.monitorStatus === "HEALTHY"
                      ? "Not required"
                      : row.raiseBlockReason || "—";
                  return (
                    <tr
                      key={row.itemId}
                      className={cn(
                        row.monitorStatus === "BELOW_MINIMUM" && "bg-amber-50/45",
                        row.monitorStatus === "HEALTHY" && "bg-emerald-50/25",
                      )}
                    >
                      <td className="text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                          checked={selected.has(row.itemId)}
                          disabled={!eligible}
                          onChange={() => toggleRow(row)}
                          aria-label={`Select ${row.itemName}`}
                        />
                      </td>
                      <td className="max-w-[18rem]">
                        <span className="block truncate font-medium text-slate-900" title={row.itemName}>
                          {row.itemName}
                        </span>
                        <span className="text-[11px] text-slate-500">{row.generatedDisplayCode}</span>
                      </td>
                      <td className="text-slate-600">{row.unit || "-"}</td>
                      <td className="text-right tabular-nums">{fmtQty(current)}</td>
                      <td className="text-right tabular-nums">{fmtQty(row.minimumStockQty)}</td>
                      <td>
                        <Badge variant={row.monitorStatus === "BELOW_MINIMUM" ? "warning" : "default"}>
                          {statusLabel}
                        </Badge>
                      </td>
                      <td className="text-right tabular-nums">{fmtQty(suggested)}</td>
                      <td className="text-right">
                        {qtyLocked ? (
                          <span className="text-[11px] font-medium text-slate-600">—</span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={orderQty}
                            onChange={(e) => {
                              const value = e.target.value;
                              setQtyByItemId((prev) => ({ ...prev, [row.itemId]: value }));
                            }}
                            className="h-8 w-28 rounded-md border border-slate-200 bg-white px-2 text-right text-xs tabular-nums shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                        )}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "text-[11px]",
                            eligible ? "font-semibold text-slate-800" : "text-slate-500",
                          )}
                        >
                          {actionLabel}
                        </span>
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
            <h2 className="text-sm font-bold text-slate-900">Open Replenishment Requests</h2>
            <p className="text-[11px] text-slate-600">
              Active STOCK_REPLENISHMENT requests. ADMIN can cancel draft requests before procurement is created.
            </p>
          </div>
          <Badge variant={openRequests.length > 0 ? "warning" : "default"} className="tabular-nums">
            {openRequests.length}
          </Badge>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="erp-table erp-table-dense w-full min-w-[64rem] text-[12px] [&_td]:py-2 [&_th]:py-2">
            <thead>
              <tr>
                <th className="text-left">Request No.</th>
                <th className="text-left">Created Date</th>
                <th className="text-right">Items</th>
                <th className="text-right">Requested Qty</th>
                <th className="text-left">Purchase Request No.</th>
                <th className="text-left">PO No.</th>
                <th className="text-left">Procurement Status</th>
                <th className="text-right">Pending Qty</th>
                <th className="text-right">Admin</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-center text-sm text-slate-500">
                    Loading open replenishment requests…
                  </td>
                </tr>
              ) : openRequests.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-center text-sm text-slate-500">
                    No open replenishment requests.
                  </td>
                </tr>
              ) : (
                openRequests.map((mr) => (
                  <tr key={mr.id}>
                    <td className="font-semibold text-slate-900">{mr.docNo ?? `REQ-${mr.id}`}</td>
                    <td className="text-slate-600">
                      {new Date(mr.createdAt).toLocaleDateString()}
                      {mr.createdByName ? ` · ${mr.createdByName}` : ""}
                    </td>
                    <td className="text-right tabular-nums">{mr.itemCount ?? mr.lineCount}</td>
                    <td className="text-right tabular-nums">{fmtQty(mr.requestedQty ?? mr.totalQty)}</td>
                    <td>
                      {(mr.purchaseRequestNos ?? mr.purchaseRequestRefs).length > 0 ? (
                        <Badge variant="info">{(mr.purchaseRequestNos ?? mr.purchaseRequestRefs).join(", ")}</Badge>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td>
                      {(mr.poNos ?? []).length > 0 ? (
                        <Badge variant="info">{(mr.poNos ?? []).join(", ")}</Badge>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td>
                      <Badge variant="default">{mr.procurementStatus ?? mr.status}</Badge>
                    </td>
                    <td className="text-right tabular-nums">{fmtQty(mr.pendingQty ?? 0)}</td>
                    <td className="text-right">
                      {auth.user?.role === "ADMIN" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={!mr.canCancel}
                          title={mr.cancelBlockReason ?? "Cancel replenishment request"}
                          onClick={() => {
                            setCancelTarget(mr);
                            setCancelReason("");
                          }}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
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
                Cancel replenishment request
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                {cancelTarget.docNo ?? `REQ-${cancelTarget.id}`} will stay visible with reversal audit details.
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
              <Button
                type="button"
                size="sm"
                disabled={cancelling || cancelReason.trim().length < 3}
                onClick={() => void cancelReplenishmentMr()}
              >
                {cancelling ? "Cancelling..." : "Confirm cancel"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}
    </PageContainer>
  );
}
