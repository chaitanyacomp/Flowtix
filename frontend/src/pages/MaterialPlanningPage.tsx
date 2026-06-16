/**
 * REGULAR flow — Order RM Planning (quotation or sales order → Store RM Requisition).
 * Live BOM explosion and shortage simulation; optional MR draft (not PO, not stock reserve).
 */
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  Info,
  Package,
  X,
} from "lucide-react";
import { apiFetch } from "../services/api";
import { Button, buttonVariants } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { useToast } from "../contexts/ToastContext";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { WorkflowHandoffStrip } from "../components/erp/WorkflowHandoffStrip";
import { REGULAR_TERMS } from "../lib/flowTerminology";
import { buildRmControlCenterHref } from "../lib/woProcurementContinuity";
import { presentOperationalError } from "../lib/operationalErrorPresentation";
import { ErpModal } from "../components/erp/ErpModal";
import { formatRmQty } from "../lib/rmQtyDisplay";

type SourceKind = "quotation" | "salesOrder";

type SourceRow = {
  id: number;
  docNo: string | null;
  customerName: string;
};

type MaterialRequirementLineView = {
  rmItemId: number;
  itemName: string;
  unit: string;
  requiredQty: number;
  shortageQty: number;
  availableQty: number;
};

type MaterialRequirementView = {
  id: number;
  docNo: string | null;
  status: string;
  statusLabel: string;
  createdAt?: string;
  lines: MaterialRequirementLineView[];
};

type MaterialRequirementApiLine = {
  rmItemId: number;
  requiredQty: string | number;
  shortageQty: string | number;
  availableQtySnapshot: string | number;
  unitSnapshot?: string | null;
  rmItem?: { itemName: string; unit: string };
};

type PlanningPreview = {
  sourceType: "QUOTATION" | "SALES_ORDER";
  quotationId: number | null;
  salesOrderId: number | null;
  customerName: string;
  referenceLabel: string;
  referenceNo: string;
  linkedSalesOrderId: number | null;
  linkedSalesOrderNo: string | null;
  linkedQuotationId: number | null;
  linkedQuotationNo: string | null;
  fgCount: number;
  rmCount: number;
  childBomsLinked: number;
  fgSummary: {
    lineId: number;
    fgItemId: number;
    fgName: string;
    fgQty: number;
    unit: string;
    bomRevision: string | null;
    bomDocNo: string | null;
    rmCount: number;
    sfgCount: number;
    planningStatus: string;
    warningMessage: string | null;
  }[];
  rmSummary: {
    rmItemId: number;
    itemName: string;
    unit: string;
    requiredQty: number;
    availableQty: number;
    shortageQty: number;
    status: "AVAILABLE" | "PARTIAL" | "SHORTAGE";
  }[];
  childBomWarnings: string[];
  hasMissingBom: boolean;
  hasMissingChildBom: boolean;
  canRaiseRequirement: boolean;
  totalShortageLines: number;
  allRmAvailable: boolean;
  existingMaterialRequirement: MaterialRequirementView | null;
  completedMaterialRequirement?: MaterialRequirementView | null;
  cancelledMaterialRequirement?: MaterialRequirementView | null;
  operationalState?: {
    key: string;
    currentStage: string;
    purchaseRequiredCount: number;
    pendingProcurementQty: number;
    readyForProduction: boolean;
    procurementCompleted: boolean;
    sourceCompleted: boolean;
    banner: string | null;
    actionLabel: string;
    nextActionLabel?: string | null;
    materialIssueHref?: string | null;
    workOrderId?: number | null;
    workOrderNo?: string | null;
  };
};

const WORKFLOW_STEPS = [
  { id: "source", label: "Sales order / Quotation" },
  { id: "planning", label: "Order RM calculation" },
  { id: "requirement", label: "RM Requisition" },
  { id: "procurement", label: "Procurement Workspace" },
  { id: "purchase", label: "Purchase & GRN" },
] as const;

type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];

function formatQty(n: number, unit?: string) {
  return formatRmQty(n, unit);
}

