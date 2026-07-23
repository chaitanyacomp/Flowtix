import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { DecimalInput } from "../../ui/DecimalInput";
import { cn } from "../../../lib/utils";
import type { WastageDetailDraft } from "../../../lib/productionWastageClassification";
import {
  computeWastageClassificationBalance,
  fmtWastageQty,
  remainingWastageAfterRow,
  resolveLiveWastageValidationMessage,
  suggestNextWastageTypeId,
  suggestWastageQtyForTypeSelection,
} from "../../../lib/productionWastageClassification";
import type { WastageTypeRow } from "../../../lib/wastageTypeApi";

type Props = {
  rmLines: Array<{ itemId: number; itemName: string; unit: string }>;
  wastageTypes: WastageTypeRow[];
  rows: WastageDetailDraft[];
  totalWastageQty: number;
  unit?: string;
  readOnly?: boolean;
  compact?: boolean;
  /** When true, validation feedback is rendered by the parent header readiness (compact report panel). */
  hideInlineValidation?: boolean;
  /** When true, wastage rows scroll inside a compact bounded region (header Confirm stays visible). */
  scrollableRows?: boolean;
  /** When true with scrollableRows, wastage fills remaining middle-zone height. */
  fillAvailableHeight?: boolean;
  validationMessage?: string | null;
  onChange: (rows: WastageDetailDraft[]) => void;
};

