import { cn } from "../../lib/utils";
import { WORKFLOW_STATUS_COPY } from "../../lib/flowTerminology";

/**
 * Read-only "Planning status" chip shown to roles without planning permission
 * (SALES / PRODUCTION / QC / ACCOUNTS) in place of "Open Requirement Sheet" CTAs.
 *
 * Purpose: keep workflow visibility for non-planning operators while preserving
 * role clarity — the planning workspace is owned by Store/Planning (and Admin).
 * Default copy uses department wording ("Waiting for Planning Team") instead of
 * technical jargon, so factory operators and managers parse it instantly.
 *
 * UI-only: no backend permissions or workflow rules are changed.
 */
export function PlanningStatusChip(props: {
  label?: string;
  /** Defaults to "Planning Status". */
  caption?: string;
  /** When true, render the chip as a single compact pill (no caption row). */
  inline?: boolean;
  className?: string;
  title?: string;
}) {
  const label = props.label ?? WORKFLOW_STATUS_COPY.WAITING_FOR_PLANNING_TEAM;
  const caption = props.caption ?? "Planning Status";
  const title =
    props.title ??
    "Planning workspace is owned by Store/Planning. This role sees workflow status only.";

  if (props.inline) {
    return (
      <span
        title={title}
        aria-disabled="true"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm",
          props.className,
        )}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
        {label}
      </span>
    );
  }

  return (
    <span
      title={title}
      aria-disabled="true"
      className={cn(
        "inline-flex flex-col items-start gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-left shadow-sm",
        props.className,
      )}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
        {caption}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-800">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
        {label}
      </span>
    </span>
  );
}
