import {
  buildDashboardProductionStatusRows,
  inferProductionHrefRoute,
  type DashboardProductionStatusRow,
  type DashboardProductionStatusSource,
  type ProductionOperationalStatusTone,
} from "./dashboardProductionStatus";
import {
  mapOperationalLabelToNoQtyDisplayLabel,
  resolveNoQtyCycleDisplayStatus,
  resolveNoQtyCycleDisplayStatusForWorkOrder,
} from "./noQtyCycleDisplayStatus";
import {
  NO_QTY_OPERATOR_PENDING_LABEL,
  NO_QTY_OPERATOR_REMAINING_LABEL,
  sumNoQtyErpAdjustedPlanningQty,
  sumNoQtyOperatorPendingQty,
} from "./noQtyShortagePresentation";

export type WoWorkspaceSection = "operationalOpen" | "carryForwardHistory" | "completedCycles";

const QTY_EPS = 0.0001;

/** Operator-facing cycle outcome (presentation only — from production-queue snapshot). */
export type CycleOutcomeDisplay = {
  /** Cycle production target (WO required / planned qty). */
  rsQty: number;
  produced: number;
  /** Operator pending qty = planned − approved produced. */
  pendingQty: number;
  /** Carry-forward planning snapshot (`lastShortageQty` sum). */
  erpAdjustedPlanningQty: number;
};

/** @deprecated Use pendingQty */
export type CycleOutcomeDisplayLegacy = CycleOutcomeDisplay & { carryForwardShortage: number };

/** @deprecated Use CycleOutcomeDisplay */
export type CycleHistoryQtyTrace = CycleOutcomeDisplay & { carryForwardIn?: number; finalPlanned?: number };

export type WoWorkspaceLineItem = {
  fgName: string;
  qty: string;
  workOrderLineId?: number;
};

/** One WO row in the Work Order Workspace (presentation). */
export type WoWorkspaceGroup = {
  woId: number;
  woDocNo?: string | null;
  salesOrderId: number;
  soDocNo?: string | null;
  orderType?: string | null;
  cycleId?: number | null;
  cycleNo?: number | null;
  itemName: string;
  lines: WoWorkspaceLineItem[];
  section: WoWorkspaceSection;
  presentationStatus: string;
  statusTone: ProductionOperationalStatusTone | "regular";
  actionHref: string;
  actionLabel: string;
  contextHint?: string;
  isMuted: boolean;
  qtyTrace?: CycleOutcomeDisplay;
};

export type WoWorkspaceSections = {
  operationalOpen: WoWorkspaceGroup[];
  /** Unified historical cycles (carry-forward + completed), newest cycle first. */
  cycleHistory: WoWorkspaceGroup[];
};

export type WoApiGroupInput = {
  woId: number;
  woDocNo?: string | null;
  salesOrderId: number;
  soDocNo?: string | null;
  orderType?: string | null;
  cycleNo?: number | null;
  status: string;
  lines: WoWorkspaceLineItem[];
};

const NO_QTY_ACTIONABLE = new Set([
  "In Production",
  "Continue Production",
  "Ready for Production",
  "Waiting for Production",
  "Production Pending",
  "QC Pending",
  "Dispatch Pending",
  "Next Cycle",
  "Next Cycle Pending",
  "Carry-forward Pending",
  "Ready to Bill",
]);

const NO_QTY_HISTORY = new Set(["Carried Forward"]);

const NO_QTY_COMPLETED = new Set(["Production Complete", "Completed"]);

const TONE_RANK: Record<ProductionOperationalStatusTone, number> = {
  qc: 0,
  dispatch: 1,
  carryForward: 2,
  running: 3,
  partial: 4,
  idle: 5,
  carriedForward: 9,
};

