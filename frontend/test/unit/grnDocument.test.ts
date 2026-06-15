import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatGrnBillingStatusRow,
  formatGrnQty,
  formatGrnSignatoryForLine,
  grnBillStatusDisplay,
  grnBillStatusSummaryLabel,
  grnReceiptStatusDisplay,
  groupGrnTraceLines,
  procurementCaseTraceChain,
  resolveGrnBillPresentation,
  resolveGrnCompanyHeader,
  resolveGrnVendorAddressLines,
  stockPostingStatusLabel,
} from "../../src/lib/grnDocument";
import { buildGrnDetailHref } from "../../src/lib/grnDocumentActions";

const viewPath = resolve(__dirname, "../../src/components/rmPurchase/GrnDocumentView.tsx");
const pagePath = resolve(__dirname, "../../src/pages/rmPurchase/GrnDetailPage.tsx");
const appPath = resolve(__dirname, "../../src/App.tsx");
const stylePath = resolve(__dirname, "../../src/style.css");
const viewSource = readFileSync(viewPath, "utf8");
const pageSource = readFileSync(pagePath, "utf8");
const appSource = readFileSync(appPath, "utf8");
const styleSource = readFileSync(stylePath, "utf8");

describe("grnDocument helpers", () => {
  it("formats bill status labels", () => {
    expect(grnBillStatusDisplay("NOT_BILLED")).toBe("Not billed");
    expect(grnBillStatusDisplay("PARTIALLY_BILLED")).toBe("Partially billed");
    expect(grnBillStatusDisplay("BILLED")).toBe("Billed");
  });

  it("formats receipt status", () => {
    expect(grnReceiptStatusDisplay(false)).toBe("Active");
    expect(grnReceiptStatusDisplay(true)).toBe("Reversed");
  });

  it("formats stock posting status", () => {
    expect(stockPostingStatusLabel("POSTED")).toBe("Posted");
    expect(stockPostingStatusLabel("REVERSED")).toBe("Reversed");
  });

  it("formats qty with unit", () => {
    expect(formatGrnQty(12.5, "KG")).toBe("12.500 KG");
  });

  it("buildGrnDetailHref includes returnTo when provided", () => {
    expect(buildGrnDetailHref(42)).toBe("/grn/42");
    expect(buildGrnDetailHref(42, "/rm-po-grn/10")).toBe("/grn/42?returnTo=%2Frm-po-grn%2F10");
  });

  it("print helper uses grn-document-print body class", async () => {
    const mod = await import("../../src/lib/grnDocumentActions");
    expect(mod.printGrnDocumentSection).toBeTypeOf("function");
    const src = readFileSync(resolve(__dirname, "../../src/lib/grnDocumentActions.ts"), "utf8");
    expect(src).toContain("grn-document-print");
  });

  it("summary bill status labels for document polish", () => {
    expect(grnBillStatusSummaryLabel("NOT_BILLED")).toBe("Not Billed");
    expect(grnBillStatusSummaryLabel("PARTIALLY_BILLED")).toBe("Partially Billed");
    expect(grnBillStatusSummaryLabel("BILLED")).toBe("Fully Billed");
  });

  it("resolveGrnCompanyHeader uses company profile fields", () => {
    const header = resolveGrnCompanyHeader({
      companyName: "CHAITANYA COMPUTER SOLUTIONS",
      companyAddressLine1: "Line 1",
      companyAddressLine2: null,
      companyCity: "Pune",
      companyStateName: "Maharashtra",
      companyStateCode: "27",
      companyPincode: "411001",
      companyGstin: "27AAAAA0000A1Z5",
      companySignatoryName: "Director",
      hasLogo: true,
    });
    expect(header.companyName).toBe("CHAITANYA COMPUTER SOLUTIONS");
    expect(header.isConfigured).toBe(true);
    expect(header.addressLines.some((l) => l.includes("Pune"))).toBe(true);
    expect(header.gstin).toBe("27AAAAA0000A1Z5");
  });

  it("resolveGrnBillPresentation shows summary and hides uniform line clutter", () => {
    const summary = resolveGrnBillPresentation(
      { headerBillingStatus: "NOT_BILLED", documentBillStatus: "NOT_BILLED", bills: [] },
      [
        { billStatus: "NOT_BILLED", item: { itemName: "HDPE" }, purchaseBillLines: [] },
        { billStatus: "NOT_BILLED", item: { itemName: "Powder" }, purchaseBillLines: [] },
      ] as never,
    );
    expect(summary.statusLabel).toBe("Not Billed");
    expect(summary.showLineBreakdown).toBe(false);
  });

  it("resolveGrnBillPresentation shows line breakdown when statuses differ", () => {
    const summary = resolveGrnBillPresentation(
      { headerBillingStatus: "PARTIALLY_BILLED", documentBillStatus: "PARTIALLY_BILLED", bills: [] },
      [
        { billStatus: "BILLED", item: { itemName: "HDPE" }, purchaseBillLines: [{ billNo: "PB-101" }] },
        { billStatus: "NOT_BILLED", item: { itemName: "Powder" }, purchaseBillLines: [] },
      ] as never,
    );
    expect(summary.showLineBreakdown).toBe(true);
    expect(summary.lineBreakdown).toHaveLength(2);
  });

  it("groupGrnTraceLines merges identical chains", () => {
    const groups = groupGrnTraceLines([
      {
        id: 1,
        item: { itemName: "HDPE" },
        demandSources: [{ mr: { docNo: "MR-26-0002" }, pr: { docNo: "PR-26-0002" } }],
        traceChain: ["Monthly Plan Rev 3", "MR-26-0002"],
      },
      {
        id: 2,
        item: { itemName: "Powder" },
        demandSources: [{ mr: { docNo: "MR-26-0002" }, pr: { docNo: "PR-26-0002" } }],
        traceChain: ["Monthly Plan Rev 3", "MR-26-0002"],
      },
    ] as never);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemNames).toEqual(["HDPE", "Powder"]);
    expect(groups[0].mrDocNo).toBe("MR-26-0002");
  });

  it("groupGrnTraceLines merges same procurement case when per-line trace suffix differs", () => {
    const demandSources = [
      {
        demandSourceType: "MONTHLY_PLAN",
        monthlyPlan: { label: "June Plan 1", periodKey: "2026-06" },
        mr: { materialRequirementId: 1, docNo: "MR-26-0001" },
        pr: { purchaseRequestId: 1, docNo: "PR-26-0001" },
      },
    ];
    const groups = groupGrnTraceLines([
      {
        id: 1,
        item: { itemName: "PP" },
        demandSources,
        traceChain: ["June Plan 1", "MR-26-0001", "PR-26-0001", "RMPO-112", "GRN-112", "StockTransaction IN"],
      },
      {
        id: 2,
        item: { itemName: "Powder" },
        demandSources: [
          {
            ...demandSources[0],
            monthlyPlanRevision: 1,
            monthlyPlan: { periodKey: "2026-06", sourceRevision: 1 },
          },
        ],
        traceChain: ["Monthly Plan Rev 1", "MR-26-0001", "PR-26-0001", "RMPO-112", "GRN-112", "StockTransaction IN"],
      },
    ] as never);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemNames).toEqual(["PP", "Powder"]);
    expect(groups[0].traceChain).toEqual(["June Plan 1", "MR-26-0001", "PR-26-0001", "RMPO-112"]);
  });

  it("groupGrnTraceLines keeps Regular SO cases separate by sales order", () => {
    const groups = groupGrnTraceLines([
      {
        id: 1,
        item: { itemName: "RM-A" },
        demandSources: [
          {
            demandSourceType: "SALES_ORDER",
            salesOrder: { id: 10, docNo: "SO-26-0001" },
            mr: { docNo: "MR-26-0010" },
            pr: { docNo: "PR-26-0010" },
          },
        ],
        traceChain: ["SO-26-0001", "MR-26-0010", "PR-26-0010", "RMPO-200"],
      },
      {
        id: 2,
        item: { itemName: "RM-B" },
        demandSources: [
          {
            demandSourceType: "SALES_ORDER",
            salesOrder: { id: 10, docNo: "SO-26-0001" },
            mr: { docNo: "MR-26-0010" },
            pr: { docNo: "PR-26-0010" },
          },
        ],
        traceChain: ["SO-26-0001", "MR-26-0010", "PR-26-0010", "RMPO-200", "GRN-201"],
      },
    ] as never);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemNames).toEqual(["RM-A", "RM-B"]);
    expect(groups[0].soDocNo).toBe("SO-26-0001");
    expect(groups[0].traceChain).toEqual(["SO-26-0001", "MR-26-0010", "PR-26-0010", "RMPO-200"]);
  });

  it("procurementCaseTraceChain strips GRN and stock suffixes", () => {
    expect(
      procurementCaseTraceChain([
        "June Plan 1",
        "MR-26-0001",
        "PR-26-0001",
        "RMPO-112",
        "GRN-112",
        "StockTransaction IN",
      ]),
    ).toEqual(["June Plan 1", "MR-26-0001", "PR-26-0001", "RMPO-112"]);
  });

  it("resolveGrnVendorAddressLines prefers supply location address", () => {
    const lines = resolveGrnVendorAddressLines(
      { address: "Supplier HQ" } as never,
      { address: "Branch A\nCity" } as never,
    );
    expect(lines).toEqual(["Branch A", "City"]);
  });
});

