import { describe, expect, it } from "vitest";

import {

  formatPriorCycleExecutionBanner,

  shouldRenderNoQtyExecutionWorkspace,

} from "../../src/lib/requirementSheetExecutionWorkspaceUx";



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


