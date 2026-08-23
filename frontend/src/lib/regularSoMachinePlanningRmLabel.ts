/**
 * Store / RM column label for REGULAR_SO machine planning queue.
 * "Ready for WO" only after completed, valid machine planning + RM gates.
 */

export type MachinePlanningRmReadinessSummary = {
  canCreateWorkOrder?: boolean;
  shortageRmCount?: number;
  woBlockReason?: string | null;
  storeOperationalKey?: string;
  storeOperationalLabel?: string;
  requiredQtyTotal?: number;
  availableQtyTotal?: number;
  shortageQtyTotal?: number;
};

export type MachinePlanningRmLabelRow = {
  machinePlanningComplete?: boolean;
  storeOperationalKey?: string | null;
  storeOperationalLabel?: string | null;
  rmReadinessSummary?: MachinePlanningRmReadinessSummary | null;
};

function hasRmShortage(rm: MachinePlanningRmReadinessSummary): boolean {
  if (rm.shortageQtyTotal != null && Number(rm.shortageQtyTotal) > 1e-9) return true;
  if (rm.shortageRmCount != null && Number(rm.shortageRmCount) > 0) return true;
  return false;
}

/**
 * Display label for Store/RM while Production plans (or after handoff).
 */
export function regularSoMachinePlanningRmLabel(row: MachinePlanningRmLabelRow): string {
  const rm = row.rmReadinessSummary;
  if (rm == null) return "—";

  const planningComplete = row.machinePlanningComplete === true;
  const readyForWo =
    planningComplete &&
    (rm.canCreateWorkOrder === true ||
      row.storeOperationalKey === "READY_FOR_WO" ||
      rm.storeOperationalKey === "READY_FOR_WO");

  if (readyForWo) return "Ready for WO";

  if (hasRmShortage(rm)) {
    if (rm.requiredQtyTotal != null || rm.availableQtyTotal != null || rm.shortageQtyTotal != null) {
      return `RM Shortage · req ${rm.requiredQtyTotal ?? "—"} / avail ${rm.availableQtyTotal ?? "—"} / short ${rm.shortageQtyTotal ?? "—"}`;
    }
    return "RM Shortage";
  }

  if (!planningComplete) return "RM Available";

  return row.storeOperationalLabel || rm.storeOperationalLabel || "With Store";
}
