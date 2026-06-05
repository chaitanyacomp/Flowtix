import { describe, expect, it } from "vitest";

import {
  CONTROL_TOWER_BOARD_GROUP_ORDER,
  sortControlTowerBoardGroups,
} from "../../src/lib/controlTowerApi";

describe("controlTowerApi", () => {
  it("CONTROL_TOWER_BOARD_GROUP_ORDER matches approved swimlanes", () => {
    expect(CONTROL_TOWER_BOARD_GROUP_ORDER).toEqual([
      "RM_READINESS",
      "PRODUCTION",
      "QUALITY",
      "DISPATCH",
      "COMMERCIAL_CLOSURE",
      "PLANNING",
    ]);
  });

  it("sortControlTowerBoardGroups orders known groups first", () => {
    const groups = sortControlTowerBoardGroups([
      { groupKey: "PLANNING", label: "Planning", ownerRole: "ADMIN", order: 6, count: 1, rows: [] },
      { groupKey: "RM_READINESS", label: "RM", ownerRole: "STORE", order: 1, count: 2, rows: [] },
      { groupKey: "PRODUCTION", label: "Production", ownerRole: "PRODUCTION", order: 2, count: 3, rows: [] },
    ]);
    expect(groups[0]?.groupKey).toBe("RM_READINESS");
    expect(groups[1]?.groupKey).toBe("PRODUCTION");
    expect(groups[2]?.groupKey).toBe("PLANNING");
  });
});
