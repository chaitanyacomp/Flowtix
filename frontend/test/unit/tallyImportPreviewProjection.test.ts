import { describe, expect, it } from "vitest";
import {
  displayedEffectiveItemType,
  tallyConfirmIsDisabled,
} from "../../src/lib/tallyImportPreviewProjection";

describe("Tally import authoritative preview projection", () => {
  it("shows the backend effective type, including SFG and CONSUMABLE, without an FG fallback", () => {
    expect(displayedEffectiveItemType({ autoDetectedItemType: "FG", itemType: "RM" })).toBe("RM");
    expect(displayedEffectiveItemType({ autoDetectedItemType: "RM", itemType: "CONSUMABLE" })).toBe("CONSUMABLE");
    expect(displayedEffectiveItemType({ itemType: "SFG" })).toBe("SFG");
    expect(displayedEffectiveItemType({ autoDetectedItemType: "RM" })).toBe("—");
  });

  it("blocks confirmation for authoritative blockers and un-recalculated mapping edits", () => {
    const ready = {
      busy: false,
      hasPreviewToken: true,
      confirmBlockingCount: 0,
      mappingsDirty: false,
      stage2Editable: true,
    };
    expect(tallyConfirmIsDisabled(ready)).toBe(false);
    expect(tallyConfirmIsDisabled({ ...ready, confirmBlockingCount: 1 })).toBe(true);
    expect(tallyConfirmIsDisabled({ ...ready, mappingsDirty: true })).toBe(true);
  });
});
