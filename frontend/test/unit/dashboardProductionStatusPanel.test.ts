import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACTIVE_PRODUCTION_STATUS_HELPER,
  ACTIVE_PRODUCTION_STATUS_TITLE,
} from "../../src/components/erp/foundation/DashboardCurrentProductionStatus";
import {
  PENDING_ACTIONS_DEFAULT_HELPER,
  PENDING_ACTIONS_PRODUCTION_HELPER,
} from "../../src/pages/PendingActionsPage";
import { OPEN_ACTIVE_SHIFT_LABEL } from "../../src/lib/activeShiftRunGuidance";

const root = resolve(__dirname, "../..");
const activeRunCardSource = readFileSync(
  resolve(root, "src/components/erp/foundation/DashboardActiveProductionRunCard.tsx"),
  "utf8",
);
const dashboardPageSource = readFileSync(resolve(root, "src/pages/DashboardPage.tsx"), "utf8");

describe("Production dashboard action vs status separation", () => {
  it("labels production monitor as status for lines without an active shift run", () => {
    expect(ACTIVE_PRODUCTION_STATUS_TITLE).toBe("Current Production Monitor");
    expect(ACTIVE_PRODUCTION_STATUS_HELPER).toMatch(/without an active shift run/i);
    expect(ACTIVE_PRODUCTION_STATUS_HELPER).not.toMatch(/Ready to Start is not Running/i);
    expect(ACTIVE_PRODUCTION_STATUS_HELPER).not.toMatch(/pending action/i);
  });

  it("surfaces Active Production Run with state-aware primary CTA and Open Active Shift", () => {
    expect(dashboardPageSource).toContain("DashboardActiveProductionRunCard");
    expect(activeRunCardSource).toContain('aria-label="Active Production Run"');
    expect(activeRunCardSource).toContain("active-run-primary-cta");
    expect(activeRunCardSource).toContain("{run.primaryActionLabel}");
    expect(activeRunCardSource).toContain("active-run-open-shift-cta");
    expect(activeRunCardSource).toContain("OPEN_ACTIVE_SHIFT_LABEL");
    expect(OPEN_ACTIVE_SHIFT_LABEL).toMatch(/Open Active Shift/i);
  });

  it("uses distinct helper copy for Production pending actions inbox", () => {
    expect(PENDING_ACTIONS_PRODUCTION_HELPER).toMatch(/start or continue/i);
    expect(PENDING_ACTIONS_PRODUCTION_HELPER).not.toBe(PENDING_ACTIONS_DEFAULT_HELPER);
  });
});
