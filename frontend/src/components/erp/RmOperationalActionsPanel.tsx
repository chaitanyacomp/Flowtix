import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import type { OperationalActionButton, RmOperationalContext, TraceStep } from "../../lib/rmOperationalActions";

type Props = {
  operational: RmOperationalContext;
  canAct: boolean;
  transitioning?: boolean;
  onAction?: (action: NonNullable<OperationalActionButton["action"]>) => void;
  className?: string;
};

/** Single compact stage chip — one operational truth for the case header. */
export function RmOperationalStageChip({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-950 ring-1 ring-violet-200",
        className,
      )}
    >
      {label}
    </span>
  );
}

export function RmOperationalTraceStrip({
  steps,
  className,
  variant = "default",
}: {
  steps: TraceStep[];
  className?: string;
  variant?: "default" | "compact";
}) {
  const chip = (state: TraceStep["state"]) =>
    state === "done"
      ? "bg-emerald-100 text-emerald-950 ring-emerald-200"
      : state === "active"
        ? "bg-violet-100 text-violet-950 ring-violet-300"
        : state === "waiting"
          ? "bg-amber-100 text-amber-950 ring-amber-200"
          : "bg-slate-50 text-slate-500 ring-slate-200";

  return (
    <div className={cn("rounded-md bg-slate-50/90 px-2 py-1 ring-1 ring-slate-200/70", className)}>
      {variant !== "compact" ? (
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Workflow</p>
      ) : null}
      <div className={cn("flex flex-wrap items-center gap-1", variant === "compact" ? "" : "mt-1")}>
        {steps.map((step, i) => (
          <React.Fragment key={step.key}>
            {i > 0 ? <span className="text-[11px] text-slate-400">→</span> : null}
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1",
                chip(step.state),
              )}
              title={step.statusLabel}
            >
              {step.label}
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/** Action rail — owner plus at most one primary and one secondary CTA. */
export function RmOperationalActionsPanel({
  operational,
  canAct,
  transitioning,
  onAction,
  className,
}: Props) {
  const { buttons, owner } = operational;

  const approveBtn = buttons.find((b) => b.action === "approve");
  const closeBtn = buttons.find((b) => b.action === "close");
  const sendBtn = buttons.find((b) => b.action === "send-to-purchase");
  const procurementBtn = buttons.find((b) => b.id === "open-procurement");
  const issueToProductionBtn = buttons.find((b) => b.id === "issue-to-production" || b.id === "open-issue");
  const raiseReopenBtn = buttons.find((b) => b.id === "raise-mr-reopen");
  const raiseBtn = buttons.find((b) => b.action === "raise-mr" && b.id !== "raise-mr-reopen");
  const reopenBtn = buttons.find((b) => b.action === "reopen");
  const linkBtn = buttons.find((b) => b.href && !b.disabled && b.kind === "primary" && b.id !== "open-procurement");

  const primaryBtn =
    approveBtn ??
    sendBtn ??
    issueToProductionBtn ??
    procurementBtn ??
    raiseReopenBtn ??
    raiseBtn ??
    linkBtn ??
    buttons.find((b) => b.kind === "primary" && !b.disabled && b.action);

  const secondaryBtn =
    (closeBtn && closeBtn !== primaryBtn ? closeBtn : null) ??
    (reopenBtn && reopenBtn !== primaryBtn ? reopenBtn : null) ??
    buttons.find(
      (b) =>
        b !== primaryBtn &&
        b.kind !== "info" &&
        !b.disabled &&
        (b.action === "send-to-purchase" || b.kind === "outline" || b.href),
    ) ??
    null;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      <div className="shrink-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Current owner</p>
        <p className="mt-0.5 text-[16px] font-semibold text-slate-900">{owner}</p>
      </div>

      <div className="flex shrink-0 flex-col gap-1">
        {primaryBtn ? renderCta(primaryBtn, canAct, transitioning, onAction, "primary") : null}
        {secondaryBtn && secondaryBtn !== primaryBtn
          ? renderCta(secondaryBtn, canAct, transitioning, onAction, "secondary")
          : null}
      </div>
    </div>
  );
}

function renderCta(
  btn: OperationalActionButton,
  canAct: boolean,
  transitioning: boolean | undefined,
  onAction: Props["onAction"],
  tier: "primary" | "secondary",
) {
  const base = "flex h-9 w-full items-center justify-center rounded-md text-[13px] font-semibold";

  if (btn.href) {
    return canAct ? (
      <Link
        key={btn.id}
        to={btn.href}
        className={cn(
          base,
          "no-underline shadow-sm",
          tier === "primary"
            ? "bg-slate-900 text-white hover:bg-slate-800"
            : "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
        )}
      >
        {btn.label}
      </Link>
    ) : (
      <p key={btn.id} className="text-center text-[12px] text-slate-600">
        {btn.label}
      </p>
    );
  }

  if (btn.action && onAction) {
    return (
      <Button
        key={btn.id}
        type="button"
        size="sm"
        variant={tier === "secondary" ? "outline" : "default"}
        className={cn(base, tier === "primary" && "bg-slate-900 hover:bg-slate-800")}
        disabled={!canAct || transitioning || btn.disabled}
        onClick={() => onAction(btn.action!)}
      >
        {transitioning ? "Updating…" : btn.label}
      </Button>
    );
  }

  if (btn.kind === "info" || btn.disabled) {
    return (
      <div key={btn.id} className="rounded-md bg-slate-100 px-2 py-1.5 text-center text-[12px] font-semibold text-slate-800">
        {btn.label}
      </div>
    );
  }

  return null;
}

export function procurementKeyForGuidedPhase(phase: string): string {
  switch (phase) {
    case "C_PR_CREATED":
      return "PR_PENDING_PO";
    case "D_PO_GRN_PENDING":
      return "GRN_PENDING";
    case "E_READY_TO_ISSUE":
    case "F_ISSUED_OPEN_PRODUCTION":
      return "RM_READY";
    default:
      return "PROCUREMENT_PENDING";
  }
}
