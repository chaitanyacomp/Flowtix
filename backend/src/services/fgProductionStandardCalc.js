/**
 * FG Production Standard — expected qty from cycle time, cavities, efficiency, net shift.
 * Preview Shift is never stored on the master row.
 */

/**
 * @param {unknown} value
 * @returns {number}
 */
function toPositiveNumber(value, fieldLabel) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error(`${fieldLabel} must be greater than zero.`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/**
 * @param {unknown} cycleTimeSecondsRaw
 * @param {unknown} piecesPerCycleRaw
 * @param {unknown} efficiencyPercentRaw
 * @param {unknown} netShiftMinutesRaw
 */
function computeExpectedShiftQty({
  cycleTimeSeconds: cycleTimeSecondsRaw,
  piecesPerCycle: piecesPerCycleRaw,
  standardEfficiencyPercent: efficiencyPercentRaw,
  netShiftMinutes: netShiftMinutesRaw,
}) {
  const cycleTimeSeconds = toPositiveNumber(cycleTimeSecondsRaw, "Cycle time");
  const piecesRaw = Number(piecesPerCycleRaw);
  if (!Number.isFinite(piecesRaw) || !Number.isInteger(piecesRaw) || piecesRaw < 1) {
    const err = new Error("Pieces per cycle must be a positive whole number.");
    err.statusCode = 400;
    throw err;
  }
  const piecesPerCycle = piecesRaw;

  const efficiency = Number(efficiencyPercentRaw);
  if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 100) {
    const err = new Error("Standard efficiency % must be greater than 0 and not more than 100.");
    err.statusCode = 400;
    throw err;
  }

  const netShiftMinutes = Number(netShiftMinutesRaw);
  if (!Number.isFinite(netShiftMinutes) || netShiftMinutes <= 0) {
    const err = new Error("Net shift minutes must be greater than zero for preview.");
    err.statusCode = 400;
    throw err;
  }

  const netShiftSeconds = netShiftMinutes * 60;
  const cyclesPerShift = netShiftSeconds / cycleTimeSeconds;
  const theoreticalQuantity = Math.floor(cyclesPerShift * piecesPerCycle);
  const expectedQuantity = Math.floor(cyclesPerShift * piecesPerCycle * (efficiency / 100));

  return {
    cycleTimeSeconds,
    piecesPerCycle,
    standardEfficiencyPercent: efficiency,
    netShiftMinutes,
    netShiftSeconds,
    theoreticalQuantity,
    expectedQuantity,
  };
}

/**
 * Soft validation used by create/update (no net-shift required).
 */
function validateStandardInputs({
  cycleTimeSeconds: cycleTimeSecondsRaw,
  piecesPerCycle: piecesPerCycleRaw,
  standardEfficiencyPercent: efficiencyPercentRaw,
}) {
  const cycleTimeSeconds = toPositiveNumber(cycleTimeSecondsRaw, "Cycle time");
  const piecesRaw = Number(piecesPerCycleRaw);
  if (!Number.isFinite(piecesRaw) || !Number.isInteger(piecesRaw) || piecesRaw < 1) {
    const err = new Error("Pieces per cycle must be a positive whole number.");
    err.statusCode = 400;
    throw err;
  }
  const efficiency = Number(efficiencyPercentRaw);
  if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 100) {
    const err = new Error("Standard efficiency % must be greater than 0 and not more than 100.");
    err.statusCode = 400;
    throw err;
  }
  return {
    cycleTimeSeconds,
    piecesPerCycle: piecesRaw,
    standardEfficiencyPercent: efficiency,
  };
}

module.exports = {
  computeExpectedShiftQty,
  validateStandardInputs,
};
