export const MAX_PLANNED_SETUP_COUNT = 9999;

export type PurgingPlanningSummary = {
  plannedPurgeCount?: number;
  productionRunCount?: number;
  purgingDetectionSource?: string | null;
  purgingDetectionLabel?: string | null;
  standardPurgingQtyGramsPerSetup?: number | null;
  totalPlannedPurgingGrams?: number;
  totalPlannedPurgingKg?: number;
  totalProductionRmKg?: number;
  totalPlannedRmKg?: number;
};

export function parsePlannedSetupCountInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 1;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  if (n > MAX_PLANNED_SETUP_COUNT) return null;
  return n;
}

export function plannedSetupCountError(raw: string): string | null {
  if (raw.trim() === "") return null;
  const parsed = parsePlannedSetupCountInput(raw);
  if (parsed == null) {
    return `Enter a whole number from 1 to ${MAX_PLANNED_SETUP_COUNT}.`;
  }
  return null;
}

/** total planned purging = BOM standard × planned purge count */
export function computeTotalPlannedPurgingGrams(
  standardPurgingQtyGramsPerSetup: number,
  plannedPurgeCount: number,
): number {
  const standard = Number(standardPurgingQtyGramsPerSetup);
  const purges = Number(plannedPurgeCount);
  if (!Number.isFinite(standard) || standard <= 0 || !Number.isFinite(purges) || purges < 0) return 0;
  return Math.round(standard * purges * 1000) / 1000;
}

export function plannedSetupCountQueryParam(_count: number): string {
  // Client counts are not trusted — backend derives purge count from detection.
  return "";
}

export function formatPurgingGrams(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0 g";
  return `${n} g`;
}
