import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeRmPoCommercialTotals,
  resolveRmPoDeliverToBlock,
  resolveRmPoTaxDisplay,
  resolveRmPoVendorBlock,
  supplierDocumentHasErpOnlyContent,
  formatProcurementSignatoryForLine,
  VENDOR_ADDRESS_MISSING_WARNING,
} from "../../src/lib/rmPoSupplierDocument";
import type { RmPoRow } from "../../src/pages/rmPurchase/rmPurchaseShared";

const supplierDocPath = resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx");
const documentViewPath = resolve(__dirname, "../../src/components/rmPurchase/RmPoDocumentView.tsx");
const supplierDocSource = readFileSync(supplierDocPath, "utf8");
const documentViewSource = readFileSync(documentViewPath, "utf8");

function basePo(partial?: Partial<RmPoRow>): RmPoRow {
  return {
    id: 101,
    supplierId: 1,
    supplier: { id: 1, name: "Acme Metals", contact: "Ravi", email: "buy@acme.in", address: "Reg Addr Line" },
    supplierLocation: {
      id: 10,
      label: "Mumbai Depot",
      address: "Plot 12, MIDC\nAndheri East",
      city: "Mumbai",
      contactPerson: "Suresh",
      phone: "9876543210",
    },
    status: "PENDING",
    lines: [
      {
        id: 1,
        itemId: 5,
        qty: "10",
        rate: "100",
        unit: "Kg",
        hsn: "7208",
        gstRate: "18",
        amount: "1000",
        item: { id: 5, itemName: "MS Sheet", unit: "Kg" },
      },
    ],
    grns: [],
    resolvedSupplierCommercial: {
      snapshotState: "FROZEN",
      registeredSupplier: {
        name: "Acme Metals Pvt Ltd",
        address: "Registered Office, Pune",
        gstin: "27AAAAA0000A1Z5",
        stateName: "Maharashtra",
        stateCode: "27",
      },
      supplyLocation: {
        id: 10,
        label: "Mumbai Depot",
        address: "Plot 12, MIDC\nAndheri East",
        gstin: "27BBBBB0000B1Z5",
        stateName: "Maharashtra",
        stateCode: "27",
      },
    },
    ...partial,
  };
}

describe("rmPoSupplierDocument helpers", () => {
  it("resolves vendor block with supply location address from snapshot", () => {
    const vendor = resolveRmPoVendorBlock(basePo());
    expect(vendor.name).toBe("Acme Metals Pvt Ltd");
    expect(vendor.supplyLabel).toBe("Mumbai Depot");
    expect(vendor.addressLines.join(" ")).toContain("Plot 12");
    expect(vendor.addressLines).toContain("Mumbai");
    expect(vendor.gstin).toBe("27BBBBB0000B1Z5");
    expect(vendor.contact).toBe("Suresh");
    expect(vendor.phone).toBe("9876543210");
    expect(vendor.email).toBe("buy@acme.in");
  });

  it("vendor block has empty address when not maintained", () => {
    const vendor = resolveRmPoVendorBlock(
      basePo({
        supplier: { id: 1, name: "No Addr Co" },
        supplierLocation: null,
        resolvedSupplierCommercial: {
          registeredSupplier: { name: "No Addr Co", address: null },
          supplyLocation: { label: "Registered Office", address: null },
        },
      }),
    );
    expect(vendor.addressLines).toHaveLength(0);
  });

  it("splits tax as CGST/SGST for LOCAL gst mode", () => {
    const totals = computeRmPoCommercialTotals(basePo().lines);
    const tax = resolveRmPoTaxDisplay(
      basePo({ resolvedSupplierCommercial: { gstMode: "LOCAL" } }),
      totals,
    );
    expect(tax.mode).toBe("split");
    if (tax.mode === "split") {
      expect(tax.cgst).toBe(90);
      expect(tax.sgst).toBe(90);
    }
  });

  it("shows IGST for INTERSTATE gst mode", () => {
    const totals = computeRmPoCommercialTotals(basePo().lines);
    const tax = resolveRmPoTaxDisplay(
      basePo({ resolvedSupplierCommercial: { gstMode: "INTERSTATE" } }),
      totals,
    );
    expect(tax.mode).toBe("igst");
    if (tax.mode === "igst") expect(tax.igst).toBe(180);
  });

  it("falls back to aggregate tax when gst mode unknown", () => {
    const totals = computeRmPoCommercialTotals(basePo().lines);
    const tax = resolveRmPoTaxDisplay(basePo({ resolvedSupplierCommercial: { gstMode: "UNKNOWN" } }), totals);
    expect(tax.mode).toBe("aggregate");
  });

  it("resolves deliver-to from company profile", () => {
    const block = resolveRmPoDeliverToBlock({
      companyName: "Flowtix Factory",
      companyAddressLine1: "Unit 4, Industrial Estate",
      companyAddressLine2: null,
      companyCity: "Pune",
      companyStateName: "Maharashtra",
      companyStateCode: "27",
      companyPincode: "411001",
      companyGstin: "27CCCC0000C1Z5",
      companyMobile: null,
      companyPhone: null,
      companyEmail: null,
      companySignatoryName: "Director",
      hasLogo: false,
    });
    expect(block.name).toBe("Flowtix Factory");
    expect(block.addressLines[0]).toBe("Unit 4, Industrial Estate");
    expect(block.addressLines[1]).toContain("Pune");
    expect(block.gstin).toBe("27CCCC0000C1Z5");
  });

  it("computes commercial totals", () => {
    const totals = computeRmPoCommercialTotals(basePo().lines);
    expect(totals.subtotal).toBe(1000);
    expect(totals.tax).toBe(180);
    expect(totals.grandTotal).toBe(1180);
  });
});

