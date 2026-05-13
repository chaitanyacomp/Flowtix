/** Commercial due-date display — excludes null, invalid, and epoch DB sentinels (not statutory accounting). */

const MIN_UTC_YEAR = 1971;

export function hasEffectiveCommercialDueDate(iso: string | null | undefined): boolean {
  if (iso == null || String(iso).trim() === "") return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  if (d.getUTCFullYear() < MIN_UTC_YEAR) return false;
  return true;
}

/** Table cell: real due dates formatted; missing/invalid/epoch → "No due date". */
export function formatCommercialDueDateCell(iso: string | null | undefined): string {
  if (!hasEffectiveCommercialDueDate(iso)) return "No due date";
  return new Date(iso as string).toLocaleDateString();
}
