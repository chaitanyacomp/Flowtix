/**

 * Procurement Workspace — MR → PR → PO → GRN (MPRS flow).

 */

import * as React from "react";

import { Link, useSearchParams } from "react-router-dom";

import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { apiFetch } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { buildPurchaseRequestPayloadFromMr } from "../lib/purchaseRequestFromMr";

import { Button, buttonVariants } from "../components/ui/button";

import { Badge } from "../components/ui/badge";

import { cn } from "../lib/utils";

import { PageContainer, StickyWorkspaceHead } from "../components/PageHeader";

import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../components/erp/foundation";

import { PendingMaterialRequestsPanel } from "../components/purchase/PendingMaterialRequestsPanel";

import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { useAuth } from "../hooks/useAuth";
import { hasErpRole, PURCHASE_EXECUTION_ROLES } from "../config/erpRoles";
import { canRoleCreatePurchaseRequestForMr } from "../lib/procurementPurchaseRequestOwnership";

import { PROCUREMENT_TERMS, procurementDemandPoolSectionCopy } from "../lib/procurementTerminology";
import { WoProcurementContinuityStrip } from "../components/erp/WoProcurementContinuityStrip";
import {
  buildRmControlCenterHref,
  procurementStageLabelForKey,
  WO_PROCUREMENT_CONTINUITY,
} from "../lib/woProcurementContinuity";
import { GUIDED_WORKFLOW_CTA } from "../lib/rmGuidedWorkflow";
import { buildRmPoDetailHref } from "../lib/rmPurchaseWoContinuity";
import {
  DEFAULT_PROCUREMENT_DEMAND_POOL,
  deriveDemandPoolCountsFromWorkspace,
  mrMatchesDemandPool,
  parseDemandPoolParam,
  workspaceQueryForDemandPool,
  type ProcurementDemandPoolCounts,
  type ProcurementDemandPoolKey,
} from "../lib/procurementWorkspaceQueues";
import { ProcurementWorkspaceQueueTabs } from "../components/erp/ProcurementWorkspaceQueueTabs";



type MrSummary = {

  materialRequirementId: number;

  docNo: string | null;

  sourceType?: string | null;

  source?: {
    type: string | null;
    label: string;
    planDocumentLabel?: string | null;
    monthlyProductionPlanId: number | null;
    periodKey: string | null;
    sourceRevision: number | null;
  } | null;

  hasMultiSourceDemand?: boolean;

  multiSourceRmItemCount?: number;

  sourceRef: string;

  salesOrderId: number | null;

  salesOrderDocNo: string | null;

  workOrderId?: number | null;

  workOrderNo?: string | null;

  customerName?: string | null;

  primaryFgName: string | null;

  pendingGrnQty?: number;

  procurementStage?: string | null;

  shortageRmLineCount: number;

  totalShortageQty: number;

  totalRemainingQty: number;

  createdAt: string | null;

  createdByName: string | null;

  status?: string | null;

  canCreatePurchaseRequest?: boolean;

  operationalKey: string;

  operationalLabel: string;

  pendingPoStatus: string;

  pendingGrnStatus: string;

  supplierPendingStatus: string;

  primaryPoId: number | null;

  nextActionKey: string;

  lines?: {

    lineId: number;

    rmItemId: number;

    itemName: string;

    unit: string;

    requiredQty: number;

    shortageQty: number;

    remainingQty: number;

    planningStatus: string;

    multiSourceDemand?: boolean;

    demandSourceTypes?: string[];

  }[];

};



type WorkspaceResponse = {

  demandPool?: ProcurementDemandPoolKey | null;

  summary: {

    pendingMrCount: number;

    openMrCount?: number;

    supplierAllocationItemCount: number;

    purchaseRequestCount: number;

    poPendingCount: number;

    grnPendingLineCount: number;

    completedCount: number;

    queueCounts?: {
      byDemandPool?: Partial<ProcurementDemandPoolCounts>;
    };

  };

  sections: {

    pendingMaterialRequirements: MrSummary[];

    supplierAllocationPending: {

      rmItemId: number;

      itemName: string;

      unit: string;

      requiredQty: number;

      shortageQty: number;

      netRequiredQty: number;

      originCount: number;

      planningStatus: string;

    }[];

    poPending: {

      purchaseOrderId: number;

      docNo: string;

      supplierName: string;

      status: string;

      lineCount: number;

    }[];

    grnPending: {

      purchaseOrderId: number;

      purchaseOrderDocNo: string;

      supplierName: string;

      itemName: string;

      pendingQty: number;

    }[];

    procurementCompleted: {

      materialRequirementId: number;

      docNo: string | null;

      sourceRef: string;

      operationalLabel: string;

    }[];

  };

  pool: { summary?: { itemCount: number; originCount: number }; demandPool?: ProcurementDemandPoolKey | null };

  pools?: Partial<
    Record<
      ProcurementDemandPoolKey,
      { items?: Array<{ origins?: Array<{ materialRequirementId?: number }> }> }
    >
  >;

};



