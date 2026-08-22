/**
 * FG Production Standard expected-qty helpers (mirrors backend fgProductionStandardCalc.js).
 */

export type ExpectedQtyPreview = {
  cycleTimeSeconds: number;
  piecesPerCycle: number;
  standardEfficiencyPercent: number;
  netShiftMinutes: number;
  netShiftSeconds: number;
  theoreticalQuantity: number;
  expectedQuantity: number;
  error?: string;
};

export function computeExpectedShiftQtyPreview(input: {
  cycleTimeSeconds: unknown;
  piecesPerCycle?: unknown;
  standardEfficiencyPercent?: unknown;
  netShiftMinutes: unknown;
}): ExpectedQtyPreview | { error: string } {
  const cycleTimeSeconds = Number(input.cycleTimeSeconds);
  if (!Number.isFinite(cycleTimeSeconds) || cycleTimeSeconds <= 0) {
    return { error: "Cycle time must be greater than zero." };
  }

  const piecesRaw =
    input.piecesPerCycle == null || input.piecesPerCycle === "" ? 1 : Number(input.piecesPerCycle);
  if (!Number.isFinite(piecesRaw) || !Number.isInteger(piecesRaw) || piecesRaw < 1) {
    return { error: "Pieces per cycle must be a positive whole number." };
  }

  const efficiencyRaw =
    input.standardEfficiencyPercent == null || input.standardEfficiencyPercent === ""
      ? 95
      : Number(input.standardEfficiencyPercent);
  if (!Number.isFinite(efficiencyRaw) || efficiencyRaw <= 0 || efficiencyRaw > 100) {
    return { error: "Standard efficiency % must be greater than 0 and not more than 100." };
  }

  const netShiftMinutes = Number(input.netShiftMinutes);
  if (!Number.isFinite(netShiftMinutes) || netShiftMinutes <= 0) {
    return { error: "Select an active shift to preview expected quantity." };
  }

  const netShiftSeconds = netShiftMinutes * 60;
  const cyclesPerShift = netShiftSeconds / cycleTimeSeconds;
  return {
    cycleTimeSeconds,
    piecesPerCycle: piecesRaw,
    standardEfficiencyPercent: efficiencyRaw,
    netShiftMinutes,
    netShiftSeconds,
    theoreticalQuantity: Math.floor(cyclesPerShift * piecesRaw),
    expectedQuantity: Math.floor(cyclesPerShift * piecesRaw * (efficiencyRaw / 100)),
  };
}
