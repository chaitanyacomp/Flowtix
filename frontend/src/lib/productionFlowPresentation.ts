import {
  type ProductionFlowParam,
  PRODUCTION_FLOW_GREEN_LEVEL,
  PRODUCTION_FLOW_NO_QTY,
} from "./productionFlowContract";

/** P6B-2 — user-facing flow type labels. */
export function productionFlowDisplayLabel(flow: ProductionFlowParam): string {
  if (flow === PRODUCTION_FLOW_NO_QTY) return "Monthly Planning (NO_QTY)";
  if (flow === PRODUCTION_FLOW_GREEN_LEVEL) return "Green Level WO / Stock WO";
  return "Regular Sales Order";
}