describe("GrnDocumentView P5B", () => {
  it("exports document component", async () => {
    const mod = await import("../../src/components/rmPurchase/GrnDocumentView");
    expect(typeof mod.GrnDocumentView).toBe("function");
  });

  it("renders header and item table", () => {
    expect(viewSource).toContain('data-testid="grn-document-header"');
    expect(viewSource).toContain('data-testid="grn-lines-table"');
    expect(viewSource).toContain("Goods Receipt Note");
  });

  it("renders stock posting summary", () => {
    expect(viewSource).toContain('data-testid="grn-stock-summary"');
    expect(viewSource).toContain("Stock Posting Summary");
  });

  it("renders purchase bill status", () => {
    expect(viewSource).toContain('data-testid="grn-bill-status"');
    expect(viewSource).toContain("Purchase Bill Status");
  });

  it("renders reversal section when reversed", () => {
    expect(viewSource).toContain('data-testid="grn-reversal-section"');
    expect(viewSource).toContain("grn.isReversed");
  });

  it("renders internal traceability separately", () => {
    expect(viewSource).toContain('data-testid="grn-internal-trace-section"');
    expect(viewSource).toContain("Internal procurement traceability");
  });

  it("has print and action bar controls", () => {
    expect(viewSource).toContain('data-testid="grn-print-btn"');
    expect(viewSource).toContain('data-testid="grn-back-po-btn"');
    expect(viewSource).toContain('data-testid="grn-reverse-btn"');
    expect(viewSource).toContain("printGrnDocumentSection");
    expect(viewSource).toContain('id="grn-document-printable"');
  });
});

