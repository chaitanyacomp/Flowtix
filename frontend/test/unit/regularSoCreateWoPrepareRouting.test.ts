import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WO_PLAN_PREP_ROLES, WO_WRITE_ROLES } from "../../src/config/erpRoles";
import { pendingActionWorkspaceListHref } from "../../src/lib/pendingActionsWorkBuckets";
import { resolveStoreActionPrimaryPresentation } from "../../src/lib/rmControlCenterReadinessUx";
import { noQtyExecutionEntryHref } from "../../src/lib/noQtyRsActionLabels";
import { woPreparePrepareHref } from "../../src/lib/woPrepareOperationalStage";
import { computeStoreDashboardKpiMetrics } from "../../src/lib/storeDashboardMetrics";

const rmccPage = readFileSync(
  resolve(__dirname, "../../src/pages/MaterialAvailabilityControlCenterPage.tsx"),
  "utf8",
);
const rmCheckPage = readFileSync(resolve(__dirname, "../../src/pages/RmCheckPage.tsx"), "utf8");
const appSource = readFileSync(resolve(__dirname, "../../src/App.tsx"), "utf8");

describe("REGULAR_SO Create Work Order → Prepare WO routing", () => {
  it("builds refresh-safe Prepare WO deep link with SO id and regular_so source", () => {
    const href = woPreparePrepareHref(258, { source: "regular_so", from: "rm-control-center" });
    expect(href).toBe(
      "/work-orders/prepare?salesOrderId=258&source=regular_so&from=rm-control-center",
    );
    expect(href).not.toContain("/dashboard");
  });

  it("RM Control Center CREATE_WO primary CTA opens Prepare WO (not Dashboard)", () => {
    const ready = resolveStoreActionPrimaryPresentation({
      storeAction: { key: "CREATE_WO", label: "Create Work Order" },
      issueHref: "",
      grnHref: "/rm-po-grn",
      prepareWoHref: woPreparePrepareHref(258, { source: "regular_so", from: "rm-control-center" }),
    });
    expect(ready.kind).toBe("link");
    if (ready.kind === "link") {
      expect(ready.href).toContain("/work-orders/prepare");
      expect(ready.href).toContain("salesOrderId=258");
      expect(ready.href).toContain("source=regular_so");
      expect(ready.href).not.toContain("/dashboard");
    }
    expect(rmccPage).toContain('from: "rm-control-center"');
    expect(rmccPage).toContain("woPreparePrepareHref");
  });

  it("Pending Action list open keeps salesOrderId on Prepare WO (survives refresh / multi-open)", () => {
    const listHref = pendingActionWorkspaceListHref(
      "/work-orders/prepare?salesOrderId=258&source=regular_so&from=pending-actions",
    );
    expect(listHref).toContain("/work-orders/prepare");
    expect(listHref).toContain("salesOrderId=258");
    expect(listHref).toContain("source=regular_so");
    expect(listHref).not.toContain("/dashboard");
  });

  it("Store and Admin may open Prepare WO; Purchase is excluded", () => {
    expect(WO_PLAN_PREP_ROLES).toContain("STORE");
    expect(WO_PLAN_PREP_ROLES).toContain("ADMIN");
    expect(WO_WRITE_ROLES).toContain("STORE");
    expect(WO_PLAN_PREP_ROLES).not.toContain("PURCHASE");
    expect(WO_PLAN_PREP_ROLES).not.toContain("QA");
    expect(appSource).toContain("WO_PLAN_PREP_ROLES");
    expect(appSource).toContain('path="/work-orders/prepare"');
  });

  it("Prepare WO auto-selects SO from salesOrderId and runs RM check (eligible FG lines)", () => {
    expect(rmCheckPage).toContain('searchParams.get("salesOrderId")');
    expect(rmCheckPage).toContain("didAutoRunRef");
    expect(rmCheckPage).toContain("runCheck()");
    expect(rmCheckPage).toContain("isRegularSoRow");
  });

  it("NO_QTY Prepare WO entry remains on execution workspace (not Regular prepare)", () => {
    const noQtyHref = noQtyExecutionEntryHref({
      salesOrderId: 99,
      guidedCycleId: 7,
      role: "STORE",
      source: "rm_control_center",
    });
    expect(noQtyHref).not.toContain("/work-orders/prepare");
    expect(rmccPage).toContain("noQtyExecutionEntryHref");
    expect(rmccPage).toContain("isNoQtyOrder");
  });

  it("Ready for WO KPI includes Regular SO RM-ready cases alongside NO_QTY PLACE_WO", () => {
    const kpis = computeStoreDashboardKpiMetrics({
      inboxRows: [
        {
          so: { salesOrderId: 1, docNo: "SO-NQ-1", customerName: "A" },
          rsStatus: "LOCKED",
          lockedPeriodKey: "2026-07",
          flowState: null,
          guidedCycleId: 1,
          cycleNo: 1,
          executionRegisterEnabled: true,
          actionNeededKey: "PLACE_WO",
          rsBalanceQty: 100,
        },
      ],
      materialIssuePendingCount: 0,
      rmccSummary: { rmReceivedCreateWoCount: 1, queueCount: 1 },
      procurementWorkspace: null,
    });
    expect(kpis.readyForWo).toBe(2);
  });
});
