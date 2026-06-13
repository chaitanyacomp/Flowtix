/**
 * P7F-CA3 — Production plan unsaved-change detection (lock workflow only).
 */

export const UNSAVED_PRODUCTION_PLAN_LOCK_MESSAGE =
  "Production plan contains unsaved changes. Save changes before locking.";

export type ProductionPlanRowSnapshot = {
  id?: number;
  fgItemId: number;
  plannedFgQty: number;
  plannedQtyOverridden: boolean;
  source: string;
  remarks: string;
};

export type ProductionPlanSavedBaseline = {
  rows: ProductionPlanRowSnapshot[];
};

function round3(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function normalizeRemarks(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function snapshotProductionPlanRow(row: {
  id?: number;
  fgItemId: number;
  plannedFgQty: number | string;
  plannedQtyOverridden: boolean;
  source: string;
  remarks?: string | null;
}): ProductionPlanRowSnapshot {
  return {
    id: row.id,
    fgItemId: row.fgItemId,
    plannedFgQty: round3(Number(row.plannedFgQty)),
    plannedQtyOverridden: Boolean(row.plannedQtyOverridden),
    source: String(row.source ?? ""),
    remarks: normalizeRemarks(row.remarks),
  };
}

export function captureProductionPlanBaseline(
  rows: Array<{
    id?: number;
    fgItemId: number;
    plannedFgQty: number | string;
    plannedQtyOverridden: boolean;
    source: string;
    remarks?: string | null;
  }>,
): ProductionPlanSavedBaseline {
  return {
    rows: rows.map(snapshotProductionPlanRow).sort((a, b) => a.fgItemId - b.fgItemId),
  };
}

function rowsEqual(a: ProductionPlanRowSnapshot, b: ProductionPlanRowSnapshot): boolean {
  return (
    a.fgItemId === b.fgItemId &&
    a.plannedFgQty === b.plannedFgQty &&
    a.plannedQtyOverridden === b.plannedQtyOverridden &&
    a.source === b.source &&
    a.remarks === b.remarks
  );
}

/** True when local production plan edits differ from the last successful server load/save. */
export function hasUnsavedProductionChanges(
  rows: Array<{
    id?: number;
    fgItemId: number;
    plannedFgQty: number | string;
    plannedQtyOverridden: boolean;
    source: string;
    remarks?: string | null;
  }>,
  removedIds: number[],
  baseline: ProductionPlanSavedBaseline | null,
): boolean {
  if (!baseline) return false;
  if (removedIds.length > 0) return true;

  const current = captureProductionPlanBaseline(rows).rows;
  if (current.length !== baseline.rows.length) return true;

  for (let i = 0; i < current.length; i += 1) {
    if (!rowsEqual(current[i], baseline.rows[i])) return true;
  }
  return false;
}

export function hasPlannedSuggestedMismatch(
  totalPlannedQty: number,
  totalSuggestedQty: number,
  epsilon = 1e-6,
): boolean {
  return Math.abs(round3(totalPlannedQty) - round3(totalSuggestedQty)) > epsilon;
}

export function formatPlannedSuggestedLockWarning(totalPlannedQty: number, totalSuggestedQty: number): string {
  return `Suggested production is ${round3(totalSuggestedQty).toLocaleString()} but planned production is ${round3(totalPlannedQty).toLocaleString()}. Locking will create an RM snapshot using ${round3(totalPlannedQty).toLocaleString()} planned quantity.`;
}

export type LockSnapshotSummaryInput = {
  revision: number | null | undefined;
  totalFgPlannedQty: number | string | null | undefined;
  rmLines: Array<{ netRequirementQty: number | string }>;
};

export function formatLockSnapshotSuccessMessage(input: LockSnapshotSummaryInput): string {
  const revision = input.revision ?? "—";
  const plannedFg = round3(Number(input.totalFgPlannedQty ?? 0));
  const rmTotal = round3(
    (input.rmLines ?? []).reduce((acc, line) => acc + Number(line.netRequirementQty ?? 0), 0),
  );
  return `Snapshot ${revision} created. Planned FG: ${plannedFg.toLocaleString()}. RM Requirement: ${rmTotal.toLocaleString()}.`;
}
