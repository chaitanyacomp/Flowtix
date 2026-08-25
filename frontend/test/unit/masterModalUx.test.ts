/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampModalDragOffset,
  isErpModalDragHandleTarget,
  isErpModalDragIgnoreTarget,
  readErpModalDragEnabled,
  ERP_MODAL_DRAG_HANDLE_ATTR,
  ERP_MODAL_DRAG_MEDIA_QUERY,
} from "../../src/lib/erpModalDrag";

const customersSrc = readFileSync(resolve(__dirname, "../../src/pages/CustomersPage.tsx"), "utf8");
const suppliersSrc = readFileSync(resolve(__dirname, "../../src/pages/SuppliersPage.tsx"), "utf8");
const itemsSrc = readFileSync(resolve(__dirname, "../../src/pages/ItemsPage.tsx"), "utf8");
const customerFormSrc = readFileSync(resolve(__dirname, "../../src/components/erp/CustomerMasterForm.tsx"), "utf8");
const supplierFormSrc = readFileSync(resolve(__dirname, "../../src/components/erp/SupplierMasterForm.tsx"), "utf8");
const partyModalSrc = readFileSync(resolve(__dirname, "../../src/components/erp/partyMasterUi.tsx"), "utf8");
const erpModalSrc = readFileSync(resolve(__dirname, "../../src/components/erp/ErpModal.tsx"), "utf8");
const erpModalFrameSrc = readFileSync(resolve(__dirname, "../../src/components/erp/ErpModalFrame.tsx"), "utf8");
const styleCss = readFileSync(resolve(__dirname, "../../src/style.css"), "utf8");

describe("erpModalDrag helpers", () => {
  it("ignores interactive targets for drag start", () => {
    const handle = {
      closest(selector: string) {
        if (selector.includes(ERP_MODAL_DRAG_HANDLE_ATTR)) return this;
        return null;
      },
    };
    const buttonOnHandle = {
      closest(selector: string) {
        if (selector.split(",").some((s) => s.trim() === "button")) return this;
        if (selector.includes(ERP_MODAL_DRAG_HANDLE_ATTR)) return handle;
        return null;
      },
    };
    expect(isErpModalDragIgnoreTarget(null)).toBe(true);
    expect(isErpModalDragHandleTarget(null)).toBe(false);
    expect(isErpModalDragIgnoreTarget(buttonOnHandle as unknown as EventTarget)).toBe(true);
    expect(isErpModalDragHandleTarget(buttonOnHandle as unknown as EventTarget)).toBe(false);
    expect(isErpModalDragIgnoreTarget(handle as unknown as EventTarget)).toBe(false);
    expect(isErpModalDragHandleTarget(handle as unknown as EventTarget)).toBe(true);
  });

  it("clamps drag offset within viewport margins", () => {
    const start = { x: 0, y: 0 };
    const rect = { left: 100, top: 80, width: 400, height: 300 };
    const viewport = { width: 1000, height: 700 };
    expect(clampModalDragOffset(-200, -200, start, rect, viewport, 8)).toEqual({ x: -92, y: -72 });
    expect(clampModalDragOffset(900, 900, start, rect, viewport, 8)).toEqual({ x: 492, y: 312 });
    expect(clampModalDragOffset(10, 20, start, rect, viewport, 8)).toEqual({ x: 10, y: 20 });
  });

  it("enables drag only on desktop media query", () => {
    expect(ERP_MODAL_DRAG_MEDIA_QUERY).toContain("768px");
    expect(readErpModalDragEnabled(() => ({ matches: true }))).toBe(true);
    expect(readErpModalDragEnabled(() => ({ matches: false }))).toBe(false);
  });
});

describe("shared ErpModalFrame sticky shell", () => {
  it("defines sticky header, scroll body with bottom padding, and sticky footer", () => {
    expect(erpModalFrameSrc).toContain("ErpModalFrame");
    expect(erpModalFrameSrc).toContain("ErpModalFrameBody");
    expect(erpModalFrameSrc).toContain("ErpModalFrameFooter");
    expect(erpModalFrameSrc).toContain('data-testid="erp-modal-frame"');
    expect(erpModalFrameSrc).toContain('data-testid="erp-modal-frame-body"');
    expect(erpModalFrameSrc).toContain('data-testid="erp-modal-frame-footer"');
    expect(erpModalFrameSrc).toContain('aria-label="Close"');
    expect(erpModalFrameSrc).toContain("data-erp-modal-drag-handle");
    expect(erpModalFrameSrc).toContain("forwardRef");

    expect(styleCss).toContain(".erp-modal-frame");
    expect(styleCss).toContain(".erp-modal-frame__header");
    expect(styleCss).toContain(".erp-modal-frame__body");
    expect(styleCss).toContain(".erp-modal-frame__footer");
    expect(styleCss).toMatch(/erp-modal-frame__body[\s\S]*?pb-6/);
    expect(styleCss).toMatch(/erp-modal-frame__body[\s\S]*?overflow-y-auto/);
    expect(styleCss).toMatch(/erp-modal-frame__footer[\s\S]*?shrink-0/);
  });
});

