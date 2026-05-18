import { describe, expect, it } from "vitest";

import {

  CONTINUE_WORKING_STAGE_PRIORITY,

  dedupeContinueWorkingBySalesOrder,

  enrichActionRequiredWithNoQtyPlanning,

  enforceUniqueSalesOrdersAcrossGroups,

  partitionContinueWorkingForActions,

  shouldHideOpenNoQtyForActionRequired,

  shouldShowNoQtyDashboardContinueProduction,

  type ContinueWorkingRow,

} from "../../src/lib/dashboardActionQueue";



function row(partial: Partial<ContinueWorkingRow> & Pick<ContinueWorkingRow, "salesOrderId" | "stageKey">): ContinueWorkingRow {

  return {

    key: `k-${partial.salesOrderId}-${partial.stageKey}`,

    customerName: "C",

    itemName: "I",

    nextStep: "Go",

    href: "/x",

    metricQty: 10,

    ...partial,

  };

}



describe("dashboardActionQueue", () => {

  it("ranks production above sales bill when deduping per SO", () => {

    const rows = dedupeContinueWorkingBySalesOrder([

      row({ salesOrderId: 1, stageKey: "SALES_BILL", metricQty: 5 }),

      row({ salesOrderId: 1, stageKey: "PRODUCTION", productionRemaining: 8 }),

    ]);

    const other = rows.filter((r) => r.stageKey !== "DISPATCH");

    expect(other).toHaveLength(1);

    expect(other[0]?.stageKey).toBe("PRODUCTION");

  });



  it("keeps NO_QTY planning alongside production for the same SO", () => {

    const rows = dedupeContinueWorkingBySalesOrder([

      row({ salesOrderId: 7, orderType: "NO_QTY", stageKey: "NEXT_RS", lastShortageQty: 3000 }),

      row({ salesOrderId: 7, orderType: "NO_QTY", stageKey: "PRODUCTION", productionRemaining: 3000 }),

    ]);

    const stages = rows.map((r) => r.stageKey).sort();

    expect(stages).toEqual(["NEXT_RS", "PRODUCTION"]);

  });



  it("keeps canonical stage priority order", () => {

    expect(CONTINUE_WORKING_STAGE_PRIORITY.QC).toBeLessThan(CONTINUE_WORKING_STAGE_PRIORITY.DISPATCH);

    expect(CONTINUE_WORKING_STAGE_PRIORITY.NO_QTY_PLANNING).toBeLessThan(

      CONTINUE_WORKING_STAGE_PRIORITY.PRODUCTION,

    );

    expect(CONTINUE_WORKING_STAGE_PRIORITY.PRODUCTION).toBeLessThan(CONTINUE_WORKING_STAGE_PRIORITY.SALES_BILL);

  });



  it("enforces one SO across groups but keeps NO_QTY planning with production", () => {

    const groups = enforceUniqueSalesOrdersAcrossGroups({

      qc: [{ key: "1", salesOrderId: 9, customerName: "", itemName: "", metricQty: 1, href: "", group: "QC" }],

      dispatch: [{ key: "2", salesOrderId: 9, customerName: "", itemName: "", metricQty: 1, href: "", group: "DISPATCH" }],

      production: [{ key: "3", salesOrderId: 9, customerName: "", itemName: "", metricQty: 1, href: "", group: "PRODUCTION" }],

      salesBill: [],

      nextRs: [],

      noQtyPlanning: [

        {

          key: "4",

          salesOrderId: 9,

          customerName: "",

          itemName: "",

          metricQty: 3000,

          href: "",

          group: "NO_QTY_PLANNING",

        },

      ],

    });

    expect(groups.qc).toHaveLength(1);

    expect(groups.dispatch).toHaveLength(0);

    expect(groups.production).toHaveLength(0);

    expect(groups.noQtyPlanning).toHaveLength(1);

  });



  it("partitions NO_QTY NEXT_RS into noQtyPlanning for SALES", () => {

    const g = partitionContinueWorkingForActions(

      [row({ salesOrderId: 3, orderType: "NO_QTY", stageKey: "NEXT_RS", lastShortageQty: 3000 })],

      { role: "SALES" },

    );

    expect(g.noQtyPlanning).toHaveLength(1);

    expect(g.production).toHaveLength(0);

    expect(g.noQtyPlanning[0]?.buttonLabel).toBe("Create Next RS");

  });



  it("partitions sales bill separately from production", () => {

    const g = partitionContinueWorkingForActions(

      [row({ salesOrderId: 2, stageKey: "SALES_BILL", metricQty: 3 })],

      { role: "ADMIN" },

    );

    expect(g.salesBill).toHaveLength(1);

    expect(g.production).toHaveLength(0);

  });



  it("enriches planning from createNextRsEligible when queue has production only", () => {

    const base = enforceUniqueSalesOrdersAcrossGroups({

      qc: [],

      dispatch: [],

      production: [

        {

          key: "p1",

          salesOrderId: 42,

          customerName: "Cust",

          itemName: "FG",

          metricQty: 3000,

          href: "/production",

          group: "PRODUCTION",

          orderType: "NO_QTY",

        },

      ],

      salesBill: [],

      nextRs: [],

      noQtyPlanning: [],

    });

    const enriched = enrichActionRequiredWithNoQtyPlanning(

      base,

      [

        {

          salesOrderId: 42,

          customerName: "Cust",

          createNextRsEligible: true,

          lastShortageQty: 3000,

        },

      ],

      { role: "SALES" },

    );

    expect(enriched.noQtyPlanning).toHaveLength(1);

    expect(enriched.production).toHaveLength(1);

  });



  it("hides launcher when action required has higher priority", () => {

    const primary = new Map([[5, "QC"]]);

    expect(shouldHideOpenNoQtyForActionRequired(5, "Open Production", primary)).toBe(true);

    expect(shouldHideOpenNoQtyForActionRequired(5, "Next RS", primary)).toBe(true);

  });



  it("does not hide launcher when planning already shown", () => {

    const primary = new Map([[5, "NO_QTY_PLANNING"]]);

    expect(shouldHideOpenNoQtyForActionRequired(5, "Next RS", primary)).toBe(false);

  });

  it("shows Continue Production only before next RS exists", () => {
    expect(
      shouldShowNoQtyDashboardContinueProduction({ createNextRsEligible: true }, { noQtyPlanningPointerAhead: false }),
    ).toBe(true);
    expect(
      shouldShowNoQtyDashboardContinueProduction({ createNextRsEligible: false }, { noQtyPlanningPointerAhead: false }),
    ).toBe(false);
    expect(
      shouldShowNoQtyDashboardContinueProduction(
        { createNextRsEligible: true, nextRollingRequirementSheetId: 99 },
        { noQtyPlanningPointerAhead: false },
      ),
    ).toBe(false);
    expect(
      shouldShowNoQtyDashboardContinueProduction({ createNextRsEligible: true }, { noQtyPlanningPointerAhead: true }),
    ).toBe(false);
  });

});

