/**
 * P6B-1 — Explicit production flow contract (REGULAR SO vs NO_QTY).
 * `flow` query param is authoritative once present; legacy signals canonicalize to it.
 */

export const PRODUCTION_FLOW_REGULAR = "REGULAR_SO" as const;
export const PRODUCTION_FLOW_NO_QTY = "NO_QTY" as const;

export type ProductionFlowParam = typeof PRODUCTION_FLOW_REGULAR | typeof PRODUCTION_FLOW_NO_QTY;

export function parseProductionFlowParam(raw: string | null | undefined): ProductionFlowParam | null {
  const v = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (v === PRODUCTION_FLOW_NO_QTY || v === "NO_QTY_SO") return PRODUCTION_FLOW_NO_QTY;
  if (v === PRODUCTION_FLOW_REGULAR || v === "REGULAR") return PRODUCTION_FLOW_REGULAR;
  return null;
}

export function orderTypeForProductionFlow(flow: ProductionFlowParam): "NO_QTY" | "NORMAL" {
  return flow === PRODUCTION_FLOW_NO_QTY ? "NO_QTY" : "NORMAL";
}

export function productionFlowFromOrderType(orderType: string | null | undefined): ProductionFlowParam | null {
  const ot = String(orderType ?? "").trim();
  if (ot === "NO_QTY") return PRODUCTION_FLOW_NO_QTY;
  if (ot === "NORMAL") return PRODUCTION_FLOW_REGULAR;
  return null;
}

export function inferProductionFlowFromLegacy(opts: {
  fromNoQtySo?: boolean;
  orderType?: string | null;
}): ProductionFlowParam | null {
  if (opts.fromNoQtySo) return PRODUCTION_FLOW_NO_QTY;
  return productionFlowFromOrderType(opts.orderType);
}

export function appendProductionFlowToSearchParams(
  params: URLSearchParams,
  flow: ProductionFlowParam,
): URLSearchParams {
  params.set("flow", flow);
  return params;
}

export function appendProductionFlowToHref(href: string, flow: ProductionFlowParam): string {
  const hashIdx = href.indexOf("#");
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : "";
  const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const qIdx = base.indexOf("?");
  const path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  const qs = new URLSearchParams(qIdx >= 0 ? base.slice(qIdx + 1) : "");
  appendProductionFlowToSearchParams(qs, flow);
  const q = qs.toString();
  return `${path}${q ? `?${q}` : ""}${hash}`;
}

export type FlowOrderTypeValidation =
  | { ok: true }
  | { ok: false; message: string; flow: ProductionFlowParam; orderType: string };

/** When SO master type is known, flow param must agree — never silently switch shells. */
export function validateProductionFlowVsOrderType(
  flow: ProductionFlowParam,
  orderType: string | null | undefined,
): FlowOrderTypeValidation {
  const ot = String(orderType ?? "").trim();
  if (!ot) return { ok: true };
  if (flow === PRODUCTION_FLOW_NO_QTY && ot !== "NO_QTY") {
    return {
      ok: false,
      flow,
      orderType: ot,
      message: `Production flow is NO_QTY but this sales order is type ${ot}. Open production from the NO_QTY agreement.`,
    };
  }
  if (flow === PRODUCTION_FLOW_REGULAR && ot === "NO_QTY") {
    return {
      ok: false,
      flow,
      orderType: ot,
      message:
        "Production flow is REGULAR SO but this order is a NO_QTY agreement. Use the NO_QTY production link.",
    };
  }
  return { ok: true };
}

export function productionFlowBadgeLabel(flow: ProductionFlowParam): string {
  return flow === PRODUCTION_FLOW_NO_QTY ? "NO_QTY FLOW" : "REGULAR SO FLOW";
}