/** FG chip status — BOM issues first; planning tracks live shortage, not store-issue ownership. */
function resolveFgDisplayStatus(
  fg: PlanningPreview["fgSummary"][number],
  preview: PlanningPreview,
): string {
  if (fg.planningStatus === "MISSING_BOM") return "MISSING_BOM";
  if (fg.planningStatus === "MISSING_CHILD_BOM") return "MISSING_CHILD_BOM";
  if (preview.operationalState?.sourceCompleted) return "SO_COMPLETED";
  if (preview.operationalState?.key === "PROCUREMENT_PENDING") return "PROCUREMENT_PENDING";
  if (preview.operationalState?.key === "PROCUREMENT_COMPLETED") return "PROCUREMENT_COMPLETED";
  const hasRmShortage = preview.rmSummary.some((r) => r.shortageQty > 0);
  if (hasRmShortage || preview.existingMaterialRequirement) return "PROCUREMENT_PENDING";
  if (fg.planningStatus === "READY") return "READY";
  return fg.planningStatus;
}

function fgStatusLabel(status: string) {
  if (status === "MISSING_BOM") return "Missing BOM";
  if (status === "MISSING_CHILD_BOM") return "Child BOM missing";
  if (status === "SO_COMPLETED") return "SO completed";
  if (status === "PROCUREMENT_COMPLETED") return "Procurement complete";
  if (status === "PROCUREMENT_PENDING") return "Supply timeline in progress";
  if (status === "READY") return "Live RM covered";
  return status;
}

function fgStatusClass(status: string) {
  if (status === "MISSING_BOM") return "bg-red-100 text-red-800";
  if (status === "MISSING_CHILD_BOM") return "bg-amber-100 text-amber-900";
  if (status === "SO_COMPLETED" || status === "PROCUREMENT_COMPLETED" || status === "READY")
    return "bg-emerald-100 text-emerald-800";
  if (status === "PROCUREMENT_PENDING") return "bg-violet-100 text-violet-900";
  return "bg-slate-100 text-slate-800";
}

function rmPlanningCurrentStage(preview: PlanningPreview): string {
  if (preview.operationalState?.currentStage) return preview.operationalState.currentStage;
  if (preview.hasMissingBom || preview.hasMissingChildBom) return "Resolve BOM first";
  if (preview.rmSummary.some((r) => r.shortageQty > 0) || preview.existingMaterialRequirement) {
    return "Supply timeline in progress";
  }
  if (preview.allRmAvailable) return "RM ready";
  return "Order RM calculation";
}

function rmOperationalLabel(status: string) {
  if (status === "SO_COMPLETED") return "SO completed";
  if (status === "PROCUREMENT_COMPLETED") return "Procurement complete";
  if (status === "AVAILABLE") return "Live store covered";
  if (status === "PARTIAL") return "Partial shortage";
  return "Supply pending / waiting stock";
}

function rmStatusClass(status: string) {
  if (status === "SO_COMPLETED" || status === "PROCUREMENT_COMPLETED") return "bg-emerald-100 text-emerald-800";
  if (status === "AVAILABLE") return "bg-emerald-100 text-emerald-800";
  if (status === "SHORTAGE") return "bg-red-100 text-red-800";
  if (status === "PARTIAL") return "bg-amber-100 text-amber-900";
  return "bg-red-100 text-red-800";
}

function mapApiMaterialRequirement(raw: {
  id: number;
  docNo: string | null;
  status?: string;
  statusLabel?: string;
  lines?: MaterialRequirementApiLine[];
}): MaterialRequirementView {
  return {
    id: raw.id,
    docNo: raw.docNo,
    status: raw.status ?? "DRAFT",
    statusLabel: raw.statusLabel ?? "Pending Store Approval",
    lines: (raw.lines ?? []).map((l) => ({
      rmItemId: l.rmItemId,
      itemName: l.rmItem?.itemName ?? "",
      unit: l.unitSnapshot ?? l.rmItem?.unit ?? "",
      requiredQty: Number(l.requiredQty),
      shortageQty: Number(l.shortageQty),
      availableQty: Number(l.availableQtySnapshot),
    })),
  };
}

