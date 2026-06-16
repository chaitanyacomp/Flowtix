import * as React from "react";
import { PROCUREMENT_TERMS } from "../../lib/procurementTerminology";
import {
  POST_ISSUE_RM_TABLE_HEADERS,
  POST_ISSUE_RM_TABLE_HELPER_TEXT,
  PRE_ISSUE_RM_TABLE_HEADERS,
  storeHandoffLineStatusLabel,
} from "../../lib/rmControlCenterPostIssueHandoff";
import { rmItemFilterTableHelperText } from "../../lib/storeRmWorkspaceUx";
import { cn } from "../../lib/utils";
import { RmOperationalStageChip } from "./RmOperationalActionsPanel";

export type RmCaseLine = {
  rmItemId: number;
  rmItemName: string;
  unit: string;
  requiredQty: number;
  physicalUsableStockQty?: number;
  activeAllocatedQty?: number;
  freeStockQty: number;
  incomingQty?: number;
  coveredByIncomingQty?: number;
  issuedToProductionQty?: number;
  effectiveReservedQty?: number;
  legacyReservedQty?: number;
  shortageAfterReservationQty: number;
  netShortageAfterIncomingQty: number;
  allocationStatus?: string | null;
  blockerReason: string;
  procurementStatus?: string | null;
  poStatus?: string | null;
  grnReceivedPercent?: number | null;
  coveragePercent?: number | null;
};

type OperationalGuidance = {
  headline: string;
  owner: string;
  nextAction: string;
  variant: "zero_stock" | "shortage" | "info";
};

type Props = {
  salesOrderLabel?: string | null;
  fgLabel?: string | null;
  stageLabel: string;
  allocationFirstLabel?: string | null;
  mrDocNo?: string | null;
  procurementChipLabel?: string | null;
  procurementAnchorLabel?: string | null;
  procurementExecutionWoLabel?: string | null;
  /** @deprecated Use procurementAnchorLabel */
  procurementSourceLabel?: string | null;
  operationalGuidance?: OperationalGuidance | null;
  postIssueHandoff?: boolean;
  rmItemFilterLabel?: string | null;
  rmLines: RmCaseLine[];
  selectedRmItemId: number | null;
  onSelectLine: (line: RmCaseLine) => void;
  formatQty: (v: number | null | undefined, unit?: string | null) => string;
};

