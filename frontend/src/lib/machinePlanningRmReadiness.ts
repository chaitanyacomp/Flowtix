/**
 * Authoritative RM shortage for Machine Run Planning / Prepare WO UI.
 * Must match the RM table (shortageQty ?? shortage) — never invent shortage from WO gates.
 */

export type RmSummaryShortageRow = {
  shortage?: number | null;
  shortageQty?: number | null;
  requiredQty?: number | null;
  availableQty?: number | null;
  status?: string | null;
};

export type AuthoritativeRmReadiness = {
  hasShortage: boolean;
  shortageQtyTotal: number;
  requiredQtyTotal: number;
  availableQtyTotal: number;
  shortageLineCount: number;
  /** Compact label for strips — never "RM Shortage" when hasShortage is false. */
  rmLabel: "RM Shortage" | "RM Available" | "Ready for WO";
};

function lineShortageQty(row: RmSummaryShortageRow): number {
  const raw = row.shortageQty ?? row.shortage;
  const n = Number(raw);
  return Number.isFinite(n) && n > 1e-9 ? n : 0;
}

/**
 * Single readiness result derived from the same fields the RM Summary table displays.
 */
export function summarizeAuthoritativeRmReadiness(
  rows: RmSummaryShortageRow[] | null | undefined,
  opts?: {
    machinePlanningComplete?: boolean;
    /** True only when Store WO gates pass (after handoff). Never use machine-planning block alone. */
    storeCanCreateWorkOrder?: boolean;
  },
): AuthoritativeRmReadiness {
  const list = Array.isArray(rows) ? rows : [];
  let shortageQtyTotal = 0;
  let requiredQtyTotal = 0;
  let availableQtyTotal = 0;
  let shortageLineCount = 0;
  for (const r of list) {
    const short = lineShortageQty(r);
    shortageQtyTotal += short;
    if (short > 0) shortageLineCount += 1;
    requiredQtyTotal += Math.max(0, Number(r.requiredQty) || 0);
    availableQtyTotal += Math.max(0, Number(r.availableQty) || 0);
  }
  shortageQtyTotal = Math.round(shortageQtyTotal * 1000) / 1000;
  const hasShortage = shortageQtyTotal > 1e-9 || shortageLineCount > 0;

  const planningComplete = opts?.machinePlanningComplete === true;
  const storeReady = opts?.storeCanCreateWorkOrder === true;

  let rmLabel: AuthoritativeRmReadiness["rmLabel"];
  if (hasShortage) {
    rmLabel = "RM Shortage";
  } else if (planningComplete && storeReady) {
    rmLabel = "Ready for WO";
  } else {
    rmLabel = "RM Available";
  }

  return {
    hasShortage,
    shortageQtyTotal,
    requiredQtyTotal: Math.round(requiredQtyTotal * 1000) / 1000,
    availableQtyTotal: Math.round(availableQtyTotal * 1000) / 1000,
    shortageLineCount,
    rmLabel,
  };
}

/**
 * Planning stage badge for Machine Run Planning — independent of RM availability.
 * RM stock must never promote this to Ready for WO before handoff.
 */
export function machinePlanningStageBadge(args: {
  machinePlanningKey?: string | null;
  machinePlanningComplete?: boolean;
}): { label: string; tone: "neutral" | "success" | "warning" } {
  if (
    args.machinePlanningComplete === true ||
    String(args.machinePlanningKey ?? "").toUpperCase() === "MACHINE_PLANNING_COMPLETE"
  ) {
    return { label: "Handed to Store", tone: "success" };
  }
  const key = String(args.machinePlanningKey ?? "").toUpperCase();
  if (key === "MACHINE_PLANNING_AWAITING_COMPLETION") {
    return { label: "Planning Valid — Awaiting Completion", tone: "warning" };
  }
  if (key === "MACHINE_PLANNING_IN_PROGRESS") {
    return { label: "Machine Planning In Progress", tone: "warning" };
  }
  return { label: "Machine Planning Pending", tone: "neutral" };
}
