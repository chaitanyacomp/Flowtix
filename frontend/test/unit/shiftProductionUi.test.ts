/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isProductionNavItemVisible,
  isShiftProductionNavActive,
  listVisibleProductionFlowNavKeys,
} from "../../src/lib/productionNavFilter";
import {
  ERP_ROLES,
  SHIFT_PRODUCTION_ROLES,
  hasErpRole,
} from "../../src/config/erpRoles";
import {
  busyOperatorIdSet,
  canShowManagerControls,
  deriveMachineShiftUiStatus,
  indiaLocalDateYmd,
  mapShiftApiError,
  validateStartOperators,
} from "../../src/lib/machineShiftSessionUi";
import { ApiRequestError } from "../../src/services/api";
import type { ShiftSessionDetail } from "../../src/lib/machineShiftSessionApi";

const appLayoutPath = resolve(__dirname, "../../src/components/AppLayout.tsx");
const appPath = resolve(__dirname, "../../src/App.tsx");
const appLayoutSource = readFileSync(appLayoutPath, "utf8");
const appSource = readFileSync(appPath, "utf8");

const PRODUCTION_FLOW_ITEMS = [
  { navKey: "plan-dash", roles: ["ADMIN", "STORE", "PRODUCTION"] },
  { navKey: "wo", roles: ["ADMIN", "STORE", "PRODUCTION"] },
  { navKey: "prod", roles: ["ADMIN", "PRODUCTION"] },
  { navKey: "shift-prod", roles: [...SHIFT_PRODUCTION_ROLES] },
];

describe("Shift Production navigation & roles", () => {
  it("includes PRODUCTION_MANAGER in ERP_ROLES and SHIFT_PRODUCTION_ROLES", () => {
    expect(ERP_ROLES).toContain("PRODUCTION_MANAGER");
    expect(SHIFT_PRODUCTION_ROLES).toEqual(
      expect.arrayContaining(["ADMIN", "PRODUCTION_MANAGER", "PRODUCTION"]),
    );
  });

  it("shows Shift Production nav for ADMIN, PRODUCTION_MANAGER, PRODUCTION", () => {
    expect(isProductionNavItemVisible("PRODUCTION", "shift-prod")).toBe(true);
    expect(listVisibleProductionFlowNavKeys("PRODUCTION", PRODUCTION_FLOW_ITEMS)).toContain("shift-prod");
    expect(hasErpRole("ADMIN", SHIFT_PRODUCTION_ROLES)).toBe(true);
    expect(hasErpRole("PRODUCTION_MANAGER", SHIFT_PRODUCTION_ROLES)).toBe(true);
    expect(hasErpRole("STORE", SHIFT_PRODUCTION_ROLES)).toBe(false);
  });

  it("wires AppLayout nav and App routes without changing Production Workspace path", () => {
    expect(appLayoutSource).toContain('navKey: "shift-prod"');
    expect(appLayoutSource).toContain("Shift Production");
    expect(appLayoutSource).toContain('to: "/shift-production"');
    expect(appLayoutSource).toContain('to: "/production"');
    expect(appLayoutSource).toContain("Production Workspace");
    expect(appSource).toContain('path="/shift-production"');
    expect(appSource).toContain('path="/shift-production/sessions/:sessionId"');
    expect(appSource).toContain('path="/production"');
  });

  it("highlights shift production workspace paths", () => {
    expect(isShiftProductionNavActive("/shift-production")).toBe(true);
    expect(isShiftProductionNavActive("/shift-production/sessions/12")).toBe(true);
    expect(isShiftProductionNavActive("/production")).toBe(false);
  });
});

