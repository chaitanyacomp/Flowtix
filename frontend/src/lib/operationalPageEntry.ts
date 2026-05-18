/**
 * Distinguish sidebar/workspace entry (no flow context) from workflow deep-links.
 * Presentation only — does not change queue or business rules.
 */

export type WorkOrderEntryContext = {
  fromNoQtySo: boolean;
  regularSoIdFromUrl: number;
  focusSoIdFromUrl: number;
  isEditMode: boolean;
  focusWorkOrderId: number;
  salesOrderId: number | "";
  fromRequirementSheet: boolean;
  fromRmCheck: boolean;
};

export function isWorkOrderScopedEntry(ctx: WorkOrderEntryContext): boolean {
  if (ctx.fromNoQtySo) return true;
  if (ctx.isEditMode) return true;
  if (ctx.focusWorkOrderId > 0) return true;
  if (ctx.regularSoIdFromUrl > 0) return true;
  if (ctx.fromRequirementSheet) return true;
  if (ctx.fromRmCheck && ctx.salesOrderId !== "") return true;
  if (ctx.salesOrderId !== "") return true;
  return false;
}

export function isWorkOrderWorkspaceEntry(ctx: WorkOrderEntryContext): boolean {
  return !isWorkOrderScopedEntry(ctx);
}

export type ProductionEntryContext = {
  fromNoQtySo: boolean;
  focusSoIdValid: boolean;
  woIdFromUrlValid: boolean;
  workOrderLineIdFromUrlValid: boolean;
  /** Dashboard Continue with explicit SO/WO/line target — not bare menu entry. */
  fromDashboardWithTarget: boolean;
};

export function isProductionScopedEntry(ctx: ProductionEntryContext): boolean {
  if (ctx.fromNoQtySo) return true;
  if (ctx.focusSoIdValid) return true;
  if (ctx.woIdFromUrlValid) return true;
  if (ctx.workOrderLineIdFromUrlValid) return true;
  if (ctx.fromDashboardWithTarget) return true;
  return false;
}

export function isProductionWorkspaceEntry(ctx: ProductionEntryContext): boolean {
  return !isProductionScopedEntry(ctx);
}
