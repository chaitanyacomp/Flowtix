import * as React from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Badge } from "../../ui/badge";
import { Button, buttonVariants } from "../../ui/button";
import { PlanningStatusChip } from "../PlanningStatusChip";
import { cn } from "../../../lib/utils";
import { displaySalesOrderNo } from "../../../lib/docNoDisplay";
import {
  noQtyBusinessNextRsBlockReason,
  noQtyCurrentCycleLabel,
  noQtyNextCycleLabel,
  noQtyNextRsStatusHeadline,
} from "../../../lib/noQtyRsActionLabels";

export type NoQtyAgreementCardProps = {
  salesOrderId: number;
  docNo?: string | null;
  customerName: string;
  agreementStatus: "OPEN" | "CLOSED";
  currentCycleNo: number | null;
  currentStage: string;
  currentRsStatus: string;
  nextCycleNo: number | null;
  nextRsEligible?: boolean | null;
  nextRsBlockReason?: string | null;
  nextRsAlreadyExists?: boolean;
  commercialCaption?: string | null;
  /** Primary + secondary action links (already resolved). */
  children?: React.ReactNode;
  adminActions?: React.ReactNode;
  drillAttrs?: Record<string, unknown>;
};

function DetailRow({ label, value, valueClassName }: { label: string; value: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cn("mt-0.5 text-[12px] font-medium leading-snug text-slate-900", valueClassName)}>{value}</dd>
    </div>
  );
}

export function NoQtyAgreementCard({
  salesOrderId,
  docNo,
  customerName,
  agreementStatus,
  currentCycleNo,
  currentStage,
  currentRsStatus,
  nextCycleNo,
  nextRsEligible,
  nextRsBlockReason,
  nextRsAlreadyExists,
  commercialCaption,
  children,
  adminActions,
  drillAttrs,
}: NoQtyAgreementCardProps) {
  const nextRsHeadlineRaw = noQtyNextRsStatusHeadline(nextRsEligible === true, nextRsAlreadyExists);
  const nextRsHeadline = nextRsHeadlineRaw.startsWith("Next RS: ")
    ? nextRsHeadlineRaw.slice("Next RS: ".length)
    : nextRsHeadlineRaw.replace(/^Next RS /, "");
  const nextRsReason =
    nextRsAlreadyExists
      ? "Next cycle Requirement Sheet already exists."
      : nextRsEligible
        ? null
        : noQtyBusinessNextRsBlockReason(nextRsBlockReason) || null;

  const nextRsTone =
    nextRsAlreadyExists || nextRsEligible
      ? "text-emerald-800"
      : nextRsEligible === false
        ? "text-amber-900"
        : "text-slate-700";

  return (
    <article
      className="rounded-lg border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-900/[0.03]"
      data-testid={`no-qty-agreement-card-${salesOrderId}`}
      {...drillAttrs}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug">
        <span className="font-mono text-[13px] font-bold tabular-nums text-slate-950">
          {displaySalesOrderNo(salesOrderId, docNo ?? null)}
        </span>
        <span className="text-slate-300" aria-hidden>
          ·
        </span>
        <span className="min-w-0 truncate font-medium text-slate-900" title={customerName}>
          {customerName}
        </span>
        <span className="text-slate-300" aria-hidden>
          ·
        </span>
        <Badge
          variant={agreementStatus === "CLOSED" ? "secondary" : "success"}
          className="px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide"
        >
          {agreementStatus}
        </Badge>
        <Badge variant="info" className="ml-auto px-1.5 py-0 text-[10px] font-semibold uppercase">
          NO_QTY
        </Badge>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        <DetailRow label="Current Cycle" value={noQtyCurrentCycleLabel(currentCycleNo)} />
        <DetailRow label="Current Stage" value={currentStage} />
        <DetailRow label="Current RS" value={currentRsStatus} valueClassName="text-violet-950" />
        <DetailRow label="Next Cycle" value={noQtyNextCycleLabel(nextCycleNo)} />
        <DetailRow label="Next RS" value={nextRsHeadline} valueClassName={nextRsTone} />
        {commercialCaption ? (
          <DetailRow label="Commercial" value={commercialCaption} valueClassName="text-slate-700 font-normal" />
        ) : null}
      </dl>

      {nextRsReason ? (
        <p className="mt-2 text-[11px] leading-snug text-amber-950">
          <span className="font-semibold">Reason: </span>
          {nextRsReason}
        </p>
      ) : null}

      {children ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">{children}</div>
      ) : null}

      {adminActions ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{adminActions}</div>
      ) : null}
    </article>
  );
}

export function NoQtyAgreementActionLink({
  to,
  label,
  variant = "primary",
}: {
  to: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      to={to}
      className={cn(
        buttonVariants({ size: "sm", variant: variant === "primary" ? "default" : "outline" }),
        variant === "primary" ? "erp-so-act-primary font-semibold" : "erp-so-act-secondary",
      )}
    >
      {label}
    </Link>
  );
}

export function NoQtyAgreementAdminDeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" size="sm" variant="destructive" className="h-7 px-2" onClick={onClick}>
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export { PlanningStatusChip };
