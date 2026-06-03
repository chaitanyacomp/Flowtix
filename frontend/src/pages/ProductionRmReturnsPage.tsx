/**
 * Phase 3D — Production → Store RM return (MRN).
 */
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, PackageMinus, Send, Trash2 } from "lucide-react";
import { RmWastageModal } from "../components/erp/RmWastageModal";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useToast } from "../contexts/ToastContext";
import { PageContainer, StickyWorkspaceHead } from "../components/PageHeader";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import { computeUnusedIssuedRmQty, validateReturnQtyInput } from "../lib/rmReturnUx";
import { logRmReturnsApiError, parsePositiveIntParam } from "../lib/rmReturnsPageLoad";

type LocationRow = {
  id: number;
  locationCode: string;
  locationName: string;
  locationType: string;
};

type WoOption = {
  id: number;
  docNo: string | null;
  label: string;
  pmrs: Array<{ id: number; docNo: string | null; status: string }>;
};

type ReturnableLine = {
  itemId: number;
  itemName: string;
  unit: string;
  grossIssuedQty: number;
  consumedQty: number;
  returnedQty: number;
  wastageQty?: number;
  unusedQty?: number;
  netIssuedQty: number;
  returnableQty: number;
  availableWastageQty?: number;
  onHandAtProduction: number;
  canReturn: boolean;
  canDeclareWastage?: boolean;
};

type ReturnableResponse = {
  workOrderId: number;
  workOrderNo: string | null;
  productionMaterialRequestId: number | null;
  productionMaterialRequestDocNo: string | null;
  productionLocationIds: number[];
  defaultFromLocationId: number | null;
  defaultToLocationId: number | null;
  lines: ReturnableLine[];
};

type ContextResponse = {
  fromLocations: LocationRow[];
  toLocations: LocationRow[];
  workOrders: WoOption[];
};

type ReturnLineDraft = {
  key: string;
  itemId: number;
  itemName: string;
  unit: string;
  returnableQty: number;
  returnQty: string;
};

type HistoryEntry = {
  kind: "RETURN" | "WASTAGE";
  id: number;
  docNo: string | null;
  createdAt: string;
  direction: string;
  workOrderNo: string | null;
  reason?: string;
  reasonLabel?: string;
  lines: Array<{ itemName: string; qty: number; unit: string }>;
};

