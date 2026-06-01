import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight, ShieldAlert } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";

type Tier = "blocker" | "approval" | "ready" | "supply";

const TIER_SURFACE: Record<Tier, string> = {
  blocker: "bg-gradient-to-r from-red-50 via-red-50/90 to-amber-50/40 ring-red-200/80",
  approval: "bg-gradient-to-r from-amber-50 via-amber-50/95 to-white ring-amber-200/80",
  supply: "bg-gradient-to-r from-violet-50/90 to-white ring-violet-200/70",
  ready: "bg-slate-50/90 ring-slate-200/80",
};

type Props = {
  tier: Tier;
  headline: string;
  contextLine?: string;
  blockerReason?: string;
  owner?: string;
  nextAction?: string;
  actionLabel?: string;
  href?: string;
  onAction?: () => void;
  readOnly?: boolean;
  readOnlyHint?: string;
};

export function OperationalAlertStrip({
  tier,
  headline,
  contextLine,
  blockerReason,
  owner,
  nextAction,
  actionLabel,
  href,
  onAction,
  readOnly,
  readOnlyHint,
}: Props) {
  const Icon = tier === "blocker" ? ShieldAlert : AlertTriangle;
  const iconClass =
    tier === "blocker" ? "text-red-700" : tier === "approval" ? "text-amber-700" : "text-slate-600";

  const cta =
    readOnly && readOnlyHint ? (
      <p className="max-w-[14rem] text-right text-[12px] font-semibold text-slate-700">{readOnlyHint}</p>
    ) : onAction ? (
      <Button type="button" size="sm" className="h-9 shrink-0 px-4 text-[13px] font-bold" onClick={onAction}>
        {actionLabel}
        <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
      </Button>
    ) : href ? (
      <Link
        to={href}
        className={cn(
          buttonVariants({ size: "sm" }),
          "inline-flex h-9 shrink-0 items-center px-4 text-[13px] font-bold no-underline",
          tier === "blocker" && "bg-red-800 hover:bg-red-900",
          tier === "approval" && "bg-amber-800 hover:bg-amber-900",
        )}
      >
        {actionLabel}
        <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
      </Link>
    ) : null;

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg px-3 py-2.5 shadow-sm ring-1 sm:flex-row sm:items-center sm:gap-4",
        TIER_SURFACE[tier],
      )}
      role={readOnly ? "status" : undefined}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:max-w-[32%]">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconClass)} aria-hidden />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Factory blocked</p>
          <h3 className="text-[16px] font-bold leading-tight text-slate-900">{headline}</h3>
          {contextLine ? <p className="mt-0.5 truncate text-[13px] text-slate-700">{contextLine}</p> : null}
        </div>
      </div>

      <div className="min-w-0 flex-1 border-slate-200/60 sm:border-l sm:pl-4">
        {blockerReason ? (
          <p className="text-[13px] font-medium text-slate-800">{blockerReason}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]">
          {owner ? (
            <span>
              <span className="font-bold uppercase tracking-wide text-slate-500">Owner</span>{" "}
              <span className="font-semibold text-slate-900">{owner}</span>
            </span>
          ) : null}
          {nextAction ? (
            <span>
              <span className="font-bold uppercase tracking-wide text-slate-500">Next</span>{" "}
              <span className="font-semibold text-blue-900">{nextAction}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end sm:min-w-[11rem]">{cta}</div>
    </div>
  );
}