function fmtQty(n: number, unit?: string) {

  const u = unit?.trim() ? ` ${unit}` : "";

  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;

}



type MrRowAction =
  | { kind: "navigate"; label: string; to: string }
  | { kind: "create-pr"; label: string };

function mrCanCreatePurchaseRequest(
  row: MrSummary,
  role: string | undefined,
  demandPool: ProcurementDemandPoolKey,
): boolean {
  if (!canRoleCreatePurchaseRequestForMr(role, row, demandPool)) return false;
  if (row.canCreatePurchaseRequest === false) return false;
  if (row.canCreatePurchaseRequest === true) return true;
  const s = String(row.status ?? "").trim();
  return s === "APPROVED" || s === "SENT_TO_PURCHASE";
}

function mrPrimaryAction(
  row: MrSummary,
  role: string | undefined,
  demandPool: ProcurementDemandPoolKey,
  canExecutePurchase: boolean,
): MrRowAction | null {
  switch (row.nextActionKey) {
    case "CREATE_PO":
      if (!canExecutePurchase) return null;
      return { kind: "navigate", label: PROCUREMENT_TERMS.PREPARE_RM_PO, to: "/rm-po-grn?focus=pending-requests" };
    case "OPEN_GRN":
      return {
        kind: "navigate",
        label: PROCUREMENT_TERMS.OPEN_GRN,
        to: row.primaryPoId
          ? buildRmPoDetailHref(row.primaryPoId, { salesOrderId: row.salesOrderId, from: "rm-purchase" })
          : "/rm-po-grn",
      };
    case "OPEN_PO":
      return {
        kind: "navigate",
        label: PROCUREMENT_TERMS.OPEN_PO,
        to: row.primaryPoId
          ? buildRmPoDetailHref(row.primaryPoId, { salesOrderId: row.salesOrderId, from: "rm-purchase" })
          : "/rm-po-grn",
      };
    case "CREATE_PR":
      if (!mrCanCreatePurchaseRequest(row, role, demandPool)) return null;
      return { kind: "create-pr", label: PROCUREMENT_TERMS.CREATE_PURCHASE_REQUEST };
    case "TRACK_IN_RM_CONTROL":
      return {
        kind: "navigate",
        label: WO_PROCUREMENT_CONTINUITY.OPEN_RM_CONTROL_CENTER,
        to: buildRmControlCenterHref({
          workOrderId: row.workOrderId ?? undefined,
          salesOrderId: row.salesOrderId ?? undefined,
          materialRequirementId: row.materialRequirementId,
        }),
      };
    default:
      if (mrCanCreatePurchaseRequest(row, role, demandPool)) {
        return { kind: "create-pr", label: PROCUREMENT_TERMS.CREATE_PURCHASE_REQUEST };
      }
      return null;
  }
}



function formatPeriodKey(periodKey: string | null | undefined): string | null {
  if (!periodKey) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) return periodKey;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(m[2]) - 1;
  return `${months[mi] ?? m[2]} ${m[1]}`;
}

function MrSourceBadge({ mr }: { mr: MrSummary }) {
  const src = mr.source;
  const type = src?.type ?? mr.sourceType ?? null;
  if (type === "SALES_ORDER") {
    const soLabel = mr.salesOrderId
      ? displaySalesOrderNo(mr.salesOrderId, mr.salesOrderDocNo)
      : "Regular SO";
    return (
      <span className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
        {soLabel}
      </span>
    );
  }
  if (type === "MONTHLY_PLAN") {
    const planLabel = src?.planDocumentLabel?.trim() || (src?.label !== "Monthly Plan" ? src?.label : null);
    if (planLabel) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800"
          title={planLabel}
        >
          {planLabel}
        </span>
      );
    }
    const period = formatPeriodKey(src?.periodKey);
    const rev = src?.sourceRevision != null ? `Rev ${src.sourceRevision}` : null;
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800"
        title={`Monthly Plan${period ? ` · ${period}` : ""}${rev ? ` · ${rev}` : ""}`}
      >
        Monthly Plan{period ? ` · ${period}` : ""}{rev ? ` · ${rev}` : ""}
      </span>
    );
  }
  if (!type) return null;
  const label = src?.label ?? type;
  return (
    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
      {label}
    </span>
  );
}

function mrWoPrimaryLabel(row: MrSummary): string {
  if (row.workOrderNo) return row.workOrderNo;
  if (row.workOrderId && row.workOrderId > 0) return `WO-${row.workOrderId}`;
  if (row.sourceType === "SALES_ORDER" || row.source?.type === "SALES_ORDER") {
    if (row.salesOrderId) return displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo);
    return "Regular sales order";
  }
  if (row.sourceType === "MONTHLY_PLAN" || row.source?.type === "MONTHLY_PLAN") {
    const planLabel = row.source?.planDocumentLabel?.trim() || (row.source?.label !== "Monthly Plan" ? row.source?.label : null);
    if (planLabel) return planLabel;
    const period = formatPeriodKey(row.source?.periodKey);
    return period ? `Monthly plan · ${period}` : "Monthly plan";
  }
  if (row.sourceType === "STOCK_REPLENISHMENT") return "Stock replenishment";
  return "—";
}

