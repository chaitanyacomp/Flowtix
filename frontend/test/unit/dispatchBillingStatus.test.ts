import { describe, expect, it } from "vitest";
import {
  deriveDispatchBillingStatus,
  dispatchBillingStatusLabel,
} from "../../src/lib/dispatchBillingStatus";

const lockedForward = {
  workflowStatus: "LOCKED" as const,
  reversalOfId: null,
  dispatchedQty: 10,
};

describe("dispatchBillingStatus", () => {
  it("returns NOT_APPLICABLE for draft or reversed rows", () => {
    expect(
      deriveDispatchBillingStatus({ workflowStatus: "UNLOCKED", dispatchedQty: 5, reversalOfId: null }),
    ).toBe("NOT_APPLICABLE");
    expect(
      deriveDispatchBillingStatus({ ...lockedForward, reversalOfId: 99 }),
    ).toBe("NOT_APPLICABLE");
    expect(
      deriveDispatchBillingStatus({ ...lockedForward, dispatchedQty: 0 }),
    ).toBe("NOT_APPLICABLE");
  });

  it("returns READY_FOR_SALES_BILL when locked with no bill", () => {
    expect(
      deriveDispatchBillingStatus({ ...lockedForward, salesBillExists: false }),
    ).toBe("READY_FOR_SALES_BILL");
    expect(dispatchBillingStatusLabel("READY_FOR_SALES_BILL")).toBe("Ready for Sales Bill");
  });

  it("returns BILL_DRAFT when bill exists but not finalized", () => {
    expect(
      deriveDispatchBillingStatus({
        ...lockedForward,
        salesBillExists: true,
        salesBillStatus: "DRAFT",
      }),
    ).toBe("BILL_DRAFT");
  });

  it("returns BILLED when finalized and not exported", () => {
    expect(
      deriveDispatchBillingStatus({
        ...lockedForward,
        salesBillExists: true,
        salesBillStatus: "FINALIZED",
        salesBillIsExported: false,
      }),
    ).toBe("BILLED");
  });

  it("returns EXPORTED when bill is exported", () => {
    expect(
      deriveDispatchBillingStatus({
        ...lockedForward,
        salesBillExists: true,
        salesBillStatus: "FINALIZED",
        salesBillIsExported: true,
      }),
    ).toBe("EXPORTED");
  });
});
