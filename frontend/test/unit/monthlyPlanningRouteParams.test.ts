import { describe, expect, it } from "vitest";
import { requestedMonthlyPlanId } from "../../src/lib/monthlyPlanningRouteParams";

describe("monthlyPlanningRouteParams", () => {
  it("prefers planId over monthlyPlanId", () => {
    const params = new URLSearchParams("planId=11&monthlyPlanId=12");
    expect(requestedMonthlyPlanId(params)).toBe(11);
  });

  it("falls back to monthlyPlanId", () => {
    const params = new URLSearchParams("monthlyPlanId=12");
    expect(requestedMonthlyPlanId(params)).toBe(12);
  });

  it("ignores invalid ids", () => {
    expect(requestedMonthlyPlanId(new URLSearchParams("planId=0&monthlyPlanId=-1"))).toBeNull();
  });
});
