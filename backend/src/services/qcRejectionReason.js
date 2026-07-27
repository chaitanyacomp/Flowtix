/**
 * Canonical QC rejection reason catalog (stable codes for reporting).
 * Shared contract: frontend mirrors codes/labels in `frontend/src/lib/qcRejectionReason.ts`.
 */

const QC_REJECTION_REASON_OPTIONS = Object.freeze([
  Object.freeze({ code: "DIMENSIONAL_ISSUE", label: "Dimensional issue" }),
  Object.freeze({ code: "VISUAL_DEFECT", label: "Visual defect" }),
  Object.freeze({ code: "SHORT_MOULDING", label: "Short moulding" }),
  Object.freeze({ code: "FLASH_EXCESS_MATERIAL", label: "Flash / excess material" }),
  Object.freeze({ code: "COLOUR_VARIATION", label: "Colour variation" }),
  Object.freeze({ code: "DAMAGE", label: "Damage" }),
  Object.freeze({ code: "CONTAMINATION", label: "Contamination" }),
  Object.freeze({ code: "ASSEMBLY_ISSUE", label: "Assembly issue" }),
  Object.freeze({ code: "OTHER", label: "Other" }),
]);

const QC_REJECTION_REASON_BY_CODE = Object.freeze(
  Object.fromEntries(QC_REJECTION_REASON_OPTIONS.map((o) => [o.code, o])),
);

const QC_REJECTION_REASON_OTHER_CODE = "OTHER";

function n(v) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Resolve stored description for reporting.
 * Standard reasons use catalog label; OTHER uses free-text details.
 */
function resolveQcRejectionReasonDescription(code, otherDetails) {
  const key = String(code ?? "").trim().toUpperCase();
  const option = QC_REJECTION_REASON_BY_CODE[key];
  if (!option) return null;
  if (key === QC_REJECTION_REASON_OTHER_CODE) {
    const other = String(otherDetails ?? "").trim();
    return other || null;
  }
  return option.label;
}

/**
 * Validate rejection reason for a QC posting.
 * Required only when rejectedQty > 0. Does not change disposition / SO-type rules.
 *
 * @returns {{
 *   ok: boolean;
 *   message?: string;
 *   rejectionReasonCode: string | null;
 *   reasonDescription: string | null;
 * }}
 */
function validateQcRejectionReasonInput({
  rejectedQty = 0,
  rejectionReasonCode = null,
  rejectionReasonOther = null,
  /** @deprecated Legacy free-text — accepted only when code is OTHER and other is blank. */
  reason = null,
} = {}) {
  const rejected = Math.max(0, n(rejectedQty));
  if (!(rejected > 1e-6)) {
    return { ok: true, rejectionReasonCode: null, reasonDescription: null };
  }

  const code = String(rejectionReasonCode ?? "").trim().toUpperCase();
  if (!code) {
    return {
      ok: false,
      message: "Rejection Reason is required when Rejected Qty is greater than zero.",
      rejectionReasonCode: null,
      reasonDescription: null,
    };
  }
  if (!QC_REJECTION_REASON_BY_CODE[code]) {
    return {
      ok: false,
      message: "Select a valid Rejection Reason.",
      rejectionReasonCode: null,
      reasonDescription: null,
    };
  }

  if (code === QC_REJECTION_REASON_OTHER_CODE) {
    const other = String(rejectionReasonOther ?? reason ?? "").trim();
    if (!other) {
      return {
        ok: false,
        message: "Specify Other Reason is required when Rejection Reason is Other.",
        rejectionReasonCode: code,
        reasonDescription: null,
      };
    }
    return { ok: true, rejectionReasonCode: code, reasonDescription: other };
  }

  return {
    ok: true,
    rejectionReasonCode: code,
    reasonDescription: QC_REJECTION_REASON_BY_CODE[code].label,
  };
}

/**
 * Build QcEntry.create `data` fields (scalar only) after reason validation.
 * Keeps production route payload aligned with Prisma QcEntry schema.
 */
function buildQcEntryCreateData({
  docNo,
  productionId,
  acceptedQty,
  rejectedQty,
  rejectedStockBucket = null,
  rejectedRoute = null,
  lossQty = 0,
  rejectionReasonCode = null,
  reasonDescription = null,
  scrapReusable = false,
} = {}) {
  return {
    docNo: docNo != null ? String(docNo) : undefined,
    productionId: Number(productionId),
    acceptedQty: String(acceptedQty),
    rejectedQty: String(rejectedQty),
    rejectedStockBucket,
    rejectedRoute,
    lossQty: String(lossQty),
    rejectionReasonCode: rejectionReasonCode != null ? String(rejectionReasonCode) : null,
    reason: reasonDescription != null ? String(reasonDescription) : null,
    scrapReusable: Boolean(scrapReusable),
  };
}

module.exports = {
  QC_REJECTION_REASON_OPTIONS,
  QC_REJECTION_REASON_BY_CODE,
  QC_REJECTION_REASON_OTHER_CODE,
  resolveQcRejectionReasonDescription,
  validateQcRejectionReasonInput,
  buildQcEntryCreateData,
};
