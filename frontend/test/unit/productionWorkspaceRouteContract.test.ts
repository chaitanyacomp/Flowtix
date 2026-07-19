import { describe, expect, it } from "vitest";
import { isProductionWorkspaceEntry } from "../../src/lib/operationalPageEntry";
import { shouldHideNoQtyAddProductionEntry } from "../../src/lib/productionScopedWorkspaceState";
import {
  buildPendingActionsProductionOverviewHref,
  buildProductionWorkspaceOverviewHref,
  isProductionWorkspaceOverviewSearch,
  toProductionWorkspaceOverviewFromHref,
} from "../../src/lib/productionWorkspaceRouteContract";

describe("productionWorkspaceRouteContract", () => {
  it("left menu opens unscoped overview", () => {
    expect(buildProductionWorkspaceOverviewHref()).toBe("/production");
    expect(isProductionWorkspaceOverviewSearch("")).toBe(true);
    expect(
      isProductionWorkspaceEntry({
        fromNoQtySo: false,
        focusSoIdValid: false,
        woIdFromUrlValid: false,
        workOrderLineIdFromUrlValid: false,
        fromDashboardWithTarget: false,
      }),
    ).toBe(true);
  });

  it("Pending Actions multi-WO bucket opens filtered overview without stale SO/cycle/WO", () => {
    const href = buildPendingActionsProductionOverviewHref("readyToStart");
    expect(href).toBe(
      "/production?productionBucket=readyToStart&pwSection=ready&from=pending-actions&returnTo=pending-actions",
    );
    expect(isProductionWorkspaceOverviewSearch(href.replace("/production?", ""))).toBe(true);
    expect(
      isProductionWorkspaceEntry({
        fromNoQtySo: false,
        focusSoIdValid: false,
        woIdFromUrlValid: false,
        workOrderLineIdFromUrlValid: false,
        fromDashboardWithTarget: false,
      }),
    ).toBe(true);
  });

  it("strips completed sibling SO/cycle pins from legacy PA list hrefs", () => {
    const legacy =
      "/production?from=pending-actions&workOrderId=2&flow=NO_QTY&salesOrderId=245&cycleId=12&source=no_qty_so&productionBucket=readyToStart";
    const overview = toProductionWorkspaceOverviewFromHref(legacy);
    expect(overview).not.toContain("workOrderId=");
    expect(overview).not.toContain("salesOrderId=");
    expect(overview).not.toContain("cycleId=");
    expect(overview).toContain("productionBucket=readyToStart");
    expect(overview).toContain("returnTo=pending-actions");
  });

  it("direct individual WO link remains scoped (not overview)", () => {
    const search = "from=pending-actions&workOrderId=4&flow=NO_QTY&salesOrderId=245";
    expect(isProductionWorkspaceOverviewSearch(search)).toBe(false);
    expect(
      isProductionWorkspaceEntry({
        fromNoQtySo: true,
        focusSoIdValid: true,
        woIdFromUrlValid: true,
        workOrderLineIdFromUrlValid: false,
        fromDashboardWithTarget: true,
      }),
    ).toBe(false);
  });

  it("completed banner stays off when sibling actionable WOs remain in scope", () => {
    expect(
      shouldHideNoQtyAddProductionEntry({
        navigateNoQtyContext: true,
        showNoQtyScopedProductionCard: true,
        effectiveScopedWoId: 2,
        noQtyBlockProductionEntry: false,
        noQtyNextRsReady: false,
        noQtyAllowShopFloorContinue: false,
        approvedForSo: true,
        noQtyAutoPickLinesCount: 2,
        currentWoHasProducibleLine: false,
        currentWoHasApprovedProduction: true,
        currentWoIsClosed: false,
        siblingActionableProductionCount: 2,
      }),
    ).toBe(false);
  });

  it("completed WO with no siblings can show completed entry gate", () => {
    expect(
      shouldHideNoQtyAddProductionEntry({
        navigateNoQtyContext: true,
        showNoQtyScopedProductionCard: true,
        effectiveScopedWoId: 2,
        noQtyBlockProductionEntry: false,
        noQtyNextRsReady: false,
        noQtyAllowShopFloorContinue: false,
        approvedForSo: true,
        noQtyAutoPickLinesCount: 0,
        currentWoHasProducibleLine: false,
        currentWoHasApprovedProduction: true,
        currentWoIsClosed: false,
        siblingActionableProductionCount: 0,
      }),
    ).toBe(true);
  });
});