describe("GrnDocumentView P5C polish", () => {
  it("shows supplier address warning when address missing", () => {
    expect(viewSource).toContain("VENDOR_ADDRESS_MISSING_WARNING");
    expect(viewSource).toContain('data-testid="grn-vendor-address-warning"');
  });

  it("uses improved item table column labels", () => {
    expect(viewSource).toContain("Previously Received");
    expect(viewSource).toContain("Received Now");
    expect(viewSource).toContain("Total Received");
    expect(viewSource).toContain("Balance Qty");
  });

  it("renders professional bill status summary", () => {
    expect(viewSource).toContain('data-testid="grn-bill-status-summary"');
    expect(viewSource).toContain("resolveGrnBillPresentation");
    expect(viewSource).not.toContain("lines.map((ln) =>");
  });

  it("groups traceability chains", () => {
    expect(viewSource).toContain("groupGrnTraceLines");
    expect(viewSource).toContain('data-testid="grn-trace-groups"');
    expect(viewSource).toContain("Items:");
  });

  it("company header comes from resolveGrnCompanyHeader", () => {
    expect(viewSource).toContain("resolveGrnCompanyHeader");
    expect(viewSource).toContain('data-testid="grn-company-name"');
    expect(viewSource).toContain("/api/company-profile/logo/file");
  });

  it("header meta block includes key identifiers", () => {
    expect(viewSource).toContain('data-testid="grn-header-meta"');
    expect(viewSource).toContain("GRN No.");
    expect(viewSource).toContain("Invoice No.");
  });

  it("stock posting table uses aligned columns", () => {
    expect(viewSource).toContain("Posted Qty");
    expect(viewSource).toContain("grn-doc-table");
  });
});

