/** Centralized INR currency formatting for operator-facing UI. */
const inrCurrency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a number as Indian Rupees with the ₹ symbol (e.g. ₹8.25).
 * Strips narrow/regular non-breaking spaces some engines insert after ₹.
 */
export function formatInr(value: number): string {
  if (!Number.isFinite(value)) return formatInr(0);
  return inrCurrency.format(value).replace(/[\u00a0\u202f]/g, "");
}