export function formatWorkspaceQty(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Derive operator-facing outcome from production-queue snapshot (no internal CF-in column). */
export function buildCycleOutcomeFromQueueLines(lines: DashboardProductionStatusRow[]): CycleOutcomeDisplay {
  let rsQty = 0;
  let produced = 0;
  for (const l of lines) {
    rsQty += Math.max(0, Number(l.requiredQty ?? 0));
    produced += Math.max(0, Number(l.producedQty ?? 0));
  }
  return {
    rsQty,
    produced,
    pendingQty: sumNoQtyOperatorPendingQty(lines),
    erpAdjustedPlanningQty: sumNoQtyErpAdjustedPlanningQty(lines),
  };
}

/** @deprecated Use buildCycleOutcomeFromQueueLines */
export function buildCycleHistoryQtyTraceFromQueueLines(
  lines: DashboardProductionStatusRow[],
): CycleOutcomeDisplay {
  return buildCycleOutcomeFromQueueLines(lines);
}

export function buildCycleOutcomeFromApiLines(lines: WoWorkspaceLineItem[]): CycleOutcomeDisplay {
  let rsQty = 0;
  for (const l of lines) {
    const n = Number(l.qty);
    if (Number.isFinite(n)) rsQty += n;
  }
  return { rsQty, produced: 0, pendingQty: 0, erpAdjustedPlanningQty: 0 };
}

/** @deprecated Use buildCycleOutcomeFromApiLines */
export function buildCycleHistoryQtyTraceFromApiLines(lines: WoWorkspaceLineItem[]): CycleOutcomeDisplay {
  return buildCycleOutcomeFromApiLines(lines);
}

/** History line: RS · Produced · pending qty (operator). */
export function formatCycleHistoryOutcomeLine(outcome: CycleOutcomeDisplay | undefined): string {
  if (!outcome) return "—";
  const rs = formatWorkspaceQty(outcome.rsQty);
  const prod = formatWorkspaceQty(outcome.produced);
  if (outcome.pendingQty > QTY_EPS) {
    return `RS ${rs} · Produced ${prod} · ${NO_QTY_OPERATOR_PENDING_LABEL} ${formatWorkspaceQty(outcome.pendingQty)}`;
  }
  return `RS ${rs} · Produced ${prod}`;
}

/** Active cycle card: Planned · Produced · remaining / pending qty (operator). */
export function formatOperationalOutcomeLine(
  outcome: CycleOutcomeDisplay | undefined,
  opts?: { nextCycle?: boolean },
): string {
  if (!outcome) return "—";
  const base = `Planned ${formatWorkspaceQty(outcome.rsQty)} · Produced ${formatWorkspaceQty(outcome.produced)}`;
  if (outcome.pendingQty > QTY_EPS) {
    const label = opts?.nextCycle ? NO_QTY_OPERATOR_PENDING_LABEL : NO_QTY_OPERATOR_REMAINING_LABEL;
    return `${base} · ${label} ${formatWorkspaceQty(outcome.pendingQty)}`;
  }
  return base;
}

export { noQtyWorkspaceStatusLabel } from "./noQtyCycleDisplayStatus";

export function noQtyWorkspaceActionLabel(href: string): string {
  switch (inferProductionHrefRoute(href)) {
    case "production":
      return "Continue Production";
    case "requirement":
      return "Next Cycle";
    case "dispatch":
      return "Dispatch";
    case "qc":
      return "QC";
    case "work_orders":
      return "View Cycle";
    case "sales_bill":
      return "View Cycle";
    default:
      return "View Cycle";
  }
}

function isNoQty(orderType?: string | null): boolean {
  return orderType === "NO_QTY";
}

function pickPrimaryLine(lines: DashboardProductionStatusRow[]): DashboardProductionStatusRow {
  return [...lines].sort((a, b) => {
    const ta = TONE_RANK[a.operationalStatus.tone] ?? 8;
    const tb = TONE_RANK[b.operationalStatus.tone] ?? 8;
    if (ta !== tb) return ta - tb;
    return b.workOrderId - a.workOrderId;
  })[0]!;
}

function sectionForNoQtyLines(lines: DashboardProductionStatusRow[]): WoWorkspaceSection {
  if (!lines.length) return "operationalOpen";

  const labels = lines.map((l) => l.operationalStatus.label);
  const hasActionable = lines.some(
    (l) => l.countsAsActive && NO_QTY_ACTIONABLE.has(l.operationalStatus.label),
  );
  if (hasActionable) return "operationalOpen";

  if (labels.some((lb) => NO_QTY_HISTORY.has(lb))) return "carryForwardHistory";

  if (lines.every((l) => NO_QTY_COMPLETED.has(l.operationalStatus.label))) {
    return "completedCycles";
  }

  if (lines.every((l) => !l.countsAsActive)) return "carryForwardHistory";

  return "operationalOpen";
}

function queueLinesToGroup(
  woId: number,
  lines: DashboardProductionStatusRow[],
  allQueueSources: DashboardProductionStatusSource[],
): WoWorkspaceGroup {
  const primary = pickPrimaryLine(lines);
  const orderType = primary.orderType;
  const section = isNoQty(orderType) ? sectionForNoQtyLines(lines) : "operationalOpen";
  const href = String(primary.actionHref ?? "");

  let presentationStatus: string;
  let actionLabel: string;
  let statusTone: WoWorkspaceGroup["statusTone"] = primary.operationalStatus.tone;
  let isMuted = false;

  if (isNoQty(orderType)) {
    const display = resolveNoQtyCycleDisplayStatus({
      ...primary,
      allQueueRows: allQueueSources,
      scope:
        section === "carryForwardHistory"
          ? "historical"
          : section === "completedCycles"
            ? "historical"
            : "auto",
    });
    presentationStatus = display.label;
    statusTone = display.tone;
    if (section === "carryForwardHistory" || section === "completedCycles") {
      isMuted = true;
    }
    actionLabel =
      section === "carryForwardHistory" || section === "completedCycles"
        ? "View Cycle"
        : noQtyWorkspaceActionLabel(href);
  } else {
    presentationStatus =
      String(primary.status ?? "").toUpperCase() === "COMPLETED" ? "Completed" : String(primary.status ?? "OPEN");
    actionLabel = "View WO";
    statusTone = "regular";
  }

  if (section === "carryForwardHistory" || section === "completedCycles") {
    isMuted = true;
  }

  const qtyTrace = buildCycleOutcomeFromQueueLines(lines);

  return {
    woId,
    /** Formal docNo when present on API rows; cycle history display uses woId via displayWorkOrderTraceNo. */
    woDocNo: null,
    salesOrderId: primary.salesOrderId ?? 0,
    soDocNo: primary.salesOrderNo ?? null,
    orderType,
    cycleId: primary.cycleId ?? null,
    cycleNo: primary.cycleNo ?? null,
    itemName: primary.itemName,
    lines: lines.map((l) => ({
      fgName: l.itemName,
      qty: String(l.requiredQty),
      workOrderLineId: l.workOrderLineId,
    })),
    section,
    presentationStatus,
    statusTone,
    actionHref: href,
    actionLabel,
    contextHint: primary.operationalStatus.contextHint,
    isMuted,
    qtyTrace,
  };
}

function apiGroupToWorkspace(
  g: WoApiGroupInput,
  section: WoWorkspaceSection,
  allQueueSources: DashboardProductionStatusSource[],
): WoWorkspaceGroup {
  const st = String(g.status ?? "").toUpperCase();
  const noQty = isNoQty(g.orderType);
  const completed = st === "COMPLETED" || section === "completedCycles";
  const itemName = g.lines[0]?.fgName ?? "—";
  let presentationStatus = completed ? "Completed" : st || "OPEN";
  let statusTone: WoWorkspaceGroup["statusTone"] = completed ? "idle" : "regular";
  if (noQty) {
    const display = resolveNoQtyCycleDisplayStatusForWorkOrder(
      {
        id: g.woId,
        status: g.status,
        salesOrderId: g.salesOrderId,
        cycle: { cycleNo: g.cycleNo ?? null },
        lines: g.lines.map((l) => ({ qty: l.qty })),
      },
      allQueueSources,
      {
        scope:
          section === "carryForwardHistory" || section === "completedCycles" ? "historical" : "auto",
      },
    );
    presentationStatus = display.label;
    statusTone = display.tone;
  }
  return {
    woId: g.woId,
    woDocNo: g.woDocNo,
    salesOrderId: g.salesOrderId,
    soDocNo: g.soDocNo,
    orderType: g.orderType,
    cycleId: null,
    cycleNo: g.cycleNo ?? null,
    itemName,
    lines: g.lines,
    section,
    presentationStatus,
    statusTone,
    actionHref: "",
    actionLabel: noQty ? "View Cycle" : "View WO",
    isMuted: true,
    qtyTrace: noQty ? buildCycleOutcomeFromApiLines(g.lines) : buildCycleOutcomeFromApiLines(g.lines),
  };
}

function compareOperational(a: WoWorkspaceGroup, b: WoWorkspaceGroup): number {
  if (b.woId !== a.woId) return b.woId - a.woId;
  return (b.cycleNo ?? 0) - (a.cycleNo ?? 0);
}

/** Newest cycle first, then newest WO. */
export function compareCycleHistory(a: WoWorkspaceGroup, b: WoWorkspaceGroup): number {
  const cA = a.cycleNo ?? 0;
  const cB = b.cycleNo ?? 0;
  if (cB !== cA) return cB - cA;
  return b.woId - a.woId;
}

export function mergeCycleHistorySections(
  carryForward: WoWorkspaceGroup[],
  completed: WoWorkspaceGroup[],
): WoWorkspaceGroup[] {
  return [...carryForward, ...completed].sort(compareCycleHistory).slice(0, 24);
}

export function buildWorkOrderWorkspaceSections(
  queueRows: DashboardProductionStatusSource[],
  apiOpenGroups: WoApiGroupInput[],
  apiCompletedGroups: WoApiGroupInput[],
): WoWorkspaceSections {
  const built = buildDashboardProductionStatusRows(queueRows, {
    limit: Math.max(queueRows.length, 1),
  });

  const byWo = new Map<number, DashboardProductionStatusRow[]>();
  for (const row of built.visible) {
    const list = byWo.get(row.workOrderId) ?? [];
    list.push(row);
    byWo.set(row.workOrderId, list);
  }

  const fromQueue = Array.from(byWo.entries()).map(([woId, lines]) =>
    queueLinesToGroup(woId, lines, queueRows),
  );
  const queueWoIds = new Set(fromQueue.map((g) => g.woId));

  const operationalOpen: WoWorkspaceGroup[] = [];
  const carryForwardHistory: WoWorkspaceGroup[] = [];
  const completedCycles: WoWorkspaceGroup[] = [];

  for (const g of fromQueue) {
    if (g.section === "operationalOpen") operationalOpen.push(g);
    else if (g.section === "carryForwardHistory") carryForwardHistory.push(g);
    else completedCycles.push(g);
  }

  for (const apiG of apiOpenGroups) {
    if (queueWoIds.has(apiG.woId)) continue;
    if (isNoQty(apiG.orderType)) {
      const st = String(apiG.status ?? "").toUpperCase();
      const g = apiGroupToWorkspace(apiG, "operationalOpen", queueRows);
      if (st === "IN_PROGRESS" || st === "PENDING") {
        operationalOpen.push({
          ...g,
          presentationStatus: mapOperationalLabelToNoQtyDisplayLabel("In Production"),
          statusTone: "running",
          actionLabel: "Continue Production",
          isMuted: false,
        });
      } else {
        carryForwardHistory.push({
          ...g,
          presentationStatus: "Carried Forward",
          statusTone: "carriedForward",
        });
      }
      continue;
    }
    operationalOpen.push(apiGroupToWorkspace(apiG, "operationalOpen", queueRows));
  }

  for (const apiG of apiCompletedGroups) {
    if (queueWoIds.has(apiG.woId)) continue;
    const g = apiGroupToWorkspace(apiG, "completedCycles", queueRows);
    if (isNoQty(g.orderType)) {
      completedCycles.push({
        ...g,
        presentationStatus: g.presentationStatus === "Completed" ? "Completed" : g.presentationStatus,
      });
    } else {
      completedCycles.push(g);
    }
  }

  operationalOpen.sort(compareOperational);

  return {
    operationalOpen: operationalOpen.slice(0, 24),
    cycleHistory: mergeCycleHistorySections(carryForwardHistory, completedCycles),
  };
}
