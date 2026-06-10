import { describe, expect, it } from "vitest";
import {
  buildPurchaseBillDetailHref,
  buildPurchaseBillNewHref,
  parseGrnDisplayNo,
  purchaseBillIdByBillNo,
  resolvePrimaryPurchaseBill,
  resolvePrimaryPurchaseBillForGrn,
  resolvePrimaryPurchaseBillFromSummary,
  tallyExportLabel,
} from "../../src/lib/procurementNavigation";
import {
  connectivityGrnDocumentHref,
  type ConnectivityReportRow,
} from "../../src/lib/procurementConnectivityReportUx";

describe("procurementNavigation", () => {
  it("parseGrnDisplayNo extracts numeric id", () => {
    expect(parseGrnDisplayNo("GRN-101")).toBe(101);
    expect(parseGrnDisplayNo("grn-42")).toBe(42);
    expect(parseGrnDisplayNo("invalid")).toBeNull();
  });

  it("buildPurchaseBillDetailHref targets invoice page", () => {
    expect(buildPurchaseBillDetailHref(55)).toBe("/purchase-bills/55");
  });

  it("buildPurchaseBillNewHref pre-fills supplier and return path", () => {
    const href = buildPurchaseBillNewHref({ supplierId: 9, returnTo: "/grn/12" });
    expect(href).toContain("/purchase-bills/new?");
    expect(href).toContain("supplierId=9");
    expect(href).toContain("returnTo=%2Fgrn%2F12");
  });

  it("resolvePrimaryPurchaseBill prefers finalized bill", () => {
    const primary = resolvePrimaryPurchaseBill([
      { purchaseBillId: 1, purchaseBill: { billNo: "D-1", status: "DRAFT" } },
      { purchaseBillId: 2, purchaseBill: { billNo: "F-2", status: "FINALIZED" } },
    ]);
    expect(primary?.id).toBe(2);
    expect(primary?.billNo).toBe("F-2");
  });

  it("resolvePrimaryPurchaseBillForGrn falls back to line bill refs", () => {
    const primary = resolvePrimaryPurchaseBillForGrn([], [
      { purchaseBillId: 7, billNo: "INV-7", status: "FINALIZED" },
    ]);
    expect(primary?.id).toBe(7);
  });

  it("resolvePrimaryPurchaseBillFromSummary picks finalized summary bill", () => {
    const primary = resolvePrimaryPurchaseBillFromSummary([
      { id: 3, billNo: "A", status: "DRAFT" },
      { id: 4, billNo: "B", status: "FINALIZED" },
    ]);
    expect(primary?.id).toBe(4);
  });

  it("purchaseBillIdByBillNo maps bill number to id", () => {
    const id = purchaseBillIdByBillNo(
      [
        { id: 10, billNo: "INV-1" },
        { id: 11, billNo: "INV-2" },
      ],
      "INV-2",
    );
    expect(id).toBe(11);
  });

  it("tallyExportLabel reflects export flag", () => {
    expect(tallyExportLabel(true)).toBe("Exported");
    expect(tallyExportLabel(false)).toBe("Not exported");
  });
});

describe("connectivityGrnDocumentHref", () => {
  it("builds GRN document href from active GRN number", () => {
    const row = {
      grnSummary: { label: "GRN-88", activeGrnNos: ["GRN-88"], reversedGrnNos: [] },
    } as ConnectivityReportRow;
    expect(connectivityGrnDocumentHref(row)).toBe("/grn/88?returnTo=%2Freports%2Frm-procurement-connectivity");
  });
});
