import { formatNoQtyNextRsBlockReason } from "./noQtyNextRsBlockerPresentation";

export type PlanningInboxSheetRow = {
  id: number;
  cycleId?: number | null;
  version?: number | null;
  status: "DRAFT" | "LOCKED" | "CANCELLED" | string;
};

export type PlanningInboxSoSummary = {
  id: number;
  docNo?: string | null;
  internalStatus?: string | null;
  customer?: { name?: string | null } | null;
  po?: { customer?: { name?: string | null } | null } | null;
  processStage?: { key?: string; label?: string } | null;
  noQtyListPositionLabel?: string | null;
  noQtyActualActiveCycleNo?: number | null;
  noQtyGuidedCycleId?: number | null;
  noQtyCreateNextRsEligible?: boolean;
  noQtyCreateNextRsBlockReason?: string | null;
  noQtyCreateNextRsBlockingPmrDocNo?: string | null;
  noQtyNextRsAlreadyCreatedDocNo?: string | null;
  noQtyNextPossibleCycleNo?: number | null;
  hasCurrentCycleRequirementSheet?: boolean | null;
  noQtyNextActionLabel?: string | null;
  currentCycle?: { id: number; cycleNo: number; status?: string } | null;
};

export function isNoQtyAgreementClosed(so: Pick<PlanningInboxSoSummary, "internalStatus">): boolean {
  const st = String(so.internalStatus ?? "").toUpperCase();
  return st === "CLOSED" || st === "MANUALLY_CLOSED" || st === "COMPLETED";
}

export function planningInboxCustomerName(so: PlanningInboxSoSummary): string {
  return (
    so.customer?.name?.trim() ||
    so.po?.customer?.name?.trim() ||
    "—"
  );
}

export function planningInboxCycleLabel(so: PlanningInboxSoSummary): string {
  const pos = String(so.noQtyListPositionLabel ?? "").trim();
  if (pos) return pos;
  const n = so.noQtyActualActiveCycleNo ?? so.currentCycle?.cycleNo ?? null;
  if (n != null && Number.isFinite(Number(n)) && Number(n) > 0) return `Cycle ${Number(n)}`;
  return "—";
}

/** Pick the highest-version sheet on the guided cycle (or SO pointer cycle). */
export function resolvePlanningInboxRsStatus(
  sheets: PlanningInboxSheetRow[],
  cycleId: number | null,
): string {
  if (!Array.isArray(sheets) || sheets.length === 0) return "No RS";
  const cid = cycleId != null && Number.isFinite(Number(cycleId)) && Number(cycleId) > 0 ? Number(cycleId) : null;
  const scoped = cid != null ? sheets.filter((s) => Number(s.cycleId ?? 0) === cid) : sheets;
  const pool = scoped.length > 0 ? scoped : sheets;
  const sorted = [...pool].sort((a, b) => {
    const va = Number(a.version ?? 1);
    const vb = Number(b.version ?? 1);
    if (vb !== va) return vb - va;
    return Number(b.id) - Number(a.id);
  });
  const top = sorted[0];
  if (!top) return "No RS";
  const st = String(top.status ?? "").toUpperCase();
  if (st === "LOCKED") return "Locked";
  if (st === "DRAFT") return "Draft";
  if (st === "CANCELLED") return "Cancelled";
  return st || "—";
}

export function formatPlanningInboxNextRsLine(so: PlanningInboxSoSummary): {
  headline: string;
  reason: string | null;
  tone: "ready" | "blocked" | "exists";
} {
  const existing = String(so.noQtyNextRsAlreadyCreatedDocNo ?? "").trim();
  if (existing) {
    return {
      headline: "Next RS: Already on next cycle",
      reason: "Next cycle Requirement Sheet already exists.",
      tone: "exists",
    };
  }
  if (so.noQtyCreateNextRsEligible) {
    return {
      headline: "Next RS Ready",
      reason: null,
      tone: "ready",
    };
  }
  const reason = formatNoQtyNextRsBlockReason({
    eligible: false,
    reason: so.noQtyCreateNextRsBlockReason,
    blockingPmrDocNo: so.noQtyCreateNextRsBlockingPmrDocNo,
    existingNextRsDocNo: so.noQtyNextRsAlreadyCreatedDocNo,
    nextCycleNo: so.noQtyNextPossibleCycleNo,
  });
  return {
    headline: "Next RS Blocked",
    reason: reason || "Next cycle RS is not available for this agreement yet.",
    tone: "blocked",
  };
}

export function planningInboxAttentionScore(row: {
  so: PlanningInboxSoSummary;
  rsStatus: string;
}): number {
  let score = 0;
  if (row.so.noQtyCreateNextRsEligible) score += 100;
  if (row.rsStatus === "Draft") score += 80;
  if (row.rsStatus === "No RS") score += 70;
  if (row.rsStatus === "Cancelled") score += 60;
  if (String(row.so.noQtyNextActionLabel ?? "").trim()) score += 10;
  return score;
}

export function sortPlanningInboxRows<T extends { so: PlanningInboxSoSummary; rsStatus: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ds = planningInboxAttentionScore(b) - planningInboxAttentionScore(a);
    if (ds !== 0) return ds;
    const ca = a.so.noQtyActualActiveCycleNo ?? a.so.currentCycle?.cycleNo ?? 0;
    const cb = b.so.noQtyActualActiveCycleNo ?? b.so.currentCycle?.cycleNo ?? 0;
    if (cb !== ca) return Number(cb) - Number(ca);
    return Number(b.so.id) - Number(a.so.id);
  });
}
