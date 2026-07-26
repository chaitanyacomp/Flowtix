import { describe, expect, it } from "vitest";
import {
  computeLiveNetProductionRequirement,
  computeProvisionalNetRecovery,
} from "../../src/lib/requirementSheetNoQtyUx";
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
    expect(r.effectiveRecoveryQty).toBe(300);
  });

  it("offsets kept recovery by accepted WO excess before Prior Accepted Excess", () => {
    const r = computeLiveNetProductionRequirement({
      customerDemandQty: 1000,
      keptProductionShortageQty: 67,
      acceptedWoExcessQty: 10,
      availableAcceptedSurplusQty: 0,
    });
    expect(r.effectiveRecoveryQty).toBe(57);
    expect(r.grossRequirementQty).toBe(1057);
    expect(r.netProductionRequirementQty).toBe(1057);
  });
});

describe("computeProvisionalNetRecovery", () => {
  it("example: gross shortage 67, excess pending QC 10 → provisional 57 subject to QC", () => {
    const r = computeProvisionalNetRecovery({
      grossProductionShortageQty: 67,
      producedExcessPendingQcQty: 10,
    });
    expect(r.provisionalNetRecoveryQty).toBe(57);
    expect(r.confirmedNetRecoveryQty).toBe(67);
    expect(r.subjectToQc).toBe(true);
    expect(r.finalizeBlocked).toBe(true);
  });

  it("final recovery is exactly 57 / 61 / 67 with no surplus-reject double count", () => {
    expect(
      computeProvisionalNetRecovery({
        grossProductionShortageQty: 67,
        acceptedWoExcessQty: 10,
      }).confirmedNetRecoveryQty,
    ).toBe(57);

    expect(
      computeProvisionalNetRecovery({
        grossProductionShortageQty: 67,
        acceptedWoExcessQty: 6,
        rejectedWoExcessQty: 4,
        keptFinalQcRejectionQty: 4, // leaked surplus scrap must not add
      }).confirmedNetRecoveryQty,
    ).toBe(61);

    const fullReject = computeProvisionalNetRecovery({
      grossProductionShortageQty: 67,
      acceptedWoExcessQty: 0,
      rejectedWoExcessQty: 10,
      keptFinalQcRejectionQty: 10, // would incorrectly yield 77 if double-counted
    });
    expect(fullReject.demandBackedQcRejectionQty).toBe(0);
    expect(fullReject.confirmedNetRecoveryQty).toBe(67);
    expect(fullReject.confirmedNetRecoveryQty).not.toBe(77);
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
    expect(gridSource).toContain("Produced Excess Pending QC");
    expect(gridSource).toContain("Provisional Net Recovery");
    expect(gridSource).toContain("computeLiveNetProductionRequirement");
  });

  it("uses fixed table layout for header/value alignment", () => {
    expect(gridSource).toContain("table-fixed");
    expect(gridSource).toContain("colgroup");
    expect(gridSource).toContain('className="text-right"');
  });
});
