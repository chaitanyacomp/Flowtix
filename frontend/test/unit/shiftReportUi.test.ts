/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../src/services/api";
import type { ShiftSessionDetail } from "../../src/lib/machineShiftSessionApi";
import {
  deriveShiftLifecycleStage,
  formatShiftQty,
  handoverStateLabel,
  mapShiftApiError,
  mergeShiftReportEditableLines,
  shiftLifecycleNextAction,
  shiftLifecycleStageLabel,
} from "../../src/lib/machineShiftSessionUi";

const reportPanelSrc = readFileSync(
  resolve(__dirname, "../../src/components/erp/shiftProduction/ShiftReportPanel.tsx"),
  "utf8",
);
const overModalSrc = readFileSync(
  resolve(__dirname, "../../src/components/erp/shiftProduction/ShiftOverModal.tsx"),
  "utf8",
);
const reopenSrc = readFileSync(
  resolve(__dirname, "../../src/components/erp/shiftProduction/ShiftReopenPanel.tsx"),
  "utf8",
);
const workspaceSrc = readFileSync(
  resolve(__dirname, "../../src/pages/ShiftSessionWorkspacePage.tsx"),
  "utf8",
);
const productionPageSrc = readFileSync(resolve(__dirname, "../../src/pages/ProductionPage.tsx"), "utf8");
const woReportPanelSrc = readFileSync(
  resolve(__dirname, "../../src/components/erp/production/ProductionReportPanel.tsx"),
  "utf8",
);

function baseSession(over: Partial<ShiftSessionDetail> = {}): ShiftSessionDetail {
  return {
    id: 1,
    shiftSessionNo: "SS-26-0001",
    status: "OPEN",
    sessionDate: "2026-08-24",
    machine: null,
    shift: null,
    primaryOperator: null,
    startedAt: "2026-08-24T02:00:00.000Z",
    endedAt: null,
    operators: [],
    runSegments: [],
    downtimeIncidents: [],
    qtyLines: [
      {
        runSegmentId: 10,
        itemId: 5,
        workOrderNo: "WO-1",
        itemName: "Widget",
        runSegmentLabel: "Run 1",
        qtySentToQc: 12.5,
        productionScrapQty: 0,
        grossOutputQty: 12.5,
      },
    ],
    ...over,
  };
}

describe("Step 4B — Shift Report lifecycle helpers", () => {
  it("derives compact lifecycle stages", () => {
    expect(deriveShiftLifecycleStage(baseSession())).toBe("SHIFT_ACTIVE");
    expect(
      deriveShiftLifecycleStage(
        baseSession({
          report: {
            id: 1,
            latestVersionNo: 1,
            latestVersion: {
              id: 9,
              versionNo: 1,
              status: "DRAFT",
              grossOutputQty: 0,
              productionScrapQty: 0,
              qtySentToQc: 0,
              lines: [],
            },
          },
        }),
      ),
    ).toBe("REPORT_DRAFT");
    expect(
      deriveShiftLifecycleStage(
        baseSession({
          report: {
            id: 1,
            latestVersionNo: 1,
            latestVersion: {
              id: 9,
              versionNo: 1,
              status: "SUBMITTED",
              grossOutputQty: 1,
              productionScrapQty: 0,
              qtySentToQc: 1,
              lines: [],
            },
          },
        }),
      ),
    ).toBe("SUBMITTED");
    expect(
      deriveShiftLifecycleStage(
        baseSession({
          status: "SHIFT_OVER",
          report: {
            id: 1,
            latestVersionNo: 1,
            latestVersion: {
              id: 9,
              versionNo: 1,
              status: "VERIFIED",
              grossOutputQty: 1,
              productionScrapQty: 0,
              qtySentToQc: 1,
              lines: [],
            },
          },
        }),
      ),
    ).toBe("SHIFT_OVER");
  });

  it("labels stages and next actions without workflow jargon", () => {
    expect(shiftLifecycleStageLabel("REPORT_DRAFT")).toBe("Report Draft");
    expect(shiftLifecycleNextAction("SHIFT_ACTIVE").label).toMatch(/Prepare Shift Report/i);
    expect(shiftLifecycleNextAction("SUBMITTED", { canManage: false }).label).toMatch(/Awaiting Manager/i);
    expect(shiftLifecycleNextAction("SUBMITTED", { canManage: true }).label).toMatch(/Review Report/i);
    expect(shiftLifecycleNextAction("VERIFIED", { canManage: true }).action).toBe("shift-over");
    expect(shiftLifecycleNextAction("VERIFIED", { canManage: false }).action).toBe("report");
    expect(handoverStateLabel("RETAINED")).toBe("Material Retained");
    expect(handoverStateLabel("UNKNOWN")).toBe("Status Unknown");
    expect(formatShiftQty(12.5)).toBe("12.5");
  });

  it("merges live Qty Sent to QC for DRAFT/RETURNED and freezes SUBMITTED snapshots", () => {
    const draft = mergeShiftReportEditableLines(
      baseSession({
        report: {
          id: 1,
          latestVersionNo: 1,
          latestVersion: {
            id: 2,
            versionNo: 1,
            status: "DRAFT",
            grossOutputQty: 10,
            productionScrapQty: 1,
            qtySentToQc: 9,
            lines: [
              {
                runSegmentId: 10,
                itemId: 5,
                qtySentToQc: 9,
                productionScrapQty: 1,
                grossOutputQty: 10,
                remarks: "ok",
              },
            ],
          },
        },
        qtyLines: [
          {
            runSegmentId: 10,
            itemId: 5,
            qtySentToQc: 12.5,
            productionScrapQty: 0,
            grossOutputQty: 12.5,
            workOrderNo: "WO-1",
            itemName: "Widget",
          },
        ],
      }),
    );
    expect(draft.editable).toBe(true);
    expect(draft.lines[0].qtySentToQc).toBe(12.5);
    expect(draft.lines[0].productionScrapQty).toBe(1);
    expect(draft.lines[0].grossOutputQty).toBe(13.5);

    const submitted = mergeShiftReportEditableLines(
      baseSession({
        report: {
          id: 1,
          latestVersionNo: 1,
          latestVersion: {
            id: 2,
            versionNo: 1,
            status: "SUBMITTED",
            grossOutputQty: 10,
            productionScrapQty: 1,
            qtySentToQc: 9,
            lines: [
              {
                runSegmentId: 10,
                itemId: 5,
                qtySentToQc: 9,
                productionScrapQty: 1,
                grossOutputQty: 10,
              },
            ],
          },
        },
        qtyLines: [
          {
            runSegmentId: 10,
            itemId: 5,
            qtySentToQc: 99,
            productionScrapQty: 0,
            grossOutputQty: 99,
          },
        ],
      }),
    );
    expect(submitted.editable).toBe(false);
    expect(submitted.lines[0].qtySentToQc).toBe(9);
  });

  it("maps Step 4B API error codes to operator-safe messages", () => {
    expect(mapShiftApiError(new ApiRequestError("x", 409, "SHIFT_REPORT_HAS_UNAPPROVED_ENTRIES"))).toMatch(
      /Approve or remove the pending production entries/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 409, "SHIFT_REPORT_PRODUCTION_LOCKED"))).toMatch(
      /cannot change/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 409, "REPORT_LINE_QTY_IMBALANCE"))).toMatch(/gross output/i);
    expect(mapShiftApiError(new ApiRequestError("x", 409, "DECLARED_OPERATOR_NOT_ON_SESSION"))).toMatch(
      /participant/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 409, "REPORT_RETURNED_CANNOT_VERIFY"))).toMatch(/returned/i);
    expect(mapShiftApiError(new ApiRequestError("x", 409, "SHIFT_OVER_REQUIRES_VERIFIED_REPORT"))).toMatch(
      /verify/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 409, "HANDOVER_REMARKS_REQUIRED"))).toMatch(/Unknown/i);
    expect(mapShiftApiError(new ApiRequestError("x", 409, "REOPEN_BLOCKED_NEXT_SESSION"))).toMatch(
      /next shift has already started/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 403, "PRODUCTION_MANAGER_ACTION_REQUIRED"))).toMatch(
      /Production Manager/i,
    );
  });
});

