/**
 * REGULAR_SO End Production banner — SO demand covered vs WO-plan remainder.
 */
import { Button } from "../../ui/button";
import {
  formatRegularSoClosureQty,
  regularSoDemandCoveredStatusMessage,
  shouldOfferRegularEndProductionCovered,
  shouldOfferRegularEndProductionShortage,
  type RegularSoDemandCoverage,
} from "../../../lib/regularSoProductionClosureUx";

type Props = {
  coverage: RegularSoDemandCoverage;
  unit?: string | null;
  busy?: boolean;
  onEndCovered: () => void;
  onEndShortage: () => void;
  onContinueLater?: () => void;
  className?: string;
};

export function RegularSoEndProductionPanel({
  coverage,
  unit,
  busy,
  onEndCovered,
  onEndShortage,
  onContinueLater,
  className,
}: Props) {
  const coveredMsg = regularSoDemandCoveredStatusMessage(coverage, unit);
  const offerCovered = shouldOfferRegularEndProductionCovered(coverage);
  const offerShortage = shouldOfferRegularEndProductionShortage(coverage);

  if (coverage.reportPending) {
    return (
      <div
        className={className ?? "space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5"}
        data-testid="regular-so-report-pending-banner"
      >
        <p className="text-sm font-semibold text-amber-950">Production Report pending</p>
        <p className="text-[12px] text-amber-900/90">
          Complete RM reconciliation in the Production Report. The work order stays open until the report is confirmed.
        </p>
      </div>
    );
  }

  if (!offerCovered && !offerShortage) return null;

  return (
    <div
      className={className ?? "space-y-3 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5"}
      data-testid="regular-so-end-production-panel"
    >
      {offerCovered && coveredMsg ? (
        <p className="text-sm font-semibold text-emerald-950" data-testid="regular-so-demand-covered-status">
          {coveredMsg}
        </p>
      ) : null}
      {offerShortage ? (
        <p className="text-sm font-semibold text-amber-950" data-testid="regular-so-shortage-status">
          Produced below SO demand — continue later or end with shortage (Production Report required).
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <div className="text-[11px] font-medium text-slate-600">SO Qty</div>
          <div className="font-semibold tabular-nums text-slate-900">
            {formatRegularSoClosureQty(coverage.soDemandQty, unit)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium text-slate-600">Produced</div>
          <div className="font-semibold tabular-nums text-slate-900">
            {formatRegularSoClosureQty(coverage.producedQty, unit)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium text-slate-600">WO Target</div>
          <div className="font-semibold tabular-nums text-slate-900">
            {formatRegularSoClosureQty(coverage.woPlannedQty, unit)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium text-slate-600">WO Target Balance</div>
          <div className="font-semibold tabular-nums text-slate-900">
            {formatRegularSoClosureQty(coverage.woTargetBalance, unit)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium text-slate-600">
            {offerCovered ? "Expected Excess Before QC" : "SO Shortage"}
          </div>
          <div className="font-semibold tabular-nums text-slate-900">
            {formatRegularSoClosureQty(
              offerCovered ? coverage.expectedExcessBeforeQc : coverage.soShortageQty,
              unit,
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {offerCovered ? (
          <Button
            type="button"
            size="sm"
            className="h-9 text-[13px] font-semibold"
            disabled={busy}
            onClick={onEndCovered}
            data-testid="regular-so-end-production-covered-btn"
          >
            {busy ? "Working…" : "End Production & Complete Report"}
          </Button>
        ) : null}
        {offerShortage ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-9 text-[13px] font-semibold"
            disabled={busy}
            onClick={onEndShortage}
            data-testid="regular-so-end-production-shortage-btn"
          >
            {busy ? "Working…" : "End Production with Shortage"}
          </Button>
        ) : null}
        {onContinueLater ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 text-[13px]"
            disabled={busy}
            onClick={onContinueLater}
            data-testid="regular-so-continue-later-btn"
          >
            Continue Later
          </Button>
        ) : null}
      </div>
      {offerCovered ? (
        <p className="text-[11px] text-slate-600">
          Use Remaining Qty is optional. Ending production opens the mandatory Production Report — do not enter artificial
          quantity for the WO-plan balance.
        </p>
      ) : null}
    </div>
  );
}
