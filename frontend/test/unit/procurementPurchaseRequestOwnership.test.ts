import { describe, expect, it } from "vitest";
import {
  canRoleCreatePurchaseRequestForMr,
  isMprsMaterialRequirement,
} from "../../src/lib/procurementPurchaseRequestOwnership";

describe("procurementPurchaseRequestOwnership", () => {
  it("detects MPRS material requirements", () => {
    expect(isMprsMaterialRequirement({ sourceType: "MONTHLY_PLAN" })).toBe(true);
    expect(isMprsMaterialRequirement({ source: { type: "MONTHLY_PLAN" } })).toBe(true);
    expect(isMprsMaterialRequirement({ sourceType: "SALES_ORDER" })).toBe(false);
  });

  it("Purchase may create PR for MPRS MR rows", () => {
    const mr = { sourceType: "MONTHLY_PLAN" };
    expect(canRoleCreatePurchaseRequestForMr("PURCHASE", mr, "MPRS")).toBe(true);
    expect(canRoleCreatePurchaseRequestForMr("STORE", mr, "MPRS")).toBe(false);
  });

  it("Store may create PR for REGULAR_SO MR rows", () => {
    const mr = { sourceType: "WORK_ORDER_PLANNING" };
    expect(canRoleCreatePurchaseRequestForMr("STORE", mr, "REGULAR_SO")).toBe(true);
    expect(canRoleCreatePurchaseRequestForMr("PURCHASE", mr, "REGULAR_SO")).toBe(false);
  });

  it("Admin may create PR for any pool", () => {
    expect(canRoleCreatePurchaseRequestForMr("ADMIN", { sourceType: "MONTHLY_PLAN" }, "MPRS")).toBe(true);
    expect(canRoleCreatePurchaseRequestForMr("ADMIN", { sourceType: "SALES_ORDER" }, "REGULAR_SO")).toBe(
      true,
    );
  });
});
