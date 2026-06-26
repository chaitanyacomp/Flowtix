/**
 * P7E — Central production deep-link routing (REGULAR vs NO_QTY).
 * All client navigation to scoped `/production` should use {@link buildProductionScopedHref}.
 */

import { buildNoQtyGuidedHref } from "./noQtyFlowState";
import { PRODUCTION_FLOW_REGULAR } from "./productionFlowContract";

export type ProductionScopedNavInput = {
  workOrderId?: number;
  workOrderLineId?: number;
  salesOrderId?: number;
  orderType?: string | null;
  cycleId?: number | null;
  requirementSheetId?: number | null;
  /** Prefer server-built href when present. */
  actionHref?: string | null;
  from?: string;
};

function appendQueryParams(href: string, extra: Record<string, string | undefined>): string {
  const hashIdx = href.indexOf("#");
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : "";
  const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const qIdx = base.indexOf("?");
  const path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  const qs = new URLSearchParams(qIdx >= 0 ? base.slice(qIdx + 1) : "");
  for (const [key, value] of Object.entries(extra)) {
    if (value != null && String(value).trim() !== "") qs.set(key, value);
  }
  const q = qs.toString();
  return `${path}${q ? `?${q}` : ""}${hash}`;
}

/**
 * Build a scoped production URL from sales-order flow context.
 * - NO_QTY → guided NO_QTY URL (`flow=NO_QTY`, `source=no_qty_so`, cycle when known)
 * - REGULAR / NORMAL → `flow=REGULAR_SO`
 * - Unknown order type → omit `flow` (Production page infers from SO master)
 */
export function buildProductionScopedHref(input: ProductionScopedNavInput = {}): string {
  const woId = Number(input.workOrderId ?? 0);
  const wolId = Number(input.workOrderLineId ?? 0);
  const rawAction = input.actionHref?.trim();
  if (rawAction) {
    let href = rawAction;
    if (woId > 0 && !/[?&]workOrderId=\d+/i.test(href)) {
      href = appendQueryParams(href, { workOrderId: String(woId) });
    }
    if (wolId > 0 && !/[?&]workOrderLineId=\d+/i.test(href)) {
      href = appendQueryParams(href, { workOrderLineId: String(wolId) });
    }
    return href;
  }
  const sid = Number(input.salesOrderId ?? 0);
  const orderType = String(input.orderType ?? "").trim().toUpperCase();

  if (orderType === "NO_QTY" && sid > 0) {
    let href = buildNoQtyGuidedHref({
      to: "/production",
      salesOrderId: sid,
      cycleId: input.cycleId ?? undefined,
      requirementSheetId: input.requirementSheetId ?? undefined,
      fromStep: "production",
    });
    href = appendQueryParams(href, {
      ...(woId > 0 ? { workOrderId: String(woId) } : undefined),
      ...(wolId > 0 ? { workOrderLineId: String(wolId) } : undefined),
      ...(input.from ? { from: input.from } : undefined),
    });
    return href;
  }

  const qs = new URLSearchParams();
  if (orderType && orderType !== "NO_QTY") {
    qs.set("flow", PRODUCTION_FLOW_REGULAR);
  }
  if (sid > 0) qs.set("salesOrderId", String(sid));
  if (woId > 0) qs.set("workOrderId", String(woId));
  if (wolId > 0) qs.set("workOrderLineId", String(wolId));
  if (input.from) qs.set("from", input.from);
  const q = qs.toString();
  return q ? `/production?${q}` : "/production";
}

/** Scoped production link for a work order (optional flow context when known). */
export function productionWorkspaceHref(
  workOrderId: number,
  workOrderLineId?: number,
  ctx?: Omit<ProductionScopedNavInput, "workOrderId" | "workOrderLineId">,
): string {
  return buildProductionScopedHref({
    workOrderId,
    workOrderLineId,
    ...ctx,
  });
}
