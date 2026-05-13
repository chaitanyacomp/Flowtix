export function effectiveQty(baseQty: number, processLossPercent: number, qcAllowancePercent = 0) {
  return Number(baseQty) * (1 + (Number(processLossPercent) + Number(qcAllowancePercent)) / 100);
}
