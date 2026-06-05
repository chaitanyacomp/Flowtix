/** Human-readable Control Tower status labels (mirrors backend enum vocabulary). */
const CONTROL_TOWER_STATUS_LABELS: Record<string, string> = {
  PLANNING_PENDING: "Planning pending",
  WO_PLANNING_PENDING: "WO planning pending",
  WAITING_RM: "Waiting for RM",
  PROCUREMENT_IN_PROGRESS: "Procurement in progress",
  RM_READY_FOR_ISSUE: "RM ready for issue",
  WO_RELEASE_READY: "WO release ready",
  PRODUCTION_PENDING: "Production pending",
  PRODUCTION_ON_HOLD: "Production on hold",
  QA_PENDING: "QA pending",
  QA_REWORK_PENDING: "QA rework pending",
  DISPATCH_PENDING: "Dispatch pending",
  DISPATCH_DRAFT_PENDING: "Dispatch draft pending",
  BILLING_PENDING: "Billing pending",
  EXPORT_PENDING: "Export pending",
  PAYMENT_PENDING: "Payment pending",
  NEXT_RS_READY: "Next RS ready",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  UNKNOWN: "Unknown",
};

const CONTROL_TOWER_OWNER_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  STORE: "Store",
  PURCHASE: "Purchase",
  PRODUCTION: "Production",
  QA: "QA",
};

function titleCaseToken(token: string): string {
  if (!token) return "";
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** Map enum status to a readable validation label. */
export function formatControlTowerStatus(status: string | null | undefined): string {
  const key = String(status ?? "")
    .trim()
    .toUpperCase();
  if (!key) return "—";
  if (CONTROL_TOWER_STATUS_LABELS[key]) return CONTROL_TOWER_STATUS_LABELS[key];
  return key
    .split("_")
    .map(titleCaseToken)
    .join(" ");
}

/** Map owner role code to a readable label. */
export function formatControlTowerOwner(owner: string | null | undefined): string {
  const key = String(owner ?? "")
    .trim()
    .toUpperCase();
  if (!key) return "—";
  if (CONTROL_TOWER_OWNER_LABELS[key]) return CONTROL_TOWER_OWNER_LABELS[key];
  return titleCaseToken(key);
}

/** Format ISO timestamp for the validation status bar. */
export function formatControlTowerLoadedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
