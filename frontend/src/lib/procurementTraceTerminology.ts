/**
 * P4A — Procurement demand source / execution presentation (labels only).
 */

import { PROCUREMENT_TERMS } from "./procurementTerminology";
import {
  parseDemandPoolParam,
  type ProcurementDemandPoolKey,
} from "./procurementWorkspaceQueues";

export const LEGACY_HISTORICAL_DEMAND_LABEL = "Legacy / Historical Demand";

/** @deprecated Use LEGACY_HISTORICAL_DEMAND_LABEL */
export const LEGACY_WO_PLANNING_RECORD_LABEL = LEGACY_HISTORICAL_DEMAND_LABEL;

export function demandPoolKeyForSourceType(
  sourceType: string | null | undefined,
): ProcurementDemandPoolKey | null {
  switch (String(sourceType ?? "").trim()) {
    case "SALES_ORDER":
      return "REGULAR_SO";
    case "MONTHLY_PLAN":
      return "MPRS";
    case "STOCK_REPLENISHMENT":
      return "STOCK_REPLENISHMENT";
    default:
      return null;
  }
}

export function procurementSourceCategoryLabel(sourceType: string | null | undefined): string | null {
  switch (String(sourceType ?? "").trim()) {
    case "SALES_ORDER":
      return PROCUREMENT_TERMS.PROCUREMENT_SOURCE_SALES_ORDERS;
    case "MONTHLY_PLAN":
      return PROCUREMENT_TERMS.PROCUREMENT_SOURCE_MONTHLY_PLANNING;
    case "STOCK_REPLENISHMENT":
      return PROCUREMENT_TERMS.PROCUREMENT_SOURCE_STOCK_REPLENISHMENT;
    case "WORK_ORDER_PLANNING":
      return LEGACY_HISTORICAL_DEMAND_LABEL;
    default:
      return null;
  }
}

/** Tab / pool selector labels (business language). */
export function demandPoolLabelForSourceType(sourceType: string | null | undefined): string | null {
  return procurementSourceCategoryLabel(sourceType);
}

export function demandPoolLabelForKey(key: ProcurementDemandPoolKey | null | undefined): string | null {
  if (key === "REGULAR_SO") return PROCUREMENT_TERMS.PROCUREMENT_SOURCE_SALES_ORDERS;
  if (key === "MPRS") return PROCUREMENT_TERMS.PROCUREMENT_SOURCE_MONTHLY_PLANNING;
  if (key === "STOCK_REPLENISHMENT") return PROCUREMENT_TERMS.PROCUREMENT_SOURCE_STOCK_REPLENISHMENT;
  return null;
}

export function parseDemandPoolFromRemarks(
  remarks: string | null | undefined,
): ProcurementDemandPoolKey | null {
  if (!remarks?.trim()) return null;
  const segments = remarks.split("·").map((s) => s.trim());
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const parsed = parseDemandPoolParam(segments[i]);
    if (parsed) return parsed;
  }
  return null;
}

export function demandPoolLabelFromRemarks(remarks: string | null | undefined): string | null {
  return demandPoolLabelForKey(parseDemandPoolFromRemarks(remarks));
}

export type ProcurementDemandSourceContext = {
  sourceType?: string | null;
  salesOrderDocNo?: string | null;
  salesOrderId?: number | null;
  monthlyPlanLabel?: string | null;
  materialRequirementDocNo?: string | null;
};

export function formatProcurementDemandSourceLabel(ctx: ProcurementDemandSourceContext): string | null {
  const st = String(ctx.sourceType ?? "").trim();
  if (st === "MONTHLY_PLAN") {
    return ctx.monthlyPlanLabel?.trim() || PROCUREMENT_TERMS.PROCUREMENT_SOURCE_MONTHLY_PLANNING;
  }
  if (st === "SALES_ORDER") {
    return (
      ctx.salesOrderDocNo?.trim() ||
      (ctx.salesOrderId && ctx.salesOrderId > 0 ? `SO-${ctx.salesOrderId}` : null) ||
      PROCUREMENT_TERMS.PROCUREMENT_SOURCE_SALES_ORDERS
    );
  }
  if (st === "STOCK_REPLENISHMENT") {
    return PROCUREMENT_TERMS.PROCUREMENT_SOURCE_STOCK_REPLENISHMENT;
  }
  if (st === "WORK_ORDER_PLANNING") {
    return LEGACY_HISTORICAL_DEMAND_LABEL;
  }
  if (ctx.monthlyPlanLabel?.trim()) return ctx.monthlyPlanLabel.trim();
  if (ctx.salesOrderDocNo?.trim()) return ctx.salesOrderDocNo.trim();
  if (ctx.materialRequirementDocNo?.trim()) return ctx.materialRequirementDocNo.trim();
  return null;
}

/** @deprecated Use formatProcurementDemandSourceLabel */
export function formatProcurementAnchorLabel(ctx: ProcurementDemandSourceContext): string | null {
  return formatProcurementDemandSourceLabel(ctx);
}

export function formatProcurementExecutionWoLabel(ctx: {
  workOrderDocNo?: string | null;
  workOrderId?: number | null;
}): string | null {
  return (
    ctx.workOrderDocNo?.trim() ||
    (ctx.workOrderId && ctx.workOrderId > 0 ? `WO-${ctx.workOrderId}` : null) ||
    null
  );
}

export function resolveConnectivityDemandSourceLabel(row: {
  demandSourceLabel?: string | null;
  demandSourceType?: string | null;
  monthlyPlan?: { label?: string | null } | null;
  mr?: { docNo?: string | null } | null;
  salesOrder?: { docNo?: string | null } | null;
}): string {
  const raw = row.demandSourceLabel?.trim();
  if (raw && raw !== "Unknown demand" && raw !== "Demand source") return raw;

  const fromContext = formatProcurementDemandSourceLabel({
    sourceType: row.demandSourceType,
    monthlyPlanLabel: row.monthlyPlan?.label,
    salesOrderDocNo: row.salesOrder?.docNo,
    materialRequirementDocNo: row.mr?.docNo,
  });
  if (fromContext) return fromContext;

  const category = procurementSourceCategoryLabel(row.demandSourceType);
  if (category) return category;

  return LEGACY_HISTORICAL_DEMAND_LABEL;
}

export function poTraceChainSummary(sourceType: string | null | undefined): string {
  switch (String(sourceType ?? "").trim()) {
    case "SALES_ORDER":
      return "PO → MR → Sales Order";
    case "MONTHLY_PLAN":
      return "PO → MR → Monthly Planning";
    case "STOCK_REPLENISHMENT":
      return "PO → MR → Stock Replenishment";
    case "WORK_ORDER_PLANNING":
      return "Legacy / historical demand (not an active procurement source)";
    default:
      return "PO → MR → Procurement source";
  }
}

export function incomingPoQtyInformationalMessage(): string {
  return PROCUREMENT_TERMS.INCOMING_PO_INFORMATIONAL;
}
