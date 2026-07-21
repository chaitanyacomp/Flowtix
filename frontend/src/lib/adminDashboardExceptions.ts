/**
 * Compact Admin Dashboard critical-exception rows (presentation only).
 * Deep-links open Control Tower with filters — not full operational queues.
 */

import { controlTowerHref } from "./controlTowerNavigation";

export type AdminCriticalException = {
  key: string;
  document: string;
  issue: string;
  owner: string;
  ageLabel: string;
  href: string;
};

type BuildInput = {
  blockedWoCount?: number;
  rmCriticalCount?: number;
  qcPendingCount?: number;
  dispatchPendingCount?: number;
  recoveryOpenCount?: number;
  exportPendingCount?: number;
  firstBlockedDoc?: string | null;
};

export function buildAdminCriticalExceptions(input: BuildInput): AdminCriticalException[] {
  const out: AdminCriticalException[] = [];
  if ((input.blockedWoCount ?? 0) > 0) {
    out.push({
      key: "blocked-wo",
      document: input.firstBlockedDoc?.trim() || `${input.blockedWoCount} work order(s)`,
      issue: "Blocked / RM shortage preventing production",
      owner: "Store",
      ageLabel: "Active",
      href: controlTowerHref({ group: "RM_READINESS", blockedOnly: true }),
    });
  }
  if ((input.rmCriticalCount ?? 0) > 0) {
    out.push({
      key: "stock-critical",
      document: `${input.rmCriticalCount} RM item(s)`,
      issue: "Stock critical below minimum",
      owner: "Store",
      ageLabel: "Active",
      href: controlTowerHref({ focus: "factory", blockedOnly: true }),
    });
  }
  if ((input.qcPendingCount ?? 0) > 0) {
    out.push({
      key: "qc-overdue",
      document: `${input.qcPendingCount} batch(es)`,
      issue: "Pending QC",
      owner: "QA",
      ageLabel: "Active",
      href: controlTowerHref({ group: "QUALITY", status: "QA_PENDING" }),
    });
  }
  if ((input.dispatchPendingCount ?? 0) > 0) {
    out.push({
      key: "dispatch-overdue",
      document: `${input.dispatchPendingCount} line(s)`,
      issue: "Dispatch ready / prep pending",
      owner: "Store",
      ageLabel: "Active",
      href: controlTowerHref({ group: "DISPATCH" }),
    });
  }
  if ((input.recoveryOpenCount ?? 0) > 0) {
    out.push({
      key: "noqty-recovery",
      document: `${input.recoveryOpenCount} recovery source(s)`,
      issue: "NO_QTY recovery unresolved",
      owner: "Admin",
      ageLabel: "Active",
      href: controlTowerHref({ focus: "recovery" }),
    });
  }
  if ((input.exportPendingCount ?? 0) > 0) {
    out.push({
      key: "export-blocked",
      document: `${input.exportPendingCount} bill(s)`,
      issue: "Tally export / billing pending",
      owner: "Admin",
      ageLabel: "Active",
      href: controlTowerHref({ group: "COMMERCIAL_CLOSURE", focus: "commercial" }),
    });
  }
  return out.slice(0, 5);
}
