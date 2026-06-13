/**
 * Phase 3B — Production Material Request (PMR).
 * Store action queue + Production raise flow.
 */
import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Send } from "lucide-react";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../hooks/useAuth";
import { PageContainer, StickyWorkspaceHead } from "../components/PageHeader";
import {
  materialIssueWorkspaceHref,
  productionWorkspaceHref,
} from "../lib/materialWorkflowLinks";
import { buildProductionScopedHref } from "../lib/productionNavigation";

type PmrLine = {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  requiredQty: number;
  issuedQty: number;
  pendingQty: number;
};

type PmrRow = {
  id: number;
  docNo: string | null;
  status: string;
  workOrderId: number;
  workOrderNo: string | null;
  salesOrderNo: string | null;
  remarks: string | null;
  totalPending: number;
  lineCount: number;
  lines: PmrLine[];
};

type BomSuggestion = {
  workOrderId: number;
  workOrderNo: string | null;
  lines: Array<{ itemId: number; itemName: string; unit: string; requiredQty: number }>;
  missingChildBoms: Array<{ sfgItemId: number; sfgName: string }>;
};

type WoOption = { id: number; docNo: string | null; label: string };

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  REQUESTED: "Pending Issue",
  PARTIALLY_ISSUED: "Partial Issue",
  FULLY_ISSUED: "Fully Issued",
  CANCELLED: "Cancelled",
};

