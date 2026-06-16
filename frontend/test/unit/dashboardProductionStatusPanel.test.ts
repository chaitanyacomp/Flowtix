import { describe, expect, it } from "vitest";
import {
  ACTIVE_PRODUCTION_STATUS_HELPER,
  ACTIVE_PRODUCTION_STATUS_TITLE,
} from "../../src/components/erp/foundation/DashboardCurrentProductionStatus";
import {
  PENDING_ACTIONS_DEFAULT_HELPER,
  PENDING_ACTIONS_PRODUCTION_HELPER,
} from "../../src/pages/PendingActionsPage";

describe("Production dashboard action vs status separation", () => {
  it("labels active production status as monitoring, not an action inbox", () => {
    expect(ACTIVE_PRODUCTION_STATUS_TITLE).toBe("Active Production Status");
    expect(ACTIVE_PRODUCTION_STATUS_HELPER).toMatch(/live status/i);
    expect(ACTIVE_PRODUCTION_STATUS_HELPER).not.toMatch(/pending action/i);
  });

  it("uses distinct helper copy for Production pending actions inbox", () => {
    expect(PENDING_ACTIONS_PRODUCTION_HELPER).toMatch(/start or continue/i);
    expect(PENDING_ACTIONS_PRODUCTION_HELPER).not.toBe(PENDING_ACTIONS_DEFAULT_HELPER);
  });
});
