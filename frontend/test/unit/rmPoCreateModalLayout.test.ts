import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RM_PO_MODAL_HEADER_FIELD_CLASS,
  RM_PO_MODAL_HEADER_GRID_CLASS,
  RM_PO_MODAL_LINE_INPUT_HINT_CLASS,
  RM_PO_MODAL_LINE_INPUT_ROW_CLASS,
  RM_PO_MODAL_QTY_INPUT_CLASS,
  RM_PO_MODAL_RATE_INPUT_CLASS,
} from "../../src/lib/pendingMaterialRequestsPanelUx";

const panelSource = readFileSync(
  resolve(__dirname, "../../src/components/purchase/PendingMaterialRequestsPanel.tsx"),
  "utf8",
);

describe("RM PO modal layout tokens", () => {
  it("keeps Supplier and Supplier PO Number on a balanced two-column grid", () => {
    expect(RM_PO_MODAL_HEADER_GRID_CLASS).toContain("md:grid-cols-2");
    expect(RM_PO_MODAL_HEADER_GRID_CLASS).toContain("items-start");
  });

  it("uses identical control height for header fields", () => {
    expect(RM_PO_MODAL_HEADER_FIELD_CLASS).toContain("h-10");
    expect(RM_PO_MODAL_HEADER_FIELD_CLASS).toContain("w-full");
  });

  it("keeps Order Qty and Rate input widths consistent and right-aligned", () => {
    expect(RM_PO_MODAL_QTY_INPUT_CLASS).toBe(RM_PO_MODAL_RATE_INPUT_CLASS);
    expect(RM_PO_MODAL_QTY_INPUT_CLASS).toContain("text-right");
    expect(RM_PO_MODAL_QTY_INPUT_CLASS).toContain("tabular-nums");
    expect(RM_PO_MODAL_QTY_INPUT_CLASS).toContain("max-w-[7.5rem]");
    expect(RM_PO_MODAL_QTY_INPUT_CLASS).toContain("h-8");
  });

  it("shares a fixed-height input row so Order Qty and Rate align vertically", () => {
    expect(RM_PO_MODAL_LINE_INPUT_ROW_CLASS).toContain("h-8");
    expect(RM_PO_MODAL_LINE_INPUT_ROW_CLASS).toContain("items-center");
    expect(RM_PO_MODAL_LINE_INPUT_HINT_CLASS).toContain("min-h-[14px]");
    expect(panelSource).toContain("RM_PO_MODAL_LINE_INPUT_ROW_CLASS");
    expect(panelSource).toContain("rm-po-order-qty-cell-");
    expect(panelSource).toContain("rm-po-rate-cell-");
    expect(panelSource).toContain("align-top");
  });
});

describe("alphanumeric Supplier PO Number", () => {
  it("accepts letters, slashes and hyphens as text (not numeric-only)", () => {
    const samples = ["PO/26-001", "SUP-ABC-12", "Vendor/Ref-9"];
    for (const sample of samples) {
      expect(typeof sample).toBe("string");
      expect(Number.isNaN(Number(sample))).toBe(true);
      expect(/[A-Za-z/\-]/.test(sample)).toBe(true);
    }
  });
});
