/**
 * Roles allowed to open each drill destination, aligned with AppLayout sidebar nav
 * (`navSections[].items[].roles` for the matching route). Update both when access changes.
 */
export const DRILL_TARGET_ROLES = {
  "sales-order": ["ADMIN", "STORE", "SALES"],
  "work-order": ["ADMIN", "PRODUCTION"],
  "qc-entry": ["ADMIN", "QC"],
  stock: ["ADMIN", "STORE", "PRODUCTION", "SALES", "QC"],
  "rm-po-grn": ["ADMIN", "STORE"],
} as const;

export type DrillTargetKey = keyof typeof DRILL_TARGET_ROLES;

/** Tooltip/title when the row is not drillable for the current user (matches banner tone). */
export const DRILL_ACCESS_REQUIRED_TITLE =
  "Access required — your role cannot open this page from the menu.";

export function roleMayUseDrillTarget(userRole: string | undefined, target: DrillTargetKey): boolean {
  if (!userRole) return false;
  return (DRILL_TARGET_ROLES[target] as readonly string[]).includes(userRole);
}
