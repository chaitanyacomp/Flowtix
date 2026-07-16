/**
 * Sanitize report API errors for ERP UI — never show Prisma internals, paths, or stacks.
 * Validation messages (invalid date range, etc.) are preserved when they look operator-facing.
 */

const UNSAFE =
  /Prisma|prisma\.|Invalid `prisma|invocation in|\\src\\|\/src\/|node_modules|at Object\.|Error:\s*Invalid|Unknown argument|Argument `|select:\s*\{|where:\s*\{/i;

export function sanitizeReportUiError(raw: unknown): string {
  const msg = String(raw ?? "").trim();
  if (!msg) return "Unable to load this report. Please try again.";
  if (UNSAFE.test(msg) || msg.length > 280) {
    return "Unable to load this report. Please try again.";
  }
  return msg;
}
