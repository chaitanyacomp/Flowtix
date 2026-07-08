import * as React from "react";
import { Button } from "../../ui/button";
import { cn } from "../../../lib/utils";
import type { WastageDetailDraft } from "../../../lib/productionWastageClassification";
import {
  computeWastageClassificationBalance,
  fmtWastageQty,
  remainingWastageAfterRow,
  resolveLiveWastageValidationMessage,
  suggestWastageQtyForTypeSelection,
} from "../../../lib/productionWastageClassification";
import type { WastageTypeRow } from "../../../lib/wastageTypeApi";

type Props = {
  wastageTypes: WastageTypeRow[];
  rows: WastageDetailDraft[];
  totalWastageQty: number;
  unit?: string;
  readOnly?: boolean;
  compact?: boolean;
  /** When true, validation feedback is rendered by the parent sticky footer (compact report panel). */
  hideInlineValidation?: boolean;
  /** Cap wastage row table height so confirm action stays on screen; rows scroll internally. */
  scrollableRows?: boolean;
  validationMessage?: string | null;
  onChange: (rows: WastageDetailDraft[]) => void;
};

function newRowKey() {
  return `wd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ProductionReportWastageDetails({
  wastageTypes,
  rows,
  totalWastageQty,
  unit = "Kg",
  readOnly = false,
  compact = false,
  hideInlineValidation = false,
  scrollableRows = false,
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

  const addRow = React.useCallback(() => {
    const firstType = wastageTypes[0]?.id ?? 0;
    const key = newRowKey();
    const remaining = Math.max(0, balance.remainingQty);
    const qty =
      firstType > 0 && remaining > 1e-6
        ? suggestWastageQtyForTypeSelection(totalWastageQty, rows, key, "", unit) ?? ""
        : remaining > 1e-6
          ? fmtWastageQty(remaining)
          : "";
    onChange([
      ...rows,
      {
        key,
        wastageTypeId: firstType,
        qty,
        remarks: "",
      },
    ]);
  }, [balance.remainingQty, onChange, rows, totalWastageQty, unit, wastageTypes]);

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
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : balance.status === "over"
        ? "border-red-200 bg-red-50 text-red-950"
        : balance.status === "remaining"
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-slate-200 bg-slate-50 text-slate-800";

  const messageTone =
    balance.status === "over"
      ? "border-red-200 bg-red-50 text-red-950"
      : balance.status === "complete" && !liveMessage
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : "border-amber-200 bg-amber-50 text-amber-950";

  return (
    <div className={cn("min-w-0", compact ? "space-y-1.5" : "space-y-2")} data-testid="production-report-wastage-details">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className={cn("font-semibold text-slate-800", compact ? "text-[12px]" : "text-[13px]")}>Wastage Details</h4>
      </div>

      {totalWastageQty > 1e-6 ? (
        <div
          className={cn("rounded border px-2 py-1.5 text-[11px]", balanceTone)}
          data-testid="production-wastage-balance-strip"
        >
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums">
            <span>
              Total wastage:{" "}
              <strong>
                {fmtWastageQty(balance.totalWastageQty)} {unit}
              </strong>
            </span>
            <span>
              Classified:{" "}
              <strong>
                {fmtWastageQty(balance.classifiedQty)} {unit}
              </strong>
            </span>
            <span>
              {balance.status === "over" ? (
                <>
                  Over by:{" "}
                  <strong>
                    {fmtWastageQty(balance.classifiedQty - balance.totalWastageQty)} {unit}
                  </strong>
                </>
              ) : (
                <>
                  Remaining:{" "}
                  <strong>
                    {fmtWastageQty(Math.max(0, balance.remainingQty))} {unit}
                  </strong>
                </>
              )}
            </span>
          </div>
        </div>
      ) : null}

      {rows.length === 0 && !readOnly ? (
        <p className="text-[11px] text-slate-600">Add wastage reasons that sum to the total wastage before confirming.</p>
      ) : null}

      {rows.length > 0 ? (
        <div
          className={cn(
            "overflow-x-auto",
            scrollableRows && "max-h-[min(14rem,32vh)] overflow-y-auto rounded border border-slate-100",
          )}
          data-testid={scrollableRows ? "production-wastage-rows-scroll" : undefined}
        >
          <table className={cn("w-full border-collapse text-slate-800", compact ? "text-[11px]" : "text-[12px]")}>
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                <th className={cn("px-2 font-medium", compact ? "py-0.5" : "py-1")}>Wastage Type</th>
                <th className={cn("px-2 text-right font-medium", compact ? "py-0.5" : "py-1")}>Qty ({unit})</th>
                <th className={cn("px-2 font-medium", compact ? "py-0.5" : "py-1")}>Remarks</th>
                {!readOnly ? <th className={cn("px-2 text-right font-medium", compact ? "py-0.5" : "py-1")}>Delete</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const typeName = wastageTypes.find((t) => t.id === row.wastageTypeId)?.name ?? "—";
                const rowRemaining = remainingWastageAfterRow(totalWastageQty, rows, rowIndex);
                const showRowRemaining = !readOnly && rows.length > 1 && totalWastageQty > 1e-6;
                return (
                  <tr key={row.key} className="border-b border-slate-100">
                    <td className={cn("px-2", compact ? "py-0.5" : "py-1")}>
                      {readOnly ? (
                        typeName
                      ) : (
                        <select
                          className={cn(
                            "w-full min-w-[9rem] rounded border border-slate-200 bg-white px-1.5",
                            compact ? "h-7 text-[11px]" : "h-8 text-[12px]",
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
                    <td className={cn("px-2 text-right align-top", compact ? "py-0.5" : "py-1")}>
                      {readOnly ? (
                        <span className="tabular-nums">{fmtWastageQty(Number(row.qty))}</span>
                      ) : (
                        <div className="inline-flex flex-col items-end gap-0.5">
                          <input
                            className={cn(
                              "w-[5.5rem] rounded border border-slate-200 px-1.5 text-right tabular-nums",
                              compact ? "h-7 text-[11px]" : "h-8 text-[12px]",
                            )}
                            type="number"
                            min="0"
                            step="0.001"
                            value={row.qty}
                            onChange={(e) => updateRow(row.key, { qty: e.target.value })}
                          />
                          {showRowRemaining ? (
                            <span
                              className={cn(
                                "text-[10px] tabular-nums",
                                rowRemaining <= 1e-6 ? "font-medium text-emerald-700" : "text-amber-800",
                              )}
                            >
                              Remaining: {fmtWastageQty(Math.max(0, rowRemaining))} {unit}
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
                            "w-full min-w-[8rem] rounded border border-slate-200 px-1.5",
                            compact ? "h-7 text-[11px]" : "h-8 text-[12px]",
                          )}
                          value={row.remarks}
                          onChange={(e) => updateRow(row.key, { remarks: e.target.value })}
                        />
                      )}
                    </td>
                    {!readOnly ? (
                      <td className={cn("px-2 text-right", compact ? "py-0.5" : "py-1")}>
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => removeRow(row.key)}>
                          Delete
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
        <Button type="button" variant="outline" size="sm" className={cn("h-8", compact ? "text-[11px]" : "text-[12px]")} onClick={addRow}>
          + Add Wastage Reason
        </Button>
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
