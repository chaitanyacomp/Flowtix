import { ROW_NUM_EPS } from "./dispatchBacklog";
import { buildNoQtyGuidedHref } from "./noQtyFlowState";
import { buildProductionScopedHref } from "./productionNavigation";
import { createCycleRequirementSheetButtonLabel, noQtyAgreementWorkspaceHref, noQtySoListHref } from "./noQtyRsActionLabels";
import { PRODUCTION_QA_TERMS } from "./productionQaTerminology";

const DASHBOARD_OPEN_NO_QTY_SO_LABEL = "Open NO_QTY SO";

/** Canonical continue-working / action-required priority (lower = higher). */
export const CONTINUE_WORKING_STAGE_PRIORITY: Record<string, number> = {
  QC: 0,
  DISPATCH: 1,
  NO_QTY_PLANNING: 2,
  PRODUCTION: 3,
  NEXT_RS: 3,
  SALES_BILL: 4,
  DONE: 99,
};

export function continueWorkingStagePriority(stageKey: string): number {
  return CONTINUE_WORKING_STAGE_PRIORITY[stageKey] ?? 50;
}

export type ContinueWorkingRow = {
  key: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  itemName: string;
  orderType?: "NO_QTY" | "NORMAL" | string;
  cycleNo?: number | null;
  cycleId?: number | null;
  stageKey: "QC" | "DISPATCH" | "PRODUCTION" | "NEXT_RS" | "DONE" | "SALES_BILL" | string;
  awaitingQcQty?: number;
  dispatchableNow?: number;
  productionRemaining?: number;
  lastShortageQty?: number;
  hasPendingQc?: boolean;
  dispatchableQty?: number;
  nextAction?: string | null;
  metricLabel?: string;
  metricQty?: number;
  nextStep: string;
  href: string;
};

export type ActionRequiredRow = {
  key: string;
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  itemName: string;
  orderType?: "NO_QTY" | "NORMAL" | string;
  cycleNo?: number | null;
  cycleId?: number | null;
  metricQty: number;
  metricLabel?: string;
  buttonLabel?: string;
  href: string;
  group: "QC" | "DISPATCH" | "PRODUCTION" | "SALES_BILL" | "NEXT_RS" | "NO_QTY_PLANNING";
};

export type ActionRequiredGroups = {
  qc: ActionRequiredRow[];
  dispatch: ActionRequiredRow[];
  production: ActionRequiredRow[];
  salesBill: ActionRequiredRow[];
  nextRs: ActionRequiredRow[];
  /** NO_QTY rolling RS planning — parallel to shop-floor production, never dropped by production de-dupe. */
  noQtyPlanning: ActionRequiredRow[];
};

const EMPTY_GROUPS: ActionRequiredGroups = {
  qc: [],
  dispatch: [],
  production: [],
  salesBill: [],
  nextRs: [],
  noQtyPlanning: [],
};

function metricQtyForContinueWorkingRow(r: ContinueWorkingRow): number {
  if (r.stageKey === "QC") return Number(r.awaitingQcQty ?? r.metricQty ?? 0);
  if (r.stageKey === "DISPATCH") return Number(r.dispatchableNow ?? r.dispatchableQty ?? r.metricQty ?? 0);
  if (r.stageKey === "PRODUCTION") return Number(r.productionRemaining ?? r.metricQty ?? 0);
  if (r.stageKey === "NEXT_RS") return Number(r.lastShortageQty ?? r.metricQty ?? 0);
  if (r.stageKey === "SALES_BILL") return Number(r.metricQty ?? 0);
  return Number(r.metricQty ?? 0);
}

