import * as React from "react";
import { Link } from "react-router-dom";
import { PageContainer, PageHeader } from "../components/PageHeader";
import { useNoQtyPlannerInbox } from "../hooks/useNoQtyPlannerInbox";
import { useErpRefreshTick, ERP_REPORT_POLL_MS } from "../hooks/useErpRefreshTick";
import { NO_QTY_PLANNING_HUB_HREF } from "../lib/noQtyStoreNavigation";
import { NO_QTY_TERMS } from "../lib/flowTerminology";
import { buttonVariants } from "../components/ui/button";
import { cn } from "../lib/utils";
import { displaySalesOrderNo } from "../lib/docNoDisplay";
import { planningInboxCustomerName } from "../lib/planningInboxPresentation";
import { useCanOpenRequirementSheet } from "../hooks/useIsAdmin";
import {
  formatNoQtyExecutionRegisterQty,
  NO_QTY_OPEN_EXECUTION_WORKSPACE_LABEL,
  noQtyExecutionActionNeededClassName,
  resolveNoQtyExecutionWorkspaceHref,
} from "../lib/noQtyRsActionLabels";

export function NoQtyAgreementsPage() {
  const liveTick = useErpRefreshTick(["requirement", "dashboard", "reports"], {
    pollIntervalMs: ERP_REPORT_POLL_MS,
  });
  const { rows, loading, error } = useNoQtyPlannerInbox(liveTick);
  const canOpenRs = useCanOpenRequirementSheet();
  const executionRows = React.useMemo(
    () => rows.filter((row) => row.executionRegisterEnabled === true),
    [rows],
  );

  return (
    <PageContainer>
      <PageHeader
        title="NO_QTY Execution"
        subtitle="Track locked requirement sheets, remaining RS balance, RM coverage, and WO placement actions."
        actions={
          <Link
            to={NO_QTY_PLANNING_HUB_HREF}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}
          >
            {NO_QTY_TERMS.OPEN_REQUIREMENT_AND_CYCLE_PLANNING}
          </Link>
        }
      />

      {error ? (
        <div
          className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
          data-testid="no-qty-execution-error"
        >
          {error}
        </div>
      ) : null}

      <div
        className="rounded-md border border-slate-200 bg-white shadow-sm"
        data-testid="no-qty-execution-register"
      >
        <div className="border-b border-slate-100 px-3 py-2">
          <h2 className="text-sm font-semibold text-slate-900">Execution register</h2>
          <p className="mt-0.5 text-[11px] text-slate-600">
            Locked RS balance, RM coverage, and the next Store execution action per agreement.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">SO</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Cycle</th>
                <th className="px-3 py-2">RS</th>
                <th className="px-3 py-2 text-right">RS Balance</th>
                <th className="px-3 py-2 text-right">Suggested WO</th>
                <th className="px-3 py-2">RM Coverage</th>
                <th className="px-3 py-2">Action Needed</th>
                <th className="px-3 py-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-slate-600">
                    Loading execution register…
                  </td>
                </tr>
              ) : executionRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-4 text-slate-600"
                    data-testid="no-qty-execution-empty"
                  >
                    No NO_QTY execution work is currently pending.
                  </td>
                </tr>
              ) : (
                executionRows.map((row) => {
                  const { so, cycleNo, guidedCycleId } = row;
                  const workspaceHref = resolveNoQtyExecutionWorkspaceHref({
                    salesOrderId: so.id,
                    executionWorkspaceHref: row.executionWorkspaceHref,
                    placementRequirementSheetId: row.placementRequirementSheetId,
                    guidedCycleId,
                  });
                  const rsLabel =
                    row.placementRequirementSheetNo?.trim() ||
                    (row.placementRequirementSheetId != null
                      ? `RS #${row.placementRequirementSheetId}`
                      : "—");

                  return (
                    <tr
                      key={so.id}
                      className="border-b border-slate-100 text-slate-800"
                      data-testid={`no-qty-execution-row-${so.id}`}
                    >
                      <td className="px-3 py-2 font-mono font-semibold tabular-nums">
                        {displaySalesOrderNo(so.id, so.docNo ?? null)}
                      </td>
                      <td className="px-3 py-2">{planningInboxCustomerName(so)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {cycleNo != null ? `Cycle ${cycleNo}` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums" data-testid="execution-rs">
                        {rsLabel}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        data-testid="execution-rs-balance"
                      >
                        {formatNoQtyExecutionRegisterQty(row.rsBalanceQty)}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        data-testid="execution-suggested-wo"
                      >
                        {formatNoQtyExecutionRegisterQty(row.suggestedWoQty)}
                      </td>
                      <td className="px-3 py-2" data-testid="execution-rm-coverage">
                        {row.rmCoverageLabel ?? "—"}
                      </td>
                      <td
                        className={cn("px-3 py-2", noQtyExecutionActionNeededClassName(row.actionNeededKey))}
                        data-testid="execution-action-needed"
                      >
                        {row.actionNeededLabel ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {canOpenRs && workspaceHref ? (
                          <Link
                            to={workspaceHref}
                            className={cn(buttonVariants({ size: "sm" }), "h-7 text-[11px]")}
                            data-testid="execution-workspace-cta"
                          >
                            {NO_QTY_OPEN_EXECUTION_WORKSPACE_LABEL}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
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
