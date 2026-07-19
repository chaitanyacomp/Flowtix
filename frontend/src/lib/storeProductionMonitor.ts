/**
 * Store Operations — Production Monitor presentation.
 * Status buckets map from the canonical Production Workbench classifier
 * (same source Production Workspace uses). No independent status invention.
 */

import type { DashboardProductionStatusSource } from "./dashboardProductionStatus";
import { formatFgQuantity, normalizeUnitToken } from "./quantityDisplay";
import {
  classifyProductionWorkbenchState,
  classifyProductionWorkspaceSectionFromState,
  type ProductionWorkbenchState,
} from "./productionWorkbenchState";
import { buildProductionWorkspaceSectionCounts } from "./productionWorkspaceSections";

const EPS = 1e-6;

/** Canonical display casing for common count units (avoid nos vs Nos). */
const MONITOR_UNIT_DISPLAY: Record<string, string> = {
  NOS: "Nos",
  NO: "Nos",
  PCS: "Pcs",
  PC: "Pcs",
  KG: "Kg",
  GM: "Gm",
  MTR: "Meter",
  METER: "Meter",
  MT: "Mt",
  LTR: "Ltr",
};

export type StoreProductionMonitorStatus =
  | "READY_TO_START"
  | "RUNNING"
  | "PAUSED"
  | "BLOCKED"
  | "AWAITING_REPORT"
  | "COMPLETED"
  | "PENDING_QC";

export type StoreProductionMonitorFilter =
  | "ALL_ACTIVE"
  | "RUNNING"
  | "PAUSED"
  | "BLOCKED"
  | "AWAITING_REPORT"
  | "READY_TO_START"
  | "COMPLETED_TODAY";

export type StoreProductionMonitorRow = DashboardProductionStatusSource & {
  readOnly?: boolean;
  completedToday?: boolean;
  lastProductionActivityAt?: string | null;
  completedAt?: string | null;
  machineLabel?: string | null;
  /** Mapped monitor status for Store UI. */
  monitorStatus: StoreProductionMonitorStatus;
  /** Short single-line Next column label. */
  nextActionText: string;
  /** Full message for tooltip when Next is truncated / needs context. */
  nextActionTooltip: string;
};

export type StoreProductionMonitorCounts = {
  readyToStart: number;
  running: number;
  paused: number;
  blocked: number;
  awaitingReport: number;
  completedToday: number;
};

/** Workspace section counts for parity checks (Ready / Running / Paused / Report). */
export type StoreProductionMonitorWorkspaceParity = {
  ready: number;
  active: number;
  paused: number;
  reportPending: number;
};

const MONITOR_SORT_RANK: Record<StoreProductionMonitorStatus, number> = {
  BLOCKED: 1,
  PAUSED: 2,
  RUNNING: 3,
  AWAITING_REPORT: 4,
  READY_TO_START: 5,
  PENDING_QC: 6,
  COMPLETED: 7,
};

/**
 * Map workbench state → Store monitor bucket.
 * DRAFT_PENDING (Review & Finalize) follows Production Workspace sectioning:
 * never-started → Ready; already produced → Running — so Ready/Running counts match.
 * PRODUCTION_REPORT_PENDING alone maps to Awaiting Report.
 */
export function workbenchStateToMonitorStatus(
  state: ProductionWorkbenchState,
  opts?: { completedToday?: boolean; producedQty?: number },
): StoreProductionMonitorStatus {
  if (opts?.completedToday) return "COMPLETED";
  switch (state) {
    case "READY_TO_START":
      return "READY_TO_START";
    case "CONTINUE_PRODUCTION":
      return "RUNNING";
    case "PAUSED_PRODUCTION":
      return "PAUSED";
    case "BLOCKED":
      return "BLOCKED";
    case "PRODUCTION_REPORT_PENDING":
      return "AWAITING_REPORT";
    case "DRAFT_PENDING":
      return Number(opts?.producedQty ?? 0) > EPS ? "RUNNING" : "READY_TO_START";
    case "QC_PENDING_ONLY":
      return "PENDING_QC";
    case "COMPLETED_OR_CLOSED":
      return "COMPLETED";
    default:
      return "BLOCKED";
  }
}

export function storeMonitorStatusLabel(status: StoreProductionMonitorStatus): string {
  switch (status) {
    case "READY_TO_START":
      return "Ready to Start";
    case "RUNNING":
      return "Running";
    case "PAUSED":
      return "Paused";
    case "BLOCKED":
      return "Blocked";
    case "AWAITING_REPORT":
      return "Awaiting Report";
    case "COMPLETED":
      return "Completed Today";
    case "PENDING_QC":
      return "Pending QC";
  }
}

