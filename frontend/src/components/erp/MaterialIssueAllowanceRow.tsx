import * as React from "react";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import {
  calculatePlannedAllowance,
  issueStatusPresentation,
} from "../../lib/plannedProcessAllowance";
import {
  blockDecimalSpinnerKeys,
  blockDecimalWheel,
  normalizeDecimalOnBlur,
  sanitizeDecimalInput,
} from "../../lib/keyboardDecimalInput";

export type MaterialIssueAllowanceRowModel = {
  key: string;
  itemName: string;
  unit?: string;
  theoreticalQty: number;
  issuedQty: number;
  trueShortIssueQty: number;
  pendingQty: number;
  availableQty: number | null;
  allowanceQty: string;
  allowanceReason: string;
  issueQty: string;
  disabled: boolean;
  backendStatusLabel?: string | null;
  backendStatusExplanation?: string | null;
  /** RM allowance Admin approval workflow (Store-side). "NONE" when no active/relevant request. */
  approvalStatus?: "NONE" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  approvalRejectionReason?: string | null;
};

/** Shared 4-column desktop tracks for both rows. */
const DESKTOP_COLS =
  "md:grid-cols-[minmax(8.5rem,1.2fr)_minmax(7.5rem,1fr)_minmax(7.5rem,1fr)_minmax(9.5rem,1.25fr)]";

function qty(value: number, unit?: string): string {
  const n = Number.isFinite(value) ? value : 0;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function FieldLabel({
  children,
  title,
  align = "left",
}: {
  children: React.ReactNode;
  title?: string;
  align?: "left" | "right";
}) {
  return (
    <span
      className={cn(
        "block h-4 truncate text-xs font-medium leading-4 text-slate-500",
        align === "right" && "text-right",
      )}
      title={title}
    >
      {children}
    </span>
  );
}

function InfoValue({
  children,
  align = "right",
  title,
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 items-center text-sm tabular-nums text-slate-900",
        align === "right" ? "justify-end text-right" : "justify-start text-left",
        className,
      )}
      title={title}
    >
      <span className="truncate">{children}</span>
    </div>
  );
}

function KeyboardDecimalInput({
  value,
  unit,
  onChange,
  onBlurNormalize,
  disabled,
  ariaLabel,
  variant = "default",
}: {
  value: string;
  unit?: string;
  onChange: (value: string) => void;
  onBlurNormalize?: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  variant?: "default" | "prominent";
}) {
  return (
    <div className="relative w-full max-w-[8.5rem]">
      <Input
        type="text"
        inputMode="decimal"
        pattern="[0-9]*[.]?[0-9]*"
        autoComplete="off"
        className={cn(
          "h-9 w-full rounded-md border bg-white px-2.5 text-right text-sm tabular-nums shadow-sm",
          "focus-visible:ring-2 focus-visible:ring-offset-1",
          unit && "pr-9",
          variant === "default" &&
            "border-slate-300 focus-visible:border-slate-400 focus-visible:ring-slate-300",
          variant === "prominent" &&
            "border-sky-300 font-semibold text-slate-950 focus-visible:border-sky-400 focus-visible:ring-sky-200",
          disabled && "bg-slate-50 text-slate-500 shadow-none",
        )}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => {
          const next = sanitizeDecimalInput(event.target.value);
          if (next == null) return;
          onChange(next);
        }}
        onBlur={() => {
          if (!onBlurNormalize) return;
          onBlurNormalize(normalizeDecimalOnBlur(value));
        }}
        onKeyDown={blockDecimalSpinnerKeys}
        onWheel={(event) => {
          blockDecimalWheel(event);
          (event.currentTarget as HTMLInputElement).blur();
        }}
      />
      {unit ? (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
          {unit}
        </span>
      ) : null}
    </div>
  );
}

