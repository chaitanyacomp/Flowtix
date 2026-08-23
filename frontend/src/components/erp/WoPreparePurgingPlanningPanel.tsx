import { cn } from "../../lib/utils";
import { formatPurgingGrams, type PurgingPlanningSummary } from "../../lib/woPlanningPurging";

type Props = {
  purgingPlanning: PurgingPlanningSummary | null | undefined;
  /** Server-derived planned purge count only. */
  plannedPurgeCount?: number;
  productionRunCount?: number;
  physicalSetupConfirmationRequired?: boolean;
  saving?: boolean;
  className?: string;
};

function ReadOnlyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-950">{value}</p>
    </div>
  );
}

export function resolvePurgingPlanningPanelCopy(args: {
  purgingDetectionSource?: string | null;
  purgingDetectionLabel?: string | null;
  productionRunCount?: number;
}): { isLegacy: boolean; detectionLabel: string | null; helperText: string } {
  const source = String(args.purgingDetectionSource ?? "").trim().toUpperCase();
  const label = String(args.purgingDetectionLabel ?? "").trim();
  const runCount = Number(args.productionRunCount ?? 0);

  const isLegacy =
    source === "LEGACY_NOT_PLANNED" || label === "Not planned / legacy record";

  if (isLegacy) {
    return {
      isLegacy: true,
      detectionLabel: label || "Not planned / legacy record",
      helperText:
        "Legacy Work Order without machine-run purging detection — historical RM is unchanged; no automatic purge is added.",
    };
  }

  if (source === "AWAITING_RUNS" || (runCount <= 0 && !label)) {
    return {
      isLegacy: false,
      detectionLabel: label || "Purging will be calculated after machine runs are allocated.",
      helperText: "Purging will be calculated after machine runs are allocated.",
    };
  }

  return {
    isLegacy: false,
    detectionLabel: label || null,
    helperText:
      "Total planned purging = BOM standard × planned purge count (server detection only). Run rows and physical mould setup are separate.",
  };
}

export function WoPreparePurgingPlanningPanel({
  purgingPlanning,
  plannedPurgeCount,
  productionRunCount,
  physicalSetupConfirmationRequired: _physicalSetupConfirmationRequired,
  saving,
  className,
}: Props) {
  const runCount = Number(productionRunCount ?? purgingPlanning?.productionRunCount ?? 0);
  const copy = resolvePurgingPlanningPanelCopy({
    purgingDetectionSource: purgingPlanning?.purgingDetectionSource,
    purgingDetectionLabel: purgingPlanning?.purgingDetectionLabel,
    productionRunCount: runCount,
  });
  const isLegacy = copy.isLegacy;
  const purgeCount = Number(
    plannedPurgeCount ?? purgingPlanning?.plannedPurgeCount ?? 0,
  );
  const standardPerSetup = Number(purgingPlanning?.standardPurgingQtyGramsPerSetup ?? 0);
  const totalGrams =
    purgingPlanning?.totalPlannedPurgingGrams ??
    Math.round(standardPerSetup * Math.max(purgeCount, 0) * 1000) / 1000;
  const totalProductionKg = Number(purgingPlanning?.totalProductionRmKg ?? 0);
  const totalPlannedRmKg = Number(purgingPlanning?.totalPlannedRmKg ?? totalProductionKg);

  return (
    <section
      className={cn(
        "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm",
        className,
      )}
      aria-labelledby="wo-prepare-purging-planning-title"
      data-testid="wo-purging-planning-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1">
        <h2
          id="wo-prepare-purging-planning-title"
          className="text-[11px] font-bold uppercase tracking-wider text-slate-700"
        >
          Purging RM Planning
        </h2>
        {saving ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Updating…</span>
        ) : null}
      </div>

      {copy.detectionLabel ? (
        <p
          className="mt-1.5 text-[11px] font-medium text-slate-600"
          data-testid="wo-purging-detection-label"
        >
          Detection: {copy.detectionLabel}
        </p>
      ) : null}

      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <ReadOnlyMetric
          label="Standard Purging Qty per Setup"
          value={formatPurgingGrams(standardPerSetup)}
        />
        <ReadOnlyMetric
          label="Production run count"
          value={runCount > 0 ? String(runCount) : "—"}
        />
        <ReadOnlyMetric
          label="Planned purge count"
          value={isLegacy || runCount <= 0 ? "—" : String(Math.max(0, purgeCount))}
        />
        <ReadOnlyMetric
          label="Total Planned Purging Qty"
          value={isLegacy || runCount <= 0 ? "—" : formatPurgingGrams(totalGrams)}
        />
        <ReadOnlyMetric
          label="Production / shot RM"
          value={`${totalProductionKg} kg`}
        />
        <ReadOnlyMetric label="Total planned RM" value={`${totalPlannedRmKg} kg`} />
      </div>
      <p className="mt-1 text-[10px] text-slate-500" data-testid="wo-purging-helper-copy">
        {copy.helperText}
      </p>
    </section>
  );
}
