/**
 * Decision-only / Recovery-only RS finalize eligibility (frontend mirror of backend SSOT).
 * When Current Requirement and Total to Produce are 0 and every CF item is KEEP/WAIVE,
 * Finalize RS must be allowed so the recovery cycle can close without production.
 */

export type RecoveryDecisionItemLike = {
  decisionStatus?: string | null;
  pendingRecoveryQty?: number | null;
};

export type DraftLineQtyLike = {
  newWoQty?: number | null;
  requirementQty?: number | null;
  /** Computed Total to Produce (draft). */
  toProduceQty?: number | null;
};

const EPS = 1e-6;

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Pure rule: recovery decisions completed + zero demand/produce qty.
 */
export function isDecisionOnlyRecoveryCycleReady(input: {
  isNoQty?: boolean;
  sheetStatus?: string | null;
  lines: DraftLineQtyLike[];
  recoveryDecisionItems: RecoveryDecisionItemLike[];
}): boolean {
  if (input.isNoQty === false) return false;
  if (String(input.sheetStatus ?? "").toUpperCase() !== "DRAFT") return false;
  const items = input.recoveryDecisionItems || [];
  if (items.length === 0) return false;

  const pending = items.some(
    (d) =>
      String(d.decisionStatus ?? "").toUpperCase() === "PENDING" && n(d.pendingRecoveryQty) > EPS,
  );
  if (pending) return false;

  const decided = items.filter((d) => {
    const s = String(d.decisionStatus ?? "").toUpperCase();
    return s === "KEPT" || s === "WAIVED";
  });
  if (decided.length === 0) return false;
  if (decided.length !== items.length) {
    // Allow CANCELLED-excluded payloads; any non-KEPT/WAIVED remaining blocks.
    const unresolved = items.some((d) => {
      const s = String(d.decisionStatus ?? "").toUpperCase();
      return s !== "KEPT" && s !== "WAIVED";
    });
    if (unresolved) return false;
  }

  const lines = input.lines || [];
  if (lines.length === 0) return false;
  return lines.every((l) => n(l.newWoQty ?? l.requirementQty) <= EPS && n(l.toProduceQty) <= EPS);
}

export const DECISION_ONLY_RECOVERY_FINALIZE_MESSAGE =
  "Recovery decisions completed. This cycle can now be finalized.";
