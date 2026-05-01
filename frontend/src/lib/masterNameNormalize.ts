/** Trim and collapse internal whitespace — matches backend `normalizeMasterNameDisplay`. */
export function normalizeMasterNameDisplay(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Alias for `normalizeMasterNameDisplay` (item names, supplier/customer names, units). */
export const normalizeMasterName = normalizeMasterNameDisplay;

/** Key for duplicate checks — matches backend `normalizeMasterNameKey`. */
export function normalizeMasterNameKey(raw: string): string {
  return normalizeMasterNameDisplay(raw).toLowerCase();
}
