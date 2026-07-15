import { describe, expect, it } from "vitest";
import { computeLiveNetProductionRequirement } from "../../src/lib/requirementSheetNoQtyUx";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("computeLiveNetProductionRequirement", () => {
  it("A: demand 3500, excess pool 500 → net 3000", () => {
    const r = computeLiveNetProductionRequirement({
      customerDemandQty: 3500,
      priorAcceptedExcessQty: 500,
      unusedAcceptedExcessQty: 0,
    });
    expect(r.allocatedAcceptedSurplusQty).toBe(500);
    expect(r.netProductionRequirementQty).toBe(3000);
  });

  it("B: edit demand to 4000 → net 3500", () => {
    const r = computeLiveNetProductionRequirement({
      customerDemandQty: 4000,
      priorAcceptedExcessQty: 500,
      unusedAcceptedExcessQty: 0,
    });
    expect(r.allocatedAcceptedSurplusQty).toBe(500);
    expect(r.netProductionRequirementQty).toBe(3500);
  });

  it("C: edit demand to 300 → net 0 with unused excess retained", () => {
    const r = computeLiveNetProductionRequirement({
      customerDemandQty: 300,
      priorAcceptedExcessQty: 500,
      unusedAcceptedExcessQty: 0,
    });
    expect(r.allocatedAcceptedSurplusQty).toBe(300);
    expect(r.netProductionRequirementQty).toBe(0);
    expect(r.unusedAcceptedSurplusQty).toBe(200);
  });

  it("includes kept recovery in gross before excess allocation", () => {
    const r = computeLiveNetProductionRequirement({
      customerDemandQty: 1000,
      keptProductionShortageQty: 200,
      keptQcRejectionQty: 100,
      availableAcceptedSurplusQty: 500,
    });
    expect(r.grossRequirementQty).toBe(1300);
    expect(r.allocatedAcceptedSurplusQty).toBe(500);
    expect(r.netProductionRequirementQty).toBe(800);
  });
});

describe("RequirementSheetNoQtyGrid columns", () => {
  const gridSource = readFileSync(
    resolve(__dirname, "../../src/components/erp/requirementSheet/RequirementSheetNoQtyGrid.tsx"),
    "utf8",
  );

  it("F: renders a single final executable quantity column", () => {
    expect(gridSource).toContain("Net Production Requirement");
    expect(gridSource).not.toContain("Final RS Qty");
    expect(gridSource).toContain("Customer Demand");
    expect(gridSource).toContain("Prior Accepted Excess");
    expect(gridSource).toContain("computeLiveNetProductionRequirement");
  });

  it("uses fixed table layout for header/value alignment", () => {
    expect(gridSource).toContain("table-fixed");
    expect(gridSource).toContain("colgroup");
    expect(gridSource).toContain('className="text-right"');
  });
});
