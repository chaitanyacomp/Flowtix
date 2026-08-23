export type ProductionRunDraft = {
  clientKey: string;
  id?: number;
  fgItemId: number;
  runSequence: number;
  machineId: number;
  plannedQty: number;
  plannedDate?: string | null;
  shiftId?: number | null;
  machineCode?: string | null;
  machineName?: string | null;
  cycleTimeSeconds?: number | null;
  piecesPerCycle?: number | null;
  standardEfficiencyPercent?: number | null;
  estimatedDurationSeconds?: number | null;
  estimatedDurationLabel?: string | null;
  purgingRequired?: boolean;
  purgingDetectionStatus?: string | null;
  purgingDetectionLabel?: string | null;
  purgingDetectionReason?: string | null;
  previousProfileFingerprint?: string | null;
  targetProfileFingerprint?: string | null;
  conservativePurgePlan?: boolean | null;
  physicalSetupRequired?: boolean | null;
  physicalSetupStatus?: string | null;
  physicalSetupReason?: string | null;
};

/** Production run row count — not physical setup count and not purge count. */
export function deriveProductionRunCount(runs: ProductionRunDraft[]): number {
  return (runs ?? []).filter((r) => Number(r.machineId) > 0 && Number(r.plannedQty) > 0).length;
}

/** @deprecated Use deriveProductionRunCount — name kept for callers during transition. */
export function derivePlannedSetupCountFromRuns(runs: ProductionRunDraft[]): number {
  return deriveProductionRunCount(runs);
}

export function countPlannedPurgesFromRuns(runs: ProductionRunDraft[]): number {
  return (runs ?? []).filter((r) => r.purgingRequired === true).length;
}

export function sumAllocatedQtyForFg(runs: ProductionRunDraft[], fgItemId: number): number {
  return Math.round(
    (runs ?? [])
      .filter((r) => Number(r.fgItemId) === Number(fgItemId))
      .reduce((s, r) => s + (Number(r.plannedQty) || 0), 0) * 1000,
  ) / 1000;
}

export function estimateRunDurationLabel(input: {
  plannedQty?: number | null;
  cycleTimeSeconds?: number | null;
  piecesPerCycle?: number | null;
  standardEfficiencyPercent?: number | null;
}): string | null {
  const qty = Number(input.plannedQty);
  const cycle = Number(input.cycleTimeSeconds);
  const pieces = Number(input.piecesPerCycle);
  const eff = Number(input.standardEfficiencyPercent);
  if (!(qty > 0) || !(cycle > 0) || !(pieces >= 1) || !(eff > 0)) return null;
  const effectivePiecesPerSecond = (pieces / cycle) * (eff / 100);
  if (!(effectivePiecesPerSecond > 0)) return null;
  const seconds = qty / effectivePiecesPerSecond;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

export function runsToApiPayload(runs: ProductionRunDraft[]) {
  return (runs ?? [])
    .filter((r) => Number(r.machineId) > 0 && Number(r.plannedQty) > 0)
    .map((r, index) => ({
      fgItemId: Number(r.fgItemId),
      runSequence: Number(r.runSequence) || index + 1,
      machineId: Number(r.machineId),
      plannedQty: Number(r.plannedQty),
      plannedDate: r.plannedDate || null,
      shiftId: r.shiftId != null && r.shiftId !== 0 ? Number(r.shiftId) : null,
    }));
}

export function mapApiRunsToDraft(
  rows: Array<
    Partial<ProductionRunDraft> & {
      fgItemId: number;
      machineId: number;
      plannedQty: number;
    }
  >,
): ProductionRunDraft[] {
  return (rows ?? []).map((row, index) => ({
    clientKey: row.id != null ? `id-${row.id}` : `api-${index}-${row.fgItemId}-${row.runSequence ?? index + 1}`,
    id: row.id,
    fgItemId: Number(row.fgItemId),
    runSequence: Number(row.runSequence) || index + 1,
    machineId: Number(row.machineId),
    plannedQty: Number(row.plannedQty) || 0,
    plannedDate: row.plannedDate ?? null,
    shiftId: row.shiftId ?? null,
    machineCode: row.machineCode ?? null,
    machineName: row.machineName ?? null,
    cycleTimeSeconds: row.cycleTimeSeconds ?? null,
    piecesPerCycle: row.piecesPerCycle ?? null,
    standardEfficiencyPercent: row.standardEfficiencyPercent ?? null,
    estimatedDurationSeconds: row.estimatedDurationSeconds ?? null,
    estimatedDurationLabel: row.estimatedDurationLabel ?? null,
    purgingRequired: row.purgingRequired,
    purgingDetectionStatus: row.purgingDetectionStatus ?? null,
    purgingDetectionLabel: (row as { purgingDetectionLabel?: string | null }).purgingDetectionLabel ?? null,
    purgingDetectionReason: row.purgingDetectionReason ?? null,
    previousProfileFingerprint: row.previousProfileFingerprint ?? null,
    targetProfileFingerprint: row.targetProfileFingerprint ?? null,
    physicalSetupRequired: row.physicalSetupRequired ?? null,
    physicalSetupStatus: row.physicalSetupStatus ?? null,
    physicalSetupReason: row.physicalSetupReason ?? null,
    conservativePurgePlan: (row as { conservativePurgePlan?: boolean | null }).conservativePurgePlan ?? null,
  }));
}

export function allocationQtyError(
  runs: ProductionRunDraft[],
  fgLines: Array<{ fgItemId: number; plannedQty: number; fgName?: string }>,
): string | null {
  for (const fg of fgLines) {
    const allocated = sumAllocatedQtyForFg(runs, fg.fgItemId);
    if (Math.abs(allocated - Number(fg.plannedQty)) > 0.001) {
      return `Allocated quantity must equal planned WO quantity for ${fg.fgName || `FG ${fg.fgItemId}`}.`;
    }
  }
  if (derivePlannedSetupCountFromRuns(runs) < 1 && fgLines.some((f) => Number(f.plannedQty) > 0)) {
    return "Add at least one machine production-run allocation.";
  }
  return null;
}