describe("GrnDocumentView P5D professionalization", () => {
  it("document title is primary hierarchy element", () => {
    expect(viewSource).toContain('data-testid="grn-document-title-block"');
    expect(viewSource).toContain("grn-document-title");
    const titleIdx = viewSource.indexOf("grn-document-title");
    const companyIdx = viewSource.indexOf('data-testid="grn-company-name"');
    expect(titleIdx).toBeGreaterThan(-1);
    expect(companyIdx).toBeGreaterThan(titleIdx);
  });

  it("hides vendor address warning in print via grn-screen-only", () => {
    expect(viewSource).toContain("grn-screen-only");
    expect(viewSource).toContain('data-testid="grn-vendor-address-warning"');
  });

  it("uses print-only simplified item columns", () => {
    expect(viewSource).toContain("grn-col-screen-only");
    expect(viewSource).toContain("grn-col-print-only");
    expect(viewSource).toContain("Received Qty");
  });

  it("hides stock posting summary in print", () => {
    expect(viewSource).toContain('data-testid="grn-stock-summary"');
    expect(viewSource).toContain("grn-screen-only");
  });

  it("uses compact billing row for print", () => {
    expect(viewSource).toContain('data-testid="grn-bill-status-print"');
    expect(viewSource).toContain("formatGrnBillingStatusRow");
    expect(viewSource).toContain("grn-print-only");
  });

  it("redesigns signature block without person name", () => {
    expect(viewSource).toContain('data-testid="grn-signatory-for-line"');
    expect(viewSource).toContain("formatGrnSignatoryForLine");
    expect(viewSource).toContain("Authorized Signatory");
    expect(viewSource).not.toContain("signatoryName");
  });

  it("optional fields render only when present", () => {
    expect(viewSource).toContain("supplierInvoiceDate");
    expect(viewSource).toContain("receivedBy");
    expect(viewSource).toContain("remarks");
  });
});

describe("grnDocument P5D helpers", () => {
  it("formatGrnBillingStatusRow is compact", () => {
    expect(formatGrnBillingStatusRow("Not Billed")).toBe("Billing Status : Not Billed");
  });

  it("formatGrnSignatoryForLine prefixes company name", () => {
    expect(formatGrnSignatoryForLine("Chaitanya Computer Solutions")).toBe(
      "For Chaitanya Computer Solutions",
    );
  });
});

describe("GrnDocumentView P5E print quality", () => {
  it("signatory allows wrapping and avoids nowrap clipping", () => {
    expect(viewSource).toContain("grn-signatory-block");
    expect(viewSource).toContain("grn-signatory-company");
    expect(viewSource).not.toContain("whitespace-nowrap");
  });

  it("print CSS uses readable font sizes and balanced margins", () => {
    expect(styleSource).toContain("font-size: 19px !important");
    expect(styleSource).toContain("font-size: 11.5px !important");
    expect(styleSource).toContain("margin: 12mm 14mm");
  });

  it("print CSS improves table borders and qty alignment", () => {
    expect(styleSource).toContain(".grn-qty-cell");
    expect(styleSource).toContain("border: 1px solid #cbd5e1 !important");
    expect(styleSource).toContain("background: #f1f5f9 !important");
  });

  it("print CSS fixes signatory overflow", () => {
    expect(styleSource).toContain(".grn-signatory-company");
    expect(styleSource).toContain("white-space: normal !important");
    expect(styleSource).toContain("overflow-wrap: break-word");
  });

  it("still hides internal sections in print", () => {
    expect(styleSource).toContain("body.grn-document-print .grn-screen-only");
    expect(styleSource).toContain("body.grn-document-print .grn-internal-section");
  });
});

