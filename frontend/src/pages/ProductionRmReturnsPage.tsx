/**
 * Phase 3D — Production → Store RM return (MRN).
 */
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, PackageMinus, Send, Trash2 } from "lucide-react";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useToast } from "../contexts/ToastContext";
import { PageContainer, StickyWorkspaceHead } from "../components/PageHeader";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";
import { computeUnusedIssuedRmQty, validateReturnQtyInput } from "../lib/rmReturnUx";

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
  unusedQty?: number;
  netIssuedQty: number;
  returnableQty: number;
  onHandAtProduction: number;
  canReturn: boolean;
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

type RecentReturn = {
  id: number;
  docNo: string | null;
  fromLocation: LocationRow;
  toLocation: LocationRow;
  workOrderNo: string | null;
  pmrDocNo: string | null;
  remarks: string | null;
  createdAt: string;
  lineCount: number;
  lines: Array<{ itemName: string; returnQty: number; unit: string }>;
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
  const [ctx, setCtx] = React.useState<ContextResponse | null>(null);
  const [recent, setRecent] = React.useState<RecentReturn[]>([]);
  const [returnable, setReturnable] = React.useState<ReturnableResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingReturnable, setLoadingReturnable] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [workOrderId, setWorkOrderId] = React.useState<number | "">("");
  const [pmrId, setPmrId] = React.useState<number | "">("");
  const [fromLocationId, setFromLocationId] = React.useState<number | "">("");
  const [toLocationId, setToLocationId] = React.useState<number | "">("");
  const [remarks, setRemarks] = React.useState("");
  const [draftLines, setDraftLines] = React.useState<ReturnLineDraft[]>([]);

  async function loadReturnable(woId: number, pmr?: number | "") {
    setLoadingReturnable(true);
    try {
      const qs = new URLSearchParams({ workOrderId: String(woId) });
      if (typeof pmr === "number" && pmr > 0) qs.set("productionMaterialRequestId", String(pmr));
      if (typeof fromLocationId === "number") qs.set("fromLocationId", String(fromLocationId));
      if (typeof toLocationId === "number") qs.set("toLocationId", String(toLocationId));
      const data = await apiFetch<ReturnableResponse>(`/api/production-material-returns/returnable?${qs}`);
      setReturnable(data);
      if (data.defaultFromLocationId && !fromLocationId) setFromLocationId(data.defaultFromLocationId);
      if (data.defaultToLocationId && !toLocationId) setToLocationId(data.defaultToLocationId);
    } catch (e) {
      setReturnable(null);
      showError(e instanceof Error ? e.message : "Could not load returnable RM");
    } finally {
      setLoadingReturnable(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [context, list] = await Promise.all([
        apiFetch<ContextResponse>("/api/production-material-returns/context"),
        apiFetch<RecentReturn[]>("/api/production-material-returns/"),
      ]);
      setCtx(context);
      setRecent(Array.isArray(list) ? list : []);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to load RM returns");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadAll();
  }, []);

  React.useEffect(() => {
    const wo = Number(searchParams.get("workOrderId"));
    const pmr = Number(searchParams.get("pmrId"));
    if (Number.isFinite(wo) && wo > 0) {
      setWorkOrderId(wo);
      if (Number.isFinite(pmr) && pmr > 0) setPmrId(pmr);
    }
  }, [searchParams]);

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
      await loadAll();
      if (typeof workOrderId === "number") await loadReturnable(workOrderId, pmrId);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Return failed");
    } finally {
      setSubmitting(false);
    }
  }

  const woOptions = ctx?.workOrders ?? [];
  const selectedWo = woOptions.find((w) => w.id === workOrderId);
  const pmrOptions = selectedWo?.pmrs ?? [];

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
              {pmrOptions.length > 0 ? (
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
                      <th className="px-2 py-1" />
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
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px]"
                            disabled={!ln.canReturn}
                            onClick={() => addDraftLine(ln)}
                          >
                            Add
                          </Button>
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
            {recent.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No returns yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-[12px]">
                {recent.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="font-medium text-slate-900">
                      {r.docNo || `MRN-${r.id}`} · {r.fromLocation.locationName} → {r.toLocation.locationName}
                    </div>
                    <div className="text-slate-600">
                      {r.workOrderNo ? `WO ${r.workOrderNo}` : ""}
                      {r.pmrDocNo ? ` · ${r.pmrDocNo}` : ""}
                    </div>
                    <div className="text-slate-500">
                      {r.lines.map((ln) => `${ln.itemName} ${fmtQty(ln.returnQty, ln.unit)}`).join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageContainer>
  );
}