export function storeMonitorStatusToneClass(status: StoreProductionMonitorStatus): string {
  switch (status) {
    case "READY_TO_START":
      return "bg-sky-100 text-sky-950 ring-sky-200/80";
    case "RUNNING":
      return "bg-emerald-100 text-emerald-950 ring-emerald-200/80";
    case "PAUSED":
      return "bg-amber-100 text-amber-950 ring-amber-200/80";
    case "BLOCKED":
      return "bg-rose-100 text-rose-950 ring-rose-200/80";
    case "AWAITING_REPORT":
      return "bg-violet-100 text-violet-950 ring-violet-200/80";
    case "COMPLETED":
      return "bg-slate-100 text-slate-700 ring-slate-200/80";
    case "PENDING_QC":
      return "bg-orange-100 text-orange-950 ring-orange-200/80";
  }
}

function upper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

function isRmAwaiting(row: DashboardProductionStatusSource): boolean {
  if (row.rmReadyForProduction === false) return true;
  const gate = upper(row.rmReadinessGate);
  if (!gate) return false;
  if (gate === "READY" || gate === "READY_FOR_PRODUCTION" || gate === "OK") return false;
  return (
    gate.includes("SHORT") ||
    gate.includes("WAIT") ||
    gate.includes("BLOCK") ||
    gate === "NO_PMR" ||
    gate.includes("ISSUE")
  );
}

/**
 * Short single-line Next labels for the collapsed row (nowrap).
 * Read-only monitor copy — not mutation CTAs.
 */
export function storeMonitorNextActionText(
  status: StoreProductionMonitorStatus,
  row: DashboardProductionStatusSource,
): string {
  const next = upper(row.nextAction);
  const exec = upper(row.productionExecutionStatus);
  const backendLabel = String(row.actionLabel ?? "").trim();

  if (status === "READY_TO_START" && isRmAwaiting(row)) return "Awaiting RM";
  if (status === "BLOCKED" && isRmAwaiting(row)) return "Awaiting RM";

  switch (status) {
    case "READY_TO_START":
      return "Start production";
    case "RUNNING":
      return "Continue production";
    case "PAUSED":
      return "Resume production";
    case "AWAITING_REPORT":
      if (
        next === "PRODUCTION_SHORTFALL_DECISION" ||
        exec === "SHORTFALL_PENDING" ||
        /shortage|shortfall/i.test(backendLabel)
      ) {
        return "Resolve shortage";
      }
      return "Complete report";
    case "BLOCKED":
      return "Awaiting RM";
    case "COMPLETED":
      return "Completed";
    case "PENDING_QC":
      return "Pending QC";
  }
}

/** Longer tooltip / detail context for Next (block reason, etc.). */
export function storeMonitorNextActionTooltip(
  status: StoreProductionMonitorStatus,
  row: DashboardProductionStatusSource,
  shortLabel: string,
): string {
  const block =
    String(row.productionBlockReasonLabel ?? "").trim() ||
    String(row.holdReason ?? "").trim() ||
    String(row.productionBlockRemarks ?? "").trim();
  if (block && (status === "PAUSED" || status === "BLOCKED")) {
    return `${shortLabel} — ${block}`;
  }
  if (status === "READY_TO_START" && isRmAwaiting(row)) {
    const gate = String(row.rmReadinessGate ?? "").trim();
    return gate ? `Awaiting RM (${gate.replace(/_/g, " ")})` : "Awaiting RM";
  }
  return shortLabel;
}

export function enrichStoreProductionMonitorRow(
  row: DashboardProductionStatusSource & {
    completedToday?: boolean;
    lastProductionActivityAt?: string | null;
    completedAt?: string | null;
  },
): StoreProductionMonitorRow {
  const completedToday = Boolean(row.completedToday);
  const workbench = completedToday
    ? ("COMPLETED_OR_CLOSED" as const)
    : classifyProductionWorkbenchState(row);
  let monitorStatus = workbenchStateToMonitorStatus(workbench, {
    completedToday,
    producedQty: Number(row.producedQty ?? 0),
  });

  // Prefer workspace section for Ready/Running/Paused/Report parity when not completed.
  if (!completedToday) {
    const section = classifyProductionWorkspaceSectionFromState(row);
    if (section === "ready") monitorStatus = "READY_TO_START";
    else if (section === "active") monitorStatus = "RUNNING";
    else if (section === "paused") monitorStatus = "PAUSED";
    else if (section === "reportPending") monitorStatus = "AWAITING_REPORT";
    else if (section === "pendingQa") monitorStatus = "PENDING_QC";
    else if (workbench === "BLOCKED") monitorStatus = "BLOCKED";
  }

  const nextActionText =
    workbench === "DRAFT_PENDING"
      ? "Complete report"
      : storeMonitorNextActionText(monitorStatus, row);
  const nextActionTooltip = storeMonitorNextActionTooltip(monitorStatus, row, nextActionText);

  return {
    ...row,
    readOnly: true,
    completedToday,
    monitorStatus,
    nextActionText,
    nextActionTooltip,
  };
}

