import * as React from "react";
import { Input } from "../ui/input";
import { DecimalInput } from "../ui/DecimalInput";
import { cn } from "../../lib/utils";
import { calculatePlannedAllowance } from "../../lib/plannedProcessAllowance";
import {
  formatKgRoundingRuleLabel,
  KG_ROUNDING_RULE_TOOLTIP,
} from "../../lib/rmIssueRounding";
import {
  MATERIAL_ISSUE_RM_TABLE_HEADER_CLASS,
  MATERIAL_ISSUE_RM_TABLE_HEADER_CLASS_KG,
  MATERIAL_ISSUE_RM_TABLE_ROW_CLASS,
  MATERIAL_ISSUE_RM_TABLE_ROW_CLASS_KG,
  MATERIAL_ISSUE_RM_CARD_CLASS_KG,
  resolveCompactLineStatus,
} from "../../lib/materialIssueRmTableUx";

export type MaterialIssueAllowanceRowModel = {
  key: string;
  itemName: string;
  unit?: string;
  theoreticalQty: number;
  issuedQty: number;
  trueShortIssueQty: number;
  pendingQty: number;
  stillRequiredQty?: number;
  issueCapQty?: number;
  maxAllowedIssueQty?: number;
  availableQty: number | null;
  allowanceQty: string;
  allowanceReason: string;
  issueQty: string;
  disabled: boolean;
  backendStatusLabel?: string | null;
  backendStatusExplanation?: string | null;
  approvalStatus?: "NONE" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  approvalRejectionReason?: string | null;
  /** Kg upward rounding (hides Add Qty / Allowance %). */
  kgIssueRoundingApplies?: boolean;
  /** Technical increment — not shown as raw "1 Kg" in Kg UI. */
  issueIncrement?: number | null;
  plannedRequiredQty?: number | null;
  roundedIssueTargetQty?: number | null;
  roundingExcessQty?: number | null;
};

function qty(value: number, unit?: string): string {
  const n = Number.isFinite(value) ? value : 0;
  const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function HeaderCell({
  children,
  align = "left",
  title,
  noEllipsis = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  title?: string;
  noEllipsis?: boolean;
}) {
  return (
    <span
      className={cn(
        "block",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        noEllipsis ? "whitespace-nowrap" : "truncate",
      )}
      title={title ?? (typeof children === "string" ? children : undefined)}
    >
      {children}
    </span>
  );
}

function NumericCell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      className="block truncate text-right text-sm tabular-nums text-slate-900"
      title={title}
    >
      {children}
    </span>
  );
}

function CenterCell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="block truncate text-center text-sm text-slate-900" title={title}>
      {children}
    </span>
  );
}

