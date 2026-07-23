import { describe, expect, it } from "vitest";
import {
  isRegularSoOrderType,
  regularSoPurchaseRequestAlreadyExistsMessage,
  regularSoPurchaseRequestSuccessMessage,
  shouldCreatePurchaseRequestViaRegularSoEndpoint,
} from "../../src/lib/regularSoCreatePurchaseRequest";
import { prefersProcurementWorkspaceNavigation } from "../../src/lib/rmControlCenterProcurementHandoff";
import { resolveStoreActionPrimaryPresentation } from "../../src/lib/rmControlCenterReadinessUx";

describe("regularSoCreatePurchaseRequest", () => {
  it("treats NORMAL / empty as Regular SO and rejects NO_QTY", () => {
    expect(isRegularSoOrderType("NORMAL")).toBe(true);
    expect(isRegularSoOrderType(null)).toBe(true);
    expect(isRegularSoOrderType("NO_QTY")).toBe(false);
  });

  it("routes Regular SO Create PR through ensure-MR endpoint using salesOrderId", () => {
    expect(
      shouldCreatePurchaseRequestViaRegularSoEndpoint({
        salesOrderId: 258,
        orderType: "NORMAL",
        materialRequirementId: null,
      }),
    ).toBe(true);
    expect(
      shouldCreatePurchaseRequestViaRegularSoEndpoint({
        salesOrderId: 258,
        orderType: "NORMAL",
        materialRequirementId: 99,
      }),
    ).toBe(true);
  });

  it("does not route MPRS / monthly-plan or NO_QTY through Regular SO endpoint", () => {
    expect(
      shouldCreatePurchaseRequestViaRegularSoEndpoint({
        salesOrderId: 258,
        orderType: "NO_QTY",
      }),
    ).toBe(false);
    expect(
      shouldCreatePurchaseRequestViaRegularSoEndpoint({
        salesOrderId: 10,
        orderType: "NORMAL",
        prefersProcurementWorkspace: true,
      }),
    ).toBe(false);
    expect(
      prefersProcurementWorkspaceNavigation(
        { materialRequirementId: 1, sourceType: "MONTHLY_PLAN", docNo: "MR-1", status: "APPROVED" },
        { planningDrivenProcurement: true, woCaseMrId: null },
      ),
    ).toBe(true);
  });

  it("formats success message with business SO number", () => {
    expect(regularSoPurchaseRequestSuccessMessage("SO-26-0001", 258)).toBe(
      "Purchase Request created for SO-26-0001.",
    );
    expect(regularSoPurchaseRequestAlreadyExistsMessage("SO-26-0001", 258)).toBe(
      "Purchase Request already exists for SO-26-0001.",
    );
  });
});

describe("RM Control Center action panel — Awaiting PR", () => {
  it("shows Create Purchase Request as the single primary CTA while Awaiting PR", () => {
    const awaiting = resolveStoreActionPrimaryPresentation({
      storeAction: {
        key: "AWAITING_PR",
        label: "Create Purchase Request",
        description: "Store creates the Purchase Request for this SO shortage.",
      },
      issueHref: "",
      grnHref: "/rm-po-grn",
      procurementWorkspaceHref: "/procurement-planning?demandPool=REGULAR_SO",
      prepareWoHref: "/work-orders/prepare?salesOrderId=258",
    });
    expect(awaiting).toEqual({
      kind: "create_pr",
      label: "Create Purchase Request",
      description: "Store creates the Purchase Request for this SO shortage.",
    });

    const legacyContinue = resolveStoreActionPrimaryPresentation({
      storeAction: {
        key: "CONTINUE_PROCUREMENT",
        label: "Complete procurement, then create Work Order",
      },
      issueHref: "",
      grnHref: "/rm-po-grn",
      procurementWorkspaceHref: "/procurement-planning?demandPool=REGULAR_SO",
      hideDuplicateProcurementAction: true,
    });
    expect(legacyContinue.kind).toBe("none");
  });

  it("shows Create Work Order only when RM is ready (CREATE_WO)", () => {
    const ready = resolveStoreActionPrimaryPresentation({
      storeAction: {
        key: "CREATE_WO",
        label: "Create Work Order",
        description: "RM received in Store after GRN.",
      },
      issueHref: "",
      grnHref: "/rm-po-grn",
      prepareWoHref: "/work-orders/prepare?salesOrderId=258",
    });
    expect(ready).toEqual({
      kind: "link",
      label: "Create Work Order",
      href: "/work-orders/prepare?salesOrderId=258",
      description: "RM received in Store after GRN.",
    });
  });
});
