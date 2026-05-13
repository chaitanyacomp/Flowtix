/**
 * Controls payment-tracking input display for commercial follow-up fields (not accounting).
 * Blank input reads clearer than "0" until the user has intentionally tracked receipt/payment.
 */

function parseMoneyField(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Sales bill — received amount textbox: blank unless amount is set or zero was intentionally saved. */
export function salesReceivedAmountInputValue(bill: {
  receivedAmount?: string | null;
  paymentStatus?: string | null;
  paymentRemarks?: string | null;
}): string {
  const n = parseMoneyField(bill.receivedAmount);
  if (n === null) return "";
  if (n !== 0) return String(n);
  const intentional =
    Boolean(bill.paymentRemarks?.trim()) ||
    bill.paymentStatus === "PARTIAL" ||
    bill.paymentStatus === "PAID";
  return intentional ? "0" : "";
}

/** Purchase bill — paid amount textbox (same UX; purchase bill has no payment remarks field today). */
export function purchasePaidAmountInputValue(bill: {
  paidAmount?: string | null;
  paymentStatus?: string | null;
}): string {
  const n = parseMoneyField(bill.paidAmount);
  if (n === null) return "";
  if (n !== 0) return String(n);
  const intentional = bill.paymentStatus === "PARTIAL" || bill.paymentStatus === "PAID";
  return intentional ? "0" : "";
}
