/**
 * Roles allowed to open each drill destination, aligned with AppLayout sidebar nav.
 */
export const DRILL_TARGET_ROLES = {
  "sales-order": ["ADMIN", "PRODUCTION"],
  "work-order": ["ADMIN", "PRODUCTION"],
  "qc-entry": ["ADMIN", "QA"],
  stock: ["ADMIN", "STORE", "PRODUCTION", "PURCHASE", "QA"],
  "rm-po-grn": ["ADMIN", "PURCHASE", "STORE"],
} as const;

export type DrillTargetKey = keyof typeof DRILL_TARGET_ROLES;

export const DRILL_ACCESS_REQUIRED_TITLE =
  "Access required — your role cannot open this page from the menu.";

export function roleMayUseDrillTarget(userRole: string | undefined, target: DrillTargetKey): boolean {
  if (!userRole) return false;
  return (DRILL_TARGET_ROLES[target] as readonly string[]).includes(userRole);
}
