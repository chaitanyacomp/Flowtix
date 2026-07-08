/**
 * M1.3 — Dispatch workspace readiness presentation (consumes Batch 2D/2E API fields only).
 * Backend lock/billing rules remain authoritative; UI never re-implements eligibility engines.
 */

export type DispatchDraftLockEligibilityState =
  | "READY"
  | "WAITING_QA"
  | "WAITING_STOCK"
  | "WAITING_APPROVAL";

export type DispatchDraftLockReadinessFields = {
  draftLockEligibility?: DispatchDraftLockEligibilityState | string | null;
  draftLockEligibilityReason?: string | null;
};

export type DispatchBillingAdjustmentFields = {
  /** GET /api/dispatch/ledger — bill summary on dispatch row */
  salesBillBillingAdjustmentRequired?: boolean | null;
  /** When bill payload is inlined on a dispatch row */
  billingAdjustmentRequired?: boolean | null;
};

export type DispatchReadinessRow = DispatchDraftLockReadinessFields &
  DispatchBillingAdjustmentFields & {
    id?: number;
  };

export const DISPATCH_BILLING_ADJUSTMENT_LABEL =
  "Billing adjustment required — review the linked sales bill after dispatch reversal.";

function normalizeDraftLockState(
  raw: DispatchDraftLockEligibilityState | string | null | undefined,
): DispatchDraftLockEligibilityState | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (
    s === "READY" ||
    s === "WAITING_QA" ||
    s === "WAITING_STOCK" ||
    s === "WAITING_APPROVAL"
  ) {
    return s;
  }
  return null;
}

export function draftLockEligibilityLabel(
  state: DispatchDraftLockEligibilityState | string | null | undefined,
): string {
  switch (normalizeDraftLockState(state)) {
    case "READY":
      return "Ready to finalize";
    case "WAITING_QA":
      return "Waiting for QC";
    case "WAITING_STOCK":
      return "Waiting for stock";
    case "WAITING_APPROVAL":
      return "Waiting for approval";
    default:
      return "";
  }
}

export function draftLockEligibilityBadgeClass(
  state: DispatchDraftLockEligibilityState | string | null | undefined,
): string {
  switch (normalizeDraftLockState(state)) {
    case "READY":
      return "border-emerald-200 bg-emerald-50 text-emerald-950";
    case "WAITING_QA":
      return "border-violet-200 bg-violet-50 text-violet-950";
    case "WAITING_STOCK":
      return "border-amber-200 bg-amber-50 text-amber-950";
    case "WAITING_APPROVAL":
      return "border-slate-300 bg-slate-50 text-slate-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export type BackendDraftFinalizeGate = {
  canFinalize: boolean;
  state: DispatchDraftLockEligibilityState | null;
  reason: string | null;
  label: string | null;
};

/**
 * Finalize/Lock UI gate from backend `draftLockEligibility` (+ reason).
 * When the API omits eligibility, allow the action — POST /lock remains authoritative.
 */
export function resolveBackendDraftFinalizeGate(
  row: DispatchDraftLockReadinessFields | null | undefined,
): BackendDraftFinalizeGate {
  const state = normalizeDraftLockState(row?.draftLockEligibility);
  if (!state) {
    return { canFinalize: true, state: null, reason: null, label: null };
  }
  const label = draftLockEligibilityLabel(state);
  if (state === "READY") {
    return { canFinalize: true, state, reason: null, label };
  }
  const reason = row?.draftLockEligibilityReason?.trim() || label;
  return { canFinalize: false, state, reason, label };
}

export function indexDraftLockEligibilityByDispatchId(
  salesOrders: Array<{ dispatch?: DispatchReadinessRow[] | null }> | null | undefined,
): Map<number, DispatchReadinessRow> {
  const map = new Map<number, DispatchReadinessRow>();
  for (const so of salesOrders ?? []) {
    for (const d of so.dispatch ?? []) {
      const id = Number(d.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      map.set(id, d);
    }
  }
  return map;
}

export function lookupDraftLockReadiness(
  dispatchId: number | null | undefined,
  index: Map<number, DispatchReadinessRow>,
): DispatchReadinessRow | null {
  const id = Number(dispatchId ?? 0);
  if (!(id > 0)) return null;
  return index.get(id) ?? null;
}

export function isSalesBillBillingAdjustmentRequired(
  row: DispatchBillingAdjustmentFields | null | undefined,
): boolean {
  return (
    row?.salesBillBillingAdjustmentRequired === true || row?.billingAdjustmentRequired === true
  );
}

export function mergeDispatchReadinessFields<T extends DispatchReadinessRow>(
  row: T,
  index: Map<number, DispatchReadinessRow>,
): T {
  const id = Number(row.id);
  if (!(id > 0)) return row;
  const fromSo = index.get(id);
  if (!fromSo) return row;
  return {
    ...row,
    draftLockEligibility: row.draftLockEligibility ?? fromSo.draftLockEligibility ?? null,
    draftLockEligibilityReason:
      row.draftLockEligibilityReason ?? fromSo.draftLockEligibilityReason ?? null,
    salesBillBillingAdjustmentRequired:
      row.salesBillBillingAdjustmentRequired ?? fromSo.salesBillBillingAdjustmentRequired ?? null,
    billingAdjustmentRequired:
      row.billingAdjustmentRequired ?? fromSo.billingAdjustmentRequired ?? null,
  };
}
