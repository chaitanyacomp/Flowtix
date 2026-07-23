/**
 * Production Workspace operational sections for 20–25 concurrent WOs.
 * Uses the same canonical workbench state as Dashboard / Pending Actions / process screen.
 */

import type { DashboardProductionStatusRow, DashboardProductionStatusSource } from "./dashboardProductionStatus";
import { buildDashboardProductionStatusRows } from "./dashboardProductionStatus";
import { classifyProductionWorkspaceSectionFromState } from "./productionWorkbenchState";

export type ProductionWorkspaceSectionId =
  | "ready"
  | "draftPending"
  | "active"
  | "paused"
  | "reportPending"
  | "pendingQa"
  | "awaitingStore"
  | "recent";

export type ProductionWorkspaceSectionCounts = Record<ProductionWorkspaceSectionId, number>;

export type RmReturnPendingSectionRow = {
  workOrderId: number;
  workOrderNo?: string | null;
  itemName?: string;
  requestedQty?: number;
  unit?: string;
  status?: string;
  id?: number;
};

function upper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

export function classifyProductionWorkspaceSection(
  row: DashboardProductionStatusSource,
): Exclude<ProductionWorkspaceSectionId, "awaitingStore" | "recent"> | null {
  return classifyProductionWorkspaceSectionFromState(row);
}

export function buildProductionWorkspaceSectionRows(
  queueRows: DashboardProductionStatusSource[],
): {
  active: DashboardProductionStatusRow[];
  ready: DashboardProductionStatusRow[];
  draftPending: DashboardProductionStatusRow[];
  paused: DashboardProductionStatusRow[];
  reportPending: DashboardProductionStatusRow[];
  pendingQa: DashboardProductionStatusRow[];
  all: DashboardProductionStatusRow[];
} {
  const built = buildDashboardProductionStatusRows(queueRows, { limit: Math.max(queueRows.length, 1) });
  const active: DashboardProductionStatusRow[] = [];
  const ready: DashboardProductionStatusRow[] = [];
  const draftPending: DashboardProductionStatusRow[] = [];
  const paused: DashboardProductionStatusRow[] = [];
  const reportPending: DashboardProductionStatusRow[] = [];
  const pendingQa: DashboardProductionStatusRow[] = [];

  for (const row of built.all) {
    const section = classifyProductionWorkspaceSection(row);
    if (section === "ready") ready.push(row);
    else if (section === "draftPending") draftPending.push(row);
    else if (section === "active") active.push(row);
    else if (section === "paused") paused.push(row);
    else if (section === "reportPending") reportPending.push(row);
    else if (section === "pendingQa") pendingQa.push(row);
  }

  const byWoAge = (a: DashboardProductionStatusRow, b: DashboardProductionStatusRow) =>
    b.workOrderId - a.workOrderId;

  return {
    active: [...active].sort(byWoAge),
    ready: [...ready].sort(byWoAge),
    draftPending: [...draftPending].sort(byWoAge),
    paused: [...paused].sort(byWoAge),
    reportPending: [...reportPending].sort(byWoAge),
    pendingQa: [...pendingQa].sort(byWoAge),
    all: built.all,
  };
}

export function buildProductionWorkspaceSectionCounts(
  queueRows: DashboardProductionStatusSource[],
  rmReturnPending: RmReturnPendingSectionRow[],
  recentEntryCount = 0,
): ProductionWorkspaceSectionCounts {
  const sections = buildProductionWorkspaceSectionRows(queueRows);
  const woPaused = new Set(sections.paused.map((r) => r.workOrderId));
  const woReady = new Set(sections.ready.map((r) => r.workOrderId));
  const woDraft = new Set(sections.draftPending.map((r) => r.workOrderId));
  const woActive = new Set(sections.active.map((r) => r.workOrderId));
  const woReport = new Set(sections.reportPending.map((r) => r.workOrderId));
  const woQa = new Set(sections.pendingQa.map((r) => r.workOrderId));
  const woStore = new Set(
    rmReturnPending.map((r) => Number(r.workOrderId ?? 0)).filter((id) => id > 0),
  );

  return {
    ready: woReady.size,
    draftPending: woDraft.size,
    active: woActive.size,
    paused: woPaused.size,
    reportPending: woReport.size,
    pendingQa: woQa.size,
    awaitingStore: woStore.size,
    recent: recentEntryCount,
  };
}

export function filterProductionWorkspaceRows(
  rows: DashboardProductionStatusRow[],
  opts: {
    query?: string;
    flow?: string | null;
    sort?: "priority" | "woDesc" | "woAsc" | "product" | "remainingDesc" | "ageDesc";
  },
): DashboardProductionStatusRow[] {
  const q = String(opts.query ?? "")
    .trim()
    .toLowerCase();
  const flow = String(opts.flow ?? "")
    .trim()
    .toUpperCase();

  let out = rows;
  if (flow && flow !== "ALL") {
    out = out.filter((r) => upper(r.orderType) === flow || (flow === "REGULAR" && !r.orderType));
  }
  if (q) {
    out = out.filter((r) => {
      const hay = [
        r.workOrderNo,
        String(r.workOrderId),
        r.salesOrderNo,
        String(r.salesOrderId ?? ""),
        r.customerName,
        r.itemName,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const sort = opts.sort ?? "woDesc";
  const sorted = [...out];
  sorted.sort((a, b) => {
    if (sort === "priority") return (a.sortRank ?? 99) - (b.sortRank ?? 99) || a.workOrderId - b.workOrderId;
    if (sort === "woAsc") return a.workOrderId - b.workOrderId;
    if (sort === "product") return a.itemName.localeCompare(b.itemName) || a.workOrderId - b.workOrderId;
    if (sort === "remainingDesc") return b.remainingQty - a.remainingQty;
    if (sort === "ageDesc") return a.workOrderId - b.workOrderId;
    return b.workOrderId - a.workOrderId;
  });
  return sorted;
}

export function pauseReasonLabel(row: DashboardProductionStatusSource): string {
  const label = String(row.productionBlockReasonLabel ?? "").trim();
  if (label) return label;
  const reason = String(row.productionBlockReason ?? row.holdReason ?? "").trim();
  if (!reason) return "Paused";
  return reason.replace(/_/g, " ");
}

export const PRODUCTION_WORKSPACE_SECTION_LABELS: Record<ProductionWorkspaceSectionId, string> = {
  ready: "Ready to Start",
  draftPending: "Draft Awaiting Approval",
  active: "Continue Production",
  paused: "Paused Production",
  reportPending: "Production Report Pending",
  pendingQa: "Pending QA/QC",
  awaitingStore: "Awaiting Store Approval",
  recent: "Recent Entries",
};
