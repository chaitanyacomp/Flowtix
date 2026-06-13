import { type ProductionFlowParam, PRODUCTION_FLOW_NO_QTY } from "./productionFlowContract";

/** P6B-2 — user-facing flow type labels. */
export function productionFlowDisplayLabel(flow: ProductionFlowParam): string {
  return flow === PRODUCTION_FLOW_NO_QTY ? "Monthly Planning (NO_QTY)" : "Regular Sales Order";
}
