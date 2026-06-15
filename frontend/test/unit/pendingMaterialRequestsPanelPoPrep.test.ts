import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePendingPrPoPrepUi } from "../../src/lib/pendingMaterialRequestsPanelUx";
import { PROCUREMENT_TERMS } from "../../src/lib/procurementTerminology";
import { hasErpRole, GRN_WRITE_ROLES, PURCHASE_EXECUTION_ROLES, RM_PO_WRITE_ROLES } from "../../src/config/erpRoles";

const panelPath = resolve(__dirname, "../../src/components/purchase/PendingMaterialRequestsPanel.tsx");
const procurementPagePath = resolve(__dirname, "../../src/pages/ProcurementPlanningPage.tsx");
const rmPurchaseListPath = resolve(__dirname, "../../src/pages/rmPurchase/RmPurchaseListPage.tsx");
const rmPoDetailPath = resolve(__dirname, "../../src/pages/rmPurchase/RmPurchasePoDetailPage.tsx");
const panelSource = readFileSync(panelPath, "utf8");
const procurementPageSource = readFileSync(procurementPagePath, "utf8");
const rmPurchaseListSource = readFileSync(rmPurchaseListPath, "utf8");
const rmPoDetailSource = readFileSync(rmPoDetailPath, "utf8");

describe("pendingMaterialRequestsPanelUx", () => {
  it("Store read-only mode hides PO prep chrome and shows waiting message", () => {
    const ui = resolvePendingPrPoPrepUi(false);
    expect(ui.showCheckboxes).toBe(false);
    expect(ui.showPrepareButton).toBe(false);
    expect(ui.readOnlyMessage).toBe(PROCUREMENT_TERMS.WAITING_FOR_PURCHASE_RM_PO);
  });

  it("Purchase mode enables PO prep chrome", () => {
    const ui = resolvePendingPrPoPrepUi(true);
    expect(ui.showCheckboxes).toBe(true);
    expect(ui.showPrepareButton).toBe(true);
    expect(ui.readOnlyMessage).toBeNull();
  });
});

describe("PO ownership role gates", () => {
  it("Store cannot prepare or write PO", () => {
    expect(hasErpRole("STORE", PURCHASE_EXECUTION_ROLES)).toBe(false);
    expect(hasErpRole("STORE", RM_PO_WRITE_ROLES)).toBe(false);
  });

  it("Purchase can prepare and write PO", () => {
    expect(hasErpRole("PURCHASE", PURCHASE_EXECUTION_ROLES)).toBe(true);
    expect(hasErpRole("PURCHASE", RM_PO_WRITE_ROLES)).toBe(true);
  });

  it("Purchase cannot post GRN; Store and Admin can", () => {
    expect(hasErpRole("PURCHASE", GRN_WRITE_ROLES)).toBe(false);
    expect(hasErpRole("STORE", GRN_WRITE_ROLES)).toBe(true);
    expect(hasErpRole("ADMIN", GRN_WRITE_ROLES)).toBe(true);
  });
});

describe("PendingMaterialRequestsPanel PO prep visibility", () => {
  it("defaults canPrepareRmPo to false (Store-safe)", () => {
    expect(panelSource).toMatch(/canPrepareRmPo\s*=\s*false/);
  });

  it("gates checkboxes, footer, and modal on poPrepUi / canPrepareRmPo", () => {
    expect(panelSource).toContain("poPrepUi.showCheckboxes");
    expect(panelSource).toContain("poPrepUi.showPrepareButton");
    expect(panelSource).toContain('data-testid="pr-po-readonly-hint"');
    expect(panelSource).toContain("if (!canPrepareRmPo || !selectedLines.length || creating) return");
    expect(panelSource).toContain("{canPrepareRmPo && poOpen ? (");
  });

  it("Prepare RM PO label only renders inside showPrepareButton branch", () => {
    expect(panelSource).toContain("resolvePendingPrPoPrepUi(canPrepareRmPo)");
    const prepareIdx = panelSource.indexOf("PROCUREMENT_TERMS.PREPARE_RM_PO");
    const branchIdx = panelSource.indexOf("poPrepUi.showPrepareButton");
    expect(prepareIdx).toBeGreaterThan(-1);
    expect(branchIdx).toBeGreaterThan(-1);
    expect(prepareIdx).toBeGreaterThan(branchIdx);
  });
});

describe("Procurement Workspace PO prep wiring", () => {
  it("passes canPrepareRmPo from canExecutePurchase (Purchase/Admin only)", () => {
    expect(procurementPageSource).toContain("const canExecutePurchase = hasErpRole(user?.role, PURCHASE_EXECUTION_ROLES)");
    expect(procurementPageSource).toContain("canPrepareRmPo={canExecutePurchase}");
  });
});

describe("Purchase & GRN PO prep wiring", () => {
  it("RmPurchaseListPage passes canPrepareRmPo for Purchase/Admin only", () => {
    expect(rmPurchaseListSource).toContain("const canPrepareRmPo = hasErpRole(user?.role, PURCHASE_EXECUTION_ROLES)");
    expect(rmPurchaseListSource).toContain("<PendingMaterialRequestsPanel embedded canPrepareRmPo={canPrepareRmPo} />");
  });

  it("RmPurchasePoDetailPage gates GRN post by GRN_WRITE_ROLES and shows read-only hint for Purchase", () => {
    expect(rmPoDetailSource).toContain("const canPostGrn = hasErpRole(user?.role, GRN_WRITE_ROLES)");
    expect(rmPoDetailSource).toContain("const grnAllowed = grnReceiptPending && canPostGrn");
    expect(rmPoDetailSource).toContain("grnPendingReadOnlyForViewer");
    expect(rmPoDetailSource).toContain("PROCUREMENT_TERMS.GRN_PENDING_STORE_POSTS_RECEIPT");
    expect(rmPoDetailSource).toContain('stripTestId: "rm-po-grn-pending-readonly"');
    expect(rmPoDetailSource).toContain("grnAllowed={Boolean(grnAllowed)}");
  });

  it("RmPurchasePoDetailPage gates Edit PO by RM_PO_WRITE_ROLES separately from GRN", () => {
    expect(rmPoDetailSource).toContain("const canWritePo = hasErpRole(user?.role, RM_PO_WRITE_ROLES)");
    expect(rmPoDetailSource).toContain("const canEditPo = canWritePo && po");
    expect(rmPoDetailSource).toContain("canEditPo={Boolean(canEditPo)}");
  });
});
