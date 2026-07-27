import { describe, expect, it } from "vitest";
import {
  QC_REJECTION_REASON_OPTIONS,
  QC_REJECTION_REASON_OTHER_CODE,
  isQcRejectionReasonComplete,
  qcRejectionReasonValidationMessage,
  resolveQcRejectionReasonDescription,
} from "../../src/lib/qcRejectionReason";

describe("qcRejectionReason", () => {
  it("lists standard reasons including Other", () => {
    expect(QC_REJECTION_REASON_OPTIONS.map((o) => o.label)).toEqual([
      "Dimensional issue",
      "Visual defect",
      "Short moulding",
      "Flash / excess material",
      "Colour variation",
      "Damage",
      "Contamination",
      "Assembly issue",
      "Other",
    ]);
    expect(QC_REJECTION_REASON_OTHER_CODE).toBe("OTHER");
  });

  it("treats no rejection as complete without a reason", () => {
    expect(
      isQcRejectionReasonComplete({
        rejectedQty: 0,
        rejectionReasonCode: "",
      }),
    ).toBe(true);
    expect(
      qcRejectionReasonValidationMessage({
        rejectedQty: 0,
        rejectionReasonCode: "",
      }),
    ).toBeNull();
  });

  it("requires a standard reason when rejected qty > 0", () => {
    expect(
      isQcRejectionReasonComplete({
        rejectedQty: 3,
        rejectionReasonCode: "",
      }),
    ).toBe(false);
    expect(
      qcRejectionReasonValidationMessage({
        rejectedQty: 3,
        rejectionReasonCode: "",
      }),
    ).toMatch(/Rejection Reason is required/i);

    expect(
      isQcRejectionReasonComplete({
        rejectedQty: 3,
        rejectionReasonCode: "VISUAL_DEFECT",
      }),
    ).toBe(true);
    expect(
      resolveQcRejectionReasonDescription({
        rejectionReasonCode: "VISUAL_DEFECT",
      }),
    ).toBe("Visual defect");
  });

  it("requires Specify Other Reason when Other is selected", () => {
    expect(
      isQcRejectionReasonComplete({
        rejectedQty: 1,
        rejectionReasonCode: "OTHER",
        rejectionReasonOther: "",
      }),
    ).toBe(false);
    expect(
      qcRejectionReasonValidationMessage({
        rejectedQty: 1,
        rejectionReasonCode: "OTHER",
        rejectionReasonOther: "  ",
      }),
    ).toMatch(/Specify Other Reason/i);

    expect(
      isQcRejectionReasonComplete({
        rejectedQty: 1,
        rejectionReasonCode: "OTHER",
        rejectionReasonOther: "Custom defect note",
      }),
    ).toBe(true);
    expect(
      resolveQcRejectionReasonDescription({
        rejectionReasonCode: "OTHER",
        rejectionReasonOther: "Custom defect note",
      }),
    ).toBe("Custom defect note");
  });
});
