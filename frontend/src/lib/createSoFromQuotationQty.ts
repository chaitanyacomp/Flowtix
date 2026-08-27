/**
 * Client-side guards for REGULAR create-from-quotation Customer PO Qty.
 * Backend assertFromQuotationCustomerPoQuantities remains authoritative.
 */

export type QuoteLineQtyInput = {
  itemId: number;
  quotedQty: number;
  customerPoQty: string | number;
};

export type QuoteLineQtyIssue = {
  lineIndex: number;
  itemId: number;
  quotedQty: number;
  enteredQty: number;
  message: string;
};

export function parsePositiveQty(raw: string | number | null | undefined): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Max allowed Customer PO Qty for a quotation-linked SO line (= quoted qty). */
export function maxCustomerPoQtyFromQuoted(quotedQty: number): number {
  const q = Number(quotedQty);
  if (!Number.isFinite(q) || q < 0) return 0;
  return q;
}

export function validateCreateFromQuotationLineQtys(lines: QuoteLineQtyInput[]): QuoteLineQtyIssue[] {
  const issues: QuoteLineQtyIssue[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    const quoted = maxCustomerPoQtyFromQuoted(row.quotedQty);
    const entered = parsePositiveQty(row.customerPoQty);
    if (entered == null) {
      issues.push({
        lineIndex: i,
        itemId: row.itemId,
        quotedQty: quoted,
        enteredQty: Number(row.customerPoQty) || 0,
        message: "Customer PO Qty must be greater than zero.",
      });
      continue;
    }
    if (entered > quoted) {
      issues.push({
        lineIndex: i,
        itemId: row.itemId,
        quotedQty: quoted,
        enteredQty: entered,
        message: `Customer PO qty (${entered}) exceeds approved quotation qty (${quoted}).`,
      });
    }
  }
  return issues;
}

export function formatQuoteQtyDisplay(qty: number | string | null | undefined): string {
  const n = Number(qty);
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return String(n);
}
