/**
 * Permanent Work Order Details — loads by workOrderId (authoritative).
 * REGULAR_SO primary; NO_QTY opens with flow indicator and guided links (no REGULAR lifecycle mutation).
 */

import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageHeader, PageSmartBackLink } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { cn } from "../lib/utils";
import { formatQtyNumber } from "../lib/quantityDisplay";
import { buildMaterialIssueDeepLink } from "../lib/manufacturingNavigationContinuity";
import { buildProductionScopedHref } from "../lib/productionNavigation";
import { qcEntryFocusHref } from "../lib/drillDownRoutes";
import { workOrderStatusBadgeVariant, workOrderStatusDisplayLabel } from "../lib/workOrderLifecycle";
import { REGULAR_TERMS } from "../lib/flowTerminology";
import { useAuth } from "../hooks/useAuth";

type LifecycleAction = { enabled: boolean; blockers: string[] };

type WoDetail = {
  id: number;
  displayNo: string;
  flow: string;
  orderType?: string | null;
  lifecycleStatus: string;
  createdAt?: string;
  closureReason?: string | null;
  identification: {
    workOrderId: number;
    workOrderNo: string;
    salesOrderId: number | null;
    salesOrderNo: string | null;
    salesOrderLineId?: number | null;
    customerName: string | null;
    fgItemId: number | null;
    fgItemName: string | null;
    fgUnit?: string | null;
    approvedBom?: { id: number; version?: number | null; status?: string } | null;
  };
  quantityPlanning: {
    customerSoQty: number;
    productionBufferPercent: number;
    productionBufferQty: number;
    woTargetQty: number;
    producedQty: number;
    remainingProductionQty: number;
  };
  rmPosition: {
    theoreticalRmRequiredQty: number;
    reservedQty: number;
    netIssuedQty: number;
    cumulativeReturnedQty: number;
    wastageQty: number;
    remainingIssueBalance: number;
    supportedProductionCapacityQty: number;
  };
  linkedExecution: {
    pmr: { id: number; docNo: string | null; status: string } | null;
    materialIssues: Array<{ id: number; docNo: string | null; createdAt: string }>;
    productionReports: Array<{ id: number; status: string; confirmedAt?: string | null }>;
    qaInspections: Array<{ id: number; result?: string | null; productionDocNo?: string | null }>;
    dispatches: Array<{ id: number; docNo: string | null; status?: string | null }>;
    executionStatus?: string | null;
  };
  nextAction: { key: string; label: string; hrefKind: string };
  lifecycleActions: {
    edit: LifecycleAction;
    hardDelete: LifecycleAction;
    cancel: LifecycleAction;
    reopen: LifecycleAction;
  } | null;
  lines: Array<{ id: number; fgItemName: string | null; qty: number; producedQty: number; unit?: string | null }>;
};

function Metric({ label, value, emphasize }: { label: string; value: React.ReactNode; emphasize?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-0.5 truncate text-sm tabular-nums text-slate-900", emphasize && "font-semibold")}>{value}</div>
    </div>
  );
}