function fmtQty(n: number, unit?: string) {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

function newLineKey() {
  return `ln-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ProductionRmReturnsPage() {
  const [searchParams] = useSearchParams();
  const { showSuccess, showError } = useToast();
  const urlWoId = parsePositiveIntParam(searchParams.get("workOrderId"));
  const urlPmrId = parsePositiveIntParam(searchParams.get("pmrId"));
  const [ctx, setCtx] = React.useState<ContextResponse | null>(null);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [wastageLine, setWastageLine] = React.useState<ReturnableLine | null>(null);
  const [returnable, setReturnable] = React.useState<ReturnableResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingReturnable, setLoadingReturnable] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [historyLoadFailed, setHistoryLoadFailed] = React.useState(false);

  const [workOrderId, setWorkOrderId] = React.useState<number | "">(urlWoId ?? "");
  const [pmrId, setPmrId] = React.useState<number | "">(urlPmrId ?? "");
  const [fromLocationId, setFromLocationId] = React.useState<number | "">("");
  const [toLocationId, setToLocationId] = React.useState<number | "">("");
  const [remarks, setRemarks] = React.useState("");
  const [draftLines, setDraftLines] = React.useState<ReturnLineDraft[]>([]);

  async function loadReturnable(woId: number, pmr?: number | "") {
    setLoadingReturnable(true);
    const qs = new URLSearchParams({ workOrderId: String(woId) });
    if (typeof pmr === "number" && pmr > 0) qs.set("productionMaterialRequestId", String(pmr));
    if (typeof fromLocationId === "number") qs.set("fromLocationId", String(fromLocationId));
    if (typeof toLocationId === "number") qs.set("toLocationId", String(toLocationId));
    const endpoint = `/api/production-material-returns/returnable?${qs}`;
    try {
      const data = await apiFetch<ReturnableResponse>(endpoint);
      setReturnable(data);
      if (data.defaultFromLocationId) {
        setFromLocationId((prev) => (prev === "" ? data.defaultFromLocationId! : prev));
      }
      if (data.defaultToLocationId) {
        setToLocationId((prev) => (prev === "" ? data.defaultToLocationId! : prev));
      }
    } catch (e) {
      setReturnable(null);
      logRmReturnsApiError(endpoint, e);
      showError(e instanceof Error ? e.message : "Could not load returnable RM");
    } finally {
      setLoadingReturnable(false);
    }
  }

  async function loadContext(focusWo?: number | null, focusPmr?: number | null) {
    const qs = new URLSearchParams();
    const wo = focusWo ?? urlWoId;
    const pmr = focusPmr ?? urlPmrId;
    if (wo) qs.set("workOrderId", String(wo));
    if (pmr) qs.set("pmrId", String(pmr));
    const endpoint = `/api/production-material-returns/context${qs.toString() ? `?${qs}` : ""}`;
    const context = await apiFetch<ContextResponse>(endpoint);
    setCtx(context);
  }

  async function loadHistory() {
    try {
      const hist = await apiFetch<HistoryEntry[]>("/api/production-material-returns/history");
      setHistory(Array.isArray(hist) ? hist : []);
      setHistoryLoadFailed(false);
    } catch (e) {
      logRmReturnsApiError("/api/production-material-returns/history", e);
      setHistory([]);
      setHistoryLoadFailed(true);
    }
  }

  async function loadPageBootstrap() {
    setLoading(true);
    try {
      await loadContext(
        typeof workOrderId === "number" ? workOrderId : urlWoId,
        typeof pmrId === "number" ? pmrId : urlPmrId,
      );
    } catch (e) {
      logRmReturnsApiError("/api/production-material-returns/context", e);
      showError(e instanceof Error ? e.message : "Failed to load RM return workspace");
    } finally {
      setLoading(false);
    }
    void loadHistory();
  }

  React.useEffect(() => {
    void loadPageBootstrap();
  }, []);

  React.useEffect(() => {
    if (urlWoId) setWorkOrderId(urlWoId);
    if (urlPmrId) setPmrId(urlPmrId);
  }, [urlWoId, urlPmrId]);

  React.useEffect(() => {
    if (urlWoId || urlPmrId) {
      void loadContext(urlWoId, urlPmrId).catch((e) => {
        logRmReturnsApiError("/api/production-material-returns/context (url)", e);
      });
    }
  }, [urlWoId, urlPmrId]);

  React.useEffect(() => {
    if (typeof workOrderId === "number" && workOrderId > 0) {
      void loadReturnable(workOrderId, pmrId);
    } else {
      setReturnable(null);
    }
  }, [workOrderId, pmrId, fromLocationId, toLocationId]);

  function addDraftLine(line: ReturnableLine) {
    if (!line.canReturn) return;
    setDraftLines((prev) => {
      if (prev.some((d) => d.itemId === line.itemId)) return prev;
      return [
        ...prev,
        {
          key: newLineKey(),
          itemId: line.itemId,
          itemName: line.itemName,
          unit: line.unit,
          returnableQty: line.returnableQty,
          returnQty: "",
        },
      ];
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (typeof workOrderId !== "number" || typeof fromLocationId !== "number" || typeof toLocationId !== "number") {
      showError("Select work order, from (production), and to (store) locations.");
      return;
    }
    const lines: Array<{ itemId: number; returnQty: number }> = [];
    for (const ln of draftLines) {
      const check = validateReturnQtyInput(ln.returnQty, ln.returnableQty);
      if (!check.ok) {
        showError(`${ln.itemName}: ${check.message}`);
        return;
      }
      lines.push({ itemId: ln.itemId, returnQty: check.qty });
    }
    if (!lines.length) {
      showError("Add at least one line and enter qty to return.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ docNo: string }>("/api/production-material-returns/", {
        method: "POST",
        body: JSON.stringify({
          workOrderId,
          fromLocationId,
          toLocationId,
          productionMaterialRequestId: typeof pmrId === "number" ? pmrId : null,
          remarks: remarks.trim() || null,
          lines,
        }),
      });
      showSuccess(`Material return ${res.docNo} posted.`);
      setDraftLines([]);
      setRemarks("");
      await loadPageBootstrap();
      if (typeof workOrderId === "number") await loadReturnable(workOrderId, pmrId);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Return failed");
    } finally {
      setSubmitting(false);
    }
  }

  const woOptions = React.useMemo(() => {
    const base = ctx?.workOrders ?? [];
    if (typeof workOrderId !== "number") return base;
    if (base.some((w) => w.id === workOrderId)) return base;
    const label =
      returnable?.workOrderNo != null
        ? `${returnable.workOrderNo} · WO #${workOrderId}`
        : `WO #${workOrderId}`;
    return [{ id: workOrderId, docNo: returnable?.workOrderNo ?? null, label, pmrs: [] }, ...base];
  }, [ctx?.workOrders, workOrderId, returnable?.workOrderNo]);

  const selectedWo = woOptions.find((w) => w.id === workOrderId);
  const pmrOptions = React.useMemo(() => {
    const base = selectedWo?.pmrs ?? [];
    if (typeof pmrId !== "number") return base;
    if (base.some((p) => p.id === pmrId)) return base;
    const doc = returnable?.productionMaterialRequestDocNo;
    return [{ id: pmrId, docNo: doc ?? null, status: "SELECTED" }, ...base];
  }, [selectedWo?.pmrs, pmrId, returnable?.productionMaterialRequestDocNo]);

  return (
    <PageContainer>
      <StickyWorkspaceHead
        lead={
          <Link to="/production" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4" />
            Production
          </Link>
        }
      >
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Return unused RM</h1>
          <p className="text-xs font-medium text-slate-600">
            Move surplus raw material from production back to store. Does not reverse consumption or finished goods.
          </p>
        </div>
      </StickyWorkspaceHead>

      {loading ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <ErpKpiStrip>
            <ErpKpiSegment>
              <ErpKpiLabel>Direction</ErpKpiLabel>
              <ErpKpiValue>Production → Store</ErpKpiValue>
            </ErpKpiSegment>
            <ErpKpiSegment>
              <ErpKpiLabel>Stock txn</ErpKpiLabel>
              <ErpKpiValue>Location transfer (paired)</ErpKpiValue>
            </ErpKpiSegment>
          </ErpKpiStrip>

          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-slate-900">1. Unused RM at production</h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Issued, consumed, and returnable qty per work order. Consumed RM stays consumed; only unused stock can return.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className="erp-flow-filter-input h-8 min-w-[12rem] rounded-md border border-slate-200 px-2 text-[13px]"
                value={workOrderId === "" ? "" : String(workOrderId)}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : "";
                  setWorkOrderId(id);
                  setPmrId("");
                  setDraftLines([]);
                }}
              >
                <option value="">Select work order…</option>
                {woOptions.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
              {pmrOptions.length > 0 || typeof pmrId === "number" ? (
                <select
                  className="erp-flow-filter-input h-8 min-w-[10rem] rounded-md border border-slate-200 px-2 text-[13px]"
                  value={pmrId === "" ? "" : String(pmrId)}
                  onChange={(e) => setPmrId(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">All PMRs (WO)</option>
                  {pmrOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.docNo || `PMR-${p.id}`} · {p.status}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            {loadingReturnable ? (
              <p className="mt-2 text-xs text-slate-500">Loading returnable lines…</p>
            ) : returnable?.lines.length ? (
              <div className="mt-2 max-h-56 overflow-auto rounded border border-slate-100">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-2 py-1">RM Item</th>
                      <th className="px-2 py-1 text-right">Issued</th>
                      <th className="px-2 py-1 text-right">Consumed</th>
                      <th className="px-2 py-1 text-right">Returned</th>
                      <th className="px-2 py-1 text-right">Unused</th>
                      <th className="px-2 py-1 text-right">Returnable</th>
                      <th className="px-2 py-1">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnable.lines.map((ln) => {
                      const unused =
                        ln.unusedQty ??
                        computeUnusedIssuedRmQty(ln.grossIssuedQty, ln.consumedQty, ln.returnedQty);
                      return (
                      <tr key={ln.itemId} className="border-t border-slate-100">
                        <td className="px-2 py-0.5">{ln.itemName}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtQty(ln.grossIssuedQty, ln.unit)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtQty(ln.consumedQty, ln.unit)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtQty(ln.returnedQty, ln.unit)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{fmtQty(unused, ln.unit)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums font-medium">{fmtQty(ln.returnableQty, ln.unit)}</td>
                        <td className="px-2 py-0.5">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px]"
                              disabled={!ln.canReturn}
                              onClick={() => addDraftLine(ln)}
                            >
                              Return
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] text-amber-900"
                              disabled={!(ln.canDeclareWastage ?? ln.canReturn) || typeof fromLocationId !== "number"}
                              onClick={() => setWastageLine(ln)}
                            >
                              Wastage
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            ) : typeof workOrderId === "number" ? (
              <p className="mt-2 text-xs text-slate-500">No returnable RM for this work order.</p>
            ) : null}
          </section>

          <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <PackageMinus className="h-4 w-4" />
              2. Return to store
            </h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-0.5 text-[11px]">
                <span className="font-medium text-slate-600">From production</span>
                <select
                  className="erp-flow-filter-input h-8 rounded-md border border-slate-200 px-2 text-[13px]"
                  value={fromLocationId === "" ? "" : String(fromLocationId)}
                  onChange={(e) => setFromLocationId(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  <option value="">Select…</option>
                  {(ctx?.fromLocations ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.locationName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-0.5 text-[11px]">
                <span className="font-medium text-slate-600">Return to store</span>
                <select
                  className="erp-flow-filter-input h-8 rounded-md border border-slate-200 px-2 text-[13px]"
                  value={toLocationId === "" ? "" : String(toLocationId)}
                  onChange={(e) => setToLocationId(e.target.value ? Number(e.target.value) : "")}
                  required
                >
                  <option value="">Select…</option>
                  {(ctx?.toLocations ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.locationName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-0.5 text-[11px] sm:col-span-2">
                <span className="font-medium text-slate-600">Remarks</span>
                <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="h-8 text-[13px]" />
              </label>
            </div>

            <div className="mt-2 space-y-1">
              {draftLines.map((ln) => (
                <div key={ln.key} className="flex flex-wrap items-end gap-2 rounded border border-slate-100 bg-slate-50/50 px-2 py-1.5">
                  <span className="min-w-[8rem] text-[12px] font-medium">{ln.itemName}</span>
                  <span className="text-[11px] text-slate-500">Returnable {fmtQty(ln.returnableQty, ln.unit)}</span>
                  <label className="grid gap-0.5 text-[11px]">
                    <span className="font-medium text-slate-600">Qty to return</span>
                  <Input
                    type="number"
                    step="any"
                    min={0}
                    max={ln.returnableQty}
                    placeholder="0"
                    value={ln.returnQty}
                    onChange={(e) =>
                      setDraftLines((prev) =>
                        prev.map((d) => (d.key === ln.key ? { ...d, returnQty: e.target.value } : d)),
                      )
                    }
                    className="h-8 w-28 text-[13px]"
                  />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-red-700"
                    onClick={() => setDraftLines((prev) => prev.filter((d) => d.key !== ln.key))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {draftLines.length === 0 ? (
                <p className="text-[11px] text-slate-500">Add lines from the returnable table above.</p>
              ) : null}
            </div>

            <Button type="submit" className="mt-3 h-8 gap-1 text-[12px]" disabled={submitting || !draftLines.length}>
              <Send className="h-3.5 w-3.5" />
              Return to store
            </Button>
          </form>

          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="text-sm font-semibold text-slate-900">3. History</h2>
            {historyLoadFailed ? (
              <p className="mt-1 text-xs text-amber-800">
                Return history loaded; wastage notes could not be loaded (migration may be pending). Returns still work.
              </p>
            ) : null}
            {history.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No returns or wastage yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-[12px]">
                {history.map((r) => (
                  <li key={`${r.kind}-${r.id}`} className="py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          r.kind === "WASTAGE"
                            ? "rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
                            : "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
                        }
                      >
                        {r.kind === "WASTAGE" ? "Wastage" : "Returns"}
                      </span>
                      <span className="font-medium text-slate-900">
                        {r.docNo || (r.kind === "WASTAGE" ? `MWN-${r.id}` : `MRN-${r.id}`)}
                      </span>
                    </div>
                    <div className="text-slate-600">{r.direction}</div>
                    {r.workOrderNo ? <div className="text-slate-600">WO {r.workOrderNo}</div> : null}
                    {r.reasonLabel ? (
                      <div className="text-slate-500">Reason: {r.reasonLabel}</div>
                    ) : null}
                    <div className="text-slate-500">
                      {r.lines.map((ln) => `${ln.itemName} ${fmtQty(ln.qty, ln.unit)}`).join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {wastageLine && typeof workOrderId === "number" && typeof fromLocationId === "number" ? (
            <RmWastageModal
              open
              line={wastageLine}
              workOrderId={workOrderId}
              pmrId={pmrId}
              fromLocationId={fromLocationId}
              onClose={() => setWastageLine(null)}
              onSuccess={async () => {
                await loadPageBootstrap();
                if (typeof workOrderId === "number") await loadReturnable(workOrderId, pmrId);
              }}
            />
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
