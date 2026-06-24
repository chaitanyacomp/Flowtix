import { Badge } from "../../ui/badge";
import { cn } from "../../../lib/utils";

type Props = {
  soLabel: string;
  customerName: string;
  cycleNo: number | null | undefined;
  rsLabel: string;
  rsStatus?: string | null;
  className?: string;
};

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
    <div
      className={cn("rounded-md border border-slate-200 bg-white px-3 py-2.5 shadow-sm", className)}
      data-testid="execution-workspace-context-header"
    >
      <div className="font-mono text-base font-semibold tabular-nums text-slate-900">{soLabel}</div>
      <div className="mt-1 text-sm font-medium text-slate-800">
        Customer: <span className="font-normal text-slate-700">{customerName || "—"}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-700">
        <span className="font-semibold text-slate-900">
          {cycleNo != null && Number.isFinite(cycleNo) && cycleNo > 0 ? `Cycle ${cycleNo}` : "Cycle —"}
        </span>
        <span className="text-slate-300">·</span>
        <span className="font-mono font-semibold tabular-nums text-violet-950">{rsLabel}</span>
        {status ? (
          <Badge variant={status === "LOCKED" ? "success" : status === "DRAFT" ? "warning" : "default"}>
            {status === "LOCKED" ? "Locked" : status === "DRAFT" ? "Draft" : status}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