export function MaterialIssueAllowanceRow({
  row,
  actorRole,
  onExtraQtyChange,
  onIssueQtyChange,
  onReasonChange,
}: {
  row: MaterialIssueAllowanceRowModel;
  actorRole?: string | null;
  onExtraQtyChange: (value: string) => void;
  onIssueQtyChange: (value: string) => void;
  onReasonChange: (value: string) => void;
}) {
  const calculation = calculatePlannedAllowance({
    theoreticalQty: row.theoreticalQty,
    quantityRaw: row.allowanceQty,
    alreadyIssuedQty: row.issuedQty,
  });
  const status = issueStatusPresentation({
    calculation,
    availableQty: row.availableQty,
    issueQty: Number(row.issueQty || 0),
    reason: row.allowanceReason,
    actorRole,
  });
  const approvalStatus = row.approvalStatus ?? "NONE";
  // Pending: full snapshot locked. Approved: Add Qty/reason locked; Issue Now may be reduced ≤ approved.
  const addQtyLocked = approvalStatus === "PENDING_APPROVAL" || approvalStatus === "APPROVED";
  const issueNowLocked = approvalStatus === "PENDING_APPROVAL";
  let issueLabel = status.issueLabel;
  let issueMessage = status.issueMessage;
  let tone = status.tone;
  if (approvalStatus === "PENDING_APPROVAL") {
    issueLabel = "Awaiting Admin Approval";
    issueMessage = "Sent to Admin for review — this line is locked until it is decided.";
    tone = "warning";
  } else if (approvalStatus === "APPROVED") {
    issueLabel = "Approved by Admin";
    issueMessage = "Admin approved this allowance — ready to issue.";
    tone = "ready";
  } else if (approvalStatus === "REJECTED") {
    issueLabel = "Rejected by Admin";
    issueMessage = row.approvalRejectionReason
      ? `Rejected: ${row.approvalRejectionReason}`
      : "Revise Add Qty or reason and resubmit for approval.";
    tone = "danger";
  }
  const expanded = Boolean(
    calculation.requiresReason ||
      calculation.blocked ||
      (!calculation.valid && calculation.error) ||
      tone === "danger",
  );
  const allowancePctLabel = calculation.valid
    ? `${calculation.calculatedPct.toFixed(2)}%`
    : "—";
  /** Original/total BOM requirement for the line — never the remaining balance. */
  const bomQty = Number.isFinite(row.theoreticalQty) ? row.theoreticalQty : 0;
  const remainingQty = calculation.valid
    ? Math.max(0, calculation.applicableBomQty)
    : Math.max(0, bomQty - Math.max(0, Number(row.issuedQty) || 0));

  const stockBadgeClass = cn(
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold leading-4",
    status.stockTone === "ready" && "bg-emerald-100 text-emerald-800",
    status.stockTone === "warning" && "bg-amber-100 text-amber-900",
  );
  const issueToneClass = cn(
    "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-semibold leading-4",
    tone === "ready" && "bg-emerald-100 text-emerald-800",
    tone === "warning" && "bg-amber-100 text-amber-900",
    tone === "danger" && "bg-red-100 text-red-800",
  );

  return (
    <article
      className={cn(
        "min-w-0 rounded-lg border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm",
        expanded && "border-amber-200/90 bg-amber-50/20",
      )}
      data-testid="material-issue-allowance-row"
      data-expanded={expanded ? "true" : "false"}
    >
      {/*
        Row 1: RM Item | Qty (BOM original) | Already Issued | Remaining
        Row 2: Add Qty | Allowance % | Issue Now | Available Qty + Ready/Short
        Footer: Issue Status
      */}
      <div className={cn("grid min-w-0 grid-cols-2 gap-x-3 gap-y-2", DESKTOP_COLS)}>
        <div className="min-w-0">
          <FieldLabel>RM Item</FieldLabel>
          <div
            className="flex h-9 items-center text-sm font-semibold leading-5 text-slate-950"
            title={row.itemName}
          >
            <span className="truncate">{row.itemName}</span>
          </div>
        </div>

        <div className="min-w-0">
          <FieldLabel
            align="right"
            title="Original BOM requirement for this RM line (runner already included). Not the remaining balance."
          >
            Qty (BOM)
          </FieldLabel>
          <InfoValue>{qty(bomQty, row.unit)}</InfoValue>
        </div>

        <div className="min-w-0">
          <FieldLabel align="right" title="Cumulative quantity issued against this PMR line">
            Already Issued
          </FieldLabel>
          <InfoValue>{qty(row.issuedQty, row.unit)}</InfoValue>
        </div>

        <div className="min-w-0">
          <FieldLabel
            align="right"
            title="Unissued balance for this line (original BOM minus already issued, less any short-closed qty)"
          >
            Remaining
          </FieldLabel>
          <div data-testid="material-issue-remaining-qty">
            <InfoValue>{qty(remainingQty, row.unit)}</InfoValue>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mt-2 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2",
          DESKTOP_COLS,
        )}
      >
        <label className="min-w-0">
          <FieldLabel title="Extra material for process wastage (only editable allowance field)">
            Add Qty
          </FieldLabel>
          <div className="flex h-9 items-center">
            <KeyboardDecimalInput
              value={row.allowanceQty}
              unit={row.unit}
              onChange={onExtraQtyChange}
              onBlurNormalize={onExtraQtyChange}
              ariaLabel={`Add Qty for ${row.itemName}`}
              disabled={row.disabled || addQtyLocked}
              variant="default"
            />
          </div>
        </label>

        <div className="min-w-0">
          <FieldLabel
            align="right"
            title="Add Qty ÷ remaining BOM entitlement × 100 — read-only; remaining balance is not itself an allowance"
          >
            Allowance %
          </FieldLabel>
          <div
            className="flex h-9 items-center justify-end"
            aria-label={`Allowance % for ${row.itemName}`}
            data-testid="extra-allowance-pct"
          >
            <span className="text-sm font-medium tabular-nums text-slate-700">{allowancePctLabel}</span>
          </div>
        </div>

        <label className="min-w-0">
          <FieldLabel align="right">Issue Now</FieldLabel>
          <div className="flex h-9 items-center justify-end">
            <KeyboardDecimalInput
              value={row.issueQty}
              unit={row.unit}
              onChange={onIssueQtyChange}
              onBlurNormalize={onIssueQtyChange}
              disabled={row.disabled || issueNowLocked}
              ariaLabel={`Issue Now for ${row.itemName}`}
              variant="prominent"
            />
          </div>
        </label>

        <div className="min-w-0">
          <FieldLabel align="right">Available Qty</FieldLabel>
          <div className="flex h-9 items-center justify-end gap-2">
            <span className="text-sm tabular-nums text-slate-900">
              {row.availableQty == null ? "—" : qty(row.availableQty, row.unit)}
            </span>
            <span className={stockBadgeClass} data-testid="stock-readiness-badge">
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  status.stockTone === "ready" ? "bg-emerald-600" : "bg-amber-600",
                )}
                aria-hidden
              />
              {status.stockBadge}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-slate-100 pt-2">
        <FieldLabel>Issue Status</FieldLabel>
        <span className={issueToneClass} title={issueMessage} data-testid="material-issue-status-pill">
          {tone === "ready" ? "✓ " : ""}
          {issueLabel}
        </span>
      </div>

      {calculation.requiresReason ? (
        <div className="mt-2.5 grid min-w-0 gap-2 border-t border-amber-200/80 pt-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <Input
            className="h-9 min-w-0 rounded-md border-amber-200 bg-white text-sm shadow-sm"
            placeholder="Reason required for allowance above 5%"
            value={row.allowanceReason}
            onChange={(event) => onReasonChange(event.target.value)}
            disabled={row.disabled || addQtyLocked}
            aria-label={`Allowance reason for ${row.itemName}`}
          />
          <span className="text-xs font-medium text-amber-900">Admin approval required above 5%.</span>
        </div>
      ) : null}
    </article>
  );
}
