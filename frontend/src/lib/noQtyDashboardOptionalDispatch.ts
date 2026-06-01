import { ROW_NUM_EPS } from "./dispatchBacklog";
import type { ActionRequiredGroups, ContinueWorkingRow } from "./dashboardActionQueue";

export type NoQtyOptionalDispatchSoSummary = {
  qty: number;
  itemId?: number;
  cycleId?: number | null;
};

type ProdRowLike = {
  salesOrderId: number;
  orderType?: string | null;
  dispatchableQty?: number | null;
  itemId?: number | null;
  cycleId?: number | null;
};

/**
 * Sum QC-backed optional dispatch headroom for an OPEN NO_QTY SO (same field as production queue).
 * Does not imply mandatory dispatch backlog — customer pending may be zero.
 */
export function aggregateNoQtyOptionalDispatchBySo(
  prodRows: ProdRowLike[] | null | undefined,
): Map<number, NoQtyOptionalDispatchSoSummary> {
  const m = new Map<number, NoQtyOptionalDispatchSoSummary>();
  if (!prodRows?.length) return m;

  for (const r of prodRows) {
    if (r.orderType !== "NO_QTY") continue;
    const dq = Number(r.dispatchableQty ?? 0);
    if (!Number.isFinite(dq) || dq <= ROW_NUM_EPS) continue;

    const sid = Number(r.salesOrderId);
    const cur = m.get(sid) ?? { qty: 0 };
    cur.qty += dq;
    if (cur.itemId == null && r.itemId != null && Number(r.itemId) > 0) {
      cur.itemId = Number(r.itemId);
    }
    if (cur.cycleId == null && r.cycleId != null && Number(r.cycleId) > 0) {
      cur.cycleId = Number(r.cycleId);
    }
    m.set(sid, cur);
  }

  return m;
}

/** True when dashboard Action Required / continue-working still treats dispatch as mandatory for this SO. */
export function hasMandatoryNoQtyDispatchBacklog(
  salesOrderId: number,
  groups: Pick<ActionRequiredGroups, "dispatch">,
  continueWorking: ContinueWorkingRow[] | null | undefined,
): boolean {
  for (const d of groups.dispatch) {
    if (d.orderType !== "NO_QTY" || d.salesOrderId !== salesOrderId) continue;
    if (Number(d.metricQty ?? 0) > ROW_NUM_EPS) return true;
  }
  if (continueWorking) {
    for (const r of continueWorking) {
      if (r.orderType !== "NO_QTY" || r.salesOrderId !== salesOrderId || r.stageKey !== "DISPATCH") continue;
      const mq = Number(r.dispatchableNow ?? r.dispatchableQty ?? r.metricQty ?? 0);
      if (mq > ROW_NUM_EPS) return true;
    }
  }
  return false;
}

export function shouldShowNoQtyOptionalDispatchChip(
  salesOrderId: number,
  optionalBySo: Map<number, NoQtyOptionalDispatchSoSummary>,
  groups: Pick<ActionRequiredGroups, "dispatch">,
  continueWorking: ContinueWorkingRow[] | null | undefined,
): NoQtyOptionalDispatchSoSummary | null {
  if (hasMandatoryNoQtyDispatchBacklog(salesOrderId, groups, continueWorking)) return null;
  const opt = optionalBySo.get(salesOrderId);
  if (!opt || !(opt.qty > ROW_NUM_EPS)) return null;
  return opt;
}
