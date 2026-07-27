/**
 * Canonical QC rejection reason catalog (stable codes for reporting).
 * Keep in sync with `backend/src/services/qcRejectionReason.js`.
 */

export const QC_REJECTION_REASON_OTHER_CODE = "OTHER" as const;

export type QcRejectionReasonCode =
  | "DIMENSIONAL_ISSUE"
  | "VISUAL_DEFECT"
  | "SHORT_MOULDING"
  | "FLASH_EXCESS_MATERIAL"
  | "COLOUR_VARIATION"
  | "DAMAGE"
  | "CONTAMINATION"
  | "ASSEMBLY_ISSUE"
  | typeof QC_REJECTION_REASON_OTHER_CODE;

export type QcRejectionReasonOption = {
  code: QcRejectionReasonCode;
  label: string;
};

export const QC_REJECTION_REASON_OPTIONS: readonly QcRejectionReasonOption[] = [
  { code: "DIMENSIONAL_ISSUE", label: "Dimensional issue" },
  { code: "VISUAL_DEFECT", label: "Visual defect" },
  { code: "SHORT_MOULDING", label: "Short moulding" },
  { code: "FLASH_EXCESS_MATERIAL", label: "Flash / excess material" },
  { code: "COLOUR_VARIATION", label: "Colour variation" },
  { code: "DAMAGE", label: "Damage" },
  { code: "CONTAMINATION", label: "Contamination" },
  { code: "ASSEMBLY_ISSUE", label: "Assembly issue" },
  { code: "OTHER", label: "Other" },
] as const;

const BY_CODE = Object.fromEntries(QC_REJECTION_REASON_OPTIONS.map((o) => [o.code, o])) as Record<
  QcRejectionReasonCode,
  QcRejectionReasonOption
>;

const EPS = 1e-6;

export function isQcRejectionReasonCode(value: string | null | undefined): value is QcRejectionReasonCode {
  const key = String(value ?? "").trim().toUpperCase();
  return Boolean(BY_CODE[key as QcRejectionReasonCode]);
}

export function qcRejectionReasonLabel(code: string | null | undefined): string | null {
  const key = String(code ?? "").trim().toUpperCase() as QcRejectionReasonCode;
  return BY_CODE[key]?.label ?? null;
}

/** True when rejected qty requires a dropdown selection (and Other details when applicable). */
export function isQcRejectionReasonComplete(input: {
  rejectedQty: number | null | undefined;
  rejectionReasonCode: string | null | undefined;
  rejectionReasonOther?: string | null | undefined;
}): boolean {
  const rejected = Number(input.rejectedQty ?? 0);
  if (!(Number.isFinite(rejected) && rejected > EPS)) return true;
  const code = String(input.rejectionReasonCode ?? "").trim().toUpperCase();
  if (!isQcRejectionReasonCode(code)) return false;
  if (code === QC_REJECTION_REASON_OTHER_CODE) {
    return String(input.rejectionReasonOther ?? "").trim().length > 0;
  }
  return true;
}

export function resolveQcRejectionReasonDescription(input: {
  rejectionReasonCode: string | null | undefined;
  rejectionReasonOther?: string | null | undefined;
}): string | null {
  const code = String(input.rejectionReasonCode ?? "").trim().toUpperCase();
  if (!isQcRejectionReasonCode(code)) return null;
  if (code === QC_REJECTION_REASON_OTHER_CODE) {
    const other = String(input.rejectionReasonOther ?? "").trim();
    return other || null;
  }
  return BY_CODE[code].label;
}

export function qcRejectionReasonValidationMessage(input: {
  rejectedQty: number | null | undefined;
  rejectionReasonCode: string | null | undefined;
  rejectionReasonOther?: string | null | undefined;
}): string | null {
  const rejected = Number(input.rejectedQty ?? 0);
  if (!(Number.isFinite(rejected) && rejected > EPS)) return null;
  const code = String(input.rejectionReasonCode ?? "").trim().toUpperCase();
  if (!code) return "Rejection Reason is required.";
  if (!isQcRejectionReasonCode(code)) return "Select a valid Rejection Reason.";
  if (code === QC_REJECTION_REASON_OTHER_CODE && !String(input.rejectionReasonOther ?? "").trim()) {
    return "Specify Other Reason is required.";
  }
  return null;
}