describe("Step 4B — Shift Report UI wiring (source)", () => {
  it("names the surface Shift Report and does not re-enter produced qty", () => {
    expect(reportPanelSrc).toContain("Shift Report");
    expect(reportPanelSrc).toContain(
      "Shift Report records shift output. Work order material closure remains in Production Workspace.",
    );
    expect(reportPanelSrc).toContain("Qty Sent to QC");
    expect(reportPanelSrc).toContain("Production Scrap");
    expect(reportPanelSrc).toContain("Gross Output");
    expect(reportPanelSrc).not.toMatch(/Produced Qty/i);
    expect(reportPanelSrc).toContain("DecimalInput");
    expect(reportPanelSrc).toContain("maxFractionDigits={3}");
    expect(reportPanelSrc).toContain("Approve or remove the pending production entries");
    expect(reportPanelSrc).toContain("I confirm that the production and scrap quantities");
    expect(reportPanelSrc).toContain("Submitted for manager verification.");
    expect(reportPanelSrc).toContain("Return for Correction");
    expect(reportPanelSrc).toContain("Verify Report");
    expect(reportPanelSrc).toContain("Shift Report History");
  });

  it("wires Shift Over and reopen UX copy", () => {
    expect(overModalSrc).toContain("Complete Shift Over");
    expect(overModalSrc).toContain("HANDOVER_OPTIONS");
    expect(overModalSrc).toContain("Downtime will continue into the next shift until resumed.");
    expect(overModalSrc).toContain("handoverState");
    expect(handoverStateLabel("RETAINED")).toBe("Material Retained");
    expect(handoverStateLabel("CLEARED")).toBe("Machine Cleared");
    expect(handoverStateLabel("UNKNOWN")).toBe("Status Unknown");
    expect(reopenSrc).toContain("Reopening is allowed only before the next shift starts on this machine.");
    expect(reopenSrc).toContain("Request Reopen");
    expect(reopenSrc).toContain("Approve reopen");
    expect(reopenSrc).toContain("requestedByName");
    expect(reopenSrc).toContain("decidedByName");
    expect(reopenSrc).not.toMatch(/requestedByUserId/);
    expect(reopenSrc).not.toMatch(/decidedByUserId/);
  });

  it("embeds panels in workspace without new routes or WO report changes", () => {
    expect(workspaceSrc).toContain("ShiftReportPanel");
    expect(workspaceSrc).toContain("ShiftOverModal");
    expect(workspaceSrc).toContain("ShiftReopenPanel");
    expect(workspaceSrc).toContain("ShiftReportAdjustmentPanel");
    expect(workspaceSrc).toContain("deriveShiftLifecycleStage");
    expect(workspaceSrc).toContain("shift-lifecycle-stage");
    expect(workspaceSrc).not.toContain("ProductionReportPanel");
    expect(productionPageSrc).not.toContain("ShiftReportPanel");
    expect(woReportPanelSrc).not.toContain("Shift Report");
  });
});
