import { describe, expect, it } from "vitest";
import {
  getReleaseDeltaDisabledStatusMessage,
  getReleaseDeltaProcurementBadge,
  isReleaseDeltaButtonEnabled,
  resolveAdditionalRequirementTotal,
} from "../../src/lib/monthlyPlanningReleaseDeltaUx";

describe("monthlyPlanningReleaseDeltaUx", () => {
  it("additional requirement > 0 → button enabled", () => {
    expect(isReleaseDeltaButtonEnabled(125.675)).toBe(true);
    expect(
      isReleaseDeltaButtonEnabled(
        resolveAdditionalRequirementTotal({ additionalRequirementTotal: 50 }, []),
      ),
    ).toBe(true);
  });

  it("additional requirement = 0 → button disabled", () => {
    expect(isReleaseDeltaButtonEnabled(0)).toBe(false);
    expect(
      isReleaseDeltaButtonEnabled(
        resolveAdditionalRequirementTotal({ additionalRequirementTotal: 0 }, []),
      ),
    ).toBe(false);
  });

  it("release success → reload data with zero additional → disabled", () => {
    const afterRelease = resolveAdditionalRequirementTotal(
      { additionalRequirementTotal: 0, previouslyReleasedTotal: 125.675 },
      [],
    );
    expect(isReleaseDeltaButtonEnabled(afterRelease)).toBe(false);
    expect(
      getReleaseDeltaDisabledStatusMessage({
        additionalRequirementTotal: afterRelease,
        previouslyReleasedTotal: 125.675,
      }),
    ).toBe("Demand Released complete for this legacy plan snapshot.");
  });

  it("release failure → additional unchanged → remains enabled", () => {
    const afterFailedRelease = resolveAdditionalRequirementTotal(
      { additionalRequirementTotal: 125.675, previouslyReleasedTotal: 0 },
      [],
    );
    expect(isReleaseDeltaButtonEnabled(afterFailedRelease)).toBe(true);
    expect(getReleaseDeltaDisabledStatusMessage({ additionalRequirementTotal: afterFailedRelease })).toBe(
      "",
    );
  });

  it("new revision creates positive delta → enabled again", () => {
    const rev4Delta = resolveAdditionalRequirementTotal(
      { additionalRequirementTotal: 14.325, previouslyReleasedTotal: 100 },
      [],
    );
    expect(isReleaseDeltaButtonEnabled(rev4Delta)).toBe(true);
    expect(
      getReleaseDeltaProcurementBadge({
        currentRevision: 4,
        releasedRevision: 3,
        materialRequirementDocNo: "MR-26-0002",
      }),
    ).toBeNull();
  });

  it("shows procurement badge when released revision matches current", () => {
    expect(
      getReleaseDeltaProcurementBadge({
        currentRevision: 3,
        releasedRevision: 3,
        materialRequirementDocNo: "MR-26-0002",
      }),
    ).toEqual({ revision: 3, label: "Legacy snapshot 3", materialRequirementDocNo: "MR-26-0002" });
  });

  it("shows plan label badge for APPROVED plan documents", () => {
    expect(
      getReleaseDeltaProcurementBadge({
        planStatus: "APPROVED",
        currentRevision: 0,
        snapshotRevision: 1,
        releasedRevision: 1,
        planDisplayLabel: "June Plan 2",
        materialRequirementDocNo: "MR-26-0010",
      }),
    ).toEqual({
      revision: 1,
      label: "June Plan 2",
      materialRequirementDocNo: "MR-26-0010",
    });
  });

  it("uses plan-document disabled message after release", () => {
    expect(
      getReleaseDeltaDisabledStatusMessage({
        additionalRequirementTotal: 0,
        previouslyReleasedTotal: 50,
        usesPlanDocumentUx: true,
      }),
    ).toBe("RM requirement released — no further release required.");
  });

  it("falls back to line sums when totals missing", () => {
    expect(
      resolveAdditionalRequirementTotal(null, [
        { additionalRequirementQty: 10 },
        { additionalRequirementQty: 4.325 },
      ]),
    ).toBeCloseTo(14.325);
  });
});
