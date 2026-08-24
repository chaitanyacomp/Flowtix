import { apiFetch } from "../services/api";

export const PURGING_CONSUMPTION_EVENT = "PURGING_CONSUMPTION";

/** Operator-facing material condition choices — no default selection. */
export const MATERIAL_CONDITIONS = [
  { value: "SAME_MATERIAL_RETAINED", label: "Same material as this job" },
  { value: "DIFFERENT_MATERIAL_RETAINED", label: "Different material" },
  { value: "MACHINE_CLEARED", label: "Machine is empty/cleaned" },
  { value: "UNKNOWN", label: "Not sure" },
] as const;

/** Operator-facing mould choices — independent of purge decision. */
export const SETUP_CONDITIONS = [
  { value: "SETUP_RETAINED", label: "Correct mould was already fitted" },
  { value: "NEW_SETUP_COMPLETED", label: "Correct mould is fitted now" },
] as const;

export const CONFIRM_START_MODAL_TITLE = "Check Machine Before Start";
export const MATERIAL_REQUIRED_LABEL = "Material required for this job:";
export const MATERIAL_QUESTION = "Which material is inside the machine now?";
export const MOULD_QUESTION = "Is the correct mould fitted?";
export const MACHINE_MATERIAL_NOT_RECORDED_NOTE =
  "Machine material is not recorded. Please check before starting.";

/** Compact layout contract for 1280×768 shop-floor screens. */
export const CONFIRM_START_LAYOUT = {
  viewportWidth: 1280,
  viewportHeight: 768,
  maxModalHeightClass: "max-h-[min(85vh,640px)]",
  maxModalWidthClass: "max-w-xl",
  optionTextClass: "text-sm", // 14px
  bodyScrollClass: "min-h-0 flex-1 overflow-y-auto",
  footerStickyClass: "shrink-0 border-t bg-white",
} as const;

/** Words that must not appear in operator-facing Confirm Start UI copy. */
export const CONFIRM_START_BANNED_OPERATOR_WORDS = [
  "retained",
  "profile",
  "conservative",
  "fingerprint",
  "physical setup",
  "allocation",
] as const;
export type MaterialCondition = (typeof MATERIAL_CONDITIONS)[number]["value"];
export type SetupCondition = (typeof SETUP_CONDITIONS)[number]["value"];

export type ProductionRunStartListResponse = {
  mode: "LEGACY" | "MACHINE_RUN_PLANNING";
  label: string | null;
  runs: Array<{
    runAllocationId: number;
    runSequence: number;
    machine: { id: number; machineCode: string; machineName: string };
    fgItem: { id: number; itemName: string };
    plannedPurgingRequired: boolean;
    plannedDetectionReason: string | null;
    needsConfirmation: boolean;
    entryAllowed?: boolean;
    isActive?: boolean;
    confirmation: ProductionRunStartConfirmation | null;
  }>;
};

export type ProductionRunStartConfirmation = {
  id: number;
  status: string;
  eventType: string;
  actualMaterialCondition: string;
  actualSetupCondition: string;
  suggestedPurgingRequired: boolean;
  suggestedPurgingReason: string | null;
  actualPurgingRequired: boolean;
  purgeOverrideReason: string | null;
  plannedPurgeQtyGrams: number;
  actualPurgeQtyGrams: number;
  purgeVarianceGrams: number;
  confirmedAt: string;
  confirmedBy: { id: number; name: string | null } | null;
  purgeRmLines: Array<{
    itemId: number;
    itemName: string | null;
    actualQtyKg: number;
    materialWastageDocNo: string | null;
    eventType: string;
  }>;
};

export type ProductionRunStartPreview = {
  runAllocationId: number;
  runSequence?: number | null;
  workOrderId: number;
  workOrderNo: string | null;
  orderType: string | null;
  machine: { id: number; machineCode: string; machineName: string };
  fgItem: { id: number; itemName: string; unit?: string | null };
  bom: { id: number; revisionLabel: string | null; standardPurgingQtyGrams: number } | null;
  planned: {
    purgingRequired: boolean;
    detectionStatus: string;
    detectionReason: string | null;
    previousProfileFingerprint: string | null;
    targetProfileFingerprint: string | null;
    targetProfileLabel?: string | null;
    targetProfileComponents?: Array<{
      rmItemId: number;
      mixPercent: number;
      itemName?: string | null;
    }>;
    plannedPurgeQtyGrams: number;
    allocationPreviewKg: Array<{
      rmItemId: number;
      itemName?: string | null;
      mixPercent?: number;
      purgingQtyKg: number;
    }>;
  };
  machineState: {
    materialState: string;
    currentProfileFingerprint: string | null;
    currentProfileLabel?: string | null;
    version: number;
  };
  confirmation: ProductionRunStartConfirmation | null;
};

