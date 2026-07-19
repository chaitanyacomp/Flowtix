import { describe, expect, it } from "vitest";
import {
  RM_ALLOWANCE_APPROVAL_ACTION,
  resolveAllowanceApprovalIdFromAction,
} from "../../src/lib/rmAllowanceApprovalApi";

describe("resolveAllowanceApprovalIdFromAction", () => {
  it("prefers metadata.allowanceApprovalId when present", () => {
    const id = resolveAllowanceApprovalIdFromAction({
      metadata: { allowanceApprovalId: 42 },
      href: "/pending-actions?focus=rm-allowance-approval&allowanceApprovalId=99",
    });
    expect(id).toBe(42);
  });

  it("falls back to parsing allowanceApprovalId from the href", () => {
    const id = resolveAllowanceApprovalIdFromAction({
      metadata: null,
      href: "/pending-actions?focus=rm-allowance-approval&allowanceApprovalId=7",
    });
    expect(id).toBe(7);
  });

  it("returns null when neither metadata nor href carry an id", () => {
    expect(resolveAllowanceApprovalIdFromAction({ metadata: null, href: "/pending-actions" })).toBeNull();
    expect(resolveAllowanceApprovalIdFromAction(null)).toBeNull();
    expect(resolveAllowanceApprovalIdFromAction(undefined)).toBeNull();
  });

  it("ignores non-positive or non-numeric metadata ids", () => {
    expect(
      resolveAllowanceApprovalIdFromAction({ metadata: { allowanceApprovalId: 0 }, href: "" }),
    ).toBeNull();
    expect(
      resolveAllowanceApprovalIdFromAction({ metadata: { allowanceApprovalId: "abc" }, href: "" }),
    ).toBeNull();
  });

  it("exposes the exact action label emitted by the backend for grouping", () => {
    expect(RM_ALLOWANCE_APPROVAL_ACTION).toBe("RM Allowance Approval");
  });
});