describe("Procurement documents P5F polish", () => {
  it("PO and GRN use shared signatory helper", async () => {
    const poMod = await import("../../src/lib/rmPoSupplierDocument");
    const grnMod = await import("../../src/lib/grnDocument");
    expect(poMod.formatProcurementSignatoryForLine("Acme")).toBe("For Acme");
    expect(grnMod.formatGrnSignatoryForLine("Acme")).toBe("For Acme");
  });

  it("GRN stock summary has reduced screen weight", () => {
    expect(viewSource).toContain('data-testid="grn-stock-summary"');
    expect(viewSource).toContain("text-slate-400");
    expect(viewSource).toContain("text-xs text-slate-700");
  });

  it("PO party panels and doc table classes exist", () => {
    const poSource = readFileSync(
      resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx"),
      "utf8",
    );
    expect(poSource).toContain("rm-po-party-panel");
    expect(poSource).toContain("rm-po-doc-table");
  });
});

describe("Procurement documents P5F print layout hard fix", () => {
  it("PO and GRN share printable inner wrapper with document gutter", () => {
    const poSource = readFileSync(
      resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx"),
      "utf8",
    );
    expect(poSource).toContain('data-testid="procurement-doc-grid"');
    expect(poSource).toContain("procurement-doc-print-inner");
    expect(viewSource).toContain('data-testid="procurement-doc-grid"');
    expect(styleSource).toContain(".procurement-doc-print-inner");
    expect(styleSource).toContain("max-width: 182mm !important");
  });

  it("main sections do not strip horizontal padding in print", () => {
    const poSource = readFileSync(
      resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx"),
      "utf8",
    );
    expect(poSource).not.toContain("print:px-0");
    expect(viewSource).not.toContain("print:px-0");
    expect(poSource).toContain("print:px-2.5");
    expect(viewSource).toContain("print:px-2.5");
  });

  it("print CSS uses balanced page margins for border-safe output", () => {
    expect(styleSource).toContain("margin: 12mm 14mm");
  });
});

describe("Procurement documents P5G commercial document grid", () => {
  it("PO and GRN use shared document grid container and section classes", () => {
    const poSource = readFileSync(
      resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx"),
      "utf8",
    );
    expect(poSource).toContain("procurement-doc-grid");
    expect(poSource).toContain("procurement-doc-party-grid");
    expect(poSource).toContain("procurement-doc-table-section");
    expect(poSource).toContain("procurement-doc-trailing-block");
    expect(viewSource).toContain("procurement-doc-party-grid");
    expect(viewSource).toContain("procurement-doc-trailing-section");
    expect(styleSource).toContain(".procurement-doc-grid");
    expect(styleSource).toContain("width: 85%");
    expect(styleSource).toContain("max-width: 85%");
  });

  it("party panels align in grid and trailing blocks share width", () => {
    const poSource = readFileSync(
      resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx"),
      "utf8",
    );
    expect(poSource).toContain("min-w-0");
    expect(poSource).toContain('data-testid="rm-po-supplier-footer"');
    expect(poSource).toContain('data-testid="rm-po-supplier-signatory"');
    expect(poSource).toMatch(/procurement-doc-trailing-block[\s\S]*rm-po-signatory-block/);
    expect(styleSource).toContain(".procurement-doc-party-grid");
    expect(styleSource).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styleSource).toContain(".procurement-doc-trailing-block");
  });
});

describe("Procurement documents P5H commercial proportions", () => {
  it("uses 85% document width and shared typography scale", () => {
    const poSource = readFileSync(
      resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx"),
      "utf8",
    );
    expect(styleSource).toContain("width: 85%");
    expect(styleSource).toContain(".procurement-doc-title");
    expect(styleSource).toContain("font-size: 19px");
    expect(styleSource).toContain(".procurement-doc-totals");
    expect(styleSource).toContain(".procurement-doc-grand-total");
    expect(poSource).toContain("procurement-commercial-doc");
    expect(viewSource).toContain("procurement-commercial-doc");
  });

  it("prevents qty and location wrapping and tightens trailing sections", () => {
    const poSource = readFileSync(
      resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx"),
      "utf8",
    );
    expect(poSource).toContain("procurement-doc-nowrap");
    expect(viewSource).toContain("procurement-doc-nowrap");
    expect(styleSource).toContain(".procurement-doc-nowrap");
    expect(styleSource).toContain("align-items: start");
    expect(poSource).toContain("mb-3 mt-4");
    expect(viewSource).toContain("Print / Save as PDF");
  });
});

