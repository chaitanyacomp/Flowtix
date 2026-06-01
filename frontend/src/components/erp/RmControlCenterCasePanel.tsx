import * as React from "react";
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
  rmItemLabel?: string | null;
  stageLabel: string;
  allocationFirstLabel?: string | null;
  mrDocNo?: string | null;
  operationalGuidance?: OperationalGuidance | null;
  rmLines: RmCaseLine[];
  selectedRmItemId: number | null;
  onSelectLine: (line: RmCaseLine) => void;
  formatQty: (v: number | null | undefined, unit?: string | null) => string;
};

export function RmControlCenterCasePanel({
  salesOrderLabel,
  fgLabel,
  rmItemLabel,
  stageLabel,
  allocationFirstLabel,
  mrDocNo,
  operationalGuidance,
  rmLines,
  selectedRmItemId,
  onSelectLine,
  formatQty,
}: Props) {
  const selected =
    rmLines.find((l) => l.rmItemId === selectedRmItemId) ??
    [...rmLines].sort((a, b) => b.shortageAfterReservationQty - a.shortageAfterReservationQty)[0] ??
    null;

  const sortedLines = React.useMemo(
    () =>
      [...rmLines].sort(
        (a, b) => b.shortageAfterReservationQty - a.shortageAfterReservationQty || b.requiredQty - a.requiredQty,
      ),
    [rmLines],
  );

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
        <span>
          <span className="font-bold uppercase tracking-wide text-slate-500">RM</span>{" "}
          <span className="font-semibold text-slate-900">{rmItemLabel ?? selected?.rmItemName ?? "—"}</span>
        </span>
        <RmOperationalStageChip label={allocationFirstLabel?.trim() || stageLabel} />
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
        </div>
        <div className="min-h-0 flex-1 overflow-x-auto">
          <table className="w-full min-w-[32rem]">
            <thead className="sticky top-0 z-[1] bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left">RM item</th>
                <th className="px-2 py-1.5 text-right">Need</th>
                <th className="px-2 py-1.5 text-right">Available</th>
                <th className="px-2 py-1.5 text-right">Allocated</th>
                <th className="px-2 py-1.5 text-right">Issue ready</th>
              </tr>
            </thead>
            <tbody className="text-[13px] text-slate-600">
              {sortedLines.map((line, idx) => {
                const active = selectedRmItemId === line.rmItemId;
                const need = Number(line.requiredQty ?? 0);
                const available = Number(line.freeStockQty ?? 0);
                const allocated = Number(line.activeAllocatedQty ?? 0);
                const issueReady = need > 0 && available + allocated >= need - 1e-6;
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
                    <td className="px-2 py-2 text-right text-[14px] font-semibold tabular-nums text-violet-900">
                      {formatQty(line.activeAllocatedQty ?? 0, line.unit)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2 text-right text-[12px] font-bold tabular-nums",
                        issueReady ? "text-emerald-800" : "text-slate-500",
                      )}
                    >
                      {issueReady ? "YES" : "NO"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
