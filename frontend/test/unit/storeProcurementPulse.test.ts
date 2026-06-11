import { describe, expect, it } from "vitest";
import {
  buildStoreProcurementPreviewRows,
  computeStoreProcurementPulseMetrics,
  type StoreProcurementWorkspaceLike,
} from "../../src/lib/storeProcurementPulse";

function sampleWorkspace(overrides: Partial<StoreProcurementWorkspaceLike> = {}): StoreProcurementWorkspaceLike {
  return {
    summary: {
      pendingMrCount: 1,
      purchaseRequestCount: 2,
      grnPendingLineCount: 3,
      ...overrides.summary,
    },
    sections: {
      pendingMaterialRequirements: overrides.sections?.pendingMaterialRequirements ?? [
        {
          materialRequirementId: 10,
          docNo: "MR-26-0010",
          sourceRef: "Monthly Plan · Dec 2026",
          operationalKey: "PROCUREMENT_PENDING",
          nextActionKey: "CREATE_PR",
          totalRemainingQty: 500,
          canCreatePurchaseRequest: true,
          lines: [{ lineId: 100, rmItemId: 1, itemName: "Cap RM", unit: "KG", remainingQty: 500 }],
        },
        {
          materialRequirementId: 11,
          docNo: "MR-26-0011",
          sourceRef: "WO-26-0003",
          operationalKey: "PR_PENDING_PO",
          nextActionKey: "CREATE_PO",
          totalRemainingQty: 200,
          lines: [{ lineId: 101, rmItemId: 2, itemName: "Nozzle RM", unit: "KG", remainingQty: 200 }],
        },
        {
          materialRequirementId: 12,
          docNo: "MR-26-0012",
          sourceRef: "WO-26-0004",
          operationalKey: "GRN_PENDING",
          nextActionKey: "OPEN_GRN",
          totalRemainingQty: 80,
          primaryPoId: 55,
          lines: [{ lineId: 102, rmItemId: 3, itemName: "Spring RM", unit: "NOS", remainingQty: 80 }],
        },
        {
          materialRequirementId: 13,
          docNo: "MR-26-0013",
          sourceRef: "WO-26-0005",
          operationalKey: "RM_READY",
          nextActionKey: "TRACK_IN_RM_CONTROL",
          totalRemainingQty: 0,
          lines: [],
        },
      ],
    },
  };
}

describe("computeStoreProcurementPulseMetrics", () => {
  it("derives pulse counts from workspace summary and open MR rows", () => {
    const metrics = computeStoreProcurementPulseMetrics(sampleWorkspace());
    expect(metrics.awaitingPr).toBe(1);
    expect(metrics.awaitingPo).toBe(2);
    expect(metrics.grnPending).toBe(3);
    expect(metrics.uncoveredDemand).toBe(3);
    expect(metrics.storeActionNeeded).toBe(2);
  });

  it("returns zeros for empty workspace", () => {
    expect(
      computeStoreProcurementPulseMetrics({
        summary: { pendingMrCount: 0, purchaseRequestCount: 0, grnPendingLineCount: 0 },
        sections: { pendingMaterialRequirements: [] },
      }),
    ).toEqual({
      awaitingPr: 0,
      awaitingPo: 0,
      grnPending: 0,
      uncoveredDemand: 0,
      storeActionNeeded: 0,
    });
  });
});

describe("buildStoreProcurementPreviewRows", () => {
  it("prioritizes Store-action rows and excludes RM-ready cases", () => {
    const rows = buildStoreProcurementPreviewRows(sampleWorkspace(), 8);
    expect(rows).toHaveLength(3);
    expect(rows[0].nextActionKey).toBe("CREATE_PR");
    expect(rows[0].canCreatePurchaseRequest).toBe(true);
    expect(rows[1].nextActionKey).toBe("OPEN_GRN");
    expect(rows.map((r) => r.materialRequirementId)).not.toContain(13);
  });

  it("uses MR doc no and primary RM line in preview", () => {
    const rows = buildStoreProcurementPreviewRows(sampleWorkspace(), 1);
    expect(rows[0].mrDocNo).toBe("MR-26-0010");
    expect(rows[0].rmItemName).toBe("Cap RM");
    expect(rows[0].remainingQty).toBe(500);
  });
});
