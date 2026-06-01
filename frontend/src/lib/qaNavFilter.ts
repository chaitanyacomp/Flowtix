/**
 * QA desk sidebar — allow-list (Phase 2 UI cleanup).
 */
const QA_VISIBLE_NAV_KEYS = new Set(["dash-home", "qc", "qc-report"]);

export function isQaNavItemVisible(role: string, navKey: string): boolean {
  if (role !== "QA") return true;
  return QA_VISIBLE_NAV_KEYS.has(navKey);
}
