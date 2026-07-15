import { Badge } from "../../ui/badge";
import { cn } from "../../../lib/utils";
import { WO_PLANNING_UX } from "../../../lib/requirementSheetExecutionWorkspaceUx";

type Props = {
  soLabel: string;
  customerName: string;
  cycleNo: number | null | undefined;
  rsLabel: string;
  rsStatus?: string | null;
  className?: string;
};

/**
 * Locked-RS Work Order Planning shell header.
 * Page purpose = Work Order Planning; Requirement Sheet is compact source reference only.
 */
export function ExecutionWorkspaceContextHeader({
  soLabel,
  customerName,
  cycleNo,
  rsLabel,
  rsStatus,
  className,
}: Props) {
  const status = String(rsStatus ?? "").toUpperCase();
  return (
    <div className={cn("space-y-2", className)} data-testid="execution-workspace-context-header">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Current task
        </div>
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">{WO_PLANNING_UX.PAGE_TITLE}</h1>
        <p className="mt-0.5 text-xs font-medium text-slate-600">{WO_PLANNING_UX.PAGE_SUBTITLE}</p>
      </div>

      <div
        className="rounded-md border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
        data-testid="execution-rs-reference-card"
      >
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {WO_PLANNING_UX.SOURCE_DOCUMENT_LABEL}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700">
          <span>
            <span className="text-slate-500">RS </span>
            <span className="font-mono font-semibold tabular-nums text-violet-950">{rsLabel}</span>
          </span>
          <span className="hidden text-slate-300 sm:inline">·</span>
          <span className="max-w-[14rem] truncate" title={customerName || undefined}>
            <span className="text-slate-500">Customer </span>
            <span className="font-medium text-slate-800">{customerName || "—"}</span>
          </span>
          <span className="hidden text-slate-300 sm:inline">·</span>
          <span className="font-semibold text-slate-900">
            {cycleNo != null && Number.isFinite(cycleNo) && cycleNo > 0 ? `Cycle ${cycleNo}` : "Cycle —"}
          </span>
          <span className="hidden text-slate-300 sm:inline">·</span>
          <span className="font-mono text-[11px] text-slate-600">{soLabel}</span>
          {status ? (
            <Badge variant={status === "LOCKED" ? "success" : status === "DRAFT" ? "warning" : "default"}>
              {status === "LOCKED" ? "Locked" : status === "DRAFT" ? "Draft" : status}
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}
