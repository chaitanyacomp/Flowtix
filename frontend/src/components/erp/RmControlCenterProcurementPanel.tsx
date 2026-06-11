import { Link } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import { RmProcurementTimeline } from "./RmProcurementTimeline";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import type { ProcurementChip, ProcurementWarning } from "../../lib/rmControlCenterProcurementVisibility";

type Props = {
  chip: ProcurementChip;
  sourceLabel: string | null;
  mrDocNo?: string | null;
  timelineStepIndex: number;
  prLineCount: number;
  poLineCount: number;
  pendingGrnQty: number;
  receivedGrnQty: number;
  warnings: ProcurementWarning[];
  procurementWorkspaceHref: string;
  grnHref: string;
  canCreatePurchaseRequest: boolean;
  creatingPr?: boolean;
  onCreatePurchaseRequest?: () => void;
};

const CHIP_VARIANT: Record<ProcurementChip["variant"], string> = {
  default: "bg-slate-100 text-slate-800 ring-slate-200",
  warning: "bg-amber-100 text-amber-950 ring-amber-200",
  info: "bg-blue-100 text-blue-950 ring-blue-200",
  success: "bg-emerald-100 text-emerald-950 ring-emerald-200",
  muted: "bg-slate-50 text-slate-500 ring-slate-200",
};

export function RmControlCenterProcurementPanel({
  chip,
  sourceLabel,
  mrDocNo,
  timelineStepIndex,
  prLineCount,
  poLineCount,
  pendingGrnQty,
  receivedGrnQty,
  warnings,
  procurementWorkspaceHref,
  grnHref,
  canCreatePurchaseRequest,
  creatingPr,
  onCreatePurchaseRequest,
}: Props) {
  const showCreatePr = canCreatePurchaseRequest && chip.key === "AWAITING_PR";
  const showOpenGrn = chip.key === "GRN_PENDING" || chip.key === "PARTIALLY_RECEIVED";

  return (
    <div className="space-y-2" data-testid="rm-cc-procurement-panel">
      <div className="rounded-md border border-violet-200/80 bg-violet-50/40 px-2.5 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">Procurement status</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1",
              CHIP_VARIANT[chip.variant],
            )}
            data-testid="rm-cc-procurement-chip"
          >
            {chip.label}
          </span>
          {sourceLabel ? (
            <span className="text-[11px] font-medium text-slate-700">
              Source: <span className="font-semibold text-slate-900">{sourceLabel}</span>
            </span>
          ) : null}
        </div>
      </div>

      <RmProcurementTimeline
        activeStepIndex={timelineStepIndex}
        mrDocNo={mrDocNo}
        prLineCount={prLineCount}
        poLineCount={poLineCount}
        pendingGrnQty={pendingGrnQty}
        receivedGrnQty={receivedGrnQty}
      />

      {warnings.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-amber-200/80 bg-amber-50/50 px-2.5 py-2">
          {warnings.map((w) => (
            <li key={w.code} className="text-[11px] leading-snug text-amber-950">
              <Badge variant={w.tone === "info" ? "info" : "warning"} density="compact" className="mr-1">
                Note
              </Badge>
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {showCreatePr ? (
          <Button
            type="button"
            size="sm"
            className="h-9 w-full text-[12px] font-semibold"
            disabled={creatingPr}
            onClick={() => onCreatePurchaseRequest?.()}
          >
            {creatingPr ? "Creating…" : PROCUREMENT_TERMS.CREATE_PURCHASE_REQUEST}
          </Button>
        ) : null}
        <Link
          to={procurementWorkspaceHref}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-9 w-full justify-center text-[12px] font-semibold no-underline",
          )}
        >
          Open Procurement Workspace
        </Link>
        {showOpenGrn ? (
          <Link
            to={grnHref}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-9 w-full justify-center text-[12px] font-semibold no-underline",
            )}
          >
            {PROCUREMENT_TERMS.OPEN_GRN}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