function newRowKey() {
  return `wd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ProductionReportWastageDetails({
  rmLines,
  wastageTypes,
  rows,
  totalWastageQty,
  unit = "Kg",
  readOnly = false,
  compact = false,
  hideInlineValidation = false,
  scrollableRows = false,
  fillAvailableHeight = false,
  validationMessage = null,
  onChange,
}: Props) {
  const balance = React.useMemo(
    () => computeWastageClassificationBalance(totalWastageQty, rows),
    [rows, totalWastageQty],
  );
  const liveMessage = React.useMemo(
    () => validationMessage ?? resolveLiveWastageValidationMessage(balance, rows, unit),
    [balance, rows, unit, validationMessage],
  );

  const canAddWastageReason =
    !readOnly && balance.status !== "complete" && balance.remainingQty > 1e-6;

  const addRow = React.useCallback(() => {
    if (!(balance.remainingQty > 1e-6) || balance.status === "complete") return;
    const nextTypeId = suggestNextWastageTypeId(wastageTypes, rows);
    const key = newRowKey();
    const remaining = Math.max(0, balance.remainingQty);
    const qty =
      suggestWastageQtyForTypeSelection(totalWastageQty, rows, key, "", unit) ??
      fmtWastageQty(remaining, unit);
    onChange([
      ...rows,
      {
        key,
        itemId: rmLines[0]?.itemId,
        wastageTypeId: nextTypeId,
        qty,
        remarks: "",
      },
    ]);
  }, [balance.remainingQty, balance.status, onChange, rmLines, rows, totalWastageQty, unit, wastageTypes]);

  const updateRow = React.useCallback(
    (key: string, patch: Partial<WastageDetailDraft>) => {
      onChange(
        rows.map((row) => {
          if (row.key !== key) return row;
          const next = { ...row, ...patch };
          if (patch.wastageTypeId != null && patch.wastageTypeId > 0 && patch.qty == null) {
            const suggested = suggestWastageQtyForTypeSelection(
              totalWastageQty,
              rows,
              key,
              row.qty,
              unit,
            );
            if (suggested != null) next.qty = suggested;
          }
          return next;
        }),
      );
    },
    [onChange, rows, totalWastageQty, unit],
  );

  const removeRow = React.useCallback(
    (key: string) => {
      onChange(rows.filter((row) => row.key !== key));
    },
    [onChange, rows],
  );

  if (!(totalWastageQty > 1e-6) && readOnly && rows.length === 0) {
    return null;
  }

  const balanceTone =
    balance.status === "complete"
      ? "text-emerald-900"
      : balance.status === "over"
        ? "text-red-900"
        : balance.status === "remaining"
          ? "text-amber-950"
          : "text-slate-800";

  const messageTone =
    balance.status === "over"
      ? "border-red-200 bg-red-50 text-red-950"
      : balance.status === "complete" && !liveMessage
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : "border-amber-200 bg-amber-50 text-amber-950";

  const overQty = balance.classifiedQty - balance.totalWastageQty;
  const oneLineBalance =
    balance.status === "over"
      ? `Required wastage: ${fmtWastageQty(balance.totalWastageQty, unit)} ${unit} · Classified: ${fmtWastageQty(balance.classifiedQty, unit)} ${unit} · Over by: ${fmtWastageQty(overQty, unit)} ${unit}`
      : `Required wastage: ${fmtWastageQty(balance.totalWastageQty, unit)} ${unit} · Classified: ${fmtWastageQty(balance.classifiedQty, unit)} ${unit} · Remaining to classify: ${fmtWastageQty(Math.max(0, balance.remainingQty), unit)} ${unit}`;

  return (
    <div
      className={cn(
        "min-w-0",
        compact ? "space-y-1" : "space-y-2",
        fillAvailableHeight && "flex min-h-0 flex-1 flex-col",
      )}
      data-testid="production-report-wastage-details"
    >
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 className={cn("font-semibold text-slate-800", compact ? "text-[12px]" : "text-[13px]")}>Wastage Details</h4>
        {totalWastageQty > 1e-6 ? (
          <p
            className={cn("tabular-nums", compact ? "text-[11px] font-medium" : "text-[11px]", balanceTone)}
            data-testid="production-wastage-balance-strip"
          >
            {oneLineBalance}
          </p>
        ) : null}
      </div>

      {rows.length === 0 && !readOnly ? (
        <p className="shrink-0 text-[11px] text-slate-600">Add wastage reasons that sum to the required wastage before confirming.</p>
      ) : null}

      {rows.length > 0 ? (
        <div
          className={cn(
            "min-w-0 rounded border border-slate-100",
            scrollableRows
              ? cn(
                  "overflow-x-hidden overflow-y-auto",
                  fillAvailableHeight
                    ? "min-h-0 flex-1"
                    : "max-h-[min(12rem,28vh)]",
                )
              : "overflow-x-hidden",
          )}
          data-testid={scrollableRows ? "production-wastage-rows-scroll" : "production-wastage-rows"}
        >
          <table className={cn("w-full border-collapse text-slate-800", compact ? "table-fixed text-[11px]" : "text-[12px]")}>
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                <th className={cn("px-2 font-medium", compact ? "w-[24%] py-0.5" : "py-1")}>RM Item</th>
                <th className={cn("px-2 font-medium", compact ? "w-[28%] py-0.5" : "py-1")}>Wastage Type</th>
                <th className={cn("px-2 text-right font-medium", compact ? "w-[4.5rem] py-0.5" : "py-1")}>Qty</th>
                <th className={cn("px-2 font-medium", compact ? "py-0.5" : "py-1")}>Remarks</th>
                {!readOnly ? (
                  <th className={cn("px-1 text-center font-medium", compact ? "w-8 py-0.5" : "py-1")}>
                    <span className="sr-only">Delete</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const typeName = wastageTypes.find((t) => t.id === row.wastageTypeId)?.name ?? "—";
                const rowRemaining = remainingWastageAfterRow(totalWastageQty, rows, rowIndex);
                const showRowRemaining = !compact && !readOnly && rows.length > 1 && totalWastageQty > 1e-6;
                return (
                  <tr key={row.key} className="border-b border-slate-100">
                    <td className={cn("px-2", compact ? "py-0.5" : "py-1")}>
                      {readOnly ? (
                        rmLines.find((line) => line.itemId === row.itemId)?.itemName ?? "—"
                      ) : (
                        <select
                          className="h-8 w-full rounded border border-slate-200 bg-white px-1 text-[12px]"
                          value={row.itemId ? String(row.itemId) : ""}
                          onChange={(e) => updateRow(row.key, { itemId: Number(e.target.value) })}
                        >
                          {rmLines.map((line) => <option key={line.itemId} value={line.itemId}>{line.itemName}</option>)}
                        </select>
                      )}
                    </td>
                    <td className={cn("px-2", compact ? "py-0.5" : "py-1")}>
                      {readOnly ? (
                        typeName
                      ) : (
                        <select
                          className={cn(
                            "w-full rounded border border-slate-200 bg-white px-1.5",
                            compact ? "h-8 min-w-0 text-[12px]" : "h-8 min-w-[9rem] text-[12px]",
                          )}
                          value={row.wastageTypeId > 0 ? String(row.wastageTypeId) : ""}
                          onChange={(e) => updateRow(row.key, { wastageTypeId: Number(e.target.value) })}
                        >
                          <option value="">Select…</option>
                          {wastageTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className={cn("px-2 text-right align-middle", compact ? "py-0.5" : "py-1")}>
                      {readOnly ? (
                        <span className="tabular-nums">{fmtWastageQty(Number(row.qty), unit)}</span>
                      ) : (
                        <div className="inline-flex flex-col items-end gap-0.5">
                          <DecimalInput
                            className={cn(
                              "rounded border border-slate-200 px-1.5 text-right tabular-nums",
                              compact ? "h-8 w-[4.25rem] text-[12px]" : "h-8 w-[5.5rem] text-[12px]",
                            )}
                            value={row.qty}
                            onValueChange={(next) => updateRow(row.key, { qty: next })}
                          />
                          {showRowRemaining ? (
                            <span
                              className={cn(
                                "text-[10px] tabular-nums",
                                rowRemaining <= 1e-6 ? "font-medium text-emerald-700" : "text-amber-800",
                              )}
                            >
                              Remaining: {fmtWastageQty(Math.max(0, rowRemaining), unit)} {unit}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className={cn("px-2", compact ? "py-0.5" : "py-1")}>
                      {readOnly ? (
                        row.remarks || "—"
                      ) : (
                        <input
                          className={cn(
                            "w-full rounded border border-slate-200 px-1.5",
                            compact ? "h-8 min-w-0 text-[12px]" : "h-8 min-w-[8rem] text-[12px]",
                          )}
                          value={row.remarks}
                          onChange={(e) => updateRow(row.key, { remarks: e.target.value })}
                        />
                      )}
                    </td>
                    {!readOnly ? (
                      <td className={cn("px-1 text-center", compact ? "py-0.5" : "py-1")}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn("text-slate-500 hover:text-rose-700", compact ? "h-8 w-8 p-0" : "h-7 px-2 text-[11px]")}
                          onClick={() => removeRow(row.key)}
                          aria-label="Delete wastage row"
                        >
                          {compact ? <Trash2 className="h-3.5 w-3.5" /> : "Delete"}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!readOnly ? (
        <div className="shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("shrink-0", compact ? "h-7 text-[11px]" : "h-8 text-[12px]")}
            onClick={addRow}
            disabled={!canAddWastageReason}
            data-testid="add-wastage-reason-btn"
          >
            + Add Wastage Reason
          </Button>
        </div>
      ) : null}

      {!hideInlineValidation ? (
        liveMessage ? (
          <p
            className={cn("rounded border px-2 py-1.5 text-[11px] font-medium", messageTone)}
            data-testid="production-wastage-validation"
          >
            {liveMessage}
          </p>
        ) : balance.status === "complete" && balance.totalWastageQty > 1e-6 ? (
          <p className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-950">
            Wastage fully classified.
          </p>
        ) : null
      ) : null}
    </div>
  );
}
