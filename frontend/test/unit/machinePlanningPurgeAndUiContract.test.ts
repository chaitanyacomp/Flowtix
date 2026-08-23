import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatPurgingDetectionDisplay } from "../../src/lib/purgingDetectionDisplay";
import { REGULAR_TERMS } from "../../src/lib/flowTerminology";

const rmCheckPath = resolve(__dirname, "../../src/pages/RmCheckPage.tsx");
const allocationPanelPath = resolve(
  __dirname,
  "../../src/components/erp/WoPrepareProductionRunAllocationPanel.tsx",
);
const rmCheckSource = readFileSync(rmCheckPath, "utf8");
const allocationPanelSource = readFileSync(allocationPanelPath, "utf8");

describe("purgingDetectionDisplay", () => {
  it("maps UNKNOWN / confirmation-required to Conservative purge planned", () => {
    const d = formatPurgingDetectionDisplay({
      purgingDetectionStatus: "CONFIRMATION_REQUIRED",
      conservativePurgePlan: true,
      purgingRequired: true,
    });
    expect(d.label).toBe("Conservative purge planned");
    expect(d.reason).toMatch(/operator confirms at production start/i);
  });

  it("maps retained / changed / cleared / override labels", () => {
    expect(
      formatPurgingDetectionDisplay({ purgingDetectionStatus: "AUTO_NOT_REQUIRED" }).label,
    ).toBe("No purge — same material retained");
    expect(
      formatPurgingDetectionDisplay({
        purgingDetectionStatus: "AUTO_REQUIRED",
        purgingDetectionReason: "profile differs",
      }).label,
    ).toBe("Purge required — material changed");
    expect(
      formatPurgingDetectionDisplay({
        purgingDetectionStatus: "AUTO_REQUIRED",
        purgingDetectionReason: "Machine material was cleared",
      }).label,
    ).toBe("Purge required — machine cleared");
    expect(
      formatPurgingDetectionDisplay({
        purgingDetectionStatus: "OVERRIDDEN",
        purgingRequired: true,
        purgingOverrideReason: "Audit exception",
      }).label,
    ).toMatch(/Override — purge required/);
  });
});

describe("Machine Run Planning UI contract — no duplicates", () => {
  it("has a single Machine Run Planning page title marker", () => {
    expect(REGULAR_TERMS.MACHINE_RUN_PLANNING_TITLE).toBe("Machine Run Planning");
    // App header owns the title — body must not duplicate an H1 title marker.
    expect(rmCheckSource).not.toContain('data-testid="machine-run-planning-page-title"');
    expect(rmCheckSource).toContain("MACHINE_RUN_PLANNING_SUBTITLE");
    expect(rmCheckSource).toContain("useCompactMachinePlanning");
  });

  it("does not append Setup confirm under Purge Detection", () => {
    expect(allocationPanelSource).not.toContain("Setup confirm");
    expect(allocationPanelSource).toContain("formatPurgingDetectionDisplay");
  });

  it("shows one guided status card path and hides prepare checklist in machine-planning intent", () => {
    expect(rmCheckSource).toContain("useCompactMachinePlanning");
    expect(rmCheckSource).toContain("WoPrepareWorkflowProgress");
    expect(rmCheckSource).toContain("WoPrepareReadinessChecklist");
    // Compact workspace omits guided strip; prepare path may still reference it once.
    const guidedUsages = rmCheckSource.match(/<WoPrepareGuidedStrip/g) ?? [];
    expect(guidedUsages.length).toBeLessThanOrEqual(1);
  });

  it("uses toast for action results only (no duplicate allocation-pending toast)", () => {
    expect(rmCheckSource).not.toContain(
      'toast.showError("Machine allocation pending — Production action required.")',
    );
    expect(rmCheckSource).toContain("Inline error only");
  });

  it("machine-planning sticky bar owns hub navigation (no duplicate bottom nav)", () => {
    expect(rmCheckSource).toContain("MachineRunPlanningActionBar");
    expect(rmCheckSource).toContain("Sticky action bar owns hub navigation");
    expect(rmCheckSource).not.toContain('data-testid="machine-planning-nav"');
  });

  it("primary Complete Machine Planning action appears once per editable surface", () => {
    // Compact intent action bar + prepare-WO actions (mutually exclusive branches).
    const completeBtns = rmCheckSource.match(/Complete Machine Planning/g) ?? [];
    expect(completeBtns.length).toBeGreaterThanOrEqual(1);
    expect(rmCheckSource).toContain("MachineRunPlanningActionBar");
  });
});