function StatusBadge({
  label,
  tone,
  detail,
}: {
  label: string;
  tone: "ready" | "warning" | "danger";
  detail: string | null;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
        tone === "ready" && "bg-emerald-100 text-emerald-800",
        tone === "warning" && "bg-amber-100 text-amber-900",
        tone === "danger" && "bg-red-100 text-red-800",
      )}
      title={detail ?? undefined}
      data-testid="material-issue-status-pill"
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function MetricChip({
  label,
  value,
  align = "left",
}: {
  label: string;
  value: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide text-slate-500",
          align === "right" && "text-right",
          align === "center" && "text-center",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "truncate text-sm text-slate-900",
          align === "right" && "text-right tabular-nums",
          align === "center" && "text-center",
          align === "left" && "tabular-nums",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function MaterialIssueRmTableRow({
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
  const kgMode = Boolean(row.kgIssueRoundingApplies);
  const calculation = calculatePlannedAllowance({
    theoreticalQty: row.theoreticalQty,
    quantityRaw: kgMode ? "0" : row.allowanceQty,
    alreadyIssuedQty: row.issuedQty,
  });
  const approvalStatus = row.approvalStatus ?? "NONE";
  const addQtyLocked = approvalStatus === "PENDING_APPROVAL" || approvalStatus === "APPROVED";
  const issueNowLocked = approvalStatus === "PENDING_APPROVAL";
  const plannedQty = Number.isFinite(row.plannedRequiredQty ?? row.theoreticalQty)
    ? Number(row.plannedRequiredQty ?? row.theoreticalQty)
    : 0;
  const remainingQty = kgMode
    ? Math.max(0, Number(row.pendingQty) || 0)
    : calculation.valid
      ? Math.max(0, calculation.applicableBomQty)
      : Math.max(0, plannedQty - Math.max(0, Number(row.issuedQty) || 0));
  const allowancePctLabel = calculation.valid
    ? `${calculation.calculatedPct.toFixed(2)}%`
    : "—";
  const compactStatus = resolveCompactLineStatus({
    calculation: kgMode
      ? {
          ...calculation,
          requiresReason: false,
          requiresAdminApproval: false,
          blocked: false,
          calculatedPct: 0,
          calculatedQty: 0,
          recommendedIssueQty: remainingQty,
          defaultIssueNowQty: remainingQty,
        }
      : calculation,
    availableQty: row.availableQty,
    issueQty: row.issueQty,
    allowanceReason: row.allowanceReason,
    actorRole,
    approvalStatus: kgMode ? "NONE" : approvalStatus,
    approvalRejectionReason: row.approvalRejectionReason,
    pendingQty: row.pendingQty,
    stillRequiredQty: row.stillRequiredQty ?? row.issueCapQty,
    maxAllowedIssueQty: row.maxAllowedIssueQty,
  });
  const showReason =
    !kgMode &&
    calculation.requiresReason &&
    approvalStatus !== "PENDING_APPROVAL" &&
    approvalStatus !== "APPROVED";
  const roundingRuleLabel = formatKgRoundingRuleLabel(row.issueIncrement);

  if (kgMode) {
    const availableLabel = row.availableQty == null ? "—" : qty(row.availableQty, row.unit);
    return (
      <div data-testid="material-issue-allowance-row" data-expanded="false" data-kg-rounding="true">
        <div className={MATERIAL_ISSUE_RM_TABLE_ROW_CLASS_KG}>
          <div className="min-w-0 text-left">
            <span className="block truncate text-sm font-semibold text-slate-950" title={row.itemName}>
              {row.itemName}
            </span>
          </div>
          <NumericCell title="Planned Requirement">{qty(plannedQty, row.unit)}</NumericCell>
          <div data-testid="material-issue-rounding-rule" className="min-w-0">
            <CenterCell title={KG_ROUNDING_RULE_TOOLTIP}>{roundingRuleLabel}</CenterCell>
          </div>
          <div data-testid="material-issue-rounded-target">
            <NumericCell title="Issue Target">{qty(Number(row.roundedIssueTargetQty ?? 0), row.unit)}</NumericCell>
          </div>
          <NumericCell title="Already Issued">{qty(row.issuedQty, row.unit)}</NumericCell>
          <div data-testid="material-issue-remaining-qty">
            <NumericCell title="Remaining">{qty(remainingQty, row.unit)}</NumericCell>
          </div>
          <div data-testid="material-issue-rounding-excess">
            <NumericCell title="Rounding Excess">{qty(Number(row.roundingExcessQty ?? 0), row.unit)}</NumericCell>
          </div>
          <div className="justify-self-stretch">
            <DecimalInput
              value={row.issueQty}
              unit={row.unit}
              onValueChange={onIssueQtyChange}
              disabled={row.disabled || issueNowLocked}
              aria-label={`Issue Now for ${row.itemName}`}
              className="h-8 w-full min-w-0 border-sky-300 text-right text-sm font-semibold tabular-nums focus-visible:border-sky-400 focus-visible:ring-sky-200"
              wrapperClassName="w-full max-w-none"
            />
          </div>
          <NumericCell title="Available">{availableLabel}</NumericCell>
          <div className="flex justify-center">
            <StatusBadge
              label={compactStatus.label}
              tone={compactStatus.tone}
              detail={compactStatus.detail}
            />
          </div>
        </div>

        <div className={MATERIAL_ISSUE_RM_CARD_CLASS_KG} data-testid="material-issue-kg-card">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-left text-sm font-semibold text-slate-950" title={row.itemName}>
              {row.itemName}
            </span>
            <StatusBadge
              label={compactStatus.label}
              tone={compactStatus.tone}
              detail={compactStatus.detail}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricChip label="Planned Requirement" value={qty(plannedQty, row.unit)} align="right" />
            <MetricChip
              label="Rounding Rule"
              value={roundingRuleLabel}
              align="center"
            />
            <MetricChip
              label="Issue Target"
              value={qty(Number(row.roundedIssueTargetQty ?? 0), row.unit)}
              align="right"
            />
            <MetricChip label="Already Issued" value={qty(row.issuedQty, row.unit)} align="right" />
            <MetricChip label="Remaining" value={qty(remainingQty, row.unit)} align="right" />
            <MetricChip
              label="Rounding Excess"
              value={qty(Number(row.roundingExcessQty ?? 0), row.unit)}
              align="right"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <div className="mb-0.5 text-right text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Issue Now
              </div>
              <DecimalInput
                value={row.issueQty}
                unit={row.unit}
                onValueChange={onIssueQtyChange}
                disabled={row.disabled || issueNowLocked}
                aria-label={`Issue Now for ${row.itemName}`}
                className="h-8 min-w-0 border-sky-300 text-right text-sm font-semibold tabular-nums focus-visible:border-sky-400 focus-visible:ring-sky-200"
              />
            </div>
            <MetricChip label="Available" value={availableLabel} align="right" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="material-issue-allowance-row" data-expanded={showReason ? "true" : "false"} data-kg-rounding="false">
      <div className={MATERIAL_ISSUE_RM_TABLE_ROW_CLASS}>
        <div className="col-span-2 min-w-0 text-left sm:col-span-1">
          <span
            className="block truncate text-sm font-semibold text-slate-950"
            title={row.itemName}
          >
            {row.itemName}
          </span>
        </div>

        <div className="hidden sm:block">
          <NumericCell title="Original BOM requirement">{qty(plannedQty, row.unit)}</NumericCell>
        </div>
        <div className="hidden sm:block">
          <NumericCell>{qty(row.issuedQty, row.unit)}</NumericCell>
        </div>
        <div className="hidden sm:block" data-testid="material-issue-remaining-qty">
          <NumericCell>{qty(remainingQty, row.unit)}</NumericCell>
        </div>
        <div className="min-w-0 sm:justify-self-end">
          <span className="mb-0.5 block text-[10px] font-medium text-slate-500 sm:hidden">Add Qty</span>
          <DecimalInput
            value={row.allowanceQty}
            unit={row.unit}
            onValueChange={onExtraQtyChange}
            disabled={row.disabled || addQtyLocked}
            aria-label={`Add Qty for ${row.itemName}`}
            className="h-8 min-w-0 text-right text-sm tabular-nums"
            wrapperClassName="max-w-[5.5rem] sm:max-w-none"
          />
        </div>
        <div className="text-right sm:block" data-testid="extra-allowance-pct">
          <span className="mb-0.5 block text-[10px] font-medium text-slate-500 sm:hidden">Allowance %</span>
          <span className="text-sm font-medium tabular-nums text-slate-700">{allowancePctLabel}</span>
        </div>

        <div className="min-w-0 sm:justify-self-end">
          <span className="mb-0.5 block text-[10px] font-medium text-slate-500 sm:hidden">Issue Now</span>
          <DecimalInput
            value={row.issueQty}
            unit={row.unit}
            onValueChange={onIssueQtyChange}
            disabled={row.disabled || issueNowLocked}
            aria-label={`Issue Now for ${row.itemName}`}
            className="h-8 min-w-0 border-sky-300 text-right text-sm font-semibold tabular-nums focus-visible:border-sky-400 focus-visible:ring-sky-200"
            wrapperClassName="max-w-[5.5rem] sm:max-w-none"
          />
        </div>

        <div className="hidden sm:block">
          <NumericCell>
            {row.availableQty == null ? "—" : qty(row.availableQty, row.unit)}
          </NumericCell>
        </div>

        <div className="col-span-2 flex justify-center sm:col-span-1">
          <StatusBadge
            label={compactStatus.label}
            tone={compactStatus.tone}
            detail={compactStatus.detail}
          />
        </div>
      </div>

      {showReason ? (
        <div className="grid gap-2 border-b border-amber-100 bg-amber-50/40 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <Input
            className="h-8 min-w-0 border-amber-200 bg-white text-sm"
            placeholder="Reason required for allowance above 5%"
            value={row.allowanceReason}
            onChange={(event) => onReasonChange(event.target.value)}
            disabled={row.disabled || addQtyLocked}
            aria-label={`Allowance reason for ${row.itemName}`}
          />
          <span className="text-xs font-medium text-amber-900">Admin approval required above 5%.</span>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated Use MaterialIssueRmTable — kept for dev preview imports. */
export const MaterialIssueAllowanceRow = MaterialIssueRmTableRow;

function MaterialIssueRmTableSection({
  rows,
  kgLayout,
  actorRole,
  onExtraQtyChange,
  onIssueQtyChange,
  onReasonChange,
}: {
  rows: MaterialIssueAllowanceRowModel[];
  kgLayout: boolean;
  actorRole?: string | null;
  onExtraQtyChange: (lineKey: string, value: string) => void;
  onIssueQtyChange: (lineKey: string, value: string) => void;
  onReasonChange: (lineKey: string, value: string) => void;
}) {
  if (!rows.length) return null;
  return (
    <div data-kg-rounding-section={kgLayout ? "true" : "false"}>
      {kgLayout ? (
        <div className={cn(MATERIAL_ISSUE_RM_TABLE_HEADER_CLASS_KG, "shrink-0")}>
          <HeaderCell align="left" noEllipsis>
            RM Item
          </HeaderCell>
          <HeaderCell align="right" title="Planned requirement" noEllipsis>
            Planned Requirement
          </HeaderCell>
          <HeaderCell align="center" title={KG_ROUNDING_RULE_TOOLTIP} noEllipsis>
            Rounding Rule
          </HeaderCell>
          <HeaderCell align="right" title="Rounded issue target" noEllipsis>
            Issue Target
          </HeaderCell>
          <HeaderCell align="right" title="Already issued" noEllipsis>
            Already Issued
          </HeaderCell>
          <HeaderCell align="right" title="Remaining to issue" noEllipsis>
            Remaining
          </HeaderCell>
          <HeaderCell align="right" title="Rounding excess" noEllipsis>
            Rounding Excess
          </HeaderCell>
          <HeaderCell align="right" title="Issue now" noEllipsis>
            Issue Now
          </HeaderCell>
          <HeaderCell align="right" title="Available stock" noEllipsis>
            Available
          </HeaderCell>
          <HeaderCell align="center" noEllipsis>
            Status
          </HeaderCell>
        </div>
      ) : (
        <div className={cn(MATERIAL_ISSUE_RM_TABLE_HEADER_CLASS, "shrink-0")}>
          <HeaderCell align="left">RM Item</HeaderCell>
          <HeaderCell align="right" title="Planned requirement">
            BOM Qty
          </HeaderCell>
          <HeaderCell align="right">Already Issued</HeaderCell>
          <HeaderCell align="right">Remaining</HeaderCell>
          <HeaderCell align="right">Add Qty</HeaderCell>
          <HeaderCell align="right">Allowance %</HeaderCell>
          <HeaderCell align="right">Issue Now</HeaderCell>
          <HeaderCell align="right">Available Stock</HeaderCell>
          <HeaderCell align="center">Status</HeaderCell>
        </div>
      )}
      {rows.map((row) => (
        <MaterialIssueRmTableRow
          key={row.key}
          row={row}
          actorRole={actorRole}
          onExtraQtyChange={(value) => onExtraQtyChange(row.key, value)}
          onIssueQtyChange={(value) => onIssueQtyChange(row.key, value)}
          onReasonChange={(value) => onReasonChange(row.key, value)}
        />
      ))}
    </div>
  );
}

export function MaterialIssueRmTable({
  rows,
  actorRole,
  onExtraQtyChange,
  onIssueQtyChange,
  onReasonChange,
  className,
}: {
  rows: MaterialIssueAllowanceRowModel[];
  actorRole?: string | null;
  onExtraQtyChange: (lineKey: string, value: string) => void;
  onIssueQtyChange: (lineKey: string, value: string) => void;
  onReasonChange: (lineKey: string, value: string) => void;
  className?: string;
}) {
  const kgRows = rows.filter((r) => r.kgIssueRoundingApplies);
  const otherRows = rows.filter((r) => !r.kgIssueRoundingApplies);
  const anyKg = kgRows.length > 0;
  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-col rounded border border-slate-200 bg-white", className)}
      data-testid="material-issue-compact-grid"
      data-kg-rounding-table={anyKg ? "true" : "false"}
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="material-issue-rm-table-body"
      >
        <MaterialIssueRmTableSection
          rows={kgRows}
          kgLayout
          actorRole={actorRole}
          onExtraQtyChange={onExtraQtyChange}
          onIssueQtyChange={onIssueQtyChange}
          onReasonChange={onReasonChange}
        />
        <MaterialIssueRmTableSection
          rows={otherRows}
          kgLayout={false}
          actorRole={actorRole}
          onExtraQtyChange={onExtraQtyChange}
          onIssueQtyChange={onIssueQtyChange}
          onReasonChange={onReasonChange}
        />
      </div>
    </div>
  );
}
