/** Shared helpers for quotation line forms: keep numeric fields as strings while editing so empty fields do not coerce to 0. */

export type QuoteLineDraft = {
  itemId: number;
  qty: string;
  rate: string;
  discountPct: string;
  gstPct: string;
  isFree: boolean;
};

const MSG_QTY_POSITIVE = "Quantity must be greater than zero.";
const MSG_RATE_POSITIVE = "Rate must be greater than zero for non-free items.";
const MSG_FREE_ZERO_RATE = "Free items must have zero rate.";
const MSG_DISC_NUM = "Discount % must be a valid number.";
const MSG_GST_NUM = "GST % must be a valid number.";

export function previewNum(s: string): number {
  const n = Number.parseFloat(String(s).trim());
  return Number.isFinite(n) ? n : 0;
}

export function lineTotalFromDraft(
  l: Pick<QuoteLineDraft, "qty" | "rate" | "discountPct" | "gstPct" | "isFree">,
  lineTotal: (
    qty: number,
    rate: number,
    discountPct: number,
    gstPct: number,
    isFree?: boolean,
  ) => number,
): number {
  return lineTotal(
    previewNum(l.qty),
    previewNum(l.rate),
    previewNum(l.discountPct),
    previewNum(l.gstPct),
    l.isFree,
  );
}

export function validateQuoteLinesForSave(lines: QuoteLineDraft[]): string | null {
  for (const l of lines) {
    const qty = Number.parseFloat(l.qty.trim());
    if (!Number.isFinite(qty) || qty <= 0) return MSG_QTY_POSITIVE;

    if (l.isFree) {
      const rate = Number.parseFloat(l.rate.trim());
      if (Number.isFinite(rate) && Math.abs(rate) > 1e-6) return MSG_FREE_ZERO_RATE;
    } else {
      const rate = Number.parseFloat(l.rate.trim());
      if (!Number.isFinite(rate) || rate <= 1e-6) return MSG_RATE_POSITIVE;
    }

    if (l.discountPct.trim() !== "") {
      const d = Number.parseFloat(l.discountPct.trim());
      if (!Number.isFinite(d)) return MSG_DISC_NUM;
    }
    if (l.gstPct.trim() !== "") {
      const g = Number.parseFloat(l.gstPct.trim());
      if (!Number.isFinite(g)) return MSG_GST_NUM;
    }
  }
  return null;
}

/** Maps draft lines to API payload numbers (defaults match prior behavior: discount 0, GST 18 when empty). */
export function draftLinesToApiPayload(lines: QuoteLineDraft[]) {
  return lines.map((l) => {
    const qty = Number.parseFloat(l.qty.trim());
    const rate = l.isFree ? 0 : Number.parseFloat(l.rate.trim());
    const discountPct =
      l.discountPct.trim() === "" ? 0 : Number.parseFloat(l.discountPct.trim());
    const gstPct = l.gstPct.trim() === "" ? 18 : Number.parseFloat(l.gstPct.trim());
    return {
      itemId: l.itemId,
      qty,
      rate,
      discountPct: Number.isFinite(discountPct) ? discountPct : 0,
      gstPct: Number.isFinite(gstPct) ? gstPct : 18,
      isFree: l.isFree,
    };
  });
}

export function defaultQuoteLineDraft(itemId: number): QuoteLineDraft {
  return {
    itemId,
    qty: "",
    rate: "",
    discountPct: "0",
    gstPct: "18",
    isFree: false,
  };
}
