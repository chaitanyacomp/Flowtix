import { describe, expect, it } from "vitest";
import { controlTowerHref, parseControlTowerSearchParams, rowMatchesControlTowerFilters } from "../../src/lib/controlTowerNavigation";
import { buildAdminCriticalExceptions } from "../../src/lib/adminDashboardExceptions";
import { dashboardWorkspaceHeadline } from "../../src/lib/dashboardShell";
import { formatControlTowerStatus } from "../../src/lib/controlTowerDisplay";

describe("Admin Dashboard vs Control Tower separation", () => {
  it("1. Admin headline is Admin Dashboard (not Dual Control Center)", () => {
    const h = dashboardWorkspaceHeadline("ADMIN");
    expect(h.title).toBe("Admin Dashboard");
    expect(h.subtitle).toMatch(/Admin decisions/i);
    expect(h.title).not.toMatch(/Dual Control/i);
  });

  it("2. Critical exceptions deep-link to Control Tower filters", () => {
    const rows = buildAdminCriticalExceptions({
      blockedWoCount: 2,
      qcPendingCount: 1,
      dispatchPendingCount: 3,
      recoveryOpenCount: 1,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.href.startsWith("/control-tower"))).toBe(true);
    expect(rows.some((r) => r.href.includes("View") === false)).toBe(true);
    expect(rows.every((r) => r.href.includes("View in Control Tower") === false)).toBe(true);
  });

  it("4–5. Ready status label is Ready to Start (not Release / Running)", () => {
    expect(formatControlTowerStatus("READY_TO_START")).toBe("Ready to Start");
    expect(formatControlTowerStatus("WO_RELEASE_READY")).toBe("Ready to Start");
    expect(formatControlTowerStatus("WO_RELEASE_READY")).not.toMatch(/release ready/i);
  });

  it("10. Dashboard links preserve Control Tower filters", () => {
    const href = controlTowerHref({ group: "PRODUCTION", status: "READY_TO_START" });
    expect(href).toBe("/control-tower?group=PRODUCTION&status=READY_TO_START");
    const parsed = parseControlTowerSearchParams(new URLSearchParams(href.split("?")[1]));
    expect(parsed.group).toBe("PRODUCTION");
    expect(parsed.status).toBe("READY_TO_START");
  });

  it("11. Back navigation restores filter state via URL params", () => {
    const params = new URLSearchParams("group=QUALITY&status=QA_PENDING&blockedOnly=1");
    const parsed = parseControlTowerSearchParams(params);
    expect(parsed.group).toBe("QUALITY");
    expect(parsed.status).toBe("QA_PENDING");
    expect(parsed.blockedOnly).toBe(true);
  });

  it("filters match Ready rows without treating them as blocked", () => {
    expect(
      rowMatchesControlTowerFilters(
        { currentStatus: "READY_TO_START", currentOwner: "PRODUCTION", documentNo: "WO-1" },
        { status: "READY_TO_START" },
      ),
    ).toBe(true);
    expect(
      rowMatchesControlTowerFilters(
        { currentStatus: "READY_TO_START", currentOwner: "PRODUCTION", documentNo: "WO-1" },
        { blockedOnly: true },
      ),
    ).toBe(false);
  });

  it("View Full Factory Monitor href uses Production + factory focus", () => {
    expect(controlTowerHref({ group: "PRODUCTION", focus: "factory" })).toBe(
      "/control-tower?group=PRODUCTION&focus=factory",
    );
  });
});
