export type SalesBillTaxLine = {
  gstRate?: string | number | null;
  basicAmount: string | number;
  goodsTaxableAmount?: string | number | null;
  transportationAllocation?: string | number | null;
  cgstAmount: string | number;
  sgstAmount: string | number;
  igstAmount: string | number;
};

const moneyCents = (value: string | number | null | undefined): number => Math.round(Number(value || 0) * 100);
const centsText = (cents: number): string => (cents / 100).toFixed(2);

export function formatGstPercent(value: string | number | null | undefined): string {
  const rate = Number(value || 0);
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function lineTaxRates(line: SalesBillTaxLine, intraState: boolean) {
  const gstRate = Number(line.gstRate || 0);
  return {
    gst: formatGstPercent(gstRate),
    cgst: intraState ? formatGstPercent(gstRate / 2) : null,
    sgst: intraState ? formatGstPercent(gstRate / 2) : null,
    igst: intraState ? null : formatGstPercent(gstRate),
  };
}

export function buildSalesBillTaxSummary(lines: SalesBillTaxLine[], intraState: boolean) {
  const buckets = new Map<number, { gstRate: number; taxableCents: number; cgstCents: number; sgstCents: number; igstCents: number }>();
  for (const line of lines) {
    const gstRate = Number(line.gstRate || 0);
    const bucket = buckets.get(gstRate) || { gstRate, taxableCents: 0, cgstCents: 0, sgstCents: 0, igstCents: 0 };
    bucket.taxableCents += moneyCents(line.basicAmount);
    bucket.cgstCents += moneyCents(line.cgstAmount);
    bucket.sgstCents += moneyCents(line.sgstAmount);
    bucket.igstCents += moneyCents(line.igstAmount);
    buckets.set(gstRate, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.gstRate - b.gstRate).map((bucket) => ({
    gstRate: bucket.gstRate,
    gstRateLabel: formatGstPercent(bucket.gstRate),
    cgstRateLabel: intraState ? formatGstPercent(bucket.gstRate / 2) : null,
    sgstRateLabel: intraState ? formatGstPercent(bucket.gstRate / 2) : null,
    igstRateLabel: intraState ? null : formatGstPercent(bucket.gstRate),
    taxableValue: centsText(bucket.taxableCents), cgstAmount: centsText(bucket.cgstCents),
    sgstAmount: centsText(bucket.sgstCents), igstAmount: centsText(bucket.igstCents),
  }));
}
