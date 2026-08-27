import { cn } from "../../lib/utils";
import { DecimalInput } from "../ui/DecimalInput";
import { Button } from "../ui/button";
import {
  REGULAR_SO_BUFFER_PERCENT_DECIMALS,
  REGULAR_SO_BUFFER_PERCENT_MAX,
  REGULAR_SO_BUFFER_PERCENT_SOFT_MAX,
  classifyRegularSoBufferPercent,
  computeProductionPlanningMetrics,
  formatRegularSoBufferPercentDisplay,
  type ProductionPlanningMetrics,
} from "../../lib/regularSoProductionPlanning";

export type ProductionPlanningFgLine = {
  lineId: number;
  fgName: string;
  customerCommittedQty: number;
  fgStockAdjustmentQty: number;
};

type Props = {
  soLevelBuffer?: boolean;
  primaryLine: ProductionPlanningFgLine;
  extraLines?: ProductionPlanningFgLine[];
  metrics: ProductionPlanningMetrics;
  suggestedBufferPercent?: number | null;
  bufferPercentInput: string;
  onBufferPercentInputChange: (value: string) => void;
  bufferReason?: string;
  onBufferReasonChange?: (value: string) => void;
  bufferInputInvalid?: boolean;
  bufferRequiresAdminApproval?: boolean;
  isAdmin?: boolean;
  /** Store may enter reason and request approval when buffer is above soft max. */
  allowStoreReasonEntry?: boolean;
  approvalStatus?: "none" | "pending" | "approved" | "rejected" | "stale";
  requestingApproval?: boolean;
  onRequestAdminApproval?: () => void;
  saving?: boolean;
  disabled?: boolean;
  /** Create WO / post-planning: buffer is single-sourced from Machine Run Planning. */
  readOnlyBuffer?: boolean;
  className?: string;
};

