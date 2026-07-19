/** Production Report RM allocation helpers — authoritative 3-decimal RM precision. */

const EPS = 1e-6;

export function roundRmQty(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

/**
 * Required allocation before wastage/return classification:
 * issued − consumed − returned
 */
export function computeRmLineRequiredAllocation(input: {
  issuedQty: number;
  consumedQty: number;
  returnedQty?: number;
}): number {
  const issued = roundRmQty(input.issuedQty);
  const consumed = roundRmQty(input.consumedQty);
  const returned = roundRmQty(input.returnedQty ?? 0);
  return roundRmQty(Math.max(0, issued - consumed - returned));
}

export type RmLineWastageAllocation = {
  requiredAllocation: number;
  runnerWasteQty: number;
  manualWasteQty: number;
  /** Issued − consumed − returned − runner − manual wastage (unexplained balance). */
  unexplainedBalance: number;
};

/**
 * Allocates unconsumed issued RM into runner (auto) + manual wastage.
 * Default manual wastage fills remaining required allocation so unexplained starts at 0.
 */
export function computeRmLineWastageAllocation(input: {
  issuedQty: number;
  consumedQty: number;
  returnedQty?: number;
  runnerWasteQty?: number;
  /** When omitted, manual wastage defaults to remaining required after runner. */
  manualWasteQty?: number | null;
}): RmLineWastageAllocation {
  const issued = roundRmQty(input.issuedQty);
  const consumed = roundRmQty(input.consumedQty);
  const returned = roundRmQty(input.returnedQty ?? 0);
  const runnerWasteQty = roundRmQty(Math.max(0, Number(input.runnerWasteQty) || 0));
  const requiredAllocation = computeRmLineRequiredAllocation({
    issuedQty: issued,
    consumedQty: consumed,
    returnedQty: returned,
  });
  const defaultManual = roundRmQty(Math.max(0, requiredAllocation - runnerWasteQty));
  const manualWasteQty =
    input.manualWasteQty != null && Number.isFinite(Number(input.manualWasteQty))
      ? roundRmQty(Math.max(0, Number(input.manualWasteQty)))
      : defaultManual;
  const unexplainedBalance = roundRmQty(issued - consumed - returned - runnerWasteQty - manualWasteQty);
  return {
    requiredAllocation,
    runnerWasteQty,
    manualWasteQty,
    unexplainedBalance: Math.abs(unexplainedBalance) <= EPS ? 0 : unexplainedBalance,
  };
}

/** Format RM qty for inputs/display without collapsing decimals to whole numbers. */
export function fmtRmQty(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) <= 1e-9) return "0";
  const r = roundRmQty(v);
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return String(r);
}
