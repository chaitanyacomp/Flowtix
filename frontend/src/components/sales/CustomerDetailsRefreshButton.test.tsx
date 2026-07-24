import { describe, expect, it, vi } from "vitest";
import { CustomerDetailsRefreshButton } from "./CustomerDetailsRefreshButton";

describe("CustomerDetailsRefreshButton", () => {
  it("appears for an unresolved DRAFT bill and invokes refresh when clicked", () => {
    const onRefresh = vi.fn();
    // GST/POS is intentionally absent: eligibility depends only on DRAFT status.
    const element = CustomerDetailsRefreshButton({ status: "DRAFT", refreshing: false, onRefresh });

    expect(element).not.toBeNull();
    expect(element?.props["data-testid"]).toBe("refresh-customer-details");
    expect(element?.props.children).toBe("Refresh customer details");
    element?.props.onClick();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("does not appear for immutable bills", () => {
    expect(CustomerDetailsRefreshButton({ status: "FINALIZED", refreshing: false, onRefresh: vi.fn() })).toBeNull();
  });
});