function fmtGramsForOperator(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${Math.round(v * 1000) / 1000} g`;
}

/** Success summary after Confirm Start — no confirmer name / role dangling. */
export function formatStartConfirmSuccessSummary(input: {
  actualPurgingRequired: boolean;
  actualPurgeQtyGrams?: number | null;
  purgeVarianceGrams?: number | null;
  runSequence?: number | null;
}): { purgeLine: string; readyLine: string | null } {
  const purgeLine = input.actualPurgingRequired
    ? `Purging: ${fmtGramsForOperator(input.actualPurgeQtyGrams)} · Difference from standard: ${fmtGramsForOperator(input.purgeVarianceGrams)}`
    : "Purging not required";
  const seq = Number(input.runSequence);
  const readyLine =
    Number.isFinite(seq) && seq > 0 ? `Run ${seq} is ready for production.` : null;
  return { purgeLine, readyLine };
}

/** Client-side suggestion mirror (server remains authoritative). Empty → no decision yet. */
export function suggestPurgeFromActualCondition(
  condition: MaterialCondition | null | undefined,
): {
  suggestedPurgingRequired: boolean | null;
  suggestedPurgingReason: string | null;
} {
  switch (condition) {
    case "SAME_MATERIAL_RETAINED":
      return {
        suggestedPurgingRequired: false,
        suggestedPurgingReason: "Same material as this job — purging is not required.",
      };
    case "DIFFERENT_MATERIAL_RETAINED":
      return {
        suggestedPurgingRequired: true,
        suggestedPurgingReason: "Different material is in the machine — purging is required.",
      };
    case "MACHINE_CLEARED":
      return {
        suggestedPurgingRequired: true,
        suggestedPurgingReason: "Machine is empty/cleaned — purging is required.",
      };
    case "UNKNOWN":
      return {
        suggestedPurgingRequired: true,
        suggestedPurgingReason: "Material is not sure — purging is required.",
      };
    default:
      return { suggestedPurgingRequired: null, suggestedPurgingReason: null };
  }
}

/** Setup/mould choice must not independently drive purge. */
export function mouldChoiceAffectsPurgeDecision(_setup: SetupCondition | null | undefined): boolean {
  return false;
}

export function formatReadableMaterialProfileLabel(
  components: Array<{ itemName?: string | null; rmItemId?: number; mixPercent?: number }> | null | undefined,
): string {
  const rows = Array.isArray(components) ? components : [];
  const parts = rows
    .map((c) => {
      const name = String(c?.itemName ?? "").trim() || `RM #${c?.rmItemId ?? "?"}`;
      const pct = Number(c?.mixPercent);
      if (!Number.isFinite(pct)) return name;
      return `${name} — ${Math.round(pct * 1000) / 1000}%`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "Not available";
}

export function parseActualPurgeQtyDraft(
  raw: string,
  purgingRequired: boolean,
): { ok: true; value: number } | { ok: false; message: string } {
  const t = String(raw ?? "").trim();
  if (!t) {
    if (!purgingRequired) return { ok: true, value: 0 };
    return { ok: false, message: "Enter actual purging quantity (grams)." };
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) {
    return { ok: false, message: "Purging quantity is malformed." };
  }
  const n = Number(t);
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    return { ok: false, message: "Purging quantity must be a finite number." };
  }
  if (n < 0) return { ok: false, message: "Purging quantity cannot be negative." };
  if (!purgingRequired && n !== 0) {
    return { ok: false, message: "Quantity must be zero when purging is not required." };
  }
  if (purgingRequired && n <= 0) {
    return { ok: false, message: "Quantity must be greater than zero when purging is required." };
  }
  return { ok: true, value: Math.round(n * 1000) / 1000 };
}

/** Confirm Start enablement — both physical choices required; no defaults. */
export function canEnableConfirmStart(input: {
  materialCondition: MaterialCondition | null;
  setupCondition: SetupCondition | null;
  actualPurgeRequired: boolean | null;
  purgeQtyOk: boolean;
  overrideReasonOk: boolean;
  readOnly?: boolean;
  submitting?: boolean;
}): boolean {
  if (input.readOnly || input.submitting) return false;
  if (!input.materialCondition || !input.setupCondition) return false;
  if (input.actualPurgeRequired == null) return false;
  if (!input.purgeQtyOk) return false;
  if (!input.overrideReasonOk) return false;
  return true;
}

/** Map API/network errors to a concise operator message (never Prisma text). */
export function operatorMessageFromConfirmError(error: unknown, fallback = "Confirmation failed."): string {
  if (error && typeof error === "object" && "message" in error) {
    const msg = String((error as { message?: unknown }).message ?? "").trim();
    if (!msg) return fallback;
    if (/Invalid\s*`[^`]+`\s*invocation|PrismaClient|prisma\./i.test(msg)) {
      return "Could not confirm production start. Please try again or contact Admin.";
    }
    return msg;
  }
  return fallback;
}

export async function fetchProductionRunStarts(
  workOrderId: number,
): Promise<ProductionRunStartListResponse> {
  return apiFetch(`/api/production/work-orders/${workOrderId}/production-run-starts`);
}

export async function fetchProductionRunStartPreview(
  runAllocationId: number,
): Promise<ProductionRunStartPreview> {
  return apiFetch(`/api/production/production-run-allocations/${runAllocationId}/start-preview`);
}

export async function confirmProductionRunStartApi(
  runAllocationId: number,
  body: {
    actualMaterialCondition: MaterialCondition;
    actualSetupCondition: SetupCondition;
    actualPurgingRequired?: boolean;
    purgeOverrideReason?: string | null;
    actualPurgeQtyGrams?: number | string | null;
    expectedMachineStateVersion?: number | null;
    idempotencyKey?: string | null;
  },
): Promise<{ confirmation: ProductionRunStartConfirmation; idempotent: boolean }> {
  return apiFetch(`/api/production/production-run-allocations/${runAllocationId}/confirm-start`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