describe("Customer / Supplier / Item master modal UX", () => {
  it("removes duplicate empty-state Add CTAs; keeps PageHeader Add", () => {
    expect(customersSrc).toContain('data-testid="master-add-customer"');
    expect(customersSrc).toContain("MasterEmptyState");
    expect(customersSrc).not.toMatch(/MasterEmptyState[\s\S]*?action=\{addBtn\}/);

    expect(suppliersSrc).toContain('data-testid="master-add-supplier"');
    expect(suppliersSrc).toContain("MasterEmptyState");
    expect(suppliersSrc).not.toMatch(/MasterEmptyState[\s\S]*?action=\{addBtn\}/);

    expect(itemsSrc).toContain("AddItemTypeMenu");
    expect(itemsSrc).toContain("MasterEmptyState");
    expect(itemsSrc).not.toMatch(/MasterEmptyState[\s\S]*?action=\{addActions\}/);
  });

  it("exposes an accessible top-right Close button on Add/Edit modals", () => {
    expect(partyModalSrc).toContain('closeButtonTestId="party-master-modal-close"');
    expect(partyModalSrc).toContain("ErpModalFrame");
    expect(erpModalFrameSrc).toContain('aria-label="Close"');
    expect(erpModalFrameSrc).toContain("closeButtonTestId");
    expect(itemsSrc).toContain('closeButtonTestId="item-master-modal-close"');
    expect(itemsSrc).toContain("ErpModalFrame");
  });

  it("uses sticky body/footer layout for Customer, Supplier, and Item forms", () => {
    expect(customerFormSrc).toContain("ErpModalFrameBody");
    expect(customerFormSrc).toContain("ErpModalFrameFooter");
    expect(customerFormSrc).toContain("PartyMasterFormFooter");
    expect(supplierFormSrc).toContain("ErpModalFrameBody");
    expect(supplierFormSrc).toContain("ErpModalFrameFooter");
    expect(supplierFormSrc).toContain("PartyMasterFormFooter");
    expect(itemsSrc).toContain("ErpModalFrameBody");
    expect(itemsSrc).toContain("ErpModalFrameFooter");
    expect(itemsSrc).toMatch(/ErpModalFrameFooter[\s\S]*?Cancel/);
    expect(itemsSrc).toMatch(/ErpModalFrameFooter[\s\S]*?(Save|Create)/);
    expect(itemsSrc).toContain("ref={itemFormScrollRef}");
  });

  it("routes Escape, overlay, Cancel, and Close through the same safe close handler", () => {
    expect(customersSrc).toContain("requestCloseForm");
    expect(customersSrc).toContain("confirmLeaveIfDirty");
    expect(customersSrc).toMatch(/PartyMasterModal[\s\S]*onClose=\{requestCloseForm\}/);
    expect(customersSrc).toMatch(/onCancel=\{requestCloseForm\}/);

    expect(suppliersSrc).toContain("requestCloseForm");
    expect(suppliersSrc).toMatch(/PartyMasterModal[\s\S]*onClose=\{requestCloseForm\}/);
    expect(suppliersSrc).toMatch(/onCancel=\{requestCloseForm\}/);

    expect(itemsSrc).toContain("requestCloseForm");
    expect(itemsSrc).toMatch(/ErpModal onClose=\{requestCloseForm\}/);
    expect(itemsSrc).toMatch(/onClick=\{requestCloseForm\}/);
    expect(itemsSrc).toMatch(/onClick=\{requestCloseForm\}[\s\S]*Cancel|Cancel[\s\S]*requestCloseForm/);

    expect(partyModalSrc).toContain("closeOnBackdropClick");
    expect(itemsSrc).toContain("closeOnBackdropClick");
    expect(erpModalSrc).toContain("closeOnBackdropClick");
    expect(erpModalSrc).toContain("registerErpModal");
  });

  it("opts into desktop dragging without enabling it for all ErpModals", () => {
    expect(erpModalSrc).toContain("draggable = false");
    expect(erpModalSrc).toContain("data-erp-modal-drag-handle");
    expect(partyModalSrc).toContain("draggable");
    expect(erpModalFrameSrc).toContain('data-erp-modal-drag-handle');
    expect(itemsSrc).toContain("draggable");
    expect(itemsSrc).toContain("ErpModalFrame");
    expect(erpModalSrc).toContain("setOffset({ x: 0, y: 0 })");
    expect(erpModalSrc).toContain('matchMedia("(min-width: 768px)")');
  });

  it("keeps create and edit modal titles and save wiring intact", () => {
    expect(customersSrc).toContain("Edit customer");
    expect(customersSrc).toContain("Add customer");
    expect(customersSrc).toContain("CustomerMasterForm");
    expect(customersSrc).toContain("editingId");

    expect(suppliersSrc).toContain("Edit supplier");
    expect(suppliersSrc).toContain("Add supplier");
    expect(suppliersSrc).toContain("SupplierMasterForm");
    expect(suppliersSrc).toContain("editingId");

    expect(itemsSrc).toContain("Edit Item");
    expect(itemsSrc).toContain("Add Item —");
    expect(itemsSrc).toContain("editingId");
    expect(itemsSrc).toContain("onSubmit");
    expect(itemsSrc).toContain("Quick Fill Defaults");
  });
});
