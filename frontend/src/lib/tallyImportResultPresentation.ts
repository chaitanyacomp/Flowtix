export function sanitizeTallyImportResultText(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (
    /prisma|node_modules|[a-z]:\\|\/(?:home|users|workspace)\//i.test(raw) ||
    /\bat\s+\S+\s*\([^)]*:\d+:\d+\)/i.test(raw)
  ) {
    return "The master could not be imported safely.";
  }
  return raw.split(/\r?\n/)[0].replace(/\s+at\s+.*:\d+:\d+.*$/i, "").trim();
}

export function tallyImportCorrectiveAction(
  error: string | null | undefined,
  warning: string | null | undefined,
): string {
  const safeWarning = sanitizeTallyImportResultText(warning);
  if (safeWarning) return safeWarning;
  const safeError = sanitizeTallyImportResultText(error);
  if (/equivalent|duplicate|already exists/i.test(safeError)) {
    return "Retry the import; the existing ERP unit will be reused.";
  }
  return "Review the unit mapping, correct the preview row, and retry.";
}