function statusClass(status: string) {
  switch (status) {
    case "REQUESTED":
      return "border-amber-300 bg-amber-50 text-amber-950";
    case "PARTIALLY_ISSUED":
      return "border-blue-300 bg-blue-50 text-blue-950";
    case "FULLY_ISSUED":
      return "border-emerald-300 bg-emerald-50 text-emerald-950";
    case "CANCELLED":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function fmtQty(n: number, unit?: string) {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

export function ProductionMaterialRequestsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showSuccess, showError } = useToast();
  const isStore = user?.role === "STORE" || user?.role === "ADMIN";
  const isProduction = user?.role === "PRODUCTION" || user?.role === "ADMIN";

  const urlWorkOrderId = Number(searchParams.get("workOrderId")) || 0;
  const urlWorkOrderLineId = Number(searchParams.get("workOrderLineId")) || 0;
  const urlPmrId = Number(searchParams.get("pmrId")) || 0;
  const urlReturnTo = searchParams.get("returnTo");
  const urlTab = searchParams.get("tab");

  const [tab, setTab] = React.useState<"list" | "create">("list");
  const [rows, setRows] = React.useState<PmrRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [workOrders, setWorkOrders] = React.useState<WoOption[]>([]);
  const [workOrderId, setWorkOrderId] = React.useState<number | "">("");
  const [bom, setBom] = React.useState<BomSuggestion | null>(null);
  const [reqQty, setReqQty] = React.useState<Record<number, string>>({});
  const [remarks, setRemarks] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  async function loadList(pendingOnly = false) {
    setLoading(true);
    try {
      const qs = pendingOnly ? "?pendingForStore=1" : "";
      const data = await apiFetch<PmrRow[]>(`/api/production-material-requests${qs}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to load requests");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadList(isStore && !isProduction);
    if (isProduction) {
      apiFetch<{ workOrders: WoOption[] }>("/api/material-issues/context")
        .then((ctx) => setWorkOrders(ctx.workOrders || []))
        .catch(() => setWorkOrders([]));
    }
  }, [isStore, isProduction]);

  React.useEffect(() => {
    if (urlTab === "create" && isProduction) setTab("create");
    if (urlWorkOrderId > 0 && isProduction) {
      setTab("create");
      setWorkOrderId(urlWorkOrderId);
      void loadBom(urlWorkOrderId);
    }
  }, [urlTab, urlWorkOrderId, isProduction]);

  async function loadBom(woId: number) {
    try {
      const data = await apiFetch<BomSuggestion>(
        `/api/production-material-requests/bom-suggestions?workOrderId=${woId}`,
      );
      setBom(data);
      const q: Record<number, string> = {};
      for (const l of data.lines || []) q[l.itemId] = String(l.requiredQty);
      setReqQty(q);
    } catch (e) {
      setBom(null);
      showError(e instanceof Error ? e.message : "Could not load BOM items");
    }
  }

  async function createAndSubmit() {
    if (typeof workOrderId !== "number") {
      showError("Select a work order.");
      return;
    }
    const lines = (bom?.lines || [])
      .map((l) => ({
        itemId: l.itemId,
        requiredQty: Number(reqQty[l.itemId] ?? l.requiredQty),
      }))
      .filter((l) => l.requiredQty > 0);
    if (!lines.length) {
      showError("Add at least one RM line with quantity.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiFetch<PmrRow>("/api/production-material-requests", {
        method: "POST",
        body: JSON.stringify({ workOrderId, remarks: remarks.trim() || null, lines, useBom: false }),
      });
      await apiFetch(`/api/production-material-requests/${created.id}/submit`, { method: "POST" });
      showSuccess(`Request submitted — ${created.docNo || "PMR"}`);
      const prodHref = buildProductionScopedHref({ workOrderId });
      navigate(prodHref);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Failed to save request");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDraft(id: number, docNo: string | null) {
    try {
      await apiFetch(`/api/production-material-requests/${id}/submit`, { method: "POST" });
      showSuccess(`Submitted ${docNo || "request"} to Store`);
      await loadList(isStore && !isProduction);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Submit failed");
    }
  }

  const displayRows = React.useMemo(() => {
    if (isStore) {
      return rows.filter((r) => r.status === "REQUESTED" || r.status === "PARTIALLY_ISSUED");
    }
    return rows;
  }, [rows, isStore]);

  function openPmrFromQueue(r: PmrRow) {
    if (isStore && (r.status === "REQUESTED" || r.status === "PARTIALLY_ISSUED")) {
      navigate(
        materialIssueWorkspaceHref({
          pmrId: r.id,
          workOrderId: r.workOrderId,
          returnTo: "material-requests",
        }),
      );
      return;
    }
    if (isProduction && r.workOrderId > 0) {
      navigate(productionWorkspaceHref(r.workOrderId, urlWorkOrderLineId > 0 ? urlWorkOrderLineId : undefined));
    }
  }

  const backHref =
    urlReturnTo === "production-workspace" && urlWorkOrderId > 0
      ? productionWorkspaceHref(urlWorkOrderId, urlWorkOrderLineId > 0 ? urlWorkOrderLineId : undefined)
      : isStore
        ? "/material-issue"
        : "/production";

  return (
    <PageContainer className="space-y-3">
      <StickyWorkspaceHead
        lead={
          <Link to={backHref} className="text-sm font-medium text-primary hover:underline">
            {urlReturnTo === "production-workspace" ? "Production" : isStore ? "Material Issue" : "Production"}
          </Link>
        }
      >
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            {isStore ? "Pending Material Requests" : "Material Requests"}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {isStore
              ? "Queue of pending material requests — open a request to issue RM in the execution workspace."
              : "Track material request status and priorities. Raise new requests from Production when RM is required."}
          </p>
        </div>
      </StickyWorkspaceHead>

      {tab === "create" && isProduction ? (
        <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Raise material request</h2>
          <p className="mt-1 text-xs text-slate-600">RM quantities are suggested from the approved BOM.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Work order</span>
              <select
                className="erp-select mt-1 w-full"
                value={workOrderId === "" ? "" : String(workOrderId)}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : "";
                  setWorkOrderId(id);
                  if (typeof id === "number") void loadBom(id);
                  else setBom(null);
                }}
              >
                <option value="">Select work order…</option>
                {workOrders.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-600">Remarks</span>
              <Input className="mt-1" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          {bom?.lines?.length ? (
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Required RM</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-900">
                {bom.lines.map((l) => (
                  <li key={l.itemId}>
                    {l.itemName} → {fmtQty(Number(reqQty[l.itemId] ?? l.requiredQty), l.unit)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" className="h-10 px-5 font-bold" disabled={submitting} onClick={() => void createAndSubmit()}>
              <Send className="mr-1 h-4 w-4" />
              Submit to Store
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setTab("list")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-slate-600">Loading…</p>
          ) : displayRows.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
              {isStore ? "No pending material requests." : "No material requests yet."}
            </p>
          ) : (
            displayRows.map((r) => {
              const actionableStore = isStore && (r.status === "REQUESTED" || r.status === "PARTIALLY_ISSUED");
              const actionableProd = isProduction && r.workOrderId > 0;
              const cardClickable = actionableStore || actionableProd;
              return (
                <section
                  key={r.id}
                  role={cardClickable ? "button" : undefined}
                  tabIndex={cardClickable ? 0 : undefined}
                  onClick={cardClickable ? () => openPmrFromQueue(r) : undefined}
                  onKeyDown={
                    cardClickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openPmrFromQueue(r);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "rounded-lg border px-4 py-3 shadow-sm",
                    urlPmrId === r.id ? "border-violet-400 bg-violet-50/40 ring-2 ring-violet-200" : "border-slate-300 bg-white",
                    cardClickable && "cursor-pointer transition hover:border-slate-400 hover:shadow-md",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[15px] font-bold text-slate-950">{r.docNo || `PMR-${r.id}`}</h2>
                        <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-bold", statusClass(r.status))}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-slate-800">
                        {r.workOrderNo ? `WO ${r.workOrderNo}` : ""}
                        {r.salesOrderNo ? ` · SO ${r.salesOrderNo}` : ""}
                      </p>
                      <p className="mt-2 text-[13px] text-slate-700">
                        <span className="font-semibold tabular-nums">{r.lineCount}</span> RM line{r.lineCount === 1 ? "" : "s"}
                        {r.totalPending > 0 ? (
                          <>
                            {" · "}
                            <span className="font-semibold tabular-nums text-amber-900">{fmtQty(r.totalPending)}</span> pending
                            issue
                          </>
                        ) : null}
                        {r.status === "PARTIALLY_ISSUED" ? (
                          <span className="ml-1 text-xs font-medium text-blue-800">· partially issued</span>
                        ) : null}
                      </p>
                      {cardClickable ? (
                        <p className="mt-2 text-xs font-medium text-primary">
                          {actionableStore ? "Open in Material Issue Workspace →" : "Open Production Workspace →"}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-slate-600">Requested by Production Department</p>
                      )}
                    </div>
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {r.status === "DRAFT" && isProduction ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-10 px-4 font-bold"
                          onClick={() => void submitDraft(r.id, r.docNo)}
                        >
                          Submit to Store
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </section>
              );
            })
          )}
        </div>
      )}
    </PageContainer>
  );
}
