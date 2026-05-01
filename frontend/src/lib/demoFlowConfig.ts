export type DemoFlowKind = "regular" | "no_qty";

/** Separate step counts per flow (keeps tours fully isolated). */
export const DEMO_STEP_COUNT_BY_FLOW: Record<DemoFlowKind, number> = {
  /** SO → WO → Production → QC → Dispatch → Sales Bill */
  regular: 6,
  /** No Qty SO → Requirement Sheet → WO → Production → QC → Dispatch → Sales Bill */
  no_qty: 7,
};

/** Convenience: maximum of all flows (used for generic UI). */
export const DEMO_STEP_COUNT_MAX = Math.max(...Object.values(DEMO_STEP_COUNT_BY_FLOW));

export function getDemoStepCount(flow: DemoFlowKind): number {
  return DEMO_STEP_COUNT_BY_FLOW[flow] ?? DEMO_STEP_COUNT_MAX;
}

/** Navigate targets after each step (1-based index matches array position). */
export const DEMO_ROUTES: Record<DemoFlowKind, readonly string[]> = {
  regular: [
    "/sales-orders",
    "/work-orders",
    "/production",
    "/qc-entry",
    "/dispatch",
    "/sales-bills",
  ],
  no_qty: [
    "/sales-orders/new?type=no_qty",
    "/planning-dashboard",
    "/work-orders",
    "/production",
    "/qc-entry",
    "/dispatch",
    "/sales-bills",
  ],
};

export function getDemoRouteForStep(flow: DemoFlowKind, step: number): string {
  const count = getDemoStepCount(flow);
  if (step < 1 || step > count) return "";
  return DEMO_ROUTES[flow][step - 1] ?? "";
}

/** Path prefixes allowed while on this demo step (sidebar guard). */
export function getDemoAllowedPathPrefixes(flow: DemoFlowKind, step: number): readonly string[] {
  const count = getDemoStepCount(flow);
  if (step < 1 || step > count) return [];
  const raw = DEMO_ROUTES[flow][step - 1] ?? "";
  const base = raw.split("?")[0];
  if (!base) return [];
  // NO_QTY entry redirects to /sales-orders?action=… — treat sales order list + /new as same step.
  if (flow === "no_qty" && step === 1) {
    return ["/sales-orders", "/sales-orders/new"];
  }
  // Requirement Sheet / planning: planning dashboard + SO drill paths for RS screens.
  if (flow === "no_qty" && step === 2) {
    return ["/planning-dashboard", "/sales-orders"];
  }
  // Regular step 1: list → modal → Quotations for approved quotation path.
  if (flow === "regular" && step === 1) {
    return ["/sales-orders", "/sales-orders/new", "/quotations"];
  }
  return [base];
}

/** Sidebar / guard: allow Dashboard, completed tour, or the route(s) for the current step. */
export function isDemoNavigationAllowed(
  targetTo: string,
  flow: DemoFlowKind | null,
  step: number,
): boolean {
  if (!flow || step < 1) return true;
  if (step > getDemoStepCount(flow)) return true;
  const prefixes = getDemoAllowedPathPrefixes(flow, step);
  if (!prefixes.length) return true;
  const raw = targetTo.trim();
  const pathOnly = (raw.startsWith("/") ? raw : `/${raw}`).split("?")[0];
  if (pathOnly === "/dashboard") return true;
  return prefixes.some((base) => pathOnly === base || pathOnly.startsWith(`${base}/`));
}

/** Returns `flow-step` when demo is on this step; omit highlight otherwise. */
export function demoHighlightKey(
  enabled: boolean,
  flow: DemoFlowKind | null,
  step: number,
  expectFlow: DemoFlowKind,
  expectStep: number,
): string | undefined {
  if (!enabled || !flow) return undefined;
  if (expectStep < 1 || expectStep > getDemoStepCount(expectFlow)) return undefined;
  if (flow !== expectFlow || step !== expectStep) return undefined;
  return `${flow}-${expectStep}`;
}

/** Short labels for the dashboard / hint UI. */
export const DEMO_STEP_LABELS: Record<DemoFlowKind, readonly string[]> = {
  regular: [
    "Sales Order",
    "Work Order",
    "Production",
    "QC",
    "Dispatch",
    "Sales Bill",
  ],
  no_qty: [
    "No Qty Sales Order",
    "Requirement Sheet",
    "Create Work Order",
    "Production",
    "QC",
    "Dispatch",
    "Sales Bill",
  ],
};

/** Short “what to click” copy for DemoGuide (step title uses DEMO_STEP_LABELS). */
export const DEMO_STEP_CLICK_HINTS: Record<DemoFlowKind, readonly string[]> = {
  regular: [
    "Click “+ New Sales Order”, then choose Regular SO (quotations) when prompted.",
    "Create or open a Work Order from an approved sales order line.",
    "Select batch and enter production quantity, then save (demo blocks real saves).",
    "Enter inspected qty and rejection split, then submit QC (demo-safe).",
    "Allocate and confirm dispatch for pending lines.",
    "Open Sales Bills and review or create billing from the highlighted control.",
  ],
  no_qty: [
    "Click “+ New No Qty SO”, fill the highlighted fields, then save (demo-safe).",
    "Open the Requirement Sheet / planning view from the highlighted control.",
    "Use Create Work Order once planning is ready — the system builds WO lines from your requirement sheet.",
    "Post production output using the highlighted save control.",
    "Complete QC using the highlighted fields.",
    "Confirm dispatch from the highlighted control.",
    "Open Sales Bills and review or create billing from the highlighted control.",
  ],
};

export const DEMO_STEP_HINTS: Record<DemoFlowKind, readonly string[]> = {
  regular: [
    "Create a committed Sales Order (customer PO–driven).",
    "Plan and create Work Orders from approved demand.",
    "Record production output against the work order.",
    "Perform QC on produced batches.",
    "Prepare and finalize dispatch.",
    "Generate or review the Sales Bill.",
  ],
  no_qty: [
    "Create a planning Sales Order without fixed quantity commitment.",
    "Define requirement and planned quantities before execution.",
    "System converts your requirement sheet into a work order.",
    "Record production for the active cycle.",
    "Perform QC on produced output.",
    "Dispatch finished goods for this cycle.",
    "Generate or review the Sales Bill.",
  ],
};
