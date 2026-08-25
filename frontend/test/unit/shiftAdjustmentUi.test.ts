/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../src/services/api";
import { mapShiftApiError } from "../../src/lib/machineShiftSessionUi";

const panelSrc = readFileSync(
  resolve(__dirname, "../../src/components/erp/shiftProduction/ShiftReportAdjustmentPanel.tsx"),
  "utf8",
);
const workspaceSrc = readFileSync(
  resolve(__dirname, "../../src/pages/ShiftSessionWorkspacePage.tsx"),
  "utf8",
);
const woReportSrc = readFileSync(
  resolve(__dirname, "../../src/components/erp/production/ProductionReportPanel.tsx"),
  "utf8",
);

describe("Step 4C — Historical Adjustment UI", () => {
  it("maps adjustment domain errors to friendly messages", () => {
    expect(mapShiftApiError(new ApiRequestError("x", 409, "ADJUSTMENT_REQUIRES_VERIFIED"))).toMatch(
      /verified/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 409, "ADJUSTMENT_REQUIRES_SHIFT_OVER"))).toMatch(
      /Shift Over/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 409, "ADJUSTMENT_ALREADY_OPEN"))).toMatch(
      /unresolved/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 400, "DECISION_NOTE_REQUIRED"))).toMatch(/denying/i);
    expect(mapShiftApiError(new ApiRequestError("x", 409, "ADJUSTMENT_NOT_APPROVED"))).toMatch(/approved/i);
    expect(mapShiftApiError(new ApiRequestError("x", 409, "ADJUSTMENT_NOT_AVAILABLE_FOR_ZERO_REPORT"))).toMatch(
      /zero-production/i,
    );
  });

  it("wires adjustment panel with reporting-only disclaimer and no raw IDs", () => {
    expect(panelSrc).toContain("Historical Adjustment");
    expect(panelSrc).toContain(
      "This correction updates shift reporting history only. It does not change stock, QC or work order records.",
    );
    expect(panelSrc).toContain("Request Adjustment");
    expect(panelSrc).toContain("Apply Correction");
    expect(panelSrc).toContain("Approval does not change the verified report yet");
    expect(panelSrc).toContain("requestedByName");
    expect(panelSrc).toContain("decidedByName");
    expect(panelSrc).toContain("appliedByName");
    expect(panelSrc).not.toMatch(/requestedByUserId/);
    expect(panelSrc).not.toMatch(/appliedReportVersionId/);
    expect(panelSrc).toContain("if (busy");
    expect(panelSrc).toContain("shift-adjustment-unavailable-zero");
    expect(panelSrc).toMatch(/does not\s+invent production lines/);
    expect(workspaceSrc).toContain("ShiftReportAdjustmentPanel");
    expect(woReportSrc).not.toContain("Historical Adjustment");
  });
});
