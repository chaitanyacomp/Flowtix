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
    ).toBe("Procurement already released for current revision.");
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
    ).toEqual({ revision: 3, materialRequirementDocNo: "MR-26-0002" });
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