describe("Shift Production UI helpers", () => {
  it("maps fallback and manager capability flags", () => {
    expect(canShowManagerControls({ canPerformManagerActions: true })).toBe(true);
    expect(canShowManagerControls({ canPerformManagerActions: false })).toBe(false);
  });

  it("maps Step 4B error codes used by Shift Report", () => {
    expect(mapShiftApiError(new ApiRequestError("x", 409, "REOPEN_BLOCKED_NEXT_SESSION"))).toMatch(
      /next shift has already started/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 409, "SHIFT_REPORT_HAS_UNAPPROVED_ENTRIES"))).toMatch(
      /pending production entries/i,
    );
  });

  it("validates start operators: multiple with exactly one primary", () => {
    expect(validateStartOperators([])).toMatch(/at least one/i);
    expect(
      validateStartOperators([
        { operatorId: 1, isPrimary: true },
        { operatorId: 2, isPrimary: true },
      ]),
    ).toMatch(/exactly one primary/i);
    expect(
      validateStartOperators([
        { operatorId: 1, isPrimary: true },
        { operatorId: 2, isPrimary: false },
      ]),
    ).toBeNull();
  });

  it("derives machine status for active / running / downtime", () => {
    const base = {
      id: 1,
      shiftSessionNo: "SS-26-0001",
      status: "OPEN",
      sessionDate: "2026-08-24",
      machine: null,
      shift: null,
      primaryOperator: null,
      startedAt: "2026-08-24T02:00:00.000Z",
      endedAt: null,
      operators: [],
      runSegments: [],
      downtimeIncidents: [],
    } as ShiftSessionDetail;

    expect(deriveMachineShiftUiStatus(null)).toBe("NO_ACTIVE");
    expect(deriveMachineShiftUiStatus(base)).toBe("SHIFT_ACTIVE");
    expect(
      deriveMachineShiftUiStatus({
        ...base,
        runSegments: [
          {
            id: 1,
            segmentNo: 1,
            status: "ACTIVE",
            workOrderId: 9,
            workOrderDocNo: "WO-1",
            runAllocationId: 2,
            startedAt: "2026-08-24T03:00:00.000Z",
            closedAt: null,
          },
        ],
      }),
    ).toBe("PRODUCTION_RUNNING");
    expect(
      deriveMachineShiftUiStatus({
        ...base,
        runSegments: [
          {
            id: 1,
            segmentNo: 1,
            status: "ACTIVE",
            workOrderId: 9,
            workOrderDocNo: "WO-1",
            runAllocationId: 2,
            startedAt: "2026-08-24T03:00:00.000Z",
            closedAt: null,
          },
        ],
        downtimeIncidents: [
          {
            id: 3,
            reason: "WAITING_FOR_RM",
            startedAt: "2026-08-24T04:00:00.000Z",
            endedAt: null,
            segments: [{ id: 1, sessionId: 1, segmentStartAt: "2026-08-24T04:00:00.000Z", segmentEndAt: null }],
          },
        ],
      }),
    ).toBe("DOWNTIME");
  });

  it("maps backend error codes to friendly messages", () => {
    expect(mapShiftApiError(new ApiRequestError("x", 403, "PRODUCTION_MANAGER_ACTION_REQUIRED"))).toMatch(
      /Production Manager/i,
    );
    expect(mapShiftApiError(new ApiRequestError("x", 409, "SHIFT_SESSION_ALREADY_OPEN"))).toMatch(/already has an active shift/i);
    expect(mapShiftApiError(new ApiRequestError("x", 409, "PRIMARY_OPERATOR_CANNOT_LEAVE"))).toMatch(/primary/i);
    expect(mapShiftApiError(new ApiRequestError("x", 409, "DOWNTIME_ALREADY_OPEN"))).toMatch(/already paused/i);
    expect(mapShiftApiError(new ApiRequestError("x", 409, "NO_ACTIVE_RUN_TO_PAUSE"))).toMatch(/Start a production run/i);
    expect(mapShiftApiError(new ApiRequestError("x", 409, "ACTIVE_RUN_SEGMENT_EXISTS"))).toMatch(/already active/i);
    expect(
      mapShiftApiError(
        new ApiRequestError(
          "This operator is already active on Press 1 (M1) (SS-26-0001). They must leave that machine before joining here.",
          409,
          "OPERATOR_ACTIVE_ON_ANOTHER_MACHINE",
        ),
      ),
    ).toMatch(/Press 1 \(M1\)/);
  });

  it("excludes operators busy on another session from join candidates", () => {
    const all = busyOperatorIdSet([
      { operatorId: 1, sessionId: 10 },
      { operatorId: 2, sessionId: 20 },
    ]);
    expect([...all].sort()).toEqual([1, 2]);
    const joinFiltered = busyOperatorIdSet(
      [
        { operatorId: 1, sessionId: 10 },
        { operatorId: 2, sessionId: 20 },
      ],
      10,
    );
    expect([...joinFiltered]).toEqual([2]);
  });

  it("defaults session date to India local YYYY-MM-DD", () => {
    expect(indiaLocalDateYmd(new Date("2026-08-24T20:30:00+05:30"))).toBe("2026-08-24");
  });
});

describe("StartShiftModal / workspace double-submit protection (source)", () => {
  it("StartShiftModal guards submitting and Start Shift label", () => {
    const src = readFileSync(
      resolve(__dirname, "../../src/components/erp/shiftProduction/StartShiftModal.tsx"),
      "utf8",
    );
    expect(src).toContain("if (submitting) return");
    expect(src).toContain("Start Shift");
    expect(src).toContain("validateStartOperators");
    expect(src).toContain("busyOperatorIds");
    expect(src).toContain("Night shifts use the starting date");
  });

  it("workspace refreshes after actions and disables while busy", () => {
    const src = readFileSync(resolve(__dirname, "../../src/pages/ShiftSessionWorkspacePage.tsx"), "utf8");
    expect(src).toContain("if (busy) return");
    expect(src).toContain("await refresh()");
    expect(src).toContain("fetchBusyShiftOperators");
    expect(src).toContain("busyOperatorIdSet");
    expect(src).toContain("Continue into this shift");
    expect(src).toContain("Downtime continued from previous shift");
    expect(src).toContain("Pause Production");
    expect(src).toContain("Resume Production");
    expect(src).toContain("fetchShiftSession");
    expect(src).toContain("ShiftReportPanel");
    expect(src).toContain("Shift Over");
  });

  it("landing shows fallback banner copy", () => {
    const src = readFileSync(resolve(__dirname, "../../src/pages/ShiftProductionPage.tsx"), "utf8");
    expect(src).toContain("Production Manager is not assigned. You have temporary shift control.");
    expect(src).toContain("canShowManagerControls");
    expect(src).toContain("fetchOpenShiftSession");
    expect(src).toContain("fetchBusyShiftOperators");
    expect(src).toContain("busyOperatorIds");
  });
});