export function WoPrepareProductionPlanningPanel({
  primaryLine,
  extraLines = [],
  metrics,
  suggestedBufferPercent,
  bufferPercentInput,
  onBufferPercentInputChange,
  bufferReason = "",
  onBufferReasonChange,
  bufferInputInvalid,
  bufferRequiresAdminApproval,
  isAdmin,
  allowStoreReasonEntry = false,
  approvalStatus = "none",
  requestingApproval = false,
  onRequestAdminApproval,
  saving,
  disabled,
  readOnlyBuffer = false,
  className,
}: Props) {
  const suggested =
    suggestedBufferPercent != null && Number.isFinite(suggestedBufferPercent)
      ? formatRegularSoBufferPercentDisplay(suggestedBufferPercent)
      : null;
  const allLines = [primaryLine, ...extraLines];
  const band = classifyRegularSoBufferPercent(Number(bufferPercentInput) || metrics.productionBufferPercent);
  const showApprovalHint =
    !readOnlyBuffer && (bufferRequiresAdminApproval || band === "REQUIRES_ADMIN_APPROVAL");
  const reasonEditable = Boolean(isAdmin || allowStoreReasonEntry);

  return (
    <section
      className={cn(
        "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm",
        className,
      )}
      aria-labelledby="wo-prepare-production-planning-title"
      data-testid="wo-prepare-production-planning-panel"
      data-buffer-readonly={readOnlyBuffer ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1">
        <h2
          id="wo-prepare-production-planning-title"
          className="text-[11px] font-bold uppercase tracking-wider text-slate-700"
        >
          Production Planning
        </h2>
        {saving ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Updating…</span>
        ) : null}
      </div>

      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <ReadOnlyMetric label="Customer Qty" value={metrics.customerCommittedQty} emphasize />
        {readOnlyBuffer ? (
          <>
            <ReadOnlyMetric
              label="Buffer %"
              valueLabel={`${formatRegularSoBufferPercentDisplay(metrics.productionBufferPercent)}%`}
            />
            <ReadOnlyMetric label="Buffer Qty" value={metrics.productionBufferQty} emphasize />
            <ReadOnlyMetric label="Planned WO Qty" value={metrics.plannedProductionQty} emphasize />
          </>
        ) : (
          <>
            {suggested != null ? (
              <ReadOnlyMetric label="Suggested Buffer" valueLabel={`${suggested}%`} muted />
            ) : null}
            <div>
              <label
                htmlFor="fg-buffer-percent"
                className="text-[10px] font-semibold uppercase tracking-wider text-slate-600"
              >
                Production buffer %
              </label>
              <DecimalInput
                id="fg-buffer-percent"
                maxFractionDigits={REGULAR_SO_BUFFER_PERCENT_DECIMALS}
                className={cn(
                  "mt-0.5 h-8 w-full max-w-[5.5rem] rounded border bg-white px-2 text-sm font-semibold tabular-nums text-slate-950",
                  bufferInputInvalid ? "border-red-400" : "border-slate-300",
                )}
                value={bufferPercentInput}
                disabled={disabled || saving}
                onValueChange={onBufferPercentInputChange}
                aria-invalid={bufferInputInvalid || undefined}
                aria-describedby="fg-buffer-percent-hint"
              />
              <p id="fg-buffer-percent-hint" className="mt-0.5 text-[10px] text-slate-500">
                0–{REGULAR_SO_BUFFER_PERCENT_SOFT_MAX}% normal · up to {REGULAR_SO_BUFFER_PERCENT_MAX}% with Admin
              </p>
            </div>
            <ReadOnlyMetric
              label="Buffer"
              valueLabel={`${formatRegularSoBufferPercentDisplay(metrics.productionBufferPercent)}%`}
            />
            <ReadOnlyMetric
              label="Additional planned quantity"
              value={metrics.productionBufferQty}
              emphasize
            />
            <ReadOnlyMetric label="Planned WO quantity" value={metrics.plannedProductionQty} emphasize />
          </>
        )}
        <ReadOnlyMetric label="FG Stock Adjustment" value={metrics.fgStockAdjustmentQty} muted />
        <ReadOnlyMetric label="RM Planning Qty" value={metrics.rmPlanningQty} emphasize />
      </div>

      {showApprovalHint ? (
        <div className="mt-2 space-y-1.5 rounded border border-amber-200 bg-amber-50/80 px-2 py-1.5">
          <p className="text-[11px] font-medium text-amber-950">
            Buffer above {REGULAR_SO_BUFFER_PERCENT_SOFT_MAX}% requires a reason and Admin approval (max{" "}
            {REGULAR_SO_BUFFER_PERCENT_MAX}%).
          </p>
          {onBufferReasonChange ? (
            <div>
              <label
                htmlFor="fg-buffer-reason"
                className="text-[10px] font-semibold uppercase tracking-wider text-amber-900"
              >
                Reason
              </label>
              <textarea
                id="fg-buffer-reason"
                className="mt-0.5 min-h-[2.5rem] w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900"
                value={bufferReason}
                disabled={disabled || saving || !reasonEditable}
                onChange={(e) => onBufferReasonChange(e.target.value)}
                placeholder={
                  isAdmin
                    ? "Required when buffer is above 5%"
                    : allowStoreReasonEntry
                      ? "Required — then request Admin approval"
                      : "Admin must enter a reason and apply buffer above 5%"
                }
              />
            </div>
          ) : null}
          {approvalStatus === "pending" ? (
            <p className="text-[11px] font-semibold text-amber-900">
              Waiting for Admin approval. Create Work Order stays disabled until approved.
            </p>
          ) : null}
          {approvalStatus === "approved" ? (
            <p className="text-[11px] font-semibold text-emerald-800">
              Admin approved this buffer and planned quantity. You can create the Work Order.
            </p>
          ) : null}
          {approvalStatus === "rejected" ? (
            <p className="text-[11px] font-semibold text-red-800">
              Admin rejected this request. Adjust buffer/reason and request approval again.
            </p>
          ) : null}
          {approvalStatus === "stale" ? (
            <p className="text-[11px] font-semibold text-amber-900">
              Buffer, reason, or planned quantity changed — previous approval is no longer valid.
            </p>
          ) : null}
          {!isAdmin && allowStoreReasonEntry && onRequestAdminApproval && approvalStatus !== "approved" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={
                disabled ||
                saving ||
                requestingApproval ||
                !bufferReason.trim() ||
                approvalStatus === "pending" ||
                band === "BLOCKED"
              }
              onClick={onRequestAdminApproval}
            >
              {requestingApproval
                ? "Requesting…"
                : approvalStatus === "pending"
                  ? "Approval requested"
                  : "Request Admin Approval"}
            </Button>
          ) : null}
          {isAdmin ? (
            <p className="text-[10px] text-amber-900/80">
              Admin can apply this buffer directly (reason required), or approve a Store request from Pending Actions.
            </p>
          ) : null}
        </div>
      ) : null}

      {band === "BLOCKED" ? (
        <p className="mt-1.5 text-[11px] font-medium text-red-700">
          Production buffer above {REGULAR_SO_BUFFER_PERCENT_MAX}% is blocked.
        </p>
      ) : null}

      {extraLines.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                <th className="py-1 pr-2">FG</th>
                <th className="py-1 text-right">Customer Qty</th>
                <th className="py-1 text-right">FG Stock</th>
                <th className="py-1 text-right">RM Planning Qty</th>
              </tr>
            </thead>
            <tbody>
              {allLines.map((line) => {
                const lineMetrics = computeProductionPlanningMetrics(
                  line.customerCommittedQty,
                  metrics.productionBufferPercent,
                  line.fgStockAdjustmentQty,
                );
                return (
                  <tr key={line.lineId} className="border-b border-slate-100">
                    <td className="py-1 pr-2 font-medium text-slate-900">{line.fgName}</td>
                    <td className="py-1 text-right tabular-nums">{lineMetrics.customerCommittedQty}</td>
                    <td className="py-1 text-right tabular-nums">{lineMetrics.fgStockAdjustmentQty}</td>
                    <td className="py-1 text-right tabular-nums font-semibold">{lineMetrics.rmPlanningQty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] leading-snug text-slate-600">
          <span className="font-medium text-slate-800">{primaryLine.fgName}</span>
          {" · "}
          Buffer increases RM planning and production quantity for operational safety. Dispatch remains capped at
          customer commitment only.
        </p>
      )}
    </section>
  );
}

function ReadOnlyMetric({
  label,
  value,
  valueLabel,
  emphasize,
  muted,
}: {
  label: string;
  value?: number;
  valueLabel?: string;
  emphasize?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</span>
      <div
        className={cn(
          "tabular-nums font-bold text-slate-950",
          emphasize && "text-base",
          muted && "text-slate-600",
        )}
      >
        {valueLabel ?? value}
      </div>
    </div>
  );
}
