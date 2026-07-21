import * as React from "react";
import { Input } from "../ui/input";
import { DecimalInput } from "../ui/DecimalInput";
import { cn } from "../../lib/utils";
import { calculatePlannedAllowance } from "../../lib/plannedProcessAllowance";
import {
  MATERIAL_ISSUE_RM_TABLE_HEADER_CLASS,
  MATERIAL_ISSUE_RM_TABLE_ROW_CLASS,
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
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  title?: string;
}) {
  return (
    <span
      className={cn("truncate", align === "right" && "text-right")}
      title={title}
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
        "inline-flex max-w-full items-center justify-end rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
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
  const calculation = calculatePlannedAllowance({
    theoreticalQty: row.theoreticalQty,
    quantityRaw: row.allowanceQty,
    alreadyIssuedQty: row.issuedQty,
  });
  const approvalStatus = row.approvalStatus ?? "NONE";
  const addQtyLocked = approvalStatus === "PENDING_APPROVAL" || approvalStatus === "APPROVED";
  const issueNowLocked = approvalStatus === "PENDING_APPROVAL";
  const bomQty = Number.isFinite(row.theoreticalQty) ? row.theoreticalQty : 0;
  const remainingQty = calculation.valid
    ? Math.max(0, calculation.applicableBomQty)
    : Math.max(0, bomQty - Math.max(0, Number(row.issuedQty) || 0));
  const allowancePctLabel = calculation.valid
    ? `${calculation.calculatedPct.toFixed(2)}%`
    : "—";
  const compactStatus = resolveCompactLineStatus({
    calculation,
    availableQty: row.availableQty,
    issueQty: row.issueQty,
    allowanceReason: row.allowanceReason,
    actorRole,
    approvalStatus,
    approvalRejectionReason: row.approvalRejectionReason,
    pendingQty: row.pendingQty,
    stillRequiredQty: row.stillRequiredQty ?? row.issueCapQty,
    maxAllowedIssueQty: row.maxAllowedIssueQty,
  });
  const showReason =
    calculation.requiresReason &&
    approvalStatus !== "PENDING_APPROVAL" &&
    approvalStatus !== "APPROVED";

  return (
    <div data-testid="material-issue-allowance-row" data-expanded={showReason ? "true" : "false"}>
      <div className={MATERIAL_ISSUE_RM_TABLE_ROW_CLASS}>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <span
            className="block truncate text-sm font-semibold text-slate-950"
            title={row.itemName}
          >
            {row.itemName}
          </span>
        </div>

        <div className="hidden sm:block">
          <NumericCell title="Original BOM requirement">{qty(bomQty, row.unit)}</NumericCell>
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

        <div className="col-span-2 flex justify-end sm:col-span-1">
          <StatusBadge
            label={compactStatus.label}
            tone={compactStatus.tone}
            detail={compactStatus.detail}
          />
        </div>

        {/* Narrow-width second line: BOM / issued / remaining / stock */}
        <div className="col-span-2 grid grid-cols-2 gap-x-2 text-[11px] text-slate-600 sm:hidden">
          <span className="truncate">
            BOM {qty(bomQty, row.unit)}
          </span>
          <span className="truncate text-right">
            Issued {qty(row.issuedQty, row.unit)}
          </span>
          <span className="truncate">
            Remaining {qty(remainingQty, row.unit)}
          </span>
          <span className="truncate text-right">
            Stock {row.availableQty == null ? "—" : qty(row.availableQty, row.unit)}
          </span>
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
  return (
    <div
      className={cn("flex min-h-0 min-w-0 flex-col rounded border border-slate-200 bg-white", className)}
      data-testid="material-issue-compact-grid"
    >
      <div className={cn(MATERIAL_ISSUE_RM_TABLE_HEADER_CLASS, "shrink-0")}>
        <HeaderCell>RM Item</HeaderCell>
        <HeaderCell align="right" title="Original BOM requirement">
          BOM Qty
        </HeaderCell>
        <HeaderCell align="right">Already Issued</HeaderCell>
        <HeaderCell align="right">Remaining</HeaderCell>
        <HeaderCell align="right">Add Qty</HeaderCell>
        <HeaderCell align="right">Allowance %</HeaderCell>
        <HeaderCell align="right">Issue Now</HeaderCell>
        <HeaderCell align="right">Available Stock</HeaderCell>
        <HeaderCell align="right">Status</HeaderCell>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="material-issue-rm-table-body"
      >
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
    </div>
  );
}