function MaterialRequirementModal({
  requirement,
  onClose,
}: {
  requirement: MaterialRequirementView;
  onClose: () => void;
}) {
  return (
    <ErpModal onClose={onClose} aria-labelledby="mr-detail-title">
      <div className="mp-vp-mr-modal">
        <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <div>
            <h2 id="mr-detail-title" className="text-sm font-bold text-slate-900">
              RM Requisition {requirement.docNo || `#${requirement.id}`}
            </h2>
            <p className="text-[11px] text-slate-600">{requirement.statusLabel}</p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="max-h-[50vh] overflow-auto px-3 py-2">
          <table className="mp-vp-table w-full">
            <thead>
              <tr>
                <th className="text-left">RM Item</th>
                <th className="text-right">Required Qty</th>
                <th className="text-right">Available Qty</th>
                <th className="text-right">Shortage / Net Required</th>
              </tr>
            </thead>
            <tbody>
              {requirement.lines.map((l) => (
                <tr key={l.rmItemId}>
                  <td className="font-medium text-slate-800">{l.itemName}</td>
                  <td className="text-right tabular-nums">{formatQty(l.requiredQty, l.unit)}</td>
                  <td className="text-right tabular-nums">{formatQty(l.availableQty, l.unit)}</td>
                  <td className="text-right tabular-nums font-semibold text-red-700">{formatQty(l.shortageQty, l.unit)}</td>
                </tr>
              ))}
              {!requirement.lines.length ? (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-slate-500">
                    No lines on this requirement.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 py-2">
          <Button type="button" variant="outline" size="sm" className="h-8 text-[11px]" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </ErpModal>
  );
}

export function MaterialPlanningPage() {
  const toast = useToast();
  const { flags } = useFeatureFlags();
  const planningDrivenProcurement = flags.planningDrivenProcurement;
  const [searchParams, setSearchParams] = useSearchParams();
  const [sourceKind, setSourceKind] = React.useState<SourceKind>(() =>
    searchParams.get("salesOrderId") ? "salesOrder" : "quotation",
  );
  const [quotations, setQuotations] = React.useState<SourceRow[]>([]);
  const [salesOrders, setSalesOrders] = React.useState<SourceRow[]>([]);
  const [sourceId, setSourceId] = React.useState(0);
  const [preview, setPreview] = React.useState<PlanningPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [raising, setRaising] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createdRequirement, setCreatedRequirement] = React.useState<MaterialRequirementView | null>(null);
  const [showSuccessPanel, setShowSuccessPanel] = React.useState(false);
  const [mrModal, setMrModal] = React.useState<MaterialRequirementView | null>(null);

  React.useEffect(() => {
    apiFetch<{ quotations: SourceRow[]; salesOrders: SourceRow[] }>("/api/material-planning/sources")
      .then((r) => {
        setQuotations(
          (r.quotations ?? []).map((q) => ({
            id: q.id,
            docNo: q.docNo,
            customerName: q.customerName,
          })),
        );
        setSalesOrders(
          (r.salesOrders ?? []).map((s) => ({
            id: s.id,
            docNo: s.docNo,
            customerName: s.customerName,
          })),
        );
      })
      .catch((e) => setError(presentOperationalError(e).userMessage));
  }, []);

  React.useEffect(() => {
    const qId = Number(searchParams.get("quotationId")) || 0;
    const soId = Number(searchParams.get("salesOrderId")) || 0;
    if (soId) {
      setSourceKind("salesOrder");
      setSourceId(soId);
      return;
    }
    if (qId) {
      setSourceKind("quotation");
      setSourceId(qId);
      return;
    }
    if (salesOrders.length > 0) {
      setSourceKind("salesOrder");
      setSourceId((cur) => (salesOrders.some((s) => s.id === cur) ? cur : salesOrders[0].id));
    } else if (quotations.length > 0) {
      setSourceKind("quotation");
      setSourceId((cur) => (quotations.some((q) => q.id === cur) ? cur : quotations[0].id));
    }
  }, [searchParams, salesOrders, quotations]);

  const sources = sourceKind === "quotation" ? quotations : salesOrders;

  async function loadPreview(id: number, kind: SourceKind) {
    if (!id) return;
    setError(null);
    setLoading(true);
    setShowSuccessPanel(false);
    setCreatedRequirement(null);
    try {
      const qs = kind === "quotation" ? `quotationId=${id}` : `salesOrderId=${id}`;
      const data = await apiFetch<PlanningPreview>(`/api/material-planning/preview?${qs}`);
      setPreview(data);
      const params = new URLSearchParams();
      if (kind === "quotation") params.set("quotationId", String(id));
      else params.set("salesOrderId", String(id));
      setSearchParams(params, { replace: true });
    } catch (e) {
      setPreview(null);
      setError(presentOperationalError(e).userMessage);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (sourceId > 0) void loadPreview(sourceId, sourceKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, sourceKind]);

  const activeRequirement = createdRequirement ?? preview?.existingMaterialRequirement ?? null;
  const workflowStepId: WorkflowStepId = activeRequirement ? "requirement" : "planning";

  const opsSummary = React.useMemo(() => {
    if (!preview) return null;
    const lines = preview.rmSummary;
    const state = preview.operationalState;
    return {
      stockAvailable: lines.filter((r) => r.status === "AVAILABLE").length,
      purchaseRequired: state?.purchaseRequiredCount ?? lines.filter((r) => r.shortageQty > 0).length,
      liveShortageLines: lines.filter((r) => r.shortageQty > 0).length,
      pendingProcurementQty:
        state?.pendingProcurementQty ?? lines.reduce((s, r) => s + Math.max(0, r.shortageQty), 0),
      currentStage: rmPlanningCurrentStage(preview),
    };
  }, [preview]);

  const canCreateRequirement =
    !planningDrivenProcurement &&
    Boolean(preview?.canRaiseRequirement) &&
    !preview?.existingMaterialRequirement &&
    !raising &&
    !loading;

  const resolvedSalesOrderId =
    preview?.salesOrderId ?? (sourceKind === "salesOrder" ? sourceId : preview?.linkedSalesOrderId ?? 0);

  const rmControlCenterHref = buildRmControlCenterHref({
    salesOrderId: resolvedSalesOrderId > 0 ? resolvedSalesOrderId : undefined,
    materialRequirementId: activeRequirement?.id,
    returnTo: "material-planning",
  });

  async function onCreateRequirement() {
    if (!canCreateRequirement || !sourceId) return;
    setRaising(true);
    setError(null);
    try {
      const body =
        sourceKind === "quotation" ? { quotationId: sourceId } : { salesOrderId: sourceId };
      const res = await apiFetch<{ materialRequirement: MaterialRequirementView & { lines?: MaterialRequirementApiLine[] } }>(
        "/api/material-planning/requirements",
        { method: "POST", body: JSON.stringify(body) },
      );
      const mapped = mapApiMaterialRequirement(res.materialRequirement);
      setCreatedRequirement(mapped);
      setShowSuccessPanel(false);
      toast.showSuccess(`RM Requisition ${mapped.docNo ?? mapped.id} raised.`);
      if (preview?.childBomWarnings?.length) {
        for (const w of preview.childBomWarnings) toast.showInfo(w);
      }
      await loadPreview(sourceId, sourceKind);
    } catch (e) {
      const presented = presentOperationalError(e);
      setError(presented.userMessage);
      toast.showError(presented.userMessage);
    } finally {
      setRaising(false);
    }
  }

  const operationalStage =
    preview?.operationalState?.currentStage ?? opsSummary?.currentStage ?? "Planning";
  const fgQtyTotal = preview
    ? preview.fgSummary.reduce((s, f) => s + Number(f.fgQty ?? 0), 0)
    : 0;

  return (
    <div className={cn("mp-vp-page", activeRequirement && "mp-vp-page--handoff")}>
      <header className="mp-vp-head mp-vp-head--sticky">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/dashboard" className="bom-ws-back" aria-label="Back">
            <ArrowLeft className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          </Link>
          <div className="min-w-0">
            <h1 className="mp-vp-title">{REGULAR_TERMS.ORDER_RM_PLANNING_TITLE}</h1>
            <p className="mp-vp-sub">{REGULAR_TERMS.ORDER_RM_PLANNING_SUBTITLE}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              {REGULAR_TERMS.ORDER_RM_PLANNING_SCOPE_HINT}
            </p>
          </div>
        </div>
        <div className="mp-vp-toolbar">
          <Link
            to={rmControlCenterHref}
            className={cn(
              buttonVariants({ variant: "default", size: "sm" }),
              "h-7 px-3 text-[11px] font-bold no-underline",
            )}
            title="Open RM Control Center"
          >
            Open RM Control Center
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={loading || !sourceId}
            onClick={() => void loadPreview(sourceId, sourceKind)}
          >
            Refresh
          </Button>
          {!activeRequirement ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-3 text-[11px] font-semibold"
              disabled={!canCreateRequirement}
              title={
                planningDrivenProcurement
                  ? "Procurement demand must be raised through Monthly Planning."
                  : preview?.existingMaterialRequirement
                  ? "An RM Requisition already exists for this source."
                  : preview?.operationalState?.sourceCompleted
                    ? "Sales Order completed — no further order RM planning required."
                    : preview?.operationalState?.procurementCompleted
                      ? "Procurement completed through GRN."
                      : !preview?.canRaiseRequirement
                        ? "Resolve BOM issues before raising a requisition."
                        : undefined
              }
              onClick={() => void onCreateRequirement()}
            >
              {raising ? "Sending…" : REGULAR_TERMS.SEND_TO_PROCUREMENT}
            </Button>
          ) : null}
        </div>
      </header>

      {!activeRequirement ? (
      <nav className="mp-vp-workflow" aria-label="Order RM planning workflow">
        {WORKFLOW_STEPS.map((step, i) => {
          const isActive = step.id === workflowStepId;
          const isPast =
            step.id === "source" ||
            step.id === "planning" ||
            (step.id === "requirement" && activeRequirement != null);
          return (
            <React.Fragment key={step.id}>
              {i > 0 ? <ChevronRight className="mp-vp-workflow-chevron" aria-hidden /> : null}
              <span
                className={cn(
                  "mp-vp-workflow-step",
                  isActive && "mp-vp-workflow-step--active",
                  isPast && !isActive && "mp-vp-workflow-step--done",
                )}
              >
                {step.label}
              </span>
            </React.Fragment>
          );
        })}
      </nav>
      ) : null}

      <div className="mp-vp-context">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
          <div className="flex rounded-md border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-semibold",
                sourceKind === "salesOrder" ? "bg-slate-900 text-white" : "text-slate-600",
              )}
              onClick={() => {
                setSourceKind("salesOrder");
                setSourceId(salesOrders[0]?.id ?? 0);
                setPreview(null);
              }}
            >
              Sales order
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-semibold",
                sourceKind === "quotation" ? "bg-slate-900 text-white" : "text-slate-600",
              )}
              onClick={() => {
                setSourceKind("quotation");
                setSourceId(quotations[0]?.id ?? 0);
                setPreview(null);
              }}
            >
              Quotation
            </button>
          </div>
          <select
            className="h-7 min-w-[12rem] max-w-[20rem] rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-800"
            value={sourceId || ""}
            onChange={(e) => setSourceId(Number(e.target.value))}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {(s.docNo || `#${s.id}`) + (s.customerName ? ` · ${s.customerName}` : "")}
              </option>
            ))}
          </select>
        </div>
        {preview ? (
          <p className="mt-1 truncate text-[13px] text-slate-700">
            <span className="font-semibold text-slate-900">{preview.referenceNo}</span>
            <span className="text-slate-500"> · </span>
            <span>{preview.fgSummary[0]?.fgName ?? "—"}</span>
            <span className="text-slate-500"> · Qty </span>
            <span className="font-semibold tabular-nums text-slate-900">{formatQty(fgQtyTotal)}</span>
            <span className="text-slate-500"> · </span>
            <span className="font-semibold text-slate-900">{operationalStage}</span>
          </p>
        ) : null}
      </div>

      {!activeRequirement ? (
        <div className="mp-vp-purpose">
          <Info className="h-3.5 w-3.5 shrink-0 text-sky-700" aria-hidden />
          <p className="min-w-0 text-[10px] leading-snug text-slate-700">
            <span className="font-semibold text-slate-900">Order-level RM calculator</span> — live BOM
            explosion and shortage simulation for one sales order or quotation. Raises Store requisitions only;
            no PO, GRN, or stock posting here. For period procurement, use Monthly Planning.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mx-1 shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[12px] text-red-800">
          {error}
        </div>
      ) : null}

      {activeRequirement && !showSuccessPanel ? (
        <div className="mx-1 shrink-0">
          <WorkflowHandoffStrip
            variant="compact"
            tone="neutral"
            headline="RM Requisition raised"
            mrLabel={activeRequirement.docNo ?? `#${activeRequirement.id}`}
            owner="Store Department"
            nextStep={operationalStage}
            primaryLabel="Open RM Control Center"
            primaryHref={rmControlCenterHref}
          />
        </div>
      ) : null}

      {!preview?.existingMaterialRequirement &&
      preview?.operationalState?.banner &&
      !showSuccessPanel ? (
        <div className="mx-1 shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-bold">{preview.operationalState.banner}</span>
              {preview.cancelledMaterialRequirement ? (
                <span className="ml-2 tabular-nums font-semibold">
                  {preview.cancelledMaterialRequirement.docNo || `#${preview.cancelledMaterialRequirement.id}`}
                </span>
              ) : preview.completedMaterialRequirement ? (
                <span className="ml-2 tabular-nums font-semibold">
                  {preview.completedMaterialRequirement.docNo || `#${preview.completedMaterialRequirement.id}`}
                </span>
              ) : null}
            </div>
            {preview.cancelledMaterialRequirement ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-[11px]"
                onClick={() => setMrModal(preview.cancelledMaterialRequirement ?? null)}
              >
                View cancelled requisition
              </Button>
            ) : preview.completedMaterialRequirement ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-[11px]"
                onClick={() => setMrModal(preview.completedMaterialRequirement ?? null)}
              >
                View completed requisition
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}


      {loading && !preview ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Calculating RM need…</div>
      ) : preview ? (
        <div className="mp-vp-body">
          {opsSummary && !activeRequirement ? (
            <div className="shrink-0 space-y-1">
              <p className="rounded border border-violet-200/80 bg-violet-50/60 px-2 py-1 text-[11px] text-violet-950">
                <span className="font-semibold">Stage:</span> {opsSummary.currentStage}
              </p>
            <div className="mp-vp-ops-summary shrink-0">
              <div className="mp-vp-ops-card">
                <div className="mp-vp-ops-label">Stock available</div>
                <div className="mp-vp-ops-value text-emerald-700">{opsSummary.stockAvailable} RM lines</div>
                <div className="mp-vp-ops-hint">Fully covered from store</div>
              </div>
              <div className="mp-vp-ops-card">
                <div className="mp-vp-ops-label">Supply pending</div>
                <div className="mp-vp-ops-value text-red-700">{opsSummary.purchaseRequired} RM lines</div>
                <div className="mp-vp-ops-hint">
                  {preview.operationalState?.procurementCompleted || preview.operationalState?.sourceCompleted
                    ? "No open purchase action"
                    : "Waiting stock / incoming GRN"}
                </div>
              </div>
              <div className="mp-vp-ops-card">
                <div className="mp-vp-ops-label">Live shortage</div>
                <div
                  className={cn(
                    "mp-vp-ops-value",
                    opsSummary.liveShortageLines > 0 ? "text-amber-800" : "text-emerald-700",
                  )}
                >
                  {opsSummary.liveShortageLines > 0
                    ? `${opsSummary.liveShortageLines} RM line(s)`
                    : "None (live store)"}
                </div>
                <div className="mp-vp-ops-hint">Confirm in RM Control Center before issue</div>
              </div>
              <div className="mp-vp-ops-card">
                <div className="mp-vp-ops-label">Pending procurement</div>
                <div className="mp-vp-ops-value tabular-nums text-slate-900">
                  {formatQty(opsSummary.pendingProcurementQty)}
                </div>
                <div className="mp-vp-ops-hint">
                  {preview.operationalState?.procurementCompleted || preview.operationalState?.sourceCompleted
                    ? "Open procurement only"
                    : "Total shortage qty"}
                </div>
              </div>
            </div>
            </div>
          ) : null}

          {!activeRequirement ? (
            <div className="mp-vp-mid">
              <section className="mp-vp-panel">
                <div className="mp-vp-panel-head">
                  <Package className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                  <span>FG summary</span>
                </div>
                <div className="mp-vp-panel-scroll">
                  <table className="mp-vp-table w-full">
                    <thead>
                      <tr>
                        <th>FG item</th>
                        <th className="text-right">Qty</th>
                        <th>BOM</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.fgSummary.map((f) => {
                        const fgStatus = resolveFgDisplayStatus(f, preview);
                        return (
                          <tr key={f.lineId}>
                            <td className="max-w-[8rem] truncate font-medium text-slate-800" title={f.fgName}>
                              {f.fgName}
                            </td>
                            <td className="text-right tabular-nums font-semibold">{formatQty(f.fgQty)}</td>
                            <td className="text-[11px] text-slate-600">{f.bomRevision ?? "—"}</td>
                            <td>
                              <Badge className={cn("text-[10px] font-semibold", fgStatusClass(fgStatus))}>
                                {fgStatusLabel(fgStatus)}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="mp-vp-panel mp-vp-panel--summary">
                <div className="mp-vp-panel-head">Order calculation summary</div>
                <div className="mp-vp-summary-grid">
                  <div>
                    <div className="mp-vp-stat-label">FG items</div>
                    <div className="mp-vp-stat-value tabular-nums">{preview.fgCount}</div>
                  </div>
                  <div>
                    <div className="mp-vp-stat-label">RM lines</div>
                    <div className="mp-vp-stat-value tabular-nums">{preview.rmCount}</div>
                  </div>
                  <div>
                    <div className="mp-vp-stat-label">Shortage lines</div>
                    <div
                      className={cn(
                        "mp-vp-stat-value tabular-nums",
                        preview.totalShortageLines > 0 ? "text-red-700" : "text-emerald-700",
                      )}
                    >
                      {preview.operationalState?.sourceCompleted ? 0 : preview.totalShortageLines}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          <section className="mp-vp-panel mp-vp-panel--rm flex-1">
            <div className="mp-vp-panel-head">
              {preview.operationalState?.sourceCompleted
                ? "RM planning status"
                : preview.totalShortageLines > 0
                  ? "RM shortage detected (live store)"
                  : "RM demand vs live store availability"}
            </div>
            <div className="mp-vp-panel-scroll mp-vp-panel-scroll--tall">
              <table className={cn("mp-vp-table w-full", activeRequirement && "mp-vp-table--operational")}>
                <thead>
                  <tr>
                    <th className="text-left">RM item</th>
                    <th className="text-right">Required qty</th>
                    <th className="text-right">Available qty</th>
                    <th className="text-right">Shortage</th>
                    <th className="text-center">Action needed</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rmSummary.map((r) => {
                    const displayStatus = preview.operationalState?.sourceCompleted ? "SO_COMPLETED" : r.status;
                    const displayShortage = preview.operationalState?.sourceCompleted ? 0 : r.shortageQty;
                    return (
                    <tr key={r.rmItemId} className={r.shortageQty > 0 ? "bg-red-50/60" : undefined}>
                      <td className="text-[13px] font-semibold text-slate-900">{r.itemName}</td>
                      <td className="text-right text-[13px] font-semibold tabular-nums text-slate-900">
                        {formatQty(r.requiredQty, r.unit)}
                      </td>
                      <td className="text-right text-[13px] font-semibold tabular-nums text-emerald-800">
                        {formatQty(r.availableQty, r.unit)}
                      </td>
                      <td
                        className={cn(
                          "text-right text-[13px] tabular-nums",
                          !preview.operationalState?.sourceCompleted && r.shortageQty > 0 ? "font-bold text-red-800" : "font-semibold text-slate-600",
                        )}
                      >
                        {formatQty(displayShortage, r.unit)}
                      </td>
                      <td className="text-center">
                        <Badge className={cn("text-[10px] font-semibold", rmStatusClass(displayStatus))}>
                          {rmOperationalLabel(displayStatus)}
                        </Badge>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-slate-500">
          <p>{REGULAR_TERMS.ORDER_RM_PLANNING_EMPTY_STATE}</p>
          <p className="text-[12px] text-slate-400">{REGULAR_TERMS.ORDER_RM_PLANNING_SCOPE_HINT}</p>
        </div>
      )}

      {mrModal ? <MaterialRequirementModal requirement={mrModal} onClose={() => setMrModal(null)} /> : null}
    </div>
  );
}
