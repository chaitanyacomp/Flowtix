import { describe, expect, it } from "vitest";
import { buildOperationalBlockerRows, buildOperationalSoActions } from "../../src/lib/operationalBlockers";
import { resolvePurchaseExecutionCta } from "../../src/lib/woPrepareOperationalStage";

describe("buildOperationalSoActions", () => {
  it("routes purchase/GRN pending queue to RM Control Center guided flow", () => {
    const actions = buildOperationalSoActions(
      [
        {
          materialRequirementId: 1,
          docNo: "MR-26-0001",
          salesOrderId: 10,
          salesOrderDocNo: "SO-26-0001",
          primaryFgName: "Cap",
          shortageRmLineCount: 2,
          totalShortageQty: 20800,
          operationalLabel: "Procurement pending",
          pendingPoStatus: "PO pending",
          pendingGrnStatus: "—",
          supplierPendingStatus: "—",
          nextActionKey: "OPEN_PURCHASE_PLAN",
        },
      ],
      {
        rmShortageBlocking: [],
        purchaseGrnPending: [
          {
            salesOrderId: 10,
            salesOrderDocNo: "SO-26-0001",
            customerName: "Acme",
            primaryFgName: "Cap",
            shortageRmCount: 2,
            pendingMrRefs: "MR-26-0001",
            nextActionKey: "OPEN_PURCHASE_PLAN",
            operationalLabel: "Purchase / GRN",
            procurementOperationalLabel: "PO pending",
          },
        ],
        readyForWoCreation: [],
      },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionLabel).toBe("Continue RM Resolution");
    expect(actions[0]?.actionTo).toContain("/reports/rm-shortage");
  });

  it("shows only Create Work Order when SO is ready — hides stale procurement row", () => {
    const actions = buildOperationalSoActions(
      [
        {
          materialRequirementId: 1,
          docNo: "MR-26-0001",
          salesOrderId: 10,
          salesOrderDocNo: "SO-26-0001",
          primaryFgName: "Cap",
          shortageRmLineCount: 2,
          totalShortageQty: 0,
          operationalKey: "PR_PENDING_PO",
          operationalLabel: "PO pending",
          pendingPoStatus: "No PO yet",
          pendingGrnStatus: "—",
          supplierPendingStatus: "—",
          nextActionKey: "CREATE_PO",
          totalRemainingQty: 0,
        },
      ],
      {
        rmShortageBlocking: [],
        purchaseGrnPending: [],
        readyForWoCreation: [
          {
            salesOrderId: 10,
            salesOrderDocNo: "SO-26-0001",
            customerName: "Acme",
            primaryFgName: "Cap",
            shortageRmCount: 0,
            pendingMrRefs: "",
            nextActionKey: "CREATE_WO",
            operationalLabel: "Ready for WO",
          },
        ],
      },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.variant).toBe("ready");
    expect(actions[0]?.actionLabel).toBe("Create Work Order");
    expect(actions[0]?.actionTo).toContain("salesOrderId=10");
    expect(actions[0]?.stageLabel).toBe("Ready for WO");
  });

  it("skips procurement row when operationalKey is RM_READY", () => {
    const actions = buildOperationalSoActions(
      [
        {
          materialRequirementId: 3,
          docNo: "MR-26-0003",
          salesOrderId: 12,
          salesOrderDocNo: "SO-26-0003",
          primaryFgName: null,
          shortageRmLineCount: 1,
          totalShortageQty: 0,
          operationalKey: "RM_READY",
          operationalLabel: "RM Ready",
          pendingPoStatus: "Complete",
          pendingGrnStatus: "Complete",
          supplierPendingStatus: "Complete",
          nextActionKey: "OPEN_WORKSPACE",
          totalRemainingQty: 0,
        },
      ],
      { rmShortageBlocking: [], purchaseGrnPending: [], readyForWoCreation: [] },
    );
    expect(actions).toHaveLength(0);
  });

  it("routes procurement-pending API row to RM Control Center", () => {
    const { blockers } = buildOperationalBlockerRows(
      [
        {
          materialRequirementId: 2,
          docNo: "MR-26-0002",
          salesOrderId: 11,
          salesOrderDocNo: "SO-26-0002",
          primaryFgName: null,
          shortageRmLineCount: 1,
          totalShortageQty: 100,
          operationalLabel: "Procurement pending",
          pendingPoStatus: "—",
          pendingGrnStatus: "—",
          supplierPendingStatus: "—",
          nextActionKey: "PROCUREMENT_PENDING",
        },
      ],
      { rmShortageBlocking: [], purchaseGrnPending: [], readyForWoCreation: [] },
    );
    expect(blockers[0]?.actionLabel).toBe("Continue RM Resolution");
    expect(blockers[0]?.actionTo).toContain("/reports/rm-shortage");
  });

  it("shows RM shortage blocking WO as primary operational blocker before WO creation", () => {
    const actions = buildOperationalSoActions(
      [],
      {
        rmShortageBlocking: [
          {
            salesOrderId: 4,
            salesOrderDocNo: "SO-26-0004",
            customerName: "Acme",
            primaryFgName: "Nozzle",
            shortageRmCount: 1,
            pendingMrRefs: "",
            nextActionKey: "OPEN_RM_PLANNING",
            operationalLabel: "RM shortage",
          },
        ],
        purchaseGrnPending: [],
        readyForWoCreation: [],
      },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.stageLabel).toBe("RM shortage blocking Work Order");
    expect(actions[0]?.actionLabel).toBe("Open RM Control Center");
    expect(actions[0]?.actionTo).toContain("salesOrderId=4");
    expect(actions[0]?.actionTo).toContain("onlyBlocked=true");
    expect(actions[0]?.variant).toBe("blocker");
    expect(actions[0]?.statusLine).toContain("Raise RM Requirement");
  });

  it("dedupes RM shortage and procurement rows for the same sales order", () => {
    const actions = buildOperationalSoActions(
      [
        {
          materialRequirementId: 9,
          docNo: "MR-26-0009",
          salesOrderId: 4,
          salesOrderDocNo: "SO-26-0004",
          primaryFgName: "Nozzle",
          shortageRmLineCount: 1,
          totalShortageQty: 100,
          operationalLabel: "Procurement pending",
          pendingPoStatus: "—",
          pendingGrnStatus: "—",
          supplierPendingStatus: "—",
          nextActionKey: "PROCUREMENT_PENDING",
        },
      ],
      {
        rmShortageBlocking: [
          {
            salesOrderId: 4,
            salesOrderDocNo: "SO-26-0004",
            customerName: "Acme",
            primaryFgName: "Nozzle",
            shortageRmCount: 1,
            pendingMrRefs: "",
            nextActionKey: "OPEN_RM_PLANNING",
            operationalLabel: "RM shortage",
          },
        ],
        purchaseGrnPending: [],
        readyForWoCreation: [],
      },
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.stageLabel).toBe("RM shortage blocking Work Order");
    expect(actions[0]?.actionLabel).toBe("Open RM Control Center");
  });

  it("dedupes allocation and procurement rows for the same work order", () => {
    const actions = buildOperationalSoActions(
      [
        {
          materialRequirementId: 1,
          docNo: "MR-26-0001",
          salesOrderId: 10,
          salesOrderDocNo: "SO-26-0001",
          workOrderId: 100,
          workOrderNo: "WO-26-0001",
          primaryFgName: "Cap",
          shortageRmLineCount: 1,
          totalShortageQty: 50,
          operationalLabel: "Procurement pending",
          pendingPoStatus: "PO pending",
          pendingGrnStatus: "—",
          supplierPendingStatus: "—",
          nextActionKey: "OPEN_PURCHASE_PLAN",
        },
      ],
      { rmShortageBlocking: [], purchaseGrnPending: [], readyForWoCreation: [] },
      null,
      [
        {
          workOrderId: 100,
          workOrderNo: "WO-26-0001",
          salesOrderId: 10,
          salesOrderDocNo: "SO-26-0001",
          primaryFgName: "Cap",
          operationalKey: "READY_FOR_ISSUE",
          operationalLabel: "Ready for issue",
        },
      ],
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.actionLabel).toBe("Issue RM to Production");
  });
});

describe("resolvePurchaseExecutionCta", () => {
  it("routes GRN stage to Open Purchase & GRN with open-pos focus", () => {
    const cta = resolvePurchaseExecutionCta({
      salesOrderId: 10,
      pendingPoStatus: "PO open",
      pendingGrnStatus: "Awaiting GRN",
      source: "dashboard",
    });
    expect(cta.label).toBe("Open Purchase & GRN");
    expect(cta.href).toContain("focus=open-pos");
    expect(cta.href).toContain("poStatus=OPEN");
  });
});
