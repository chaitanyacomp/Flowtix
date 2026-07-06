import { describe, expect, it } from "vitest";

import type { ProductionExecutionSummary } from "../../src/lib/productionExecutionApi";

import {

  initialProductionReportPanelStatus,

  isCloseWorkOrderEnabled,

  isProductionQtyShort,

  PRODUCTION_REPORT_CLOSE_GATE_HELPER,

  productionClosureStatusLabel,

  resolveCloseWorkOrderIntent,

  shouldRenderProductionClosureControls,

  shouldShowPauseWorkOrderAction,

  shouldShowProductionWorkspaceCompactLayout,

  shouldShowWaiveRemainingAction,

  shouldEmbedNoQtyRecentEntriesInLoggingWorkbench,

  shouldShowNoQtyOperatorWorkstationChrome,

  shouldUseNoQtyPremiumViewportWorkspace,

  shouldUseProductionPageNaturalScroll,

} from "../../src/lib/productionWorkspaceCompactUx";

import { resolveProductionCompletionScenario } from "../../src/lib/productionCompletionUx";



function summary(partial: Partial<ProductionExecutionSummary>): ProductionExecutionSummary {

  return {

    workOrderId: 1,

    workOrderStatus: "IN_PROGRESS",

    executionStatus: "RUNNING",

    plannedQty: 1500,

    producedQty: 0,

    remainderQty: 1500,

    productionPendingQty: 1500,

    hasShortfall: true,

    blockReasons: [],

    resolutionReasons: [],

    lines: [],

    ...partial,

  };

}



describe("productionWorkspaceCompactUx", () => {

  it("shows compact layout for NO_QTY closure workspace", () => {

    expect(

      shouldShowProductionWorkspaceCompactLayout({

        showProductionReport: true,

        workOrderId: 10,

        canOperate: true,

        navigateNoQtyContext: true,

        hideNoQtyAddProductionEntry: true,

        woIdFromUrlValid: false,

        workOrderLineIdFromUrlValid: false,

      }),

    ).toBe(true);

    expect(

      shouldShowProductionWorkspaceCompactLayout({

        showProductionReport: true,

        workOrderId: 10,

        canOperate: true,

        navigateNoQtyContext: false,

        hideNoQtyAddProductionEntry: true,

        woIdFromUrlValid: true,

        workOrderLineIdFromUrlValid: false,

      }),

    ).toBe(false);

  });



  it("defers closure controls until execution and report status resolve", () => {

    const report = initialProductionReportPanelStatus();

    expect(

      shouldRenderProductionClosureControls({

        executionLoading: true,

        executionResolved: false,

        reportStatus: report,

      }),

    ).toBe(false);

    expect(

      shouldRenderProductionClosureControls({

        executionLoading: false,

        executionResolved: true,

        reportStatus: { ...report, resolved: true, confirmed: false },

      }),

    ).toBe(true);

  });



  it("gates Close Work Order on production report confirmation", () => {

    const complete = summary({ producedQty: 1500, remainderQty: 0 });

    expect(

      isCloseWorkOrderEnabled({

        productionReportConfirmed: false,

        executionSummary: complete,

        busy: false,

      }),

    ).toBe(false);

    expect(

      isCloseWorkOrderEnabled({

        productionReportConfirmed: true,

        executionSummary: complete,

        busy: false,

      }),

    ).toBe(true);

    expect(PRODUCTION_REPORT_CLOSE_GATE_HELPER).toContain("Confirm Production Report");

  });



  it("maps close intent for complete vs shortfall scenarios", () => {

    const complete = summary({ producedQty: 1500, remainderQty: 0 });

    const shortfall = summary({ producedQty: 1350, remainderQty: 150 });

    expect(resolveCloseWorkOrderIntent(complete)).toBe("finish");

    expect(resolveCloseWorkOrderIntent(shortfall)).toBe("carry_forward");

  });



  it("does not expose a separate waive action", () => {

    expect(shouldShowWaiveRemainingAction("SHORTFALL")).toBe(false);

    expect(shouldShowWaiveRemainingAction("COMPLETE")).toBe(false);

  });



  it("shows Pause only when produced qty is below planned", () => {

    expect(isProductionQtyShort(1350, 1500)).toBe(true);

    expect(isProductionQtyShort(1500, 1500)).toBe(false);

    expect(isProductionQtyShort(1501, 1500)).toBe(false);

    expect(

      shouldShowPauseWorkOrderAction({

        producedQty: 1350,

        plannedQty: 1500,

        showPausedShortfall: false,

      }),

    ).toBe(true);

    expect(

      shouldShowPauseWorkOrderAction({

        producedQty: 1500,

        plannedQty: 1500,

        showPausedShortfall: false,

      }),

    ).toBe(false);

    expect(

      shouldShowPauseWorkOrderAction({

        producedQty: 1350,

        plannedQty: 1500,

        showPausedShortfall: true,

      }),

    ).toBe(false);

  });



  it("uses natural page scroll outside premium viewport workbenches", () => {
    expect(
      shouldUseProductionPageNaturalScroll({
        noQtyPremiumViewport: false,
        greenLevelPremiumViewport: false,
      }),
    ).toBe(true);
    expect(
      shouldUseProductionPageNaturalScroll({
        noQtyPremiumViewport: true,
        greenLevelPremiumViewport: false,
      }),
    ).toBe(false);
    expect(
      shouldUseProductionPageNaturalScroll({
        noQtyPremiumViewport: false,
        greenLevelPremiumViewport: true,
      }),
    ).toBe(false);
  });

  it("embeds recent entries in logging workbench only", () => {
    expect(
      shouldUseNoQtyPremiumViewportWorkspace({
        navigateNoQtyContext: true,
        showNoQtyScopedProductionCard: true,
      }),
    ).toBe(true);
    expect(
      shouldEmbedNoQtyRecentEntriesInLoggingWorkbench({
        usePremiumViewport: true,
        showProductionWorkspaceCompactLayout: false,
      }),
    ).toBe(true);
    expect(
      shouldEmbedNoQtyRecentEntriesInLoggingWorkbench({
        usePremiumViewport: true,
        showProductionWorkspaceCompactLayout: true,
      }),
    ).toBe(false);
  });

  it("uses minimal operator workstation chrome for logging and compact close", () => {
    expect(
      shouldShowNoQtyOperatorWorkstationChrome({
        embedNoQtyRecentEntries: true,
        showProductionWorkspaceCompactLayout: false,
      }),
    ).toBe(true);
    expect(
      shouldShowNoQtyOperatorWorkstationChrome({
        embedNoQtyRecentEntries: false,
        showProductionWorkspaceCompactLayout: true,
      }),
    ).toBe(true);
    expect(
      shouldShowNoQtyOperatorWorkstationChrome({
        embedNoQtyRecentEntries: false,
        showProductionWorkspaceCompactLayout: false,
      }),
    ).toBe(false);
  });

  it("labels closure status from execution summary", () => {

    const s = summary({ producedQty: 1500, remainderQty: 0 });

    const scenario = resolveProductionCompletionScenario(s);

    expect(productionClosureStatusLabel(s, scenario)).toBe("Complete");

    const short = summary({ producedQty: 1350, remainderQty: 150 });

    expect(productionClosureStatusLabel(short, "SHORTFALL")).toBe("Below WO qty");

  });

});


