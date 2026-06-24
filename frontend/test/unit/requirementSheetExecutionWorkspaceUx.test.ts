import { describe, expect, it } from "vitest";

import {

  EXECUTION_WO_HISTORY_MAX_ROWS,

  executionWoHistoryVisibleCount,

  formatPriorCycleExecutionBanner,

  isExecutionModeRequested,

  placementInlineReadinessMessage,

  rmCoverageLabelFromPlacement,

  shouldRenderNoQtyExecutionWorkspace,

  shouldUseNoQtyExecutionModeShell,

} from "../../src/lib/requirementSheetExecutionWorkspaceUx";



function params(qs: string): URLSearchParams {

  return new URLSearchParams(qs);

}



describe("isExecutionModeRequested", () => {

  it("is true when focus=execution and sheetId are present", () => {

    expect(isExecutionModeRequested(params("focus=execution&sheetId=261"))).toBe(true);

  });



  it("is false without sheetId", () => {

    expect(isExecutionModeRequested(params("focus=execution"))).toBe(false);

  });



  it("is false without focus=execution", () => {

    expect(isExecutionModeRequested(params("sheetId=261"))).toBe(false);

  });

});



describe("shouldUseNoQtyExecutionModeShell", () => {

  it("uses execution shell for NO_QTY deep links", () => {

    expect(

      shouldUseNoQtyExecutionModeShell({

        executionModeRequested: true,

        isNoQty: true,

        soLoaded: true,

      }),

    ).toBe(true);

  });



  it("keeps regular SO on planning layout even with execution query params", () => {

    expect(

      shouldUseNoQtyExecutionModeShell({

        executionModeRequested: true,

        isNoQty: false,

        soLoaded: true,

      }),

    ).toBe(false);

  });



  it("uses execution shell while NO_QTY header is still loading", () => {

    expect(

      shouldUseNoQtyExecutionModeShell({

        executionModeRequested: true,

        isNoQty: false,

        soLoaded: false,

      }),

    ).toBe(true);

  });

});



const lockedNoQty = {

  hasSheet: true,

  isNoQty: true,

  isLocked: true,

  showNoQtyEmptyCycleCreateWorkspace: false,

  canOpenRs: true,

};



describe("shouldRenderNoQtyExecutionWorkspace", () => {

  it("renders for locked NO_QTY RS when create panel is closed", () => {

    expect(shouldRenderNoQtyExecutionWorkspace(lockedNoQty)).toBe(true);

  });



  it("renders for locked NO_QTY RS on a prior cycle (execution independent of active cycle)", () => {

    expect(shouldRenderNoQtyExecutionWorkspace(lockedNoQty)).toBe(true);

  });



  it("does not render for draft NO_QTY RS", () => {

    expect(

      shouldRenderNoQtyExecutionWorkspace({

        ...lockedNoQty,

        isLocked: false,

      }),

    ).toBe(false);

  });



  it("does not render for Regular SO locked RS", () => {

    expect(

      shouldRenderNoQtyExecutionWorkspace({

        ...lockedNoQty,

        isNoQty: false,

      }),

    ).toBe(false);

  });



  it("does not render during empty-cycle create workspace", () => {

    expect(

      shouldRenderNoQtyExecutionWorkspace({

        ...lockedNoQty,

        showNoQtyEmptyCycleCreateWorkspace: true,

      }),

    ).toBe(false);

  });



  it("does not render when user cannot open RS workspace", () => {

    expect(

      shouldRenderNoQtyExecutionWorkspace({

        ...lockedNoQty,

        canOpenRs: false,

      }),

    ).toBe(false);

  });



  it("does not render when no sheet is loaded", () => {

    expect(

      shouldRenderNoQtyExecutionWorkspace({

        ...lockedNoQty,

        hasSheet: false,

      }),

    ).toBe(false);

  });

});



describe("formatPriorCycleExecutionBanner", () => {

  it("formats title and open balance detail", () => {

    expect(formatPriorCycleExecutionBanner({ viewingCycleNo: 1, rsBalanceQty: 10000 })).toEqual({

      title: "Cycle 1 (Previous Cycle) — Execution In Progress",

      detail: "Open execution balance: 10000. A newer planning cycle does not stop WO placement here.",

    });

  });



  it("returns null without a cycle number", () => {

    expect(formatPriorCycleExecutionBanner({ viewingCycleNo: null, rsBalanceQty: 100 })).toBeNull();

  });

});



describe("execution workspace presentation helpers", () => {

  it("maps placement status to RM coverage labels", () => {

    expect(rmCoverageLabelFromPlacement({ placementStatus: "READY", rsBalanceQty: 1000 })).toBe("Ready");

    expect(rmCoverageLabelFromPlacement({ placementStatus: "PARTIALLY_READY", rsBalanceQty: 1000 })).toBe("Partial");

    expect(rmCoverageLabelFromPlacement({ placementStatus: "AWAITING_PROCUREMENT", rsBalanceQty: 1000 })).toBe(

      "Awaiting RM",

    );

    expect(rmCoverageLabelFromPlacement({ placementStatus: "MISSING_BOM", rsBalanceQty: 1000 })).toBe("Blocked");

    expect(rmCoverageLabelFromPlacement({ placementStatus: "READY", rsBalanceQty: 0 })).toBe("Complete");

  });



  it("formats inline placement readiness messages", () => {

    expect(

      placementInlineReadinessMessage({

        placementStatus: "READY",

        rsBalanceQty: 5000,

        totalExecutableQty: 5000,

      }),

    ).toBe("Ready — full balance can be placed.");

    expect(

      placementInlineReadinessMessage({

        placementStatus: "PARTIALLY_READY",

        rsBalanceQty: 7000,

        totalExecutableQty: 1000,

      }),

    ).toContain("Partial RM — 1000 executable");

    expect(

      placementInlineReadinessMessage({ placementStatus: "MISSING_BOM", rsBalanceQty: 100 }),

    ).toBe("Blocked — approved BOM required.");

  });



  it("caps WO history visible rows at five unless expanded", () => {

    expect(EXECUTION_WO_HISTORY_MAX_ROWS).toBe(5);

    expect(executionWoHistoryVisibleCount(12, false)).toBe(5);

    expect(executionWoHistoryVisibleCount(12, true)).toBe(12);

    expect(executionWoHistoryVisibleCount(3, false)).toBe(3);

  });

});