function mrBlockageContext(row: MrSummary): string {
  const stage = row.procurementStage ?? procurementStageLabelForKey(row.operationalKey);
  const parts = [stage];
  if (row.pendingGrnQty != null && row.pendingGrnQty > 0) {
    parts.push(WO_PROCUREMENT_CONTINUITY.WAITING_GRN_QTY(row.pendingGrnQty.toLocaleString(undefined, { maximumFractionDigits: 3 })));
  }
  if (row.sourceType === "MONTHLY_PLAN" || row.source?.type === "MONTHLY_PLAN") {
    parts.push(`${row.shortageRmLineCount} RM line(s) with requirement`);
  } else {
    parts.push(`${row.shortageRmLineCount} RM line(s) short`);
  }
  return parts.join(" · ");
}

function mrCustomerLine(row: MrSummary): string {
  if (row.customerName) return row.customerName;
  if (row.salesOrderId) return displaySalesOrderNo(row.salesOrderId, row.salesOrderDocNo);
  return row.sourceRef || "—";
}



function SectionEmpty({ message }: { message: string }) {

  return <p className="py-2 text-xs text-slate-500">{message}</p>;

}



function CollapsibleSection({

  title,

  count,

  children,

  defaultOpen = false,

}: {

  title: string;

  count: number;

  children: React.ReactNode;

  defaultOpen?: boolean;

}) {

  const [open, setOpen] = React.useState(defaultOpen);

  return (

    <div className="min-w-0 rounded-lg border border-slate-200/90 bg-white shadow-sm">

      <button

        type="button"

        className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left"

        onClick={() => setOpen((v) => !v)}

      >

        <span className="text-sm font-semibold text-slate-900">{title}</span>

        <span className="flex shrink-0 items-center gap-2">

          <Badge variant={count > 0 ? "warning" : "default"} className="h-5 min-w-[1.25rem] justify-center px-1.5 text-[10px] tabular-nums">

            {count}

          </Badge>

          {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}

        </span>

      </button>

      {open ? <div className="min-w-0 border-t border-slate-100 px-3 pb-2">{children}</div> : null}

    </div>

  );

}



