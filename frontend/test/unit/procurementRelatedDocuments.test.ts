import { describe, expect, it } from "vitest";
import {
  buildGrnRelatedDocuments,
  buildRmPoRelatedDocuments,
  buildRmPoPageReturnHref,
} from "../../src/lib/procurementRelatedDocuments";
import type { GrnDocumentPayload } from "../../src/lib/grnDocument";
import type { RmPoRow } from "../../src/pages/rmPurchase/rmPurchaseShared";

function samplePo(partial?: Partial<RmPoRow>): RmPoRow {
  return {
    id: 129,
    supplierId: 1,
    supplier: { id: 1, name: "Arihant" },
    status: "COMPLETED",
    supplierPoNumber: "SUP-001",
    lines: [{ id: 1, itemId: 1, qty: "10", item: { id: 1, itemName: "RM", itemCode: "RM1", itemType: "RM" } }],
    grns: [{ id: 130, reversedAt: null, lines: [{ rmPoLineId: 1, receivedQty: "10" }] }],
    ...partial,
  } as RmPoRow;
}

describe("procurementRelatedDocuments", () => {
  it("builds RM PO page return href", () => {
    expect(buildRmPoPageReturnHref(129)).toBe("/rm-po-grn/129?from=procurement-nav");
  });

  it("builds related documents for RM PO with current PO and linked GRN", () => {
    const docs = buildRmPoRelatedDocuments(samplePo(), null);
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ kind: "PURCHASE_ORDER", displayNo: "RMPO-129", status: "current" });
    expect(docs[1]).toMatchObject({
      kind: "GOODS_RECEIPT",
      displayNo: "GRN-130",
      status: "available",
      href: "/grn/130?returnTo=%2Frm-po-grn%2F129%3Ffrom%3Dprocurement-nav",
    });
  });

  it("shows pending goods receipt when no GRN exists", () => {
    const docs = buildRmPoRelatedDocuments(samplePo({ grns: [] }), null);
    expect(docs[1]).toMatchObject({ kind: "GOODS_RECEIPT", displayNo: "—", status: "pending" });
    expect(docs[1]?.href).toBeUndefined();
  });

  it("builds related documents for GRN with linked PO", () => {
    const detail = {
      grn: { id: 130, displayNo: "GRN-130", date: "2026-07-04", supplierInvoiceNo: "INV-1", isReversed: false },
      po: { id: 129, displayNo: "RMPO-129", status: "COMPLETED" },
      supplier: { id: 1, name: "Arihant" },
      supplyLocation: null,
      lines: [],
      stockPostingSummary: { postedLineCount: 1, totalLineCount: 1 },
      purchaseBillSummary: { bills: [] },
      trace: null,
    } as unknown as GrnDocumentPayload;

    const docs = buildGrnRelatedDocuments(detail, "/rm-po-grn/129");
    expect(docs[0]).toMatchObject({
      kind: "PURCHASE_ORDER",
      displayNo: "RMPO-129",
      href: "/rm-po-grn/129",
      status: "available",
    });
    expect(docs[1]).toMatchObject({ kind: "GOODS_RECEIPT", displayNo: "GRN-130", status: "current" });
  });
});
