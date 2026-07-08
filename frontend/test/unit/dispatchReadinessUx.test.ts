import { describe, expect, it } from "vitest";
import {
  DISPATCH_BILLING_ADJUSTMENT_LABEL,
  draftLockEligibilityLabel,
  indexDraftLockEligibilityByDispatchId,
  isSalesBillBillingAdjustmentRequired,
  lookupDraftLockReadiness,
  resolveBackendDraftFinalizeGate,
} from "../../src/lib/dispatchReadinessUx";

describe("dispatchReadinessUx", () => {
  it("blocks finalize when backend draft lock eligibility is not READY", () => {
    expect(
      resolveBackendDraftFinalizeGate({
        draftLockEligibility: "WAITING_QA",
        draftLockEligibilityReason: "Dispatch exceeds QC-approved quantity for this sales order.",
      }),
    ).toEqual({
      canFinalize: false,
      state: "WAITING_QA",
      reason: "Dispatch exceeds QC-approved quantity for this sales order.",
      label: "Waiting for QC",
    });
  });

  it("allows finalize when backend reports READY", () => {
    expect(
      resolveBackendDraftFinalizeGate({
        draftLockEligibility: "READY",
        draftLockEligibilityReason: null,
      }),
    ).toEqual({
      canFinalize: true,
      state: "READY",
      reason: null,
      label: "Ready to finalize",
    });
  });

  it("allows finalize when backend eligibility is absent (lock API remains authority)", () => {
    expect(resolveBackendDraftFinalizeGate({})).toEqual({
      canFinalize: true,
      state: null,
      reason: null,
      label: null,
    });
  });

  it("indexes draft lock readiness from sales-order dispatch arrays", () => {
    const index = indexDraftLockEligibilityByDispatchId([
      {
        dispatch: [
          { id: 10, draftLockEligibility: "READY", draftLockEligibilityReason: null },
          { id: 11, draftLockEligibility: "WAITING_STOCK", draftLockEligibilityReason: "Insufficient usable stock." },
        ],
      },
    ]);
    expect(lookupDraftLockReadiness(11, index)?.draftLockEligibility).toBe("WAITING_STOCK");
    expect(draftLockEligibilityLabel("WAITING_STOCK")).toBe("Waiting for stock");
  });

  it("detects billing adjustment flags from ledger or bill fields", () => {
    expect(isSalesBillBillingAdjustmentRequired({ salesBillBillingAdjustmentRequired: true })).toBe(true);
    expect(isSalesBillBillingAdjustmentRequired({ billingAdjustmentRequired: true })).toBe(true);
    expect(isSalesBillBillingAdjustmentRequired({})).toBe(false);
    expect(DISPATCH_BILLING_ADJUSTMENT_LABEL).toContain("Billing adjustment required");
  });
});
