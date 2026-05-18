import { ROW_NUM_EPS } from "./dispatchBacklog";
import { buildNoQtyGuidedHref } from "./noQtyFlowState";

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
    buttonLabel: "Create Next RS",
    href: r.href,
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
    if (role === "STORE" || role === "DISPATCH") {
      if (r.stageKey !== "DISPATCH" && r.stageKey !== "SALES_BILL") continue;
    } else if (role === "PRODUCTION") {
      if (r.stageKey !== "PRODUCTION") continue;
    } else if (role === "QC") {
      if (r.stageKey !== "QC") continue;
    } else if (role === "SALES") {
      if (r.stageKey === "DISPATCH" || r.stageKey === "SALES_BILL" || r.stageKey === "PRODUCTION" || r.stageKey === "QC") {
        continue;
      }
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
      qc.push({ ...base, group: "QC", metricQty: mq, buttonLabel: "Continue QC" });
    } else if (r.stageKey === "DISPATCH") {
      const mq = Number(r.dispatchableNow ?? r.dispatchableQty ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      dispatch.push({
        ...base,
        group: "DISPATCH",
        metricQty: mq,
        metricLabel: r.metricLabel ?? "Dispatch pending",
        buttonLabel: role === "STORE" || role === "DISPATCH" ? "Open Dispatch" : "Go to Dispatch",
      });
    } else if (r.stageKey === "SALES_BILL") {
      const mq = Number(r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      salesBill.push({
        ...base,
        group: "SALES_BILL",
        metricQty: mq,
        metricLabel: r.metricLabel ?? "Sales bill pending",
        buttonLabel: role === "STORE" || role === "DISPATCH" ? "Open sales bills" : "Create Sales Bill",
      });
    } else if (r.stageKey === "NEXT_RS") {
      if (r.orderType === "NO_QTY") {
        if (role !== "SALES" && role !== "ADMIN") continue;
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
        buttonLabel: "Create Next RS",
      });
    } else if (r.stageKey === "PRODUCTION") {
      if (r.orderType === "NO_QTY" && role === "SALES") continue;
      const mq = Number(r.productionRemaining ?? r.metricQty ?? 0);
      if (mq <= ROW_NUM_EPS) continue;
      production.push({ ...base, group: "PRODUCTION", metricQty: mq, buttonLabel: "Continue Production" });
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
  if (label === "Open QC") return "QC";
  if (label.includes("Dispatch")) return "DISPATCH";
  if (label === "Open Production") return "PRODUCTION";
  if (label === "Next RS" || label.includes("RS")) return "NO_QTY_PLANNING";
  if (label.includes("Sales Bill")) return "SALES_BILL";
  return "NO_QTY_PLANNING";
}

/**
 * Dashboard NO_QTY launcher: planning (Next RS / open RS workspace).
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

/** Hide Open NO_QTY launcher rows when Action Required already owns a higher-priority step for the SO. */
export function shouldHideOpenNoQtyForActionRequired(
  salesOrderId: number,
  resolvedLabel: string,
  primaryBySo: Map<number, string>,
): boolean {
  const primary = primaryBySo.get(salesOrderId);
  if (!primary) return false;
  const launcherStage = launcherStageFromResolvedLabel(resolvedLabel);
  if (primary === "NO_QTY_PLANNING" && launcherStage === "NO_QTY_PLANNING") return false;
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
  if (role !== "SALES" && role !== "ADMIN") {
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
      buttonLabel: "Create Next RS",
      href: buildNoQtyGuidedHref({
        to: `/sales-orders/${e.salesOrderId}/requirement-sheets`,
        salesOrderId: e.salesOrderId,
        cycleId: e.cycleId ?? null,
        fromStep: "requirement",
      }),
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
  if (n === "PRODUCTION_PENDING") return continueWorkingStagePriority("PRODUCTION");
  if (n === "NEXT_RS_REQUIRED") return continueWorkingStagePriority("NO_QTY_PLANNING");
  if (n === "SALES_BILL_PENDING") return continueWorkingStagePriority("SALES_BILL");
  return 99;
}

export type ProductionQueueNextAction =
  | "QC_PENDING"
  | "DISPATCH_PENDING"
  | "SALES_BILL_PENDING"
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
        hrefProd: `/production?salesOrderId=${sid}&from=dashboard`,
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
        if (p.actionHref) {
          a.hrefProd = p.actionHref;
        } else if (p.orderType === "NO_QTY") {
          a.hrefProd = buildNoQtyGuidedHref({
            to: "/production",
            salesOrderId: a.salesOrderId,
            cycleId: p.cycleId ?? null,
            fromStep: "work_order",
          });
        }
        if (p.customerName) a.customerName = p.customerName;
        a.itemName = p.itemName;
      }
    }
  }

  const showNoQtyPlanning = role === "SALES" || role === "ADMIN";

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
      qc.push({
        key: `${key}-qc`,
        ...common,
        metricQty: a.awaitingQc,
        href: a.hrefQc,
        group: "QC",
        buttonLabel: "Continue QC",
      });
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
        buttonLabel: role === "STORE" || role === "DISPATCH" ? "Open Dispatch" : "Go to Dispatch",
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
        href: a.hrefProd,
        group: "NO_QTY_PLANNING",
        buttonLabel: "Create Next RS",
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
        buttonLabel: "Continue Production",
        cycleId: a.bestProdCycleId ?? null,
      });
    } else if (a.prodNextAction === "NEXT_RS_REQUIRED" && a.bestProdMetric > ROW_NUM_EPS) {
      nextRs.push({
        key: `${key}-nextrs`,
        ...common,
        metricQty: a.bestProdMetric,
        metricLabel: a.nextRsMetricLabel ?? "Last shortage Qty",
        href: a.hrefProd,
        group: "NEXT_RS",
        buttonLabel: "Create Next RS",
      });
    }
  }

  return enforceUniqueSalesOrdersAcrossGroups({ qc, dispatch, production, salesBill, nextRs, noQtyPlanning });
}
