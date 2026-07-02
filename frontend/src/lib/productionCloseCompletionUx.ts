import type { ProductionExecutionClosedOutcome } from "./productionCompletionUx";

export const PRODUCTION_WORKSPACE_DASHBOARD_HREF = "/production";
export const PRODUCTION_CLOSE_RETURN_DELAY_MS = 2000;

export function buildProductionCloseSuccessToast(outcome: ProductionExecutionClosedOutcome): string {
  const lines = ["✓ Production Report submitted.", "✓ Work Order closed."];
  if (outcome === "CARRY_FORWARD") {
    lines.push("✓ Remaining quantity carried forward.");
  }
  return lines.join("\n");
}

export function resolveProductionCloseNavigationOrigin(input: {
  from?: string | null;
  source?: string | null;
  returnTo?: string | null;
}): "pending-actions" | "no-qty-execution" | "default" {
  const from = String(input.from ?? "").trim();
  const source = String(input.source ?? "").trim();
  const returnTo = String(input.returnTo ?? "").trim();
  if (from === "pending-actions" || returnTo === "pending-actions" || source === "pending-actions") {
    return "pending-actions";
  }
  if (
    from === "execution-register" ||
    source === "no_qty_execution" ||
    from === "inbox" ||
    source === "no_qty_planning" ||
    source === "no_qty_rs" ||
    from === "rs-page"
  ) {
    return "no-qty-execution";
  }
  return "default";
}
