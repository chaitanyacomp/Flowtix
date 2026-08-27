import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeProductionPlanningMetrics,
  clampRegularSoBufferPercent,
} from "../../src/lib/regularSoProductionPlanning";

const root = resolve(__dirname, "../..");
const rmCheckSource = readFileSync(resolve(root, "src/pages/RmCheckPage.tsx"), "utf8");
const compactSource = readFileSync(
  resolve(root, "src/components/erp/MachineRunPlanningCompact.tsx"),
  "utf8",
);
const classicPanelSource = readFileSync(
  resolve(root, "src/components/erp/WoPrepareProductionPlanningPanel.tsx"),
  "utf8",
);
const bufferQtySvc = readFileSync(
  resolve(root, "../backend/src/services/regularSoBufferQty.js"),
  "utf8",
);
const snapshotSvc = readFileSync(
  resolve(root, "../backend/src/services/regularSoPlanningSnapshotService.js"),
  "utf8",
);

describe("REGULAR SO production buffer single-source", () => {
  it("buffer is entered only in machine planning (compact strip + buffer-only persist)", () => {
    expect(compactSource).toContain("machine-planning-add-buffer");
    expect(compactSource).toContain("+ Add production buffer");
    expect(compactSource).toContain("machine-planning-edit-buffer");
    expect(compactSource).toContain("machine-planning-buffer-editor");
    expect(rmCheckSource).toContain("MachineRunPlanningQtyStrip");
    const persistFn = rmCheckSource.slice(
      rmCheckSource.indexOf("async function persistProductionBuffer"),
      rmCheckSource.indexOf("function syncBufferInputFromFgLines"),
    );
    expect(persistFn).toContain("bufferPercent: normalized");
    expect(persistFn).not.toContain("productionRuns:");
  });

  it("Create WO classic panel is read-only for buffer fields", () => {
    expect(classicPanelSource).toContain("readOnlyBuffer");
    expect(classicPanelSource).toContain('label="Buffer %"');
    expect(classicPanelSource).toContain('label="Buffer Qty"');
    expect(classicPanelSource).toContain('label="Planned WO Qty"');
    expect(classicPanelSource).toContain('data-buffer-readonly={readOnlyBuffer ? "true" : "false"}');
    const classicMount = rmCheckSource.slice(
      rmCheckSource.indexOf("WoPrepareOperationalHeader"),
      rmCheckSource.lastIndexOf("WoPrepareProductionRunAllocationPanel"),
    );
    expect(classicMount).toContain("<WoPrepareProductionPlanningPanel");
    expect(classicMount).toMatch(/readOnlyBuffer\s*\/>/);
  });

  it("buffer changes planned qty and RM requirement", () => {
    const base = computeProductionPlanningMetrics(15000, 0, 0);
    expect(base.plannedProductionQty).toBe(15000);
    expect(base.rmPlanningQty).toBe(15000);
    const buffered = computeProductionPlanningMetrics(15000, 0.5, 0);
    expect(clampRegularSoBufferPercent(0.5)).toBe(0.5);
    expect(buffered.productionBufferQty).toBe(75);
    expect(buffered.plannedProductionQty).toBe(15075);
    expect(buffered.rmPlanningQty).toBe(15075);
  });

  it("allocation must match buffered planned qty (backend helper + complete gate)", () => {
    expect(snapshotSvc).toContain("allocationMatchesBufferedPlannedQty");
    expect(snapshotSvc).toContain("Buffer-only update");
    expect(snapshotSvc).toMatch(/machinePlanningCompleted:\s*false/);
    expect(compactSource).toContain("machine-planning-buffer-stale-banner");
  });

  it("changing buffer after runs marks planning incomplete until reallocated", () => {
    expect(rmCheckSource).toContain("allocationStale=");
    expect(rmCheckSource).toContain("productionRuns.length > 0 && Boolean(compactAllocationError)");
    expect(snapshotSvc).toContain("existing?.productionRuns?.length");
    expect(compactSource).toContain("reallocate machine runs");
  });

  it("dispatch remains capped at customer qty (NORMAL uses customerPoQty)", () => {
    expect(bufferQtySvc).toContain("dispatchFifoQtyForSoLine");
    expect(bufferQtySvc).toContain("customerPoQty");
    expect(bufferQtySvc).toMatch(/NORMAL[\s\S]*customerPoQty/);
    expect(classicPanelSource).toContain("Dispatch remains capped at");
  });

  it("does not wire buffer single-source into NO_QTY paths", () => {
    expect(snapshotSvc).toContain(
      "Production planning snapshot is not available for NO_QTY sales orders.",
    );
  });
});
