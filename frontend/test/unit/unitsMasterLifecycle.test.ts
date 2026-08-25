/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const unitsPageSrc = readFileSync(resolve(__dirname, "../../src/pages/UnitsPage.tsx"), "utf8");
const unitsRouteSrc = readFileSync(resolve(__dirname, "../../../backend/src/routes/units.js"), "utf8");
const unitMasterSrc = readFileSync(resolve(__dirname, "../../../backend/src/services/unitMaster.js"), "utf8");

describe("Unit Master lifecycle UI", () => {
  it("loads includeInactive and filters Active / Inactive / All", () => {
    expect(unitsPageSrc).toContain('/api/units?includeInactive=true');
    expect(unitsPageSrc).toContain('data-testid="units-status-filter"');
    expect(unitsPageSrc).toContain('value="active"');
    expect(unitsPageSrc).toContain('value="inactive"');
    expect(unitsPageSrc).toContain('value="all"');
    expect(unitsPageSrc).toContain('statusFilter: "active"');
  });

  it("wires Edit / Deactivate / Reactivate / Delete with usage gates", () => {
    expect(unitsPageSrc).toContain("canEdit");
    expect(unitsPageSrc).toContain("canDelete");
    expect(unitsPageSrc).toContain("In use — deactivate only");
    expect(unitsPageSrc).toContain("method: \"PATCH\"");
    expect(unitsPageSrc).toContain("/deactivate");
    expect(unitsPageSrc).toContain("/activate");
    expect(unitsPageSrc).toContain('method: "DELETE"');
    expect(unitsPageSrc).toContain("unit-edit-");
    expect(unitsPageSrc).toContain("unit-deactivate-");
    expect(unitsPageSrc).toContain("unit-reactivate-");
    expect(unitsPageSrc).toContain("unit-delete-");
  });

  it("uses ErpModalFrame for add/edit and confirmations for deactivate/delete", () => {
    expect(unitsPageSrc).toContain("ErpModalFrame");
    expect(unitsPageSrc).toContain("ErpModalFrameBody");
    expect(unitsPageSrc).toContain("ErpModalFrameFooter");
    expect(unitsPageSrc).toContain('closeButtonTestId="unit-master-modal-close"');
    expect(unitsPageSrc).toContain('data-testid="unit-confirm-deactivate"');
    expect(unitsPageSrc).toContain('data-testid="unit-confirm-delete"');
    expect(unitsPageSrc).toContain("Permanently delete");
    expect(unitsPageSrc).toContain("Deactivate");
  });

  it("disables Edit/Delete when unit cannot be changed", () => {
    expect(unitsPageSrc).toMatch(/disabled=\{!u\.canEdit \|\| saving\}/);
    expect(unitsPageSrc).toMatch(/disabled=\{!u\.canDelete \|\| saving\}/);
  });
});

describe("Unit Master backend contracts referenced by UI", () => {
  it("enriches includeInactive list with usage and tally flags", () => {
    expect(unitsRouteSrc).toContain("includeInactive");
    expect(unitsRouteSrc).toContain("tallyLinked");
    expect(unitsRouteSrc).toContain("canEdit");
    expect(unitsRouteSrc).toContain("canDelete");
    expect(unitMasterSrc).toContain("getUnitUsageCounts");
    expect(unitMasterSrc).toContain("fgWeightUnitId");
    expect(unitMasterSrc).toContain("isUnitTallyLinked");
  });
});
