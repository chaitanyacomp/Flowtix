/** Mirrors backend `purchaseBillService` rounding for live UI preview. */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeLineTaxSplit(basic: number, gstRatePct: number, intraState: boolean) {
  const rate = Number(gstRatePct) || 0;
  const basicN = round2(basic);
  const tax = round2((basicN * rate) / 100);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (intraState && rate > 0) {
    cgst = round2(tax / 2);
    sgst = round2(tax - cgst);
  } else {
    igst = tax;
  }
  const lineTotal = round2(basicN + tax);
  return { basicAmount: basicN, cgstAmount: cgst, sgstAmount: sgst, igstAmount: igst, lineTotal, totalTax: tax };
}

export function sumBillLines(
  lines: Array<{
    basicAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    lineTotal: number;
  }>,
) {
  let totalBasic = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalTax = 0;
  let netAmount = 0;
  for (const ln of lines) {
    totalBasic += ln.basicAmount;
    totalCgst += ln.cgstAmount;
    totalSgst += ln.sgstAmount;
    totalIgst += ln.igstAmount;
    totalTax += ln.cgstAmount + ln.sgstAmount + ln.igstAmount;
    netAmount += ln.lineTotal;
  }
  return {
    totalBasic: round2(totalBasic),
    totalCgst: round2(totalCgst),
    totalSgst: round2(totalSgst),
    totalIgst: round2(totalIgst),
    totalTax: round2(totalTax),
    netAmount: round2(netAmount),
  };
}
