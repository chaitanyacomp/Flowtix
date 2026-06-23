import * as React from "react";
import { Link } from "react-router-dom";
import { PageContainer, PageHeader } from "../components/PageHeader";
import { NoQtyPlannerInboxSection } from "../components/erp/planning/NoQtyPlannerInboxSection";
import { useNoQtyPlannerInbox } from "../hooks/useNoQtyPlannerInbox";
import { useErpRefreshTick, ERP_REPORT_POLL_MS } from "../hooks/useErpRefreshTick";
import { NO_QTY_PLANNING_HUB_HREF } from "../lib/noQtyStoreNavigation";
import { NO_QTY_TERMS } from "../lib/flowTerminology";
import { buttonVariants } from "../components/ui/button";
import { cn } from "../lib/utils";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { Badge } from "../components/ui/badge";
import { buildNoQtyGuidedHref } from "../lib/noQtyFlowState";
import {
  openCurrentRsButtonLabel,
  resolveNoQtyInboxPlanningCta,
} from "../lib/noQtyRsActionLabels";
import { planningInboxCustomerName } from "../lib/planningInboxPresentation";
import { useCanOpenRequirementSheet } from "../hooks/useIsAdmin";

function fmtQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(3).replace(/\.000$/, "");
}

export function NoQtyAgreementsPage() {
  const liveTick = useErpRefreshTick(["requirement", "dashboard", "reports"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });
  const { rows, loading, error } = useNoQtyPlannerInbox(liveTick);
  const canOpenRs = useCanOpenRequirementSheet();

  return (
    <PageContainer>
      <PageHeader
        title="NO_QTY Execution"
        subtitle="Read-only agreement context for Store planning and execution. Commercial Sales Order editing stays with Admin."
        actions={
          <Link
            to={NO_QTY_PLANNING_HUB_HREF}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}
          >
            {NO_QTY_TERMS.OPEN_REQUIREMENT_AND_CYCLE_PLANNING}
          </Link>
        }
      />

      <NoQtyPlannerInboxSection rows={rows} loading={loading} error={error} className="mb-4" />

      <div className="rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-3 py-2">
          <h2 className="text-sm font-semibold text-slate-900">Agreement register</h2>
          <p className="mt-0.5 text-[11px] text-slate-600">
            Open Requirement Sheet or Execution Workspace without using the commercial Sales Orders page.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Agreement</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Cycle</th>
                <th className="px-3 py-2">Latest RS</th>
                <th className="px-3 py-2">RS status</th>
                <th className="px-3 py-2 text-right">Open balance</th>
                <th className="px-3 py-2">Next action</th>
                <th className="px-3 py-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-slate-600">
                    Loading agreements…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-slate-600">
                    No active NO_QTY agreements right now.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const { so, rsStatus, lockedPeriodKey, guidedCycleId, cycleNo } = row;
                  const rsHref =
                    row.requirementSheetHref ??
                    buildNoQtyGuidedHref({
                      to: `/sales-orders/${so.id}/requirement-sheets`,
                      salesOrderId: so.id,
                      cycleId: guidedCycleId,
                      fromStep: "requirement",
                    });
                  const planningCta = resolveNoQtyInboxPlanningCta({
                    processStageKey: so.processStage?.key,
                    salesOrderId: so.id,
                    lockedPeriodKey,
                    cycleId: guidedCycleId,
                    requirementSheetId: so.noQtyPlacementRequirementSheetId ?? null,
                    readyToPlaceWo: so.noQtyReadyToPlaceWo ?? false,
                  });
                  return (
                    <tr key={so.id} className="border-b border-slate-100 text-slate-800">
                      <td className="px-3 py-2 font-mono font-semibold tabular-nums">
                        {displaySalesOrderNo(so.id, so.docNo ?? null)}
                      </td>
                      <td className="px-3 py-2">{planningInboxCustomerName(so)}</td>
                      <td className="px-3 py-2 tabular-nums">{cycleNo != null ? `Cycle ${cycleNo}` : "—"}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {row.latestRsNo ?? (row.latestRsId != null ? `RS #${row.latestRsId}` : "—")}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={rsStatus === "Locked" ? "success" : rsStatus === "Draft" ? "warning" : "default"}>
                          {rsStatus}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(row.openExecutionBalanceQty)}</td>
                      <td className="px-3 py-2">{row.pendingPlanningAction ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {canOpenRs ? (
                            <Link
                              to={rsHref}
                              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "h-7 text-[11px]")}
                            >
                              {openCurrentRsButtonLabel()}
                            </Link>
                          ) : null}
                          <Link
                            to={planningCta.href}
                            className={cn(buttonVariants({ size: "sm" }), "h-7 text-[11px]")}
                          >
                            {planningCta.label}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageContainer>
  );
}
