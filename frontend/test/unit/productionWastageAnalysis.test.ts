import { describe, expect, it } from "vitest";

import {
  WASTAGE_TYPE_CATEGORIES,
  type WastageTypeRow,
} from "../../src/lib/wastageTypeApi";
import type { TypeSummaryRow, WoDetailRow } from "../../src/lib/productionWastageAnalysisApi";

describe("wastageTypeApi types (Phase 2)", () => {
  it("exposes all required categories", () => {
    expect(WASTAGE_TYPE_CATEGORIES).toEqual([
      "PROCESS",
      "SETUP",
      "QUALITY",
      "MACHINE",
      "MATERIAL",
      "TRIAL",
      "BREAKDOWN",
      "MISC",
    ]);
  });

  it("row shape includes code, category, description", () => {
    const row: WastageTypeRow = {
      id: 1,
      code: "PURGE",
      name: "Purging",
      category: "PROCESS",
      description: "Startup purge",
      sortOrder: 10,
      isActive: true,
    };
    expect(row.code).toBe("PURGE");
    expect(row.category).toBe("PROCESS");
  });
});

describe("production wastage analysis API shapes (Phases 3–4)", () => {
  it("WO detail row does not require machine/shift/operator", () => {
    const row: WoDetailRow = {
      reportId: 1,
      reportDate: "2026-07-01",
      workOrderId: 10,
      workOrderNo: "WO-1",
      salesOrderId: 5,
      salesOrderNo: "SO-1",
      customerId: 2,
      customerName: "Acme",
      fgItemId: 90,
      fgItemName: "FG",
      fgUnit: "Nos",
      rmItemId: 20,
      rmItemName: "HDPE",
      rmUnit: "Kg",
      plannedConsumption: 9,
      issuedQty: 10,
      returnedQty: 1,
      actualConsumedQty: 8,
      fgProducedQty: 100,
      wastageQty: 1,
      wastagePct: 10,
      yieldPct: 80,
      excessConsumption: -1,
      wastageTypeLabel: "Purging",
      categoryLabel: "PROCESS",
      remarks: null,
      productionReportRef: "PWR-1",
      status: "CONFIRMED",
      drillDown: {
        workOrderId: 10,
        productionReportId: 1,
        hrefWorkOrder: "/work-orders?focus=10",
        hrefProductionReport: "/production?workOrderId=10&tab=report",
      },
    };
    expect(row).not.toHaveProperty("machine");
    expect(row).not.toHaveProperty("shift");
    expect(row).not.toHaveProperty("operator");
    expect(row.returnedQty).toBe(1);
    expect(row.wastageQty).toBe(1);
  });

  it("type summary row supports drill-down to WO report", () => {
    const row: TypeSummaryRow = {
      wastageTypeId: 1,
      wastageTypeCode: "PURGE",
      wastageTypeName: "Purging",
      category: "PROCESS",
      isActiveType: false,
      totalWastageQty: 3,
      shareOfTotalWastagePct: 50,
      workOrderCount: 2,
      productionReportCount: 2,
      averageWastagePerWo: 1.5,
      averageWastagePct: 12,
      highestWastageWoId: 10,
      highestWastageWoNo: "WO-1",
      highestWastageQty: 2,
      lowestNonZeroWastageWoId: 11,
      lowestNonZeroWastageWoNo: "WO-2",
      lowestNonZeroWastageQty: 1,
      drillDown: { wastageTypeId: 1, hrefWoReport: "/reports/production-wastage-wo?wastageTypeId=1" },
    };
    expect(row.drillDown.hrefWoReport).toContain("wastageTypeId=1");
    expect(row.isActiveType).toBe(false);
  });
});