function PendingMaterialRequirementsTable({

  rows,

  loading,

  creatingMrId,

  focusMaterialRequirementId,

  onCreatePurchaseRequest,

  userRole,

  demandPool,

  canExecutePurchase,

  emptyTitle,

  emptyDetail,

}: {

  rows: MrSummary[];

  loading: boolean;

  creatingMrId: number | null;

  focusMaterialRequirementId?: number;

  onCreatePurchaseRequest: (mr: MrSummary) => void;

  userRole: string | undefined;

  demandPool: ProcurementDemandPoolKey;

  canExecutePurchase: boolean;

  emptyTitle?: string;

  emptyDetail?: string;

}) {

  const [expandedMrId, setExpandedMrId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (focusMaterialRequirementId && focusMaterialRequirementId > 0) setExpandedMrId(focusMaterialRequirementId);
  }, [focusMaterialRequirementId]);

  if (loading) {

    return <p className="px-3 py-4 text-sm text-slate-500">Loading material requirements…</p>;

  }

  if (!rows.length) {

    return (

      <div className="px-3 py-4 text-center">

        <p className="text-sm font-medium text-slate-800">{emptyTitle ?? PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR}</p>

        <p className="mt-1 text-xs text-slate-500">{emptyDetail ?? PROCUREMENT_TERMS.SECTION_EMPTY_PENDING_MR_DETAIL}</p>

      </div>

    );

  }



  return (

    <div className="min-w-0 overflow-x-auto">

      <table className="erp-table erp-table-dense w-full min-w-[56rem] text-[12px] [&_td]:align-middle [&_th]:whitespace-nowrap [&_td]:py-2 [&_th]:py-2">

        <thead>

          <tr>

            <th className="w-8" />

            <th className="text-left">Demand source</th>

            <th className="text-left">FG · customer</th>

            <th className="text-left">Procurement stage</th>

            <th className="text-right">Procurement requirement</th>

            <th className="text-left text-slate-500">MR ref</th>

            <th className="text-right">Actions</th>

          </tr>

        </thead>

        <tbody>

          {rows.map((mr) => {

            const action = mrPrimaryAction(mr, userRole, demandPool, canExecutePurchase);

            const lines = mr.lines ?? [];

            const isOpen = expandedMrId === mr.materialRequirementId;

            const canExpand = lines.length > 0;

            return (

              <React.Fragment key={mr.materialRequirementId}>

                <tr className={mr.materialRequirementId === focusMaterialRequirementId ? "bg-blue-50 ring-2 ring-inset ring-blue-300" : undefined}>

                  <td className="w-8 px-1">

                    {canExpand ? (

                      <button

                        type="button"

                        className="rounded p-0.5 text-slate-500 hover:bg-slate-100"

                        aria-expanded={isOpen}

                        aria-label={isOpen ? "Hide RM lines" : "Show RM lines"}

                        onClick={() =>

                          setExpandedMrId(isOpen ? null : mr.materialRequirementId)

                        }

                      >

                        {isOpen ? (

                          <ChevronDown className="h-4 w-4" />

                        ) : (

                          <ChevronRight className="h-4 w-4" />

                        )}

                      </button>

                    ) : null}

                  </td>

                  <td className="min-w-[8rem]">
                    <div className="font-extrabold text-violet-950">{mrWoPrimaryLabel(mr)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <MrSourceBadge mr={mr} />
                      {mr.hasMultiSourceDemand ? (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800"
                          title={`Multiple demand sources detected for ${mr.multiSourceRmItemCount ?? 0} RM item(s). Review for duplicate procurement.`}
                        >
                          ⚠ Multiple demand sources
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[10px] font-medium text-slate-600" title={mrBlockageContext(mr)}>
                      {mrBlockageContext(mr)}
                    </p>
                    {(mr.workOrderId && mr.workOrderId > 0) || (mr.salesOrderId && mr.salesOrderId > 0) ? (
                      <Link
                        to={buildRmControlCenterHref({
                          workOrderId: mr.workOrderId && mr.workOrderId > 0 ? mr.workOrderId : undefined,
                          salesOrderId: mr.salesOrderId ?? undefined,
                          materialRequirementId: mr.materialRequirementId,
                        })}
                        className="mt-1 inline-block text-[10px] font-bold text-blue-800 no-underline hover:underline"
                      >
                        {WO_PROCUREMENT_CONTINUITY.OPEN_RM_CONTROL_CENTER} →
                      </Link>
                    ) : null}
                  </td>

                  <td className="max-w-[12rem]">
                    <div className="truncate font-semibold text-slate-900" title={mr.primaryFgName ?? ""}>
                      {mr.primaryFgName ?? "—"}
                    </div>
                    <div className="truncate text-[11px] text-slate-600" title={mrCustomerLine(mr)}>
                      {mrCustomerLine(mr)}
                    </div>
                  </td>

                  <td className="min-w-[14rem]">
                    <WoProcurementContinuityStrip operationalKey={mr.operationalKey} />
                  </td>

                  <td className="text-right tabular-nums font-bold text-amber-950">{fmtQty(mr.totalShortageQty)}</td>

                  <td className="text-[10px] text-slate-500">{mr.docNo ?? `MR-${mr.materialRequirementId}`}</td>

                  <td className="text-right">

                    {!action ? (
                      <span className="text-[11px] text-slate-400">—</span>
                    ) : action.kind === "create-pr" ? (

                      <Button

                        type="button"

                        size="sm"

                        className="h-8 whitespace-nowrap px-3 text-xs"

                        disabled={creatingMrId === mr.materialRequirementId}

                        onClick={() => onCreatePurchaseRequest(mr)}

                      >

                        {creatingMrId === mr.materialRequirementId ? "Creating…" : action.label}

                      </Button>

                    ) : (

                      <Link

                        to={action.to}

                        className={cn(

                          buttonVariants({ size: "sm" }),

                          "inline-flex h-8 whitespace-nowrap px-3 text-xs no-underline",

                        )}

                      >

                        {action.label}

                      </Link>

                    )}

                  </td>

                </tr>

                {isOpen && canExpand ? (

                  <tr className="bg-slate-50/80">

                    <td colSpan={8} className="p-0">

                      <div className="border-t border-slate-200 px-3 py-2">

                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">

                          RM lines (planning detail — no separate PR)

                        </p>

                        <table className="erp-table erp-table-dense w-full min-w-[40rem] text-[11px] [&_td]:py-1 [&_th]:py-1">

                          <thead>

                            <tr>

                              <th className="text-left">RM item</th>

                              <th className="text-right">Required qty</th>

                              <th className="text-right">Net requirement</th>

                              <th className="text-left">Planning status</th>

                            </tr>

                          </thead>

                          <tbody>

                            {lines.map((ln) => (

                              <tr key={ln.lineId}>

                                <td>{ln.itemName}</td>

                                <td className="text-right tabular-nums">{fmtQty(ln.requiredQty, ln.unit)}</td>

                                <td className="text-right tabular-nums text-amber-950">

                                  {fmtQty(ln.shortageQty, ln.unit)}

                                </td>

                                <td className="text-slate-600">{ln.planningStatus}</td>

                              </tr>

                            ))}

                          </tbody>

                        </table>

                      </div>

                    </td>

                  </tr>

                ) : null}

              </React.Fragment>

            );

          })}

        </tbody>

      </table>

    </div>

  );

}



export function ProcurementPlanningPage() {

  const { showSuccess, showError } = useToast();
  const { user } = useAuth();
  const canExecutePurchase = hasErpRole(user?.role, PURCHASE_EXECUTION_ROLES);

  const [searchParams, setSearchParams] = useSearchParams();

  const filterSoId = Number(searchParams.get("salesOrderId") ?? 0);
  const filterWorkOrderId = Number(searchParams.get("workOrderId") ?? 0);
  const focusRmItemId = Number(searchParams.get("rmItemId") ?? 0);
  const focusMaterialRequirementId = Number(searchParams.get("materialRequirementId") ?? 0);
  const returnTo = searchParams.get("returnTo");
  const demandPool =
    parseDemandPoolParam(searchParams.get("demandPool")) ?? DEFAULT_PROCUREMENT_DEMAND_POOL;

  const setDemandPool = React.useCallback(
    (pool: ProcurementDemandPoolKey) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("demandPool", pool);
        return next;
      });
    },
    [setSearchParams],
  );

  const [ws, setWs] = React.useState<WorkspaceResponse | null>(null);

  const [loading, setLoading] = React.useState(true);

  const [error, setError] = React.useState<string | null>(null);

  const [creatingMrId, setCreatingMrId] = React.useState<number | null>(null);

  const creatingPrRef = React.useRef(false);



  const load = React.useCallback(async (opts?: { silent?: boolean }) => {

    if (!opts?.silent) setLoading(true);

    setError(null);

    try {

      const q = workspaceQueryForDemandPool(demandPool, {
        salesOrderId: demandPool === "REGULAR_SO" && filterSoId > 0 ? filterSoId : null,
        materialRequirementId:
          demandPool === "MPRS" && focusMaterialRequirementId > 0 ? focusMaterialRequirementId : null,
      });

      const data = await apiFetch<WorkspaceResponse>(`/api/procurement-planning/workspace${q}`);

      setWs(data);

    } catch (e) {

      setError(e instanceof Error ? e.message : "Failed to load workspace");

    } finally {

      if (!opts?.silent) setLoading(false);

    }

  }, [demandPool, filterSoId, focusMaterialRequirementId]);



  const handleCreatePurchaseRequest = React.useCallback(

    async (mr: MrSummary) => {

      if (creatingPrRef.current) return;

      if (!mrCanCreatePurchaseRequest(mr, user?.role, demandPool)) return;

      if (!mrMatchesDemandPool(mr, demandPool)) {
        showError("This material requirement is not in the selected procurement source.");
        return;
      }

      const payload = buildPurchaseRequestPayloadFromMr(mr, { demandPool });

      if (!payload) {

        showError("No RM lines are eligible for a purchase request on this MR.");

        return;

      }

      creatingPrRef.current = true;

      setCreatingMrId(mr.materialRequirementId);

      try {

        await apiFetch("/api/procurement-planning/send-requirement", {

          method: "POST",

          body: JSON.stringify(payload),

        });

        showSuccess(PROCUREMENT_TERMS.PR_CREATE_SUCCESS);

        await load({ silent: true });

      } catch (e) {

        showError(e instanceof Error ? e.message : "Failed to create purchase request");

      } finally {

        creatingPrRef.current = false;

        setCreatingMrId(null);

      }

    },

    [user?.role, demandPool, load, showError, showSuccess],

  );



  React.useEffect(() => {
    if (!parseDemandPoolParam(searchParams.get("demandPool"))) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("demandPool", DEFAULT_PROCUREMENT_DEMAND_POOL);
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  React.useEffect(() => {

    void load();

  }, [load]);



  const pendingMrs = React.useMemo(() => {
    let all = ws?.sections.pendingMaterialRequirements ?? [];
    if (demandPool !== "MPRS") {
      if (filterSoId > 0) {
        all = all.filter((m) => m.salesOrderId === filterSoId);
      }
      if (filterWorkOrderId > 0) {
        all = all.filter((m) => !m.workOrderId || m.workOrderId === filterWorkOrderId);
      }
    }
    return all;
  }, [ws, filterSoId, filterWorkOrderId, demandPool]);

  const poolSectionCopy = procurementDemandPoolSectionCopy(demandPool);

  const focusMrRow = React.useMemo(() => {
    if (focusMaterialRequirementId > 0) {
      return pendingMrs.find((m) => m.materialRequirementId === focusMaterialRequirementId) ?? null;
    }
    if (filterWorkOrderId > 0) return pendingMrs.find((m) => m.workOrderId === filterWorkOrderId) ?? pendingMrs[0] ?? null;
    return null;
  }, [pendingMrs, focusMaterialRequirementId, filterWorkOrderId]);



  const purchasePlanningCount = ws?.sections.supplierAllocationPending.length ?? 0;

  const rmPoPendingCount = (ws?.summary.purchaseRequestCount ?? 0) + (ws?.sections.poPending.length ?? 0);

  const grnPendingCount = ws?.sections.grnPending.length ?? 0;

  const completedCount = ws?.sections.procurementCompleted.length ?? 0;

  const queueCounts = React.useMemo(() => deriveDemandPoolCountsFromWorkspace(ws), [ws]);



  return (

    <PageContainer className="min-w-0 space-y-4">

      <StickyWorkspaceHead className="border-b border-slate-200/80 bg-white px-1 py-2">

        <div className="flex flex-wrap items-start justify-between gap-3">

          <div className="min-w-0">

            <Link

              to="/rm-po-grn"

              className="mb-1 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"

            >

              <ArrowLeft className="h-4 w-4" />

              RM Purchase &amp; GRN

            </Link>

            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{PROCUREMENT_TERMS.WORKSPACE_TITLE}</h1>

            <p className="text-xs font-medium text-slate-600">{PROCUREMENT_TERMS.WORKSPACE_SUBTITLE}</p>

            <p className="mt-1 text-xs font-bold text-violet-900">
              {PROCUREMENT_TERMS.DEMAND_POOL_SELECTOR_LABEL}:{" "}
              {demandPool === "REGULAR_SO"
                ? PROCUREMENT_TERMS.DEMAND_POOL_REGULAR_SO
                : demandPool === "MPRS"
                  ? PROCUREMENT_TERMS.DEMAND_POOL_MPRS
                  : PROCUREMENT_TERMS.DEMAND_POOL_STOCK_REPLENISHMENT}
            </p>

            {filterWorkOrderId > 0 || filterSoId > 0 ? (
              <p className="mt-1 text-xs font-medium text-violet-900">
                {filterWorkOrderId > 0 ? (
                  <>
                    WO case filter · {focusMrRow?.workOrderNo ?? `WO #${filterWorkOrderId}`}
                    {focusMrRow?.primaryFgName ? ` · ${focusMrRow.primaryFgName}` : ""}
                  </>
                ) : (
                  <>Filtered to SO #{filterSoId}</>
                )}
                <Link
                  to={`/procurement-planning?demandPool=${encodeURIComponent(demandPool)}`}
                  className="ml-2 text-primary underline"
                >
                  Clear filter
                </Link>
              </p>
            ) : null}

          </div>

          <div className="flex flex-wrap items-center gap-2">
            {returnTo === "rm-control-center" ? (
              <Link
                to={
                  filterWorkOrderId > 0
                    ? buildRmControlCenterHref({
                        workOrderId: filterWorkOrderId,
                        salesOrderId: filterSoId > 0 ? filterSoId : focusMrRow?.salesOrderId,
                        rmItemId: focusRmItemId > 0 ? focusRmItemId : null,
                      })
                    : "/reports/rm-shortage?returnTo=dashboard"
                }
                className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 no-underline hover:bg-slate-50"
              >
                {WO_PROCUREMENT_CONTINUITY.OPEN_RM_CONTROL_CENTER}
              </Link>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>

              <RefreshCw className="mr-2 h-4 w-4" />

              Refresh

            </Button>
          </div>

        </div>

      </StickyWorkspaceHead>



      {ws?.summary ? (

        <ErpKpiStrip className="max-w-full">

          <ErpKpiSegment>

            <ErpKpiLabel>{PROCUREMENT_TERMS.KPI_PENDING_MR}</ErpKpiLabel>

            <ErpKpiValue tone={ws.summary.pendingMrCount > 0 ? "warn" : "muted"}>{ws.summary.pendingMrCount}</ErpKpiValue>

          </ErpKpiSegment>

          <ErpKpiSegment>

            <ErpKpiLabel>{PROCUREMENT_TERMS.KPI_PURCHASE_PLANNING}</ErpKpiLabel>

            <ErpKpiValue tone={purchasePlanningCount > 0 ? "warn" : "muted"}>{purchasePlanningCount}</ErpKpiValue>

          </ErpKpiSegment>

          <ErpKpiSegment>

            <ErpKpiLabel>{PROCUREMENT_TERMS.KPI_OPEN_PO}</ErpKpiLabel>

            <ErpKpiValue tone={ws.summary.poPendingCount > 0 ? "warn" : "muted"}>{ws.summary.poPendingCount}</ErpKpiValue>

          </ErpKpiSegment>

          <ErpKpiSegment>

            <ErpKpiLabel>{PROCUREMENT_TERMS.KPI_GRN_PENDING}</ErpKpiLabel>

            <ErpKpiValue tone={ws.summary.grnPendingLineCount > 0 ? "warn" : "muted"}>

              {ws.summary.grnPendingLineCount}

            </ErpKpiValue>

          </ErpKpiSegment>

        </ErpKpiStrip>

      ) : null}



      <section className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
        <p className="font-bold text-slate-900">Demand handoff and procurement monitoring</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Store creates Purchase Requests and posts GRN from this workspace. Purchase executes PO in{" "}
          <Link to="/rm-po-grn" className="font-bold text-violet-900 underline">
            {PROCUREMENT_TERMS.NAV_PURCHASE_GRN}
          </Link>
          . For RM availability, shortages, and case actions, use{" "}
          <Link to="/reports/rm-shortage" className="font-bold text-violet-900 underline">
            {PROCUREMENT_TERMS.NAV_RM_CONTROL_CENTER}
          </Link>
          .
        </p>
        {filterWorkOrderId > 0 ? (
          <Link
            to={buildRmControlCenterHref({
              workOrderId: filterWorkOrderId,
              salesOrderId: filterSoId > 0 ? filterSoId : undefined,
            })}
            className="mt-2 inline-block text-xs font-bold text-violet-900 underline"
          >
            ← {GUIDED_WORKFLOW_CTA.DASHBOARD_CONTINUE}
          </Link>
        ) : null}
      </section>

      {error ? (

        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>

      ) : null}

      {focusMrRow && focusMrRow.workOrderId && focusMrRow.workOrderId > 0 ? (
        <section className="rounded-lg border border-violet-300 bg-violet-50/60 px-3 py-3 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">Execution context</p>
              <h2 className="mt-0.5 text-base font-extrabold text-violet-950">
                {focusMrRow.workOrderNo ?? `WO-${focusMrRow.workOrderId}`}
                {focusMrRow.primaryFgName ? (
                  <span className="ml-2 text-sm font-bold text-slate-800">· {focusMrRow.primaryFgName}</span>
                ) : null}
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-700">
                {focusMrRow.customerName ?? displaySalesOrderNo(focusMrRow.salesOrderId ?? 0, focusMrRow.salesOrderDocNo)}
                {focusMrRow.docNo ? (
                  <span className="text-slate-500"> · handoff {focusMrRow.docNo}</span>
                ) : null}
              </p>
              <div className="mt-2">
                <WoProcurementContinuityStrip operationalKey={focusMrRow.operationalKey} />
              </div>
            </div>
            <Link
              to={buildRmControlCenterHref({
                workOrderId: focusMrRow.workOrderId,
                salesOrderId: focusMrRow.salesOrderId,
                rmItemId: focusRmItemId > 0 ? focusRmItemId : null,
              })}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 shrink-0 text-xs font-bold no-underline")}
            >
              {WO_PROCUREMENT_CONTINUITY.OPEN_RM_CONTROL_CENTER}
            </Link>
          </div>
        </section>
      ) : null}

      {/* Main workspace — always visible, full width */}

      <section className="min-w-0 rounded-lg border border-violet-200/70 bg-white shadow-sm ring-1 ring-violet-100/50">

        <div className="space-y-2 border-b border-violet-100/80 bg-violet-50/40 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">{poolSectionCopy.title}</h2>
              <p className="text-[11px] text-slate-600">{poolSectionCopy.helper}</p>
            </div>
            <Badge variant={pendingMrs.length > 0 ? "warning" : "default"} className="tabular-nums">
              {pendingMrs.length}
            </Badge>
          </div>
          <ProcurementWorkspaceQueueTabs
            activeTab={demandPool}
            counts={queueCounts}
            onChange={setDemandPool}
            disabled={loading}
          />
        </div>

        <PendingMaterialRequirementsTable
          rows={pendingMrs}
          loading={loading}
          creatingMrId={creatingMrId}
          focusMaterialRequirementId={focusMaterialRequirementId}
          onCreatePurchaseRequest={(mr) => void handleCreatePurchaseRequest(mr)}
          userRole={user?.role}
          demandPool={demandPool}
          canExecutePurchase={canExecutePurchase}
          emptyTitle={poolSectionCopy.emptyTitle}
          emptyDetail={poolSectionCopy.emptyDetail}
        />

      </section>



      <div className="flex min-w-0 flex-col gap-2">

        <CollapsibleSection title={PROCUREMENT_TERMS.SECTION_PURCHASE_PLANNING} count={purchasePlanningCount}>

          <p className="mb-2 text-[11px] text-slate-600">{PROCUREMENT_TERMS.SECTION_PURCHASE_PLANNING_DETAIL}</p>

          {purchasePlanningCount === 0 ? (

            <SectionEmpty message={PROCUREMENT_TERMS.SECTION_EMPTY_PURCHASE_PLANNING_POOL} />

          ) : (

            <div className="min-w-0 overflow-x-auto">

              <table className="erp-table erp-table-dense w-full text-[12px] [&_td]:py-1.5 [&_th]:py-1.5">

                <thead>

                  <tr>

                    <th className="text-left">RM item</th>

                    <th className="text-right">Required qty</th>

                    <th className="text-right">Net requirement</th>

                    <th className="text-left">Planning status</th>

                    <th className="text-right">MR lines</th>

                  </tr>

                </thead>

                <tbody>

                  {(ws?.sections.supplierAllocationPending ?? []).map((row) => (

                    <tr key={row.rmItemId} className={row.rmItemId === focusRmItemId ? "bg-blue-50 ring-2 ring-inset ring-blue-300" : undefined}>

                      <td className="font-medium">{row.itemName}</td>

                      <td className="text-right tabular-nums">{fmtQty(row.requiredQty, row.unit)}</td>

                      <td className="text-right tabular-nums text-amber-950">{fmtQty(row.shortageQty, row.unit)}</td>

                      <td className="text-slate-600">

                        {row.planningStatus || PROCUREMENT_TERMS.PLANNING_STATUS_MR_ACTION}

                      </td>

                      <td className="text-right tabular-nums text-slate-500">{row.originCount}</td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          )}

        </CollapsibleSection>



        <CollapsibleSection title={PROCUREMENT_TERMS.SECTION_RM_PO_PENDING} count={rmPoPendingCount}>

          <div className="space-y-3">

            <div>

              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">From purchase requests</p>

              {!loading && ws && ws.summary.purchaseRequestCount === 0 ? (

                <SectionEmpty message={PROCUREMENT_TERMS.SECTION_EMPTY_PR} />

              ) : (

                <PendingMaterialRequestsPanel
                  embedded
                  canPrepareRmPo={canExecutePurchase}
                  key={`pr-pending-${ws?.summary.purchaseRequestCount ?? 0}-${ws?.summary.poPendingCount ?? 0}`}
                />

              )}

            </div>

            <div>

              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Open purchase orders</p>

              {(ws?.sections.poPending ?? []).length === 0 ? (

                <SectionEmpty message={PROCUREMENT_TERMS.SECTION_EMPTY_PO} />

              ) : (

                <div className="min-w-0 overflow-x-auto">

                  <table className="erp-table erp-table-dense w-full text-[12px] [&_td]:py-1.5 [&_th]:py-1.5">

                    <thead>

                      <tr>

                        <th className="text-left">PO</th>

                        <th className="text-left">Supplier</th>

                        <th className="text-right">Lines</th>

                        <th className="text-right">Action</th>

                      </tr>

                    </thead>

                    <tbody>

                      {(ws?.sections.poPending ?? []).map((po) => (

                        <tr key={po.purchaseOrderId}>

                          <td className="font-medium">{po.docNo}</td>

                          <td>{po.supplierName}</td>

                          <td className="text-right tabular-nums">{po.lineCount}</td>

                          <td className="text-right">

                            <Link

                              to={`/rm-po-grn/${po.purchaseOrderId}`}

                              className={cn(

                                buttonVariants({ variant: "outline", size: "sm" }),

                                "h-7 whitespace-nowrap text-[11px] no-underline",

                              )}

                            >

                              {PROCUREMENT_TERMS.OPEN_PO}

                            </Link>

                          </td>

                        </tr>

                      ))}

                    </tbody>

                  </table>

                </div>

              )}

            </div>

          </div>

        </CollapsibleSection>



        <CollapsibleSection title={PROCUREMENT_TERMS.SECTION_GRN_PENDING} count={grnPendingCount}>

          {grnPendingCount === 0 ? (

            <SectionEmpty message={PROCUREMENT_TERMS.SECTION_EMPTY_GRN} />

          ) : (

            <div className="min-w-0 overflow-x-auto">

              <table className="erp-table erp-table-dense w-full text-[12px] [&_td]:py-1.5 [&_th]:py-1.5">

                <thead>

                  <tr>

                    <th className="text-left">PO</th>

                    <th className="text-left">Item</th>

                    <th className="text-right">Pending qty</th>

                    <th className="text-right">Action</th>

                  </tr>

                </thead>

                <tbody>

                  {(ws?.sections.grnPending ?? []).map((row, idx) => (

                    <tr key={`${row.purchaseOrderId}-${idx}`}>

                      <td className="font-medium">{row.purchaseOrderDocNo}</td>

                      <td>{row.itemName}</td>

                      <td className="text-right tabular-nums">{fmtQty(row.pendingQty)}</td>

                      <td className="text-right">

                        <Link

                          to={`/rm-po-grn/${row.purchaseOrderId}`}

                          className={cn(

                            buttonVariants({ variant: "outline", size: "sm" }),

                            "h-7 whitespace-nowrap text-[11px] no-underline",

                          )}

                        >

                          {PROCUREMENT_TERMS.OPEN_GRN}

                        </Link>

                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          )}

        </CollapsibleSection>



        <CollapsibleSection title={PROCUREMENT_TERMS.SECTION_COMPLETED} count={completedCount}>

          {completedCount === 0 ? (

            <SectionEmpty message={PROCUREMENT_TERMS.SECTION_EMPTY_COMPLETED} />

          ) : (

            <ul className="divide-y divide-slate-100 text-xs text-slate-700">

              {(ws?.sections.procurementCompleted ?? []).slice(0, 12).map((row) => (

                <li key={row.materialRequirementId} className="py-1.5">

                  {row.docNo ?? `MR #${row.materialRequirementId}`} · {row.sourceRef} · {row.operationalLabel}

                </li>

              ))}

            </ul>

          )}

        </CollapsibleSection>

      </div>

    </PageContainer>

  );

}


