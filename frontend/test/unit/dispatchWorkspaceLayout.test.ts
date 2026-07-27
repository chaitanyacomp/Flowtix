import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DISPATCH_WORKSPACE_PANEL_FIRST_SPLIT_CLASS,
  DISPATCH_WORKSPACE_QUEUE_FIRST_SPLIT_CLASS,
  DISPATCH_WORKSPACE_QUEUE_MIN_WIDTH_PX,
  DISPATCH_WORKSPACE_QUEUE_PANE_CLASS,
  DISPATCH_WORKSPACE_QUEUE_ROW_SELECTED_CLASS,
  DISPATCH_WORKSPACE_QUEUE_ROW_SELECTED_EMERALD_CLASS,
} from "../../src/lib/dispatchWorkspaceUx";

const pageSource = readFileSync(new URL("../../src/pages/DispatchPage.tsx", import.meta.url), "utf8");
const compactSource = readFileSync(
  new URL("../../src/components/erp/dispatch/DispatchCompactExecutionPanel.tsx", import.meta.url),
  "utf8",
);
const workbenchSource = readFileSync(
  new URL("../../src/components/erp/OperatorWorkbench.tsx", import.meta.url),
  "utf8",
);

describe("Dispatch Workspace responsive layout contract", () => {
  it("exposes a 70% / 30% desktop split with a 360px queue minimum", () => {
    expect(DISPATCH_WORKSPACE_QUEUE_MIN_WIDTH_PX).toBe(360);
    expect(DISPATCH_WORKSPACE_PANEL_FIRST_SPLIT_CLASS).toContain("70%");
    expect(DISPATCH_WORKSPACE_PANEL_FIRST_SPLIT_CLASS).toContain("30%");
    expect(DISPATCH_WORKSPACE_PANEL_FIRST_SPLIT_CLASS).toContain("minmax(360px,30%)");
    expect(DISPATCH_WORKSPACE_QUEUE_FIRST_SPLIT_CLASS).toContain("minmax(360px,30%)");
    expect(DISPATCH_WORKSPACE_QUEUE_FIRST_SPLIT_CLASS).toContain("minmax(0,70%)");
    expect(DISPATCH_WORKSPACE_QUEUE_PANE_CLASS).toContain("min-w-[360px]");
  });

  it("stacks below xl instead of compressing the queue on mid-size screens", () => {
    expect(DISPATCH_WORKSPACE_PANEL_FIRST_SPLIT_CLASS).toMatch(/^xl:grid-cols-/);
    expect(DISPATCH_WORKSPACE_PANEL_FIRST_SPLIT_CLASS).not.toMatch(/\blg:grid-cols-/);
    expect(DISPATCH_WORKSPACE_QUEUE_FIRST_SPLIT_CLASS).toMatch(/^xl:grid-cols-/);
    expect(workbenchSource).toContain("grid grid-cols-1");
    expect(pageSource).toContain("DISPATCH_WORKSPACE_PANEL_FIRST_SPLIT_CLASS");
    expect(pageSource).toContain("panelFirstOnLg");
    expect(pageSource).toContain('panelContainerClassName=');
    expect(pageSource).toContain('"order-1 min-w-0"');
  });

  it("wires the full Dispatch Workspace to the panel-first 70/30 split", () => {
    expect(pageSource).toContain("DISPATCH_WORKSPACE_PANEL_FIRST_SPLIT_CLASS");
    expect(pageSource).toContain("DISPATCH_WORKSPACE_QUEUE_PANE_CLASS");
    expect(pageSource).not.toContain("minmax(180px,220px)");
    expect(pageSource).not.toContain("minmax(220px,280px)");
    expect(pageSource).toContain('data-testid="dispatch-workspace-queue-pane"');
    expect(pageSource).toContain('data-testid="dispatch-workspace-queue-table"');
  });

  it("keeps queue table free of horizontal scroll and truncates long names with tooltips", () => {
    expect(pageSource).toContain("overflow-x-hidden overflow-y-auto");
    expect(pageSource).toContain("table-fixed");
    expect(pageSource).toContain("truncate");
    expect(pageSource).toContain("title={g.itemName}");
    expect(pageSource).toContain("title={customerDisplayName(so)}");
    expect(pageSource).toContain("title={ls.itemName}");
    expect(pageSource).not.toMatch(/dispatch-workspace-queue[\s\S]{0,400}overflow-x-auto/);
  });

  it("keeps SO, Item, Qty and Select visible with a clickable row plus Select button", () => {
    expect(pageSource).toContain(">SO</th>");
    expect(pageSource).toContain(">Item</th>");
    expect(pageSource).toContain(">Qty</th>");
    expect(pageSource).toContain("Select");
    expect(pageSource).toContain("cursor-pointer");
    expect(pageSource).toContain("e.stopPropagation()");
    expect(pageSource).toContain("activateRow");
    expect(pageSource).toContain("DISPATCH_WORKSPACE_QUEUE_ROW_SELECTED_CLASS");
    expect(pageSource).toContain("DISPATCH_WORKSPACE_QUEUE_ROW_SELECTED_EMERALD_CLASS");
    expect(DISPATCH_WORKSPACE_QUEUE_ROW_SELECTED_CLASS).toContain("ring-2");
    expect(DISPATCH_WORKSPACE_QUEUE_ROW_SELECTED_EMERALD_CLASS).toContain("ring-2");
  });

  it("applies the same desktop split contract to compact Dispatch Workspace", () => {
    expect(compactSource).toContain("DISPATCH_WORKSPACE_QUEUE_FIRST_SPLIT_CLASS");
    expect(compactSource).toContain("DISPATCH_WORKSPACE_QUEUE_PANE_CLASS");
    expect(compactSource).toContain("!order-2 xl:!order-1");
    expect(compactSource).toContain("!order-1");
    expect(compactSource).toContain("xl:!order-2");
    expect(compactSource).toContain("DISPATCH_WORKSPACE_QUEUE_ROW_SELECTED_EMERALD_CLASS");
    expect(compactSource).toContain("overflow-x-hidden overflow-y-auto");
    expect(compactSource).not.toContain("0.85fr");
  });
});
