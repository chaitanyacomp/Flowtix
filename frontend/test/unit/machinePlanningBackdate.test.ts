import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiRequestError } from "../../src/services/api";
import {
  MACHINE_PLANNING_PAST_DATE_WARNING,
  canBackdateMachinePlanning,
  classifyMachinePlanningSaveError,
  formatPlanningYmdDisplay,
  formatStartDateBeforeSoMessage,
  isPastMachinePlanningStartDate,
  localTodayYmd,
  machinePlanningDateInputMin,
  runsHavePastStartDate,
  runsSatisfySoStartDateFloor,
} from "../../src/lib/machinePlanningBackdate";
import { MACHINE_PLANNING_BACKDATE_ROLES, WO_MACHINE_RUN_WRITE_ROLES } from "../../src/config/erpRoles";

const root = resolve(__dirname, "../..");
const panelSource = readFileSync(
  resolve(root, "src/components/erp/WoPrepareProductionRunAllocationPanel.tsx"),
  "utf8",
);
const rmCheckSource = readFileSync(resolve(root, "src/pages/RmCheckPage.tsx"), "utf8");

describe("Machine planning controlled backdate UX", () => {
  it("Admin / Production Manager may backdate; Production/Store cannot", () => {
    expect(canBackdateMachinePlanning("ADMIN")).toBe(true);
    expect(canBackdateMachinePlanning("PRODUCTION_MANAGER")).toBe(true);
    expect(canBackdateMachinePlanning("PRODUCTION")).toBe(false);
    expect(canBackdateMachinePlanning("STORE")).toBe(false);
    expect([...MACHINE_PLANNING_BACKDATE_ROLES]).toEqual(["ADMIN", "PRODUCTION_MANAGER"]);
    expect(WO_MACHINE_RUN_WRITE_ROLES).toContain("PRODUCTION_MANAGER");
  });

  it("date input min is today for Production; SO floor when backdate allowed", () => {
    const today = localTodayYmd();
    expect(machinePlanningDateInputMin("PRODUCTION")).toBe(today);
    expect(machinePlanningDateInputMin("STORE")).toBe(today);
    expect(machinePlanningDateInputMin("ADMIN", "2026-08-01")).toBe("2026-08-01");
  });

  it("past detection and warning copy", () => {
    const yesterday = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return localTodayYmd(d);
    })();
    expect(isPastMachinePlanningStartDate(yesterday)).toBe(true);
    expect(isPastMachinePlanningStartDate(localTodayYmd())).toBe(false);
    expect(runsHavePastStartDate([{ plannedDate: yesterday }])).toBe(true);
    expect(MACHINE_PLANNING_PAST_DATE_WARNING).toBe("You are recording a past machine plan");
  });

  it("panel shows warning, reason, Backdated badge; RmCheck sends backdate reason", () => {
    expect(panelSource).toContain("machine-planning-past-date-warning");
    expect(panelSource).toContain("machine-planning-backdate-reason");
    expect(panelSource).toContain("machine-planning-backdated-badge");
    expect(panelSource).toContain("MACHINE_PLANNING_PAST_DATE_WARNING");
    expect(rmCheckSource).toContain("machinePlanningBackdateReason");
  });
});

describe("Machine planning Start Date field-error presentation", () => {
  it("formats SO floor message as DD-MM-YYYY", () => {
    expect(formatPlanningYmdDisplay("2026-08-26")).toBe("26-08-2026");
    expect(formatStartDateBeforeSoMessage("2026-08-26")).toBe(
      "Start Date cannot be earlier than the Sales Order date (26-08-2026).",
    );
  });

  it("classifies DATE_BEFORE_SO as start_date inline (not server/Retry)", () => {
    const err = new ApiRequestError(
      "Start Date cannot be earlier than the Sales Order date (2026-08-26).",
      400,
      "MACHINE_PLANNING_DATE_BEFORE_SO",
    );
    const out = classifyMachinePlanningSaveError(err, { soCreatedYmd: "2026-08-26" });
    expect(out.kind).toBe("start_date");
    expect(out.startDateMessage).toBe(
      "Start Date cannot be earlier than the Sales Order date (26-08-2026).",
    );
  });

  it("classifies other 400 planning codes as field; network as server", () => {
    expect(
      classifyMachinePlanningSaveError(
        new ApiRequestError("A Backdate Reason is required", 400, "MACHINE_PLANNING_BACKDATE_REASON_REQUIRED"),
      ).kind,
    ).toBe("field");
    expect(
      classifyMachinePlanningSaveError(new Error("Cannot reach the API at /api/sales-orders/1")).kind,
    ).toBe("server");
  });

  it("clears SO-floor error when all start dates become valid", () => {
    expect(
      runsSatisfySoStartDateFloor([{ plannedDate: "2026-08-20" }], "2026-08-26"),
    ).toBe(false);
    expect(
      runsSatisfySoStartDateFloor([{ plannedDate: "2026-08-26" }], "2026-08-26"),
    ).toBe(true);
  });

  it("RmCheck routes field validation without toast/Retry; panel shows inline Start Date error", () => {
    const persistCatch = rmCheckSource.slice(
      rmCheckSource.indexOf("async function persistMachinePlanning"),
      rmCheckSource.indexOf("async function reopenMachinePlanning"),
    );
    expect(persistCatch).toContain("classifyMachinePlanningSaveError");
    expect(persistCatch).toContain('field.kind === "start_date"');
    expect(persistCatch).toContain("setStartDateFieldError");
    expect(persistCatch).toContain("setErrorPresentation(null)");
    // toast only on server branch inside catch
    const startDateBranch = persistCatch.slice(
      persistCatch.indexOf('field.kind === "start_date"'),
      persistCatch.indexOf('field.kind === "field"'),
    );
    expect(startDateBranch).not.toContain("toast.showError");
    expect(startDateBranch).not.toContain("setErrorPresentation(presented)");
    expect(panelSource).toContain("machine-planning-start-date-error");
    expect(panelSource).toContain("startDateError");
    expect(rmCheckSource).toContain("startDateError={startDateFieldError}");
    expect(rmCheckSource).toContain("runsSatisfySoStartDateFloor");
  });
});
