/**
 * Compact NO_QTY cycle position copy for the dashboard continuation row.
 * Shortage / carry-forward origin belongs in cycle history only — not on this line.
 */

export type NoQtyDashboardTraceInput = {
  /** Document-linked cycle (locked RS / latest operational cycle). */
  cycleNo?: number | null;
  planningPointerCycleNo?: number | null;
  noQtyPlanningPointerAhead?: boolean;
  lastRsStatus?: string | null;
};

export type NoQtyDashboardTraceLine = {
  /** Muted position text before the history link (no shortage qty). */
  positionText: string;
  /** True when the between-cycles wording applies (previous completed + now planning). */
  isBetweenCycles: boolean;
};

function finiteCycleNo(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return v > 0 ? v : null;
}

/**
 * Build dashboard trace position text. Returns null when no cycle position is known.
 */
export function buildNoQtyDashboardTraceLine(input: NoQtyDashboardTraceInput): NoQtyDashboardTraceLine | null {
  const docCycle = finiteCycleNo(input.cycleNo);
  const ptrCycle = finiteCycleNo(input.planningPointerCycleNo);
  const ahead = Boolean(input.noQtyPlanningPointerAhead);
  const draft = String(input.lastRsStatus ?? "").toUpperCase() === "DRAFT";

  if (ahead && docCycle != null && ptrCycle != null && ptrCycle > docCycle) {
    return {
      positionText: `Previous cycle: Cycle ${docCycle} completed · Now planning Cycle ${ptrCycle}`,
      isBetweenCycles: true,
    };
  }

  if (draft) {
    const n = ptrCycle ?? docCycle;
    if (n != null) {
      return {
        positionText: `Cycle ${n} · Draft RS`,
        isBetweenCycles: false,
      };
    }
  }

  const active = ahead ? (ptrCycle ?? docCycle) : (docCycle ?? ptrCycle);
  if (active != null) {
    return {
      positionText: `Cycle ${active}`,
      isBetweenCycles: false,
    };
  }

  return null;
}

/** Full compact line including the history affordance label (link rendered separately). */
export function formatNoQtyDashboardTracePosition(line: NoQtyDashboardTraceLine): string {
  return line.positionText;
}
