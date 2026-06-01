import { Link } from "react-router-dom";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import type { GuidedWorkflowResolution } from "../../lib/rmGuidedWorkflow";
import { WoProcurementContinuityStrip } from "./WoProcurementContinuityStrip";
import { StockCommittedToOtherWosPanel } from "./StockCommittedToOtherWosPanel";
import type { StockCommitmentSourceRow } from "../../lib/stockCommitmentVisibility";

type Props = {
  woLabel: string;
  fgLabel?: string | null;
  customerLabel?: string | null;
  guided: GuidedWorkflowResolution;
  canAct: boolean;
  onStartProcurement?: () => void;
  startingProcurement?: boolean;
  stockCommitment?: {
    rmItemName?: string | null;
    unit?: string | null;
    physicalQty: number;
    freeQty: number;
    committedQty?: number | null;
    breakdown?: StockCommitmentSourceRow[];
    currentWorkOrderId?: number | null;
    rmItemId?: number | null;
    salesOrderId?: number | null;
  } | null;
};

export function RmGuidedWorkflowPanel({
  woLabel,
  fgLabel,
  customerLabel,
  guided,
  canAct,
  onStartProcurement,
  startingProcurement,
  stockCommitment,
}: Props) {
  const { primaryAction } = guided;

  return (
    <section className="shrink-0 space-y-3 rounded-lg border-2 border-violet-300 bg-gradient-to-b from-violet-50/80 to-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">Store allocation decision</p>
          <h2 className="mt-0.5 text-lg font-extrabold text-slate-950">{woLabel}</h2>
          <p className="mt-0.5 text-xs font-medium text-slate-700">
            {[fgLabel, customerLabel].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <span className="rounded-md border border-violet-200 bg-white px-2 py-1 text-[10px] font-bold uppercase text-violet-900">
          Owner: {guided.ownerLabel}
        </span>
      </div>

      <WoProcurementContinuityStrip
        operationalKey={
          guided.phase === "A_BLOCKED"
            ? "PROCUREMENT_PENDING"
            : guided.phase === "B_MR_ESCALATED"
              ? "PROCUREMENT_PENDING"
              : guided.phase === "C_PR_CREATED"
                ? "PR_PENDING_PO"
                : guided.phase === "D_PO_GRN_PENDING"
                  ? "GRN_PENDING"
                  : "RM_READY"
        }
      />

      <div className="rounded-md border border-amber-200 bg-amber-50/90 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-amber-900">Current blocker</p>
        <h3 className="mt-0.5 text-sm font-extrabold text-amber-950">{guided.phaseTitle}</h3>
        <p className="mt-1 text-xs font-medium leading-relaxed text-amber-950">{guided.phaseDetail}</p>
        <p className="mt-2 text-xs text-slate-700">{guided.statusHeadline}</p>
      </div>

      {stockCommitment ? (
        <StockCommittedToOtherWosPanel
          rmItemName={stockCommitment.rmItemName}
          unit={stockCommitment.unit}
          physicalQty={stockCommitment.physicalQty}
          freeQty={stockCommitment.freeQty}
          committedQty={stockCommitment.committedQty}
          breakdown={stockCommitment.breakdown}
          currentWorkOrderId={stockCommitment.currentWorkOrderId}
          rmItemId={stockCommitment.rmItemId}
          salesOrderId={stockCommitment.salesOrderId}
        />
      ) : null}

      <div className="rounded-md border border-slate-900 bg-slate-900 px-4 py-3 text-center">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Your next step</p>
        {canAct && primaryAction.kind === "START_PROCUREMENT" && onStartProcurement ? (
          <Button
            type="button"
            size="lg"
            className="mt-2 h-10 w-full max-w-md bg-white px-6 text-sm font-extrabold text-slate-900 hover:bg-slate-100"
            disabled={startingProcurement}
            onClick={onStartProcurement}
          >
            {startingProcurement ? "Starting…" : primaryAction.label}
          </Button>
        ) : canAct && primaryAction.href && primaryAction.kind !== "NONE" ? (
          <Link
            to={primaryAction.href}
            className={cn(
              buttonVariants({ size: "lg" }),
              "mt-2 inline-flex h-10 w-full max-w-md items-center justify-center bg-white px-6 text-sm font-extrabold text-slate-900 no-underline hover:bg-slate-100",
            )}
          >
            {primaryAction.label}
          </Link>
        ) : (
          <p className="mt-2 text-sm font-semibold text-slate-300">{primaryAction.label}</p>
        )}
      </div>
    </section>
  );
}
