export function effectiveQty(baseQty: number, wastagePercent: number) {
  return Number(baseQty) * (1 + Number(wastagePercent) / 100);
}
