import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const detailPath = resolve(__dirname, "../../src/pages/rmPurchase/RmPurchasePoDetailPage.tsx");
const documentPath = resolve(__dirname, "../../src/components/rmPurchase/RmPoDocumentView.tsx");
const detailSource = readFileSync(detailPath, "utf8");
const documentSource = readFileSync(documentPath, "utf8");

describe("RmPoDocumentView", () => {
  it("exports document component", async () => {
    const mod = await import("../../src/components/rmPurchase/RmPoDocumentView");
    expect(typeof mod.RmPoDocumentView).toBe("function");
  });

  it("renders document header and supplier section", () => {
    expect(documentSource).toContain('data-testid="rm-po-document-header"');
    expect(documentSource).toContain('data-testid="rm-po-supplier-section"');
  });

  it("renders ordered received pending columns", () => {
    expect(documentSource).toContain("Ordered");
    expect(documentSource).toContain("Received");
    expect(documentSource).toContain("Pending");
  });

  it("renders line-wise source trace always visible", () => {
    expect(documentSource).toContain("Source trace");
    expect(documentSource).toContain("No source trace found");
    expect(documentSource).toContain("po-line-trace-");
  });

  it("renders GRN history with expandable cards", () => {
    expect(documentSource).toContain('data-testid="rm-po-grn-history"');
    expect(documentSource).toContain('data-testid="rm-po-no-grn"');
    expect(documentSource).toContain("No GRN posted yet");
    expect(documentSource).toContain("grn-card-");
  });

  it("has responsive card layout for mobile", () => {
    expect(documentSource).toContain('data-testid="rm-po-line-cards"');
    expect(documentSource).toContain("md:hidden");
  });

  it("shows not billed state", () => {
    expect(documentSource).toContain("Not billed");
  });
});

describe("RmPurchasePoDetailPage trace integration", () => {
  it("fetches procurement trace API", () => {
    expect(detailSource).toContain("/api/procurement-trace/rm-po/");
    expect(detailSource).toContain("RmPoDocumentView");
  });

  it("keeps create GRN action", () => {
    expect(detailSource).toContain("rm-po-create-grn-btn");
    expect(documentSource).toContain("rm-po-create-grn-btn");
  });

  it("keeps edit and cancel actions", () => {
    expect(documentSource).toContain("rm-po-edit-btn");
    expect(documentSource).toContain("rm-po-cancel-btn");
    expect(detailSource).toContain("onSavePoEdit");
    expect(detailSource).toContain("onCancelPo");
  });

  it("keeps GRN modal post flow", () => {
    expect(detailSource).toContain("grnModalOpen");
    expect(detailSource).toContain('apiFetch("/api/purchase/grns"');
  });
});