function distinctWoCount(rows: StoreProductionMonitorRow[]): number {
  return new Set(rows.map((r) => r.workOrderId)).size;
}

export function buildStoreProductionMonitorCounts(
  activeRows: StoreProductionMonitorRow[],
  completedTodayRows: StoreProductionMonitorRow[],
): StoreProductionMonitorCounts {
  return {
    readyToStart: distinctWoCount(activeRows.filter((r) => r.monitorStatus === "READY_TO_START")),
    running: distinctWoCount(activeRows.filter((r) => r.monitorStatus === "RUNNING")),
    paused: distinctWoCount(activeRows.filter((r) => r.monitorStatus === "PAUSED")),
    blocked: distinctWoCount(activeRows.filter((r) => r.monitorStatus === "BLOCKED")),
    awaitingReport: distinctWoCount(activeRows.filter((r) => r.monitorStatus === "AWAITING_REPORT")),
    completedToday: distinctWoCount(completedTodayRows),
  };
}

/** Parity with Production Workspace section counts (same classifier path). */
export function buildStoreMonitorWorkspaceParity(
  activeQueueRows: DashboardProductionStatusSource[],
): StoreProductionMonitorWorkspaceParity {
  const c = buildProductionWorkspaceSectionCounts(activeQueueRows, []);
  return {
    ready: c.ready,
    active: c.active,
    paused: c.paused,
    reportPending: c.reportPending,
  };
}

export function sortStoreProductionMonitorRows(rows: StoreProductionMonitorRow[]): StoreProductionMonitorRow[] {
  return [...rows].sort((a, b) => {
    const ra = MONITOR_SORT_RANK[a.monitorStatus] ?? 99;
    const rb = MONITOR_SORT_RANK[b.monitorStatus] ?? 99;
    if (ra !== rb) return ra - rb;
    return b.workOrderId - a.workOrderId;
  });
}

export function filterStoreProductionMonitorRows(
  activeRows: StoreProductionMonitorRow[],
  completedTodayRows: StoreProductionMonitorRow[],
  opts: {
    filter: StoreProductionMonitorFilter;
    query?: string;
    machine?: string;
  },
): StoreProductionMonitorRow[] {
  const filter = opts.filter;
  let base: StoreProductionMonitorRow[];
  if (filter === "COMPLETED_TODAY") {
    base = completedTodayRows;
  } else if (filter === "ALL_ACTIVE") {
    base = activeRows;
  } else {
    base = activeRows.filter((r) => r.monitorStatus === filter);
  }

  const q = String(opts.query ?? "")
    .trim()
    .toLowerCase();
  if (q) {
    base = base.filter((r) => {
      const hay = [
        r.workOrderNo,
        String(r.workOrderId),
        r.salesOrderNo,
        String(r.salesOrderId ?? ""),
        r.customerName,
        r.itemName,
        r.itemCode,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const machine = String(opts.machine ?? "")
    .trim()
    .toLowerCase();
  if (machine) {
    base = base.filter((r) => String(r.machineLabel ?? "").toLowerCase().includes(machine));
  }

  return sortStoreProductionMonitorRows(base);
}

/** Normalize item unit for consistent display (e.g. nos / NOS → Nos). */
export function formatMonitorUnitLabel(unit?: string | null): string {
  const raw = String(unit ?? "").trim();
  if (!raw) return "";
  const token = normalizeUnitToken(raw);
  if (MONITOR_UNIT_DISPLAY[token]) return MONITOR_UNIT_DISPLAY[token];
  if (raw === raw.toUpperCase() || raw === raw.toLowerCase()) {
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  return raw;
}

/** FG qty with locale grouping + canonical unit casing: `2,000 Nos`. */
export function formatMonitorQty(qty: number | null | undefined, unit?: string | null): string {
  const label = formatMonitorUnitLabel(unit);
  return formatFgQuantity(qty, label || unit || null);
}

export function collectMonitorMachines(
  activeRows: StoreProductionMonitorRow[],
  completedTodayRows: StoreProductionMonitorRow[],
): string[] {
  const set = new Set<string>();
  for (const r of [...activeRows, ...completedTodayRows]) {
    const m = String(r.machineLabel ?? "").trim();
    if (m) set.add(m);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Store must never navigate to production mutation deep-links from this monitor. */
export function isStoreProductionMutationHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const h = href.toLowerCase();
  return (
    h.includes("startproduction") ||
    h.includes("recordproduction") ||
    h.includes("finalize") ||
    h.includes("closewo") ||
    h.includes("action=start") ||
    h.includes("action=pause") ||
    h.includes("action=resume") ||
    h.includes("action=continue")
  );
}
