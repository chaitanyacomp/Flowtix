/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatQuoteQtyDisplay,
  validateCreateFromQuotationLineQtys,
} from "../../src/lib/createSoFromQuotationQty";

const enquiriesPageSrc = readFileSync(resolve(__dirname, "../../src/pages/EnquiriesPage.tsx"), "utf8");
const salesOrdersPageSrc = readFileSync(resolve(__dirname, "../../src/pages/SalesOrdersPage.tsx"), "utf8");
const salesOrdersRouteSrc = readFileSync(
  resolve(__dirname, "../../../backend/src/routes/salesOrders.js"),
  "utf8",
);
const enquiriesRouteSrc = readFileSync(resolve(__dirname, "../../../backend/src/routes/enquiries.js"), "utf8");
const cleanupSrc = readFileSync(
  resolve(__dirname, "../../../backend/src/routes/adminDatabaseCleanup.js"),
  "utf8",
);

describe("createSoFromQuotationQty", () => {
  it("blocks 20000 against quoted 15000 and accepts equal/lower", () => {
    const over = validateCreateFromQuotationLineQtys([
      { itemId: 1, quotedQty: 15000, customerPoQty: "20000" },
    ]);
    expect(over).toHaveLength(1);
    expect(over[0].message).toContain("20000");
    expect(over[0].message).toContain("15000");

    expect(
      validateCreateFromQuotationLineQtys([
        { itemId: 1, quotedQty: 15000, customerPoQty: "15000" },
      ]),
    ).toHaveLength(0);
    expect(
      validateCreateFromQuotationLineQtys([{ itemId: 1, quotedQty: 15000, customerPoQty: "10000" }]),
    ).toHaveLength(0);
  });

  it("formats quoted qty for display", () => {
    expect(formatQuoteQtyDisplay(15000)).toBe("15000");
    expect(formatQuoteQtyDisplay("12.5")).toBe("12.5");
  });
});

describe("Enquiries history UI contracts", () => {
  it("requests history/active scopes and exposes Active/All scope control", () => {
    expect(enquiriesPageSrc).toContain('"/api/enquiries?scope=active"');
    expect(enquiriesPageSrc).toContain('"/api/enquiries?scope=history"');
    expect(enquiriesPageSrc).toContain('data-testid="enquiries-list-scope"');
    expect(enquiriesPageSrc).toContain('data-testid="enquiries-scope-active"');
    expect(enquiriesPageSrc).toContain('data-testid="enquiries-scope-history"');
    expect(enquiriesRouteSrc).toContain("parseEnquiryListScope");
    expect(enquiriesRouteSrc).toContain("enquiryListWhereForScope");
  });
});

describe("Create-from-quotation qty UI contracts", () => {
  it("shows Quoted Qty / Max allowed and blocks over-quote submit", () => {
    expect(salesOrdersPageSrc).toContain("Quoted Qty");
    expect(salesOrdersPageSrc).toContain("Max allowed");
    expect(salesOrdersPageSrc).toContain("validateCreateFromQuotationLineQtys");
    expect(salesOrdersPageSrc).toContain("createFromQuoteQtyBlocked");
    expect(salesOrdersPageSrc).toContain('data-testid="create-so-from-quotation-lines"');
    expect(salesOrdersPageSrc).toContain("new independent");
    expect(salesOrdersRouteSrc).toContain("assertFromQuotationCustomerPoQuantities");
    expect(salesOrdersRouteSrc).toContain("restoreEnquiryQuotedAfterLinkedSoDeleted");
    expect(salesOrdersRouteSrc).toContain("AuditAction.DELETE");
  });
});

describe("Cleanup retained-enquiry compensation", () => {
  it("restores orphan CLOSED when NO_QTY reset retains quotations", () => {
    expect(cleanupSrc).toContain("restoreOrphanClosedEnquiriesForRetainedApprovedQuotations");
    expect(cleanupSrc).toContain("enquiryRestoredToQuoted");
  });
});
