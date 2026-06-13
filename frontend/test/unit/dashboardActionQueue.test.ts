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



  it("partitions NO_QTY NEXT_RS into noQtyPlanning for ADMIN", () => {

    const g = partitionContinueWorkingForActions(

      [row({ salesOrderId: 3, orderType: "NO_QTY", stageKey: "NEXT_RS", lastShortageQty: 3000 })],

      { role: "ADMIN" },

    );

    expect(g.noQtyPlanning).toHaveLength(1);

    expect(g.production).toHaveLength(0);

    expect(g.noQtyPlanning[0]?.buttonLabel).toBe("Open NO_QTY SO");

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

      { role: "ADMIN" },

    );

    expect(enriched.noQtyPlanning).toHaveLength(1);

    expect(enriched.production).toHaveLength(1);

  });



  it("hides Open Production launcher when QC owns the primary action", () => {

    const primary = new Map([[5, "QC"]]);

    expect(shouldHideOpenNoQtyForActionRequired(5, "Open Production", primary)).toBe(true);

  });



  it("never hides NO_QTY Create Next RS launcher — planning is parallel to shop-floor", () => {

    // Planning (Create Next RS) is parallel to QC / Dispatch / Production:

    // Sales / Admin must always be able to start the next requirement sheet for the next cycle.

    for (const shopFloorStage of ["QC", "DISPATCH", "PRODUCTION", "SALES_BILL"]) {

      const primary = new Map([[5, shopFloorStage]]);

      expect(shouldHideOpenNoQtyForActionRequired(5, "Next RS", primary)).toBe(false);

    }

  });



  it("does not hide launcher when planning already shown", () => {

    const primary = new Map([[5, "NO_QTY_PLANNING"]]);

    expect(shouldHideOpenNoQtyForActionRequired(5, "Next RS", primary)).toBe(false);

  });



  it("Create Next RS card is added in parallel to QC when QC is pending (ADMIN)", () => {

    // Simulate continueWorking where the SO is currently on QC stage.

    const base = enforceUniqueSalesOrdersAcrossGroups(

      partitionContinueWorkingForActions(

        [

          row({

            salesOrderId: 77,

            stageKey: "QC",

            orderType: "NO_QTY",

            awaitingQcQty: 5000,

          }),

        ],

        { role: "ADMIN" },

      ),

    );



    // Flow state reports Create Next RS is eligible for this SO (locked RS + no later locked).

    const enriched = enrichActionRequiredWithNoQtyPlanning(

      base,

      [

        {

          salesOrderId: 77,

          customerName: "Cust",

          createNextRsEligible: true,

          lastShortageQty: 0,

        },

      ],

      { role: "ADMIN" },

    );



    expect(enriched.qc).toHaveLength(1);

    expect(enriched.noQtyPlanning).toHaveLength(1);

    expect(enriched.noQtyPlanning[0]?.buttonLabel).toBe("Open NO_QTY SO");



    // PURCHASE does not own QC or planning — no rows in either lane.

    const purchaseBase = enforceUniqueSalesOrdersAcrossGroups(

      partitionContinueWorkingForActions(

        [

          row({

            salesOrderId: 77,

            stageKey: "QC",

            orderType: "NO_QTY",

            awaitingQcQty: 5000,

          }),

        ],

        { role: "PURCHASE" },

      ),

    );

    const purchaseEnriched = enrichActionRequiredWithNoQtyPlanning(

      purchaseBase,

      [

        {

          salesOrderId: 77,

          customerName: "Cust",

          createNextRsEligible: true,

        },

      ],

      { role: "PURCHASE" },

    );

    expect(purchaseEnriched.noQtyPlanning).toHaveLength(0);

    expect(purchaseEnriched.qc).toHaveLength(0);

  });



  it("Production / QA / Store / Purchase never see NO_QTY Create Next RS planning rows", () => {

    const base = enforceUniqueSalesOrdersAcrossGroups({

      qc: [],

      dispatch: [],

      production: [],

      salesBill: [],

      nextRs: [],

      noQtyPlanning: [],

    });



    for (const role of ["PRODUCTION", "QA", "STORE", "PURCHASE"]) {

      const enriched = enrichActionRequiredWithNoQtyPlanning(

        base,

        [

          {

            salesOrderId: 88,

            customerName: "Cust",

            createNextRsEligible: true,

          },

        ],

        { role },

      );

      expect(enriched.noQtyPlanning).toHaveLength(0);

    }

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