describe("RmPoSupplierDocument P4D-C", () => {
  it("exports supplier document component", async () => {
    const mod = await import("../../src/components/rmPurchase/RmPoSupplierDocument");
    expect(typeof mod.RmPoSupplierDocument).toBe("function");
  });

  it("renders vendor and deliver-to blocks with addresses", () => {
    expect(supplierDocSource).toContain('testId="rm-po-vendor-block"');
    expect(supplierDocSource).toContain('testId="rm-po-deliver-to-block"');
    expect(supplierDocSource).toContain("resolveRmPoVendorBlock");
    expect(supplierDocSource).toContain("resolveRmPoDeliverToBlock");
  });

  it("includes professional line table with Sr No column", () => {
    expect(supplierDocSource).toContain("Sr");
    expect(supplierDocSource).toContain('data-testid="rm-po-supplier-lines-table"');
  });

  it("has signatory footer without ERP commercial summary", () => {
    expect(supplierDocSource).toContain('data-testid="rm-po-supplier-signatory"');
    expect(supplierDocSource).not.toContain("RmPoCommercialSummary");
    expect(supplierDocumentHasErpOnlyContent(supplierDocSource)).toBe(false);
  });

  it("hides status badge in print via screen-only class", () => {
    expect(supplierDocSource).toContain("rm-po-screen-only");
    expect(supplierDocSource).toContain('data-testid="rm-po-status-badge"');
  });

  it("document view uses dedicated supplier document", () => {
    expect(documentViewSource).toContain("RmPoSupplierDocument");
    expect(documentViewSource).not.toContain("RmPoCommercialSummary");
    expect(documentViewSource).toContain("companyProfile");
  });

  it("internal trace section preserved in full view", () => {
    expect(documentViewSource).toContain('data-testid="rm-po-internal-trace-section"');
    expect(documentViewSource).toContain("supplierCopyMode");
    expect(documentViewSource).toContain("TraceChainInline");
  });

  it("print and workflow actions preserved", () => {
    expect(documentViewSource).toContain("printRmPoSupplierSection");
    expect(documentViewSource).toContain("rm-po-create-grn-btn");
    expect(documentViewSource).toContain("rm-po-edit-btn");
    expect(documentViewSource).toContain("rm-po-cancel-btn");
  });

  it("shows supplier address warning when address missing", () => {
    expect(VENDOR_ADDRESS_MISSING_WARNING).toBe(
      "Supplier address not maintained in supplier master",
    );
    expect(supplierDocSource).toContain("VENDOR_ADDRESS_MISSING_WARNING");
    expect(supplierDocSource).toContain("rm-po-vendor-address");
    expect(supplierDocSource).not.toContain("Address not recorded");
  });

  it("vendor party hides empty field labels via PartyField", () => {
    expect(supplierDocSource).toContain("PartyField");
    expect(supplierDocSource).toContain('label="Contact"');
    expect(supplierDocSource).toContain('label="Phone"');
    expect(supplierDocSource).toContain('label="Email"');
  });

  it("renders purchase order number label and tax breakdown rows", () => {
    expect(supplierDocSource).toContain("Purchase Order No.");
    expect(supplierDocSource).toContain("TaxTotalRows");
    expect(supplierDocSource).toContain("rm-po-total-cgst");
    expect(supplierDocSource).toContain("rm-po-total-igst");
  });

  it("P5F signatory matches GRN style without personal name", () => {
    expect(formatProcurementSignatoryForLine("Chaitanya Computer Solutions")).toBe(
      "For Chaitanya Computer Solutions",
    );
    expect(supplierDocSource).toContain("formatProcurementSignatoryForLine");
    expect(supplierDocSource).toContain('data-testid="rm-po-signatory-for-line"');
    expect(supplierDocSource).toContain("Authorized Signatory");
    expect(supplierDocSource).not.toContain("signatoryName");
  });

  it("P5F hides vendor address warning in print", () => {
    expect(supplierDocSource).toContain("rm-po-screen-only");
    expect(supplierDocSource).toContain("VENDOR_ADDRESS_MISSING_WARNING");
  });

  it("remarks use boxed section and print-only footer", () => {
    expect(supplierDocSource).toContain('data-testid="rm-po-supplier-remarks"');
    expect(supplierDocSource).toContain("rm-po-supplier-print-footer");
    expect(supplierDocSource).toContain("system generated purchase order");
    expect(supplierDocSource).toContain("rm-po-print-only");
  });

  it("P5F hard fix uses shared inner wrapper without print px stripping", () => {
    expect(supplierDocSource).toContain('data-testid="procurement-doc-grid"');
    expect(supplierDocSource).toContain("procurement-doc-print-inner");
    expect(supplierDocSource).not.toContain("print:px-0");
    expect(supplierDocSource).toContain("print:px-2.5");
  });

  it("P5G commercial grid aligns sections, party blocks, totals and signatory", () => {
    expect(supplierDocSource).toContain("procurement-doc-grid");
    expect(supplierDocSource).toContain("procurement-doc-party-grid");
    expect(supplierDocSource).toContain("procurement-doc-table-section");
    expect(supplierDocSource).toContain("procurement-doc-trailing-section");
    expect(supplierDocSource).toContain("procurement-doc-trailing-block");
    expect(supplierDocSource).not.toContain("max-w-xs");
    expect(supplierDocSource).not.toContain("max-w-sm");
  });
});