function PostIssueRmLinesTable({
  lines,
  selectedRmItemId,
  onSelectLine,
  formatQty,
}: {
  lines: RmCaseLine[];
  selectedRmItemId: number | null;
  onSelectLine: (line: RmCaseLine) => void;
  formatQty: (v: number | null | undefined, unit?: string | null) => string;
}) {
  return (
    <table className="w-full min-w-[36rem]" data-testid="rm-cc-post-issue-lines-table">
      <thead className="sticky top-0 z-[1] bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        <tr>
          {POST_ISSUE_RM_TABLE_HEADERS.map((header, idx) => (
            <th
              key={header}
              className={cn("px-2 py-1.5", idx === 0 ? "text-left" : idx === POST_ISSUE_RM_TABLE_HEADERS.length - 1 ? "text-left" : "text-right")}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="text-[13px] text-slate-600">
        {lines.map((line, idx) => {
          const active = selectedRmItemId === line.rmItemId;
          const statusLabel = storeHandoffLineStatusLabel(line);
          return (
            <tr
              key={line.rmItemId}
              className={cn(
                "cursor-pointer border-t border-slate-100/80 hover:bg-slate-50/80",
                idx % 2 === 1 && !active && "bg-slate-50/40",
                active && "bg-blue-50/90",
              )}
              onClick={() => onSelectLine(line)}
            >
              <td className="max-w-[12rem] truncate px-2 py-2 font-semibold text-slate-900" title={line.rmItemName}>
                {line.rmItemName}
              </td>
              <td className="px-2 py-2 text-right text-[14px] font-semibold tabular-nums text-slate-900">
                {formatQty(line.requiredQty, line.unit)}
              </td>
              <td className="px-2 py-2 text-right text-[14px] font-semibold tabular-nums text-emerald-800">
                {formatQty(line.issuedToProductionQty ?? 0, line.unit)}
              </td>
              <td
                className="px-2 py-2 text-right text-[14px] font-medium tabular-nums text-slate-600"
                title="Free Store stock remaining after issue — not reserved for this WO"
              >
                {formatQty(line.freeStockQty, line.unit)}
              </td>
              <td className="max-w-[11rem] truncate px-2 py-2 text-[11px] font-medium text-emerald-800" title={statusLabel}>
                {statusLabel}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PreIssueRmLinesTable({
  lines,
  selectedRmItemId,
  onSelectLine,
  formatQty,
}: {
  lines: RmCaseLine[];
  selectedRmItemId: number | null;
  onSelectLine: (line: RmCaseLine) => void;
  formatQty: (v: number | null | undefined, unit?: string | null) => string;
}) {
  return (
    <table className="w-full min-w-[32rem]" data-testid="rm-cc-pre-issue-lines-table">
      <thead className="sticky top-0 z-[1] bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        <tr>
          {PRE_ISSUE_RM_TABLE_HEADERS.map((header, idx) => (
            <th
              key={header}
              className={cn("px-2 py-1.5", idx === 0 || idx === PRE_ISSUE_RM_TABLE_HEADERS.length - 1 ? "text-left" : "text-right")}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="text-[13px] text-slate-600">
        {lines.map((line, idx) => {
          const active = selectedRmItemId === line.rmItemId;
          const coverage =
            line.coveragePercent != null && Number.isFinite(line.coveragePercent)
              ? `${line.coveragePercent}%`
              : "—";
          return (
            <tr
              key={line.rmItemId}
              className={cn(
                "cursor-pointer border-t border-slate-100/80 hover:bg-slate-50/80",
                idx % 2 === 1 && !active && "bg-slate-50/40",
                active && "bg-blue-50/90",
              )}
              onClick={() => onSelectLine(line)}
            >
              <td className="max-w-[12rem] truncate px-2 py-2 font-semibold text-slate-900" title={line.rmItemName}>
                {line.rmItemName}
              </td>
              <td className="px-2 py-2 text-right text-[14px] font-bold tabular-nums text-slate-900">
                {formatQty(line.requiredQty, line.unit)}
              </td>
              <td className="px-2 py-2 text-right text-[14px] font-semibold tabular-nums text-emerald-800">
                {formatQty(line.freeStockQty, line.unit)}
              </td>
              <td className="px-2 py-2 text-right text-[14px] font-semibold tabular-nums text-blue-900">
                {formatQty(line.incomingQty ?? 0, line.unit)}
              </td>
              <td className="px-2 py-2 text-right text-[12px] font-bold tabular-nums text-violet-900">{coverage}</td>
              <td className="max-w-[9rem] truncate px-2 py-2 text-[11px] font-medium text-slate-700" title={line.procurementStatus ?? undefined}>
                {line.procurementStatus?.trim() || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function RmControlCenterCasePanel({
  salesOrderLabel,
  fgLabel,
  stageLabel,
  allocationFirstLabel,
  mrDocNo,
  procurementChipLabel,
  procurementAnchorLabel,
  procurementExecutionWoLabel,
  procurementSourceLabel,
  operationalGuidance,
  postIssueHandoff = false,
  rmItemFilterLabel,
  rmLines,
  selectedRmItemId,
  onSelectLine,
  formatQty,
}: Props) {
  const sortedLines = React.useMemo(() => {
    const copy = [...rmLines];
    if (postIssueHandoff) {
      return copy.sort((a, b) => a.rmItemName.localeCompare(b.rmItemName));
    }
    return copy.sort(
      (a, b) => b.shortageAfterReservationQty - a.shortageAfterReservationQty || b.requiredQty - a.requiredQty,
    );
  }, [rmLines, postIssueHandoff]);

  const rmItemFilterHelper = rmItemFilterTableHelperText(rmItemFilterLabel);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-slate-50/90 px-2.5 py-1.5 text-[12px] text-slate-700">
        <span>
          <span className="font-bold uppercase tracking-wide text-slate-500">SO</span>{" "}
          <span className="font-semibold text-slate-900">{salesOrderLabel ?? "—"}</span>
        </span>
        <span>
          <span className="font-bold uppercase tracking-wide text-slate-500">FG</span>{" "}
          <span className="font-semibold text-slate-900">{fgLabel ?? "—"}</span>
        </span>
        <RmOperationalStageChip label={allocationFirstLabel?.trim() || stageLabel} />
        {procurementChipLabel ? (
          <span
            className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-950 ring-1 ring-violet-200"
            data-testid="rm-cc-case-procurement-chip"
          >
            {procurementChipLabel}
          </span>
        ) : null}
        {procurementAnchorLabel ?? procurementSourceLabel ? (
          <span className="text-[11px] text-slate-600">
            <span className="font-bold uppercase tracking-wide text-slate-500">{PROCUREMENT_TERMS.PROCUREMENT_SOURCE_LABEL}</span>{" "}
            <span className="font-semibold text-slate-900">{procurementAnchorLabel ?? procurementSourceLabel}</span>
          </span>
        ) : null}
        {procurementExecutionWoLabel ? (
          <span className="text-[11px] text-slate-600">
            <span className="font-bold uppercase tracking-wide text-slate-500">{PROCUREMENT_TERMS.EXECUTION_LABEL}</span>{" "}
            <span className="font-semibold text-slate-900">{procurementExecutionWoLabel}</span>
          </span>
        ) : null}
        {mrDocNo ? (
          <span>
            <span className="font-bold uppercase tracking-wide text-slate-500">MR</span>{" "}
            <span className="font-semibold tabular-nums text-slate-900">{mrDocNo}</span>
          </span>
        ) : null}
      </div>

      {operationalGuidance ? (
        <section
          className={cn(
            "shrink-0 rounded-lg border px-3 py-2.5 shadow-sm",
            operationalGuidance.variant === "zero_stock"
              ? "border-red-400 bg-red-50"
              : operationalGuidance.variant === "shortage"
                ? "border-amber-400 bg-amber-50"
                : "border-slate-300 bg-slate-50",
          )}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Store guidance</p>
          <h3
            className={cn(
              "mt-0.5 text-[15px] font-bold",
              operationalGuidance.variant === "zero_stock" ? "text-red-950" : "text-slate-950",
            )}
          >
            {operationalGuidance.headline}
          </h3>
          <div className="mt-2 grid gap-1 text-[12px] text-slate-800 sm:grid-cols-2">
            <p>
              <span className="font-bold uppercase tracking-wide text-slate-500">Next owner</span>
              <br />
              <span className="font-semibold">{operationalGuidance.owner}</span>
            </p>
            <p>
              <span className="font-bold uppercase tracking-wide text-slate-500">Next action</span>
              <br />
              <span className="font-semibold">{operationalGuidance.nextAction}</span>
            </p>
          </div>
        </section>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-white ring-1 ring-slate-200/80">
        <div className="shrink-0 bg-slate-50/80 px-2.5 py-1">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">RM lines</h3>
          {rmItemFilterHelper ? (
            <p className="text-[10px] leading-snug text-blue-800">{rmItemFilterHelper}</p>
          ) : null}
          {postIssueHandoff ? (
            <p className="text-[10px] leading-snug text-slate-500">{POST_ISSUE_RM_TABLE_HELPER_TEXT}</p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-x-auto">
          {postIssueHandoff ? (
            <PostIssueRmLinesTable
              lines={sortedLines}
              selectedRmItemId={selectedRmItemId}
              onSelectLine={onSelectLine}
              formatQty={formatQty}
            />
          ) : (
            <PreIssueRmLinesTable
              lines={sortedLines}
              selectedRmItemId={selectedRmItemId}
              onSelectLine={onSelectLine}
              formatQty={formatQty}
            />
          )}
        </div>
      </div>
    </div>
  );
}
