import { describe, expect, it } from "vitest";
import { buildProductionScopedHref, productionWorkspaceHref } from "../../src/lib/productionNavigation";

describe("productionNavigation", () => {
  it("routes NO_QTY sales orders to guided production URL", () => {
    const href = buildProductionScopedHref({
      orderType: "NO_QTY",
      salesOrderId: 165,
      cycleId: 280,
      workOrderId: 267,
      workOrderLineId: 276,
    });
    expect(href).toContain("flow=NO_QTY");
    expect(href).toContain("source=no_qty_so");
    expect(href).toContain("salesOrderId=165");
    expect(href).toContain("cycleId=280");
    expect(href).toContain("workOrderId=267");
    expect(href).toContain("workOrderLineId=276");
    expect(href).not.toContain("flow=REGULAR_SO");
  });

  it("routes REGULAR sales orders with explicit REGULAR flow", () => {
    const href = buildProductionScopedHref({
      orderType: "NORMAL",
      salesOrderId: 10,
      workOrderId: 20,
    });
    expect(href).toContain("flow=REGULAR_SO");
    expect(href).toContain("salesOrderId=10");
    expect(href).toContain("workOrderId=20");
  });

  it("omits flow when order type is unknown (safe infer on Production page)", () => {
    const href = productionWorkspaceHref(267, 276);
    expect(href).toContain("workOrderId=267");
    expect(href).toContain("workOrderLineId=276");
    expect(href).not.toContain("flow=REGULAR_SO");
    expect(href).not.toContain("flow=NO_QTY");
  });

  it("prefers server actionHref when provided", () => {
    const href = buildProductionScopedHref({
      actionHref: "/production?source=no_qty_so&salesOrderId=1",
      orderType: "NORMAL",
      workOrderId: 9,
    });
    expect(href).toBe("/production?source=no_qty_so&salesOrderId=1");
  });
});