/** Drop completed, zero-qty, and informational-only rows from dashboard action queues. */
export function filterActionableContinueWorkingRows(rows: ContinueWorkingRow[]): ContinueWorkingRow[] {
  const higherPriorityBySo = new Set<number>();
  for (const r of rows) {
    if (r.stageKey !== "QC" && r.stageKey !== "PRODUCTION") continue;
    if (metricQtyForContinueWorkingRow(r) > ROW_NUM_EPS) higherPriorityBySo.add(r.salesOrderId);
  }

  return rows.filter((r) => {
    if (r.stageKey === "DONE" || r.nextStep === "Completed / Waiting") return false;
    const mq = metricQtyForContinueWorkingRow(r);
    if (r.orderType === "NO_QTY" && r.stageKey === "NEXT_RS") return true;
    if (mq <= ROW_NUM_EPS) return false;

    if (
      r.orderType === "NO_QTY" &&
      r.stageKey === "DISPATCH" &&
      higherPriorityBySo.has(r.salesOrderId) &&
      String(r.key).includes("-nqdp-")
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Collapse duplicate non-dispatch stages per SO; keep every DISPATCH row (NO_QTY may have multiple cycles).
 * NO_QTY NEXT_RS (planning) is kept alongside shop-floor stages for the same SO.
 */
export function dedupeContinueWorkingBySalesOrder(rows: ContinueWorkingRow[]): ContinueWorkingRow[] {
  const filtered = filterActionableContinueWorkingRows(rows);
  const qcBySo = new Map<number, ContinueWorkingRow>();
  const noQtyPlanBySo = new Map<number, ContinueWorkingRow>();
  const shopFloorBySo = new Map<number, ContinueWorkingRow>();
  const dispatchRows: ContinueWorkingRow[] = [];

  for (const r of filtered) {
    if (r.stageKey === "DISPATCH") {
      dispatchRows.push(r);
      continue;
    }
    if (r.stageKey === "QC") {
      const prev = qcBySo.get(r.salesOrderId);
      if (
        !prev ||
        continueWorkingStagePriority(String(r.stageKey)) < continueWorkingStagePriority(String(prev.stageKey))
      ) {
        qcBySo.set(r.salesOrderId, r);
      }
      continue;
    }
    if (r.orderType === "NO_QTY" && r.stageKey === "NEXT_RS") {
      noQtyPlanBySo.set(r.salesOrderId, r);
      continue;
    }
    const prev = shopFloorBySo.get(r.salesOrderId);
    if (
      !prev ||
      continueWorkingStagePriority(String(r.stageKey)) < continueWorkingStagePriority(String(prev.stageKey))
    ) {
      shopFloorBySo.set(r.salesOrderId, r);
    }
  }

  dispatchRows.sort((a, b) => {
    const ca = Number(a.cycleNo ?? 1e9);
    const cb = Number(b.cycleNo ?? 1e9);
    if (ca !== cb) return ca - cb;
    return a.salesOrderId - b.salesOrderId;
  });

  const qcList = [...qcBySo.values()].sort((a, b) => a.salesOrderId - b.salesOrderId);
  const planList = [...noQtyPlanBySo.values()].sort((a, b) => a.salesOrderId - b.salesOrderId);
  const shopList = [...shopFloorBySo.values()].sort((a, b) => {
    const ra = continueWorkingStagePriority(String(a.stageKey));
    const rb = continueWorkingStagePriority(String(b.stageKey));
    if (ra !== rb) return ra - rb;
    return a.salesOrderId - b.salesOrderId;
  });

  return [...qcList, ...planList, ...dispatchRows, ...shopList];
}

/**
 * Cross-group de-dupe: QC → dispatch → production / billing / regular next RS.
 * NO_QTY planning rows are never removed when production exists on the same SO.
 */
export function enforceUniqueSalesOrdersAcrossGroups(groups: ActionRequiredGroups): ActionRequiredGroups {
  const noQtyPlanning = groups.noQtyPlanning ?? [];
  const qcIds = new Set(groups.qc.map((r) => r.salesOrderId));

  const dispatch = groups.dispatch.filter((r) => !qcIds.has(r.salesOrderId));
  const dispIds = new Set(dispatch.map((r) => r.salesOrderId));

  const production = groups.production.filter(
    (r) => !qcIds.has(r.salesOrderId) && !dispIds.has(r.salesOrderId),
  );
  const prodIds = new Set(production.map((r) => r.salesOrderId));

  const salesBill = groups.salesBill.filter(
    (r) => !qcIds.has(r.salesOrderId) && !dispIds.has(r.salesOrderId) && !prodIds.has(r.salesOrderId),
  );
  const billIds = new Set(salesBill.map((r) => r.salesOrderId));

  const nextRs = groups.nextRs.filter(
    (r) =>
      !qcIds.has(r.salesOrderId) &&
      !dispIds.has(r.salesOrderId) &&
      !prodIds.has(r.salesOrderId) &&
      !billIds.has(r.salesOrderId),
  );

  return { qc: groups.qc, dispatch, production, salesBill, nextRs, noQtyPlanning };
}

function noQtyPlanningButtonLabel(cycleNo?: number | null): string {
  const next = cycleNo != null && Number(cycleNo) > 0 ? Number(cycleNo) + 1 : null;
  if (next != null && next > 0) return createCycleRequirementSheetButtonLabel(next);
  return "Create Next Requirement Sheet";
}

function pushNoQtyPlanningRow(
  target: ActionRequiredRow[],
  r: ContinueWorkingRow,
  mq: number,
) {
  target.push({
    key: r.key,
    salesOrderId: r.salesOrderId,
    salesOrderDocNo: r.salesOrderDocNo,
    customerName: r.customerName,
    itemName: r.itemName,
    orderType: "NO_QTY",
    cycleNo: r.cycleNo,
    cycleId: r.cycleId ?? null,
    metricQty: mq,
    metricLabel: mq > ROW_NUM_EPS ? (r.metricLabel ?? "Last shortage Qty") : "Ready to plan",
    buttonLabel: noQtyPlanningButtonLabel(r.cycleNo),
    href: noQtyAgreementWorkspaceHref(r.salesOrderId, { intent: "add", from: "dashboard" }),
    group: "NO_QTY_PLANNING",
  });
}

export function partitionContinueWorkingForActions(
  rows: ContinueWorkingRow[],
  opts?: { role?: string },
): ActionRequiredGroups {
  const qc: ActionRequiredRow[] = [];
  const dispatch: ActionRequiredRow[] = [];
  const production: ActionRequiredRow[] = [];
  const salesBill: ActionRequiredRow[] = [];
  const nextRs: ActionRequiredRow[] = [];
  const noQtyPlanning: ActionRequiredRow[] = [];
  const role = String(opts?.role ?? "").trim().toUpperCase();

  for (const r of rows) {
    if (role === "STORE") {
      if (r.stageKey !== "DISPATCH" && r.stageKey !== "SALES_BILL") continue;
    } else if (role === "PRODUCTION") {
      if (r.stageKey !== "PRODUCTION" && r.stageKey !== "QC") continue;
    } else if (role === "QA") {
      if (r.stageKey !== "QC") continue;
    } else if (role === "PURCHASE") {
      continue;
    }

    if (r.stageKey === "DONE" || r.nextStep === "Completed / Waiting") continue;

    const base = {
      key: r.key,
      salesOrderId: r.salesOrderId,
      salesOrderDocNo: r.salesOrderDocNo,
      customerName: r.customerName,
      itemName: r.itemName,
      orderType: r.orderType,
      cycleNo: r.cycleNo,
      cycleId: r.cycleId ?? null,
      href: r.href,
    };

    if (r.stageKey === "QC") {
      const mq = Number(r.awaitingQcQty ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      const qaRow = {
        ...base,
        metricQty: mq,
        metricLabel: PRODUCTION_QA_TERMS.QA_IN_PROGRESS_LABEL,
        buttonLabel: PRODUCTION_QA_TERMS.CONTINUE_QA,
      };
      if (role === "PRODUCTION") {
        production.push({ ...qaRow, group: "PRODUCTION" });
      } else {
        qc.push({ ...qaRow, group: "QC" });
      }
    } else if (r.stageKey === "DISPATCH") {
      const mq = Number(r.dispatchableNow ?? r.dispatchableQty ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      dispatch.push({
        ...base,
        group: "DISPATCH",
        metricQty: mq,
        metricLabel: r.metricLabel ?? "Dispatch pending",
        buttonLabel: role === "STORE" ? "Open Dispatch" : "Go to Dispatch",
      });
    } else if (r.stageKey === "SALES_BILL") {
      const mq = Number(r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      salesBill.push({
        ...base,
        group: "SALES_BILL",
        metricQty: mq,
        metricLabel: r.metricLabel ?? "Sales bill pending",
        buttonLabel: role === "STORE" ? "Open sales bills" : "Create Sales Bill",
      });
    } else if (r.stageKey === "NEXT_RS") {
      if (r.orderType === "NO_QTY") {
        if (role !== "ADMIN" && role !== "STORE") continue;
        const mq = Number(r.lastShortageQty ?? r.metricQty ?? 0);
        pushNoQtyPlanningRow(noQtyPlanning, r, mq > ROW_NUM_EPS ? mq : 1);
        continue;
      }
      const mq = Number(r.lastShortageQty ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      nextRs.push({
        ...base,
        group: "NEXT_RS",
        metricQty: mq,
        metricLabel: r.metricLabel ?? "Last shortage Qty",
        buttonLabel: DASHBOARD_OPEN_NO_QTY_SO_LABEL,
        href: noQtySoListHref(r.salesOrderId, role),
      });
    } else if (r.stageKey === "PRODUCTION") {
      if (r.orderType === "NO_QTY" && role !== "ADMIN") continue;
      const mq = Number(r.productionRemaining ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      production.push({ ...base, group: "PRODUCTION", metricQty: mq, buttonLabel: "Open Production Workspace" });
    }
  }

  return { qc, dispatch, production, salesBill, nextRs, noQtyPlanning };
}

/** Highest-priority stage already shown in Action Required for an SO (for launcher alignment). */
export function primaryActionStageBySalesOrder(groups: ActionRequiredGroups): Map<number, string> {
  const map = new Map<number, string>();
  const assign = (rows: ActionRequiredRow[], stage: string) => {
    for (const r of rows) {
      if (!map.has(r.salesOrderId)) map.set(r.salesOrderId, stage);
    }
  };
  assign(groups.qc, "QC");
  assign(groups.dispatch, "DISPATCH");
  assign(groups.noQtyPlanning ?? [], "NO_QTY_PLANNING");
  assign(groups.production, "PRODUCTION");
  assign(groups.salesBill, "SALES_BILL");
  assign(groups.nextRs, "NEXT_RS");
  return map;
}

export function launcherStageFromResolvedLabel(label: string): string {
  if (label === "Open QC" || label === PRODUCTION_QA_TERMS.COMPLETE_QA || label === PRODUCTION_QA_TERMS.OPEN_PRODUCTION_QA) {
    return "QC";
  }
  if (label.includes("Dispatch")) return "DISPATCH";
  if (label === "Open Production") return "PRODUCTION";
  if (label === "Next RS" || label.includes("RS")) return "NO_QTY_PLANNING";
  if (label.includes("Sales Bill")) return "SALES_BILL";
  return "NO_QTY_PLANNING";
}

/**
 * Dashboard NO_QTY launcher: planning (Next RS / open RS workspace).
 *
 * NO_QTY commercial continuation is a **planning** workflow that lives
 * parallel to shop-floor queues. Visibility on the dashboard depends on
 * the resolver landing on a planning action (`prepare_next_rs` or a
 * `/requirement-sheets/*` deep link) — **not** on `createNextRsEligible`
 * being true. The Planning Dashboard always invokes the resolver in
 * `commercialContinuation: true` mode for SALES/ADMIN, which forces a
 * planning resolution as long as the sales order is OPEN; the actual
 * Next RS eligibility check happens at click time. Older callers that
 * pass `flow.createNextRsEligible: true` are still accepted as planning.
 */
export function isNoQtyDashboardPlanningRow(
  flow: { createNextRsEligible?: boolean } | null | undefined,
  resolved: { kind: string; to?: string },
): boolean {
  if (resolved.kind === "prepare_next_rs") return true;
  if (resolved.kind === "navigate" && String(resolved.to ?? "").includes("/requirement-sheets")) return true;
  if (Boolean(flow?.createNextRsEligible)) return true;
  return false;
}

/**
 * Continue Production on dashboard only while the next RS does not exist yet.
 * After a higher-cycle RS exists, planning has moved — hide old-cycle production CTA.
 */
export function shouldShowNoQtyDashboardContinueProduction(
  flow:
    | {
        createNextRsEligible?: boolean;
        nextRollingRequirementSheetId?: number | null;
        nextRsAlreadyCreatedDocNo?: string | null;
      }
    | null
    | undefined,
  row?: { noQtyPlanningPointerAhead?: boolean },
): boolean {
  if (!flow) return false;
  if (row?.noQtyPlanningPointerAhead) return false;
  if (!flow.createNextRsEligible) return false;
  const rolling =
    flow.nextRollingRequirementSheetId != null && Number(flow.nextRollingRequirementSheetId) > 0;
  if (rolling) return false;
  if (String(flow.nextRsAlreadyCreatedDocNo ?? "").trim() !== "") return false;
  return true;
}

export type NoQtyLauncherProductionAction = {
  href: string;
  cycleId: number | null;
  balanceQty: number;
};

/** Shop-floor production CTA for the eval cycle (not the planning-pointer cycle). */
export function findNoQtyContinueProductionForLauncher(args: {
  salesOrderId: number;
  evalCycleId: number | null | undefined;
  prodQueue: ProductionQueueRow[] | null;
  continueWorking: ContinueWorkingRow[] | null;
}): NoQtyLauncherProductionAction | null {
  const salesOrderId = Number(args.salesOrderId);
  const evalCycleId =
    args.evalCycleId != null && Number(args.evalCycleId) > 0 ? Number(args.evalCycleId) : null;

  if (args.continueWorking) {
    for (const r of args.continueWorking) {
      if (r.orderType !== "NO_QTY" || r.stageKey !== "PRODUCTION" || r.salesOrderId !== salesOrderId) continue;
      if (evalCycleId != null && r.cycleId != null && Number(r.cycleId) !== evalCycleId) continue;
      const bal = Number(r.productionRemaining ?? r.metricQty ?? 0);
      if (bal <= ROW_NUM_EPS) continue;
      return { href: r.href, cycleId: r.cycleId ?? evalCycleId, balanceQty: bal };
    }
  }

  if (!args.prodQueue?.length) return null;

  let best: ProductionQueueRow | null = null;
  for (const p of args.prodQueue) {
    if (p.orderType !== "NO_QTY" || p.salesOrderId !== salesOrderId) continue;
    if (p.status !== "PENDING" && p.status !== "IN_PROGRESS") continue;
    const bal = Number(p.balanceQty ?? 0);
    if (bal <= ROW_NUM_EPS) continue;
    if (evalCycleId != null && p.cycleId != null && Number(p.cycleId) !== evalCycleId) continue;
    if (!best || bal > Number(best.balanceQty ?? 0)) best = p;
  }

  if (!best) return null;

  const href =
    best.actionHref ??
    buildNoQtyGuidedHref({
      to: "/production",
      salesOrderId,
      cycleId: best.cycleId ?? evalCycleId,
      fromStep: "work_order",
    });

  return {
    href,
    cycleId: best.cycleId ?? evalCycleId,
    balanceQty: Number(best.balanceQty ?? 0),
  };
}

/**
 * Hide Open NO_QTY launcher rows when Action Required already owns a higher-priority step for the SO.
 *
 * NO_QTY rolling planning ("Create / Open Next RS") is **parallel** to shop-floor steps
 * (QC, Dispatch, Production) — Sales/Admin can prepare the next requirement sheet while
 * QC/Dispatch finish the current cycle. Therefore, when the launcher resolves to the
 * `NO_QTY_PLANNING` stage we never suppress it based on the SO's shop-floor primary.
 *
 * For all other launcher stages (e.g. "Open Production"), the higher-priority Action Required
 * card still wins.
 */
export function shouldHideOpenNoQtyForActionRequired(
  salesOrderId: number,
  resolvedLabel: string,
  primaryBySo: Map<number, string>,
): boolean {
  const primary = primaryBySo.get(salesOrderId);
  if (!primary) return false;
  const launcherStage = launcherStageFromResolvedLabel(resolvedLabel);
  if (launcherStage === "NO_QTY_PLANNING") return false;
  return continueWorkingStagePriority(primary) < continueWorkingStagePriority(launcherStage);
}

export type NoQtyPlanningEnrichInput = {
  salesOrderId: number;
  salesOrderDocNo?: string | null;
  customerName: string;
  itemName?: string;
  cycleNo?: number | null;
  cycleId?: number | null;
  createNextRsEligible: boolean;
  lastShortageQty?: number | null;
};

/**
 * Add NO_QTY planning cards from flow-state when createNextRsEligible (independent of production balance).
 */
export function enrichActionRequiredWithNoQtyPlanning(
  groups: ActionRequiredGroups,
  entries: NoQtyPlanningEnrichInput[],
  opts?: { role?: string },
): ActionRequiredGroups {
  const role = String(opts?.role ?? "").trim().toUpperCase();
  if (role !== "ADMIN" && role !== "STORE") {
    return { ...EMPTY_GROUPS, ...groups, noQtyPlanning: groups.noQtyPlanning ?? [] };
  }

  const planning = [...(groups.noQtyPlanning ?? [])];
  const seen = new Set(planning.map((r) => r.salesOrderId));

  for (const e of entries) {
    if (!e.createNextRsEligible) continue;
    if (seen.has(e.salesOrderId)) continue;
    const mq = Number(e.lastShortageQty ?? 0);
    const soLabel = e.salesOrderDocNo ?? String(e.salesOrderId);
    planning.push({
      key: `nq-plan-flow-${e.salesOrderId}`,
      salesOrderId: e.salesOrderId,
      salesOrderDocNo: e.salesOrderDocNo,
      customerName: e.customerName,
      itemName: e.itemName ?? soLabel,
      orderType: "NO_QTY",
      cycleNo: e.cycleNo,
      cycleId: e.cycleId ?? null,
      metricQty: mq > ROW_NUM_EPS ? mq : 1,
      metricLabel: mq > ROW_NUM_EPS ? "Last shortage Qty" : "Ready to plan",
      buttonLabel: noQtyPlanningButtonLabel(e.cycleNo),
      href: noQtyAgreementWorkspaceHref(e.salesOrderId, { intent: "add", from: "dashboard" }),
      group: "NO_QTY_PLANNING",
    });
    seen.add(e.salesOrderId);
  }

  return { ...groups, noQtyPlanning: planning };
}

export function buildDashboardDispatchHref(params: {
  salesOrderId: number;
  orderType?: string | null;
  salesOrderLineId?: number | null;
  itemId?: number | null;
}): string {
  const q = new URLSearchParams();
  q.set("source", "dashboard");
  q.set("salesOrderId", String(params.salesOrderId));
  const ot = params.orderType != null ? String(params.orderType).trim() : "";
  if (ot === "NO_QTY" && params.itemId != null && Number(params.itemId) > 0) {
    q.set("itemId", String(params.itemId));
  } else if (params.salesOrderLineId != null && Number(params.salesOrderLineId) > 0) {
    q.set("salesOrderLineId", String(params.salesOrderLineId));
  }
  return `/dispatch?${q.toString()}`;
}

export function prodQueueNextRank(n?: string): number {
  if (n === "QC_PENDING") return continueWorkingStagePriority("QC");
  if (n === "DISPATCH_PENDING") return continueWorkingStagePriority("DISPATCH");
  if (n === "ON_HOLD") return continueWorkingStagePriority("PRODUCTION");
  if (n === "PRODUCTION_PENDING") return continueWorkingStagePriority("PRODUCTION");
  if (n === "NEXT_RS_REQUIRED") return continueWorkingStagePriority("NO_QTY_PLANNING");
  if (n === "SALES_BILL_PENDING") return continueWorkingStagePriority("SALES_BILL");
  return 99;
}

export type ProductionQueueNextAction =
  | "QC_PENDING"
  | "DISPATCH_PENDING"
  | "SALES_BILL_PENDING"
  | "ON_HOLD"
  | "PRODUCTION_PENDING"
  | "NEXT_RS_REQUIRED";

export type ProductionQueueRow = {
  salesOrderId: number;
  customerName?: string;
  itemName: string;
  balanceQty: number;
  status: string;
  orderType?: string;
  cycleId?: number | null;
  nextAction?: ProductionQueueNextAction;
  lastShortageQty?: number;
  qtyLabel?: string;
  actionHref?: string;
};

export type QcQueueRow = {
  salesOrderId: number;
  itemName: string;
  pendingQcQty: number;
  orderType?: string | null;
};

export type DispatchBacklogRowLite = {
  salesOrderId: number;
  customerName: string;
  itemName: string;
  dispatchableNow?: number;
  orderType?: string | null;
  salesOrderLineId?: number | null;
  itemId?: number | null;
};

/**
 * Fallback when continue-working is unavailable: QC → dispatch → production → sales bill → next RS (one row per SO).
 */
export function buildActionRequiredFromQueues(
  qcRows: QcQueueRow[] | null,
  backlogRows: DispatchBacklogRowLite[] | null,
  prodRows: ProductionQueueRow[] | null,
  opts?: { role?: string },
): ActionRequiredGroups {
  const role = String(opts?.role ?? "").trim().toUpperCase();
  const qc: ActionRequiredRow[] = [];
  const dispatch: ActionRequiredRow[] = [];
  const production: ActionRequiredRow[] = [];
  const salesBill: ActionRequiredRow[] = [];
  const nextRs: ActionRequiredRow[] = [];
  const noQtyPlanning: ActionRequiredRow[] = [];

  type Agg = {
    salesOrderId: number;
    awaitingQc: number;
    dispatchableNow: number;
    productionRemaining: number;
    customerName: string;
    itemName: string;
    hrefQc: string;
    hrefProd: string;
    bestProdRank: number;
    bestProdMetric: number;
    prodNextAction?: ProductionQueueNextAction;
    nextRsMetricLabel?: string;
    orderType?: string;
    bestProdCycleId?: number | null;
    bestWorkOrderId?: number;
    bestWorkOrderLineId?: number;
    bestBacklogLineId?: number;
    bestBacklogItemId?: number;
  };
  const bySo = new Map<number, Agg>();

  function ensure(soId: number): Agg {
    let a = bySo.get(soId);
    if (!a) {
      const sid = encodeURIComponent(String(soId));
      a = {
        salesOrderId: soId,
        awaitingQc: 0,
        dispatchableNow: 0,
        productionRemaining: 0,
        customerName: "",
        itemName: "",
        hrefQc: `/qc-entry?salesOrderId=${sid}&source=dashboard`,
        hrefProd: buildProductionScopedHref({ salesOrderId: soId, from: "dashboard" }),
        bestProdRank: 99,
        bestProdMetric: 0,
      };
      bySo.set(soId, a);
    }
    return a;
  }

  if (backlogRows) {
    const noQtySumBySoId = new Map<number, Map<number, { sum: number; sample: DispatchBacklogRowLite }>>();
    for (const b of backlogRows) {
      const dn = Number(b.dispatchableNow ?? 0);
      if (dn <= ROW_NUM_EPS) continue;
      const ot = b.orderType != null ? String(b.orderType).trim() : "";
      if (ot === "NO_QTY") {
        const itemId = b.itemId != null && Number(b.itemId) > 0 ? Number(b.itemId) : 0;
        if (!(itemId > 0)) continue;
        let perItem = noQtySumBySoId.get(b.salesOrderId);
        if (!perItem) {
          perItem = new Map();
          noQtySumBySoId.set(b.salesOrderId, perItem);
        }
        const prev = perItem.get(itemId);
        if (prev) {
          prev.sum += dn;
          prev.sample = b;
        } else {
          perItem.set(itemId, { sum: dn, sample: b });
        }
        continue;
      }
      const a = ensure(b.salesOrderId);
      if (dn > a.dispatchableNow) {
        a.dispatchableNow = dn;
        a.customerName = b.customerName;
        a.itemName = b.itemName;
        const lid = b.salesOrderLineId != null && Number(b.salesOrderLineId) > 0 ? Number(b.salesOrderLineId) : undefined;
        a.bestBacklogLineId = lid;
        if (b.itemId != null && Number(b.itemId) > 0) a.bestBacklogItemId = Number(b.itemId);
        const orderType = b.orderType != null && String(b.orderType).trim() !== "" ? String(b.orderType) : null;
        if (orderType) a.orderType = orderType;
      }
    }
    for (const [soId, perItem] of noQtySumBySoId) {
      let winner: { sum: number; sample: DispatchBacklogRowLite } | null = null;
      for (const v of perItem.values()) {
        if (!winner || v.sum > winner.sum + ROW_NUM_EPS) winner = v;
      }
      if (!winner || winner.sum <= ROW_NUM_EPS) continue;
      const a = ensure(soId);
      const b = winner.sample;
      a.dispatchableNow = winner.sum;
      a.customerName = b.customerName;
      a.itemName = b.itemName;
      const lid = b.salesOrderLineId != null && Number(b.salesOrderLineId) > 0 ? Number(b.salesOrderLineId) : undefined;
      a.bestBacklogLineId = lid;
      if (b.itemId != null && Number(b.itemId) > 0) a.bestBacklogItemId = Number(b.itemId);
      a.orderType = "NO_QTY";
    }
  }

  if (qcRows) {
    for (const q of qcRows) {
      const pend = Number(q.pendingQcQty ?? 0);
      if (pend <= ROW_NUM_EPS) continue;
      const a = ensure(q.salesOrderId);
      if (pend > a.awaitingQc) {
        a.awaitingQc = pend;
        a.itemName = q.itemName;
        const ot = q.orderType != null && String(q.orderType).trim() !== "" ? String(q.orderType) : null;
        if (ot) a.orderType = ot;
      }
    }
  }

  if (prodRows) {
    for (const p of prodRows) {
      if (p.status !== "PENDING" && p.status !== "IN_PROGRESS") continue;
      const bal = Number(p.balanceQty ?? 0);
      if (bal <= ROW_NUM_EPS) continue;
      const a = ensure(p.salesOrderId);
      if (p.orderType) a.orderType = p.orderType;
      a.productionRemaining = Math.max(a.productionRemaining, bal);
      const rank = prodQueueNextRank(p.nextAction);
      const metric =
        p.orderType === "NO_QTY" && p.nextAction === "NEXT_RS_REQUIRED"
          ? Number(p.lastShortageQty ?? 0)
          : bal;
      if (rank < a.bestProdRank || (rank === a.bestProdRank && metric > a.bestProdMetric + ROW_NUM_EPS)) {
        a.bestProdRank = rank;
        a.bestProdMetric = metric;
        a.prodNextAction = p.nextAction;
        a.bestProdCycleId = p.cycleId ?? null;
        a.nextRsMetricLabel =
          p.nextAction === "NEXT_RS_REQUIRED" ? (p.qtyLabel ?? "Last shortage Qty") : undefined;
        a.bestWorkOrderId = p.workOrderId;
        a.bestWorkOrderLineId = p.workOrderLineId;
        a.hrefProd = buildProductionScopedHref({
          actionHref: p.actionHref,
          orderType: p.orderType,
          salesOrderId: p.salesOrderId ?? a.salesOrderId,
          cycleId: p.cycleId ?? null,
          workOrderId: p.workOrderId,
          workOrderLineId: p.workOrderLineId,
          from: "dashboard",
        });
        if (p.customerName) a.customerName = p.customerName;
        a.itemName = p.itemName;
      }
    }
  }

  const showNoQtyPlanning = role === "ADMIN" || role === "STORE";

  for (const soId of [...bySo.keys()].sort((x, y) => x - y)) {
    const a = bySo.get(soId)!;
    const key = `so-${soId}`;
    const common = {
      salesOrderId: soId,
      customerName: a.customerName || "—",
      itemName: a.itemName || "—",
      ...(a.orderType ? { orderType: a.orderType } : {}),
    };

    if (a.awaitingQc > ROW_NUM_EPS) {
      const qaRow = {
        key: `${key}-qa`,
        ...common,
        metricQty: a.awaitingQc,
        href: a.hrefQc,
        metricLabel: PRODUCTION_QA_TERMS.QA_IN_PROGRESS_LABEL,
        buttonLabel: PRODUCTION_QA_TERMS.CONTINUE_QA,
      };
      if (role === "PRODUCTION") {
        production.push({ ...qaRow, group: "PRODUCTION" });
      } else {
        qc.push({ ...qaRow, group: "QC" });
      }
    } else if (a.dispatchableNow > ROW_NUM_EPS) {
      dispatch.push({
        key: `${key}-disp`,
        ...common,
        metricQty: a.dispatchableNow,
        href: buildDashboardDispatchHref({
          salesOrderId: soId,
          orderType: a.orderType,
          salesOrderLineId: a.bestBacklogLineId,
          itemId: a.bestBacklogItemId,
        }),
        group: "DISPATCH",
        buttonLabel: role === "STORE" ? "Open Dispatch" : "Go to Dispatch",
      });
    } else if (a.prodNextAction === "SALES_BILL_PENDING" && a.bestProdMetric > ROW_NUM_EPS) {
      salesBill.push({
        key: `${key}-salesbill`,
        ...common,
        metricQty: a.bestProdMetric,
        metricLabel: "Sales bill pending",
        href: a.hrefProd,
        group: "SALES_BILL",
        buttonLabel: "Create Sales Bill",
        cycleId: a.bestProdCycleId ?? null,
      });
    } else if (
      showNoQtyPlanning &&
      a.orderType === "NO_QTY" &&
      a.prodNextAction === "NEXT_RS_REQUIRED" &&
      a.bestProdMetric > ROW_NUM_EPS
    ) {
      noQtyPlanning.push({
        key: `${key}-nq-plan`,
        ...common,
        orderType: "NO_QTY",
        metricQty: a.bestProdMetric,
        metricLabel: a.nextRsMetricLabel ?? "Last shortage Qty",
        href: noQtyAgreementWorkspaceHref(soId, { intent: "add", from: "dashboard" }),
        group: "NO_QTY_PLANNING",
        buttonLabel: noQtyPlanningButtonLabel(null),
        cycleId: a.bestProdCycleId ?? null,
      });
    } else if (
      a.productionRemaining > ROW_NUM_EPS &&
      (a.orderType !== "NO_QTY" || role === "PRODUCTION" || role === "ADMIN")
    ) {
      production.push({
        key: `${key}-prod`,
        ...common,
        metricQty: a.bestProdMetric > ROW_NUM_EPS ? a.bestProdMetric : a.productionRemaining,
        href: a.hrefProd,
        group: "PRODUCTION",
        buttonLabel: "Open Production Workspace",
        cycleId: a.bestProdCycleId ?? null,
      });
    } else if (a.prodNextAction === "NEXT_RS_REQUIRED" && a.bestProdMetric > ROW_NUM_EPS) {
      nextRs.push({
        key: `${key}-nextrs`,
        ...common,
        metricQty: a.bestProdMetric,
        metricLabel: a.nextRsMetricLabel ?? "Last shortage Qty",
        href: noQtySoListHref(soId, role),
        group: "NEXT_RS",
        buttonLabel: DASHBOARD_OPEN_NO_QTY_SO_LABEL,
      });
    }
  }

  return enforceUniqueSalesOrdersAcrossGroups({ qc, dispatch, production, salesBill, nextRs, noQtyPlanning });
}