function ActionButton({
  label,
  enabled,
  blockers,
  onClick,
  variant = "outline",
  danger,
}: {
  label: string;
  enabled: boolean;
  blockers: string[];
  onClick: () => void;
  variant?: "outline" | "default";
  danger?: boolean;
}) {
  const title = blockers.join("; ") || undefined;
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={cn("h-8 text-xs", danger && "border-red-200 text-red-700 hover:bg-red-50")}
      disabled={!enabled}
      title={!enabled ? title : undefined}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function WorkOrderDetailPage() {
  const { workOrderId: workOrderIdParam } = useParams();
  const workOrderId = Number(workOrderIdParam);
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [detail, setDetail] = React.useState<WoDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!(workOrderId > 0)) {
      setError("Invalid work order id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await apiFetch<WoDetail>(`/api/production/work-orders/${workOrderId}`);
      setDetail(row);
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : "Failed to load work order");
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const soId = detail?.identification.salesOrderId ?? null;
  const pmrId = detail?.linkedExecution.pmr?.id ?? null;
  const primaryLineId = detail?.lines?.[0]?.id ?? null;

  function nextActionHref(): string | null {
    if (!detail) return null;
    const kind = detail.nextAction.hrefKind;
    if (kind === "MATERIAL_ISSUE") {
      return buildMaterialIssueDeepLink({
        workOrderId: detail.id,
        pmrId,
        salesOrderId: soId,
        returnTo: "work-order-detail",
        source: "work-order-detail",
        bucket: detail.linkedExecution.pmr?.status === "PARTIALLY_ISSUED" ? "partiallyIssued" : "readyToIssue",
      });
    }
    if (kind === "PRODUCTION" || kind === "PRODUCTION_REPORT") {
      return buildProductionScopedHref({
        orderType: detail.orderType,
        salesOrderId: soId ?? undefined,
        workOrderId: detail.id,
        workOrderLineId: primaryLineId ?? undefined,
      });
    }
    if (kind === "QA") return qcEntryFocusHref(detail.id);
    if (kind === "DISPATCH" && soId) return `/dispatch?salesOrderId=${soId}`;
    if (kind === "NO_QTY_WO" && soId) {
      return `/work-orders?salesOrderId=${soId}&workOrderId=${detail.id}&from=work-order-detail`;
    }
    return null;
  }

  async function runLifecycle(
    kind: "delete" | "cancel" | "reopen",
    confirmMsg: string,
  ) {
    if (!detail) return;
    const reason = window.prompt(`Reason for ${kind === "delete" ? "deleting" : kind === "cancel" ? "cancelling" : "reopening"} this work order (required):`)?.trim();
    if (reason == null) return;
    if (!reason) {
      setError("Reason is required.");
      return;
    }
    if (!confirm(confirmMsg)) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "delete") {
        await apiFetch(`/api/production/work-orders/${detail.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        nav("/work-orders?flow=REGULAR_SO");
        return;
      }
      if (kind === "cancel") {
        await apiFetch(`/api/production/work-orders/${detail.id}/cancel`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
      } else {
        await apiFetch(`/api/production/work-orders/${detail.id}/reopen`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${kind} work order`);
    } finally {
      setBusy(false);
    }
  }

  const backDefault =
    searchParams.get("from") === "prepare-wo" || searchParams.get("returnTo") === "prepare-wo"
      ? `/work-orders/prepare${soId ? `?salesOrderId=${soId}` : ""}`
      : "/work-orders?flow=REGULAR_SO";

  const editHref =
    soId && detail
      ? `/work-orders?so=${soId}&excludeWo=${detail.id}&from=work-order-detail`
      : null;

  const nextHref = nextActionHref();

  return (
    <div className="erp-page space-y-3">
      <PageHeader
        title={detail ? detail.displayNo : "Work Order"}
        subtitle="Permanent work order document — planning, RM position, and execution links."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PageSmartBackLink defaultTo={backDefault} defaultLabel={REGULAR_TERMS.BACK_TO_WORK_ORDERS} />
            {detail ? (
              <Badge variant={workOrderStatusBadgeVariant(detail.lifecycleStatus)} className="whitespace-nowrap">
                {workOrderStatusDisplayLabel({ status: detail.lifecycleStatus })}
              </Badge>
            ) : null}
            {detail?.flow ? (
              <Badge variant="info" className="whitespace-nowrap">
                {detail.flow === "REGULAR_SO" ? "REGULAR SO" : detail.flow}
              </Badge>
            ) : null}
          </div>
        }
      />

      {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-600">Loading work order…</div> : null}

      {!loading && detail ? (
        <>
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-slate-100 px-3 py-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Identification</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 px-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Work Order" value={detail.identification.workOrderNo} emphasize />
              <Metric label="Internal SO" value={detail.identification.salesOrderNo ?? "—"} />
              <Metric label="Customer" value={detail.identification.customerName ?? "—"} />
              <Metric label="FG" value={detail.identification.fgItemName ?? "—"} />
              <Metric
                label="Approved BOM"
                value={
                  detail.identification.approvedBom
                    ? `v${detail.identification.approvedBom.version ?? "—"} (${detail.identification.approvedBom.status})`
                    : "—"
                }
              />
              <Metric
                label="Created"
                value={detail.createdAt ? new Date(detail.createdAt).toLocaleString() : "—"}
              />
              <Metric label="Lifecycle" value={workOrderStatusDisplayLabel({ status: detail.lifecycleStatus })} />
              {detail.closureReason ? <Metric label="Closure reason" value={detail.closureReason} /> : null}
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-slate-100 px-3 py-2">
                <CardTitle className="text-sm font-semibold">Quantity planning</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 px-3 py-3 sm:grid-cols-3">
                <Metric label="Customer SO qty" value={formatQtyNumber(detail.quantityPlanning.customerSoQty)} />
                <Metric
                  label="Production buffer"
                  value={`${formatQtyNumber(detail.quantityPlanning.productionBufferPercent)}%`}
                />
                <Metric label="WO target" value={formatQtyNumber(detail.quantityPlanning.woTargetQty)} emphasize />
                <Metric label="Produced" value={formatQtyNumber(detail.quantityPlanning.producedQty)} />
                <Metric label="Remaining" value={formatQtyNumber(detail.quantityPlanning.remainingProductionQty)} />
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className="border-b border-slate-100 px-3 py-2">
                <CardTitle className="text-sm font-semibold">RM position</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 px-3 py-3 sm:grid-cols-3">
                <Metric label="Theoretical RM" value={formatQtyNumber(detail.rmPosition.theoreticalRmRequiredQty)} />
                <Metric label="Net issued" value={formatQtyNumber(detail.rmPosition.netIssuedQty)} emphasize />
                <Metric label="Returned" value={formatQtyNumber(detail.rmPosition.cumulativeReturnedQty)} />
                <Metric label="Wastage" value={formatQtyNumber(detail.rmPosition.wastageQty)} />
                <Metric label="Remaining to issue" value={formatQtyNumber(detail.rmPosition.remainingIssueBalance)} />
                <Metric
                  label="Supported capacity"
                  value={formatQtyNumber(detail.rmPosition.supportedProductionCapacityQty)}
                />
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <CardTitle className="text-sm font-semibold">Next action</CardTitle>
              {nextHref ? (
                <Link className={cn(buttonVariants({ size: "sm" }), "h-8 text-xs no-underline")} to={nextHref}>
                  {detail.nextAction.label}
                </Link>
              ) : (
                <span className="text-sm text-slate-700">{detail.nextAction.label}</span>
              )}
            </CardHeader>
            <CardContent className="grid gap-3 px-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="PMR"
                value={
                  detail.linkedExecution.pmr
                    ? `${detail.linkedExecution.pmr.docNo || `PMR-${detail.linkedExecution.pmr.id}`} · ${detail.linkedExecution.pmr.status}`
                    : "—"
                }
              />
              <Metric label="RM issues" value={String(detail.linkedExecution.materialIssues.length)} />
              <Metric label="QA inspections" value={String(detail.linkedExecution.qaInspections.length)} />
              <Metric label="Dispatches" value={String(detail.linkedExecution.dispatches.length)} />
              <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
                {pmrId ? (
                  <Link
                    className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-8 text-xs no-underline")}
                    to={`/production/material-requests?workOrderId=${detail.id}&pmrId=${pmrId}`}
                  >
                    Open PMR
                  </Link>
                ) : null}
                <Link
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-8 text-xs no-underline")}
                  to={buildMaterialIssueDeepLink({
                    workOrderId: detail.id,
                    pmrId,
                    salesOrderId: soId,
                    returnTo: "work-order-detail",
                    source: "work-order-detail",
                  })}
                >
                  Material Issue
                </Link>
                <Link
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-8 text-xs no-underline")}
                  to={buildProductionScopedHref({
                    orderType: detail.orderType,
                    salesOrderId: soId ?? undefined,
                    workOrderId: detail.id,
                    workOrderLineId: primaryLineId ?? undefined,
                  })}
                >
                  Production
                </Link>
                <Link
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-8 text-xs no-underline")}
                  to={qcEntryFocusHref(detail.id)}
                >
                  QA
                </Link>
                {soId ? (
                  <Link
                    className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-8 text-xs no-underline")}
                    to={`/dispatch?salesOrderId=${soId}`}
                  >
                    Dispatch
                  </Link>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {detail.flow === "REGULAR_SO" && detail.lifecycleActions ? (
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-slate-100 px-3 py-2">
                <CardTitle className="text-sm font-semibold">Lifecycle actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-3 py-3">
                <div className="flex flex-wrap gap-2">
                  {detail.lifecycleActions.edit.enabled && editHref ? (
                    <Link className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-8 text-xs no-underline")} to={editHref}>
                      Edit WO
                    </Link>
                  ) : (
                    <ActionButton
                      label="Edit WO"
                      enabled={false}
                      blockers={detail.lifecycleActions.edit.blockers}
                      onClick={() => undefined}
                    />
                  )}
                  <ActionButton
                    label="Delete WO"
                    enabled={detail.lifecycleActions.hardDelete.enabled && !busy}
                    blockers={detail.lifecycleActions.hardDelete.blockers}
                    danger
                    onClick={() => void runLifecycle("delete", "Permanently delete this untouched work order?")}
                  />
                  <ActionButton
                    label="Cancel WO"
                    enabled={detail.lifecycleActions.cancel.enabled && !busy}
                    blockers={detail.lifecycleActions.cancel.blockers}
                    onClick={() =>
                      void runLifecycle("cancel", "Cancel this work order and release eligible unissued reservations?")
                    }
                  />
                  <ActionButton
                    label="Reopen WO"
                    enabled={detail.lifecycleActions.reopen.enabled && !busy && String(user?.role || "").toUpperCase() === "ADMIN"}
                    blockers={
                      detail.lifecycleActions.reopen.enabled && String(user?.role || "").toUpperCase() !== "ADMIN"
                        ? ["Admin permission required"]
                        : detail.lifecycleActions.reopen.blockers
                    }
                    onClick={() => void runLifecycle("reopen", "Reopen this closed work order for controlled execution?")}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Eligibility comes from the backend lifecycle projection. Disabled actions show the exact blocker on hover.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
