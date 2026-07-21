import { describe, expect, it } from "vitest";
import {
  applyProductionWorkspaceSectionToSearchParams,
  resolveProductionWorkspaceSectionFromSearch,
} from "../../src/lib/productionWorkspaceSectionNav";
import { classifyProductionWorkspaceSection } from "../../src/lib/productionWorkspaceSections";
import { matchesProductionWorkspaceBucket } from "../../src/lib/productionWorkspaceBucketFilter";
import { buildProductionWorkspaceOverviewHref } from "../../src/lib/productionWorkspaceRouteContract";

describe("productionWorkspaceSectionNav", () => {
  it("Continue tab click clears stale readyToStart and activates Continue", () => {
    const fromReady = new URLSearchParams(
      "productionBucket=readyToStart&pwSection=ready&from=pending-actions",
    );
    const next = applyProductionWorkspaceSectionToSearchParams(fromReady, "active");
    expect(next.get("pwSection")).toBe("active");
    expect(next.get("productionBucket")).toBe("inProgress");
    expect(resolveProductionWorkspaceSectionFromSearch(next.get("pwSection"), next.get("productionBucket"))).toBe(
      "active",
    );
  });

  it("Resume navigation lands on canonical Continue bucket with focus", () => {
    const fromPaused = new URLSearchParams("pwSection=paused&productionBucket=readyToStart&pwFocus=3");
    const next = applyProductionWorkspaceSectionToSearchParams(fromPaused, "active", { pwFocus: 3 });
    expect(next.get("pwSection")).toBe("active");
    expect(next.get("productionBucket")).toBe("inProgress");
    expect(next.get("pwFocus")).toBe("3");
    expect(
      buildProductionWorkspaceOverviewHref({
        productionBucket: "inProgress",
        pwSection: "active",
        pwFocus: 3,
      }),
    ).toContain("productionBucket=inProgress");
  });

  it("does not leave Continue click stuck on Ready when only bucket was readyToStart", () => {
    // Legacy bug: delete pwSection but leave productionBucket=readyToStart → Ready.
    const broken = resolveProductionWorkspaceSectionFromSearch(null, "readyToStart");
    expect(broken).toBe("ready");
    const fixedParams = applyProductionWorkspaceSectionToSearchParams(
      new URLSearchParams("productionBucket=readyToStart"),
      "active",
    );
    expect(
      resolveProductionWorkspaceSectionFromSearch(
        fixedParams.get("pwSection"),
        fixedParams.get("productionBucket"),
      ),
    ).toBe("active");
  });

  it("Ready tab sets readyToStart; other tabs drop the bucket filter", () => {
    const ready = applyProductionWorkspaceSectionToSearchParams(
      new URLSearchParams("productionBucket=inProgress&pwSection=active"),
      "ready",
    );
    expect(ready.get("productionBucket")).toBe("readyToStart");
    expect(ready.get("pwSection")).toBe("ready");

    const paused = applyProductionWorkspaceSectionToSearchParams(ready, "paused");
    expect(paused.get("pwSection")).toBe("paused");
    expect(paused.get("productionBucket")).toBeNull();
  });

  it("partial produced + pending QC stays Continue, not Ready", () => {
    const row = {
      workOrderId: 260003,
      workOrderNo: "WO-26-0003",
      itemName: "FG",
      requiredQty: 2000,
      producedQty: 1000,
      balanceQty: 1000,
      orderType: "NO_QTY",
      status: "IN_PROGRESS",
      productionExecutionStatus: "RUNNING",
      productionWorkState: "CONTINUE_PRODUCTION" as const,
      nextAction: "PRODUCTION_PENDING",
      hasPendingQc: true,
      canAcceptProductionEntry: true,
    };
    expect(classifyProductionWorkspaceSection(row)).toBe("active");
    expect(matchesProductionWorkspaceBucket(row, "inProgress")).toBe(true);
    expect(matchesProductionWorkspaceBucket(row, "readyToStart")).toBe(false);
  });

  it("explicit pwSection wins over a conflicting productionBucket", () => {
    expect(resolveProductionWorkspaceSectionFromSearch("active", "readyToStart")).toBe("active");
    expect(resolveProductionWorkspaceSectionFromSearch("paused", "inProgress")).toBe("paused");
  });
});