describe("Procurement documents P5I print scale consistency", () => {
  it("screen keeps 85% width while print uses full printable mm width", () => {
    expect(styleSource).toContain("width: 85%");
    expect(styleSource).toContain("max-width: 85%");
    expect(styleSource).toContain("max-width: 182mm !important");
    expect(styleSource).toContain("width: 100% !important");
    expect(styleSource).not.toMatch(/max-width:\s*85%\s*!important[\s\S]*rm-po-supplier-section-printable[\s\S]*procurement-doc-grid/);
  });

  it("print tables and sections span the print content column", () => {
    expect(styleSource).toContain(
      "body.rm-po-supplier-print #rm-po-supplier-section-printable .procurement-doc-table-section table",
    );
    expect(styleSource).toContain(
      "body.grn-document-print #grn-document-printable .grn-doc-table",
    );
    expect(styleSource).toContain("margin: 12mm 14mm");
  });

  it("does not apply document transform scale in print rules", () => {
    const printBlock = styleSource.slice(
      styleSource.indexOf("body.rm-po-supplier-print"),
      styleSource.indexOf("/** Workflow table action cells"),
    );
    expect(printBlock).not.toContain("transform: scale");
  });
});

describe("GrnDetailPage P5B", () => {
  it("loads GRN detail API", () => {
    expect(pageSource).toContain("/api/purchase/grns/");
    expect(pageSource).toContain("/api/company-profile");
  });

  it("registers /grn/:grnId route", () => {
    expect(appSource).toContain('path="/grn/:grnId"');
    expect(appSource).toContain("GrnDetailPage");
  });
});

describe("GrnDocumentView P8F-A9 supplier invoice role gate", () => {
  it("GrnDetailPage passes purchase bill draft permission to document view", () => {
    expect(pageSource).toContain("PURCHASE_BILL_DRAFT_ROLES");
    expect(pageSource).toContain("canCreatePurchaseBill = hasErpRole(user?.role, PURCHASE_BILL_DRAFT_ROLES)");
    expect(pageSource).toContain("canCreatePurchaseBill={canCreatePurchaseBill}");
  });

  it("gates supplier invoice actions on canCreatePurchaseBill", () => {
    expect(viewSource).toContain("canCreatePurchaseBill");
    expect(viewSource).toContain("!grn.isReversed && canCreatePurchaseBill");
    expect(viewSource).toContain('data-testid="grn-create-supplier-invoice-btn"');
    expect(viewSource).toContain('data-testid="grn-open-supplier-invoice-btn"');
  });

  it("shows read-only supplier invoice pending message for non-Purchase viewers", () => {
    expect(viewSource).toContain('data-testid="grn-supplier-invoice-pending-readonly"');
    expect(viewSource).toContain("PROCUREMENT_TERMS.SUPPLIER_INVOICE_PENDING_PURCHASE_POSTS");
    expect(viewSource).toContain("!canCreatePurchaseBill && !primaryBill");
  });

  it("renders trace groups once with item list under shared chain", () => {
    expect(viewSource).toContain('data-testid="grn-trace-group-items"');
    expect(viewSource).toContain("group.itemNames.map");
  });
});

describe("grnDocument P8F-A9 role constants", () => {
  it("Store cannot draft purchase bills", async () => {
    const { hasErpRole, PURCHASE_BILL_DRAFT_ROLES } = await import("../../src/config/erpRoles");
    expect(hasErpRole("STORE", PURCHASE_BILL_DRAFT_ROLES)).toBe(false);
    expect(hasErpRole("PURCHASE", PURCHASE_BILL_DRAFT_ROLES)).toBe(true);
    expect(hasErpRole("ADMIN", PURCHASE_BILL_DRAFT_ROLES)).toBe(true);
  });
});
