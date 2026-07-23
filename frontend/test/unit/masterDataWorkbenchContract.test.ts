import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Master Data Workbench — page chrome contract", () => {
  const pages = [
    { file: "src/pages/CustomersPage.tsx", title: "Customers", back: true, search: "Search customers by name" },
    { file: "src/pages/SuppliersPage.tsx", title: "Suppliers", back: true, search: "Search suppliers by name" },
    { file: "src/pages/ItemsPage.tsx", title: "Items", back: true, search: "Search items by name or code" },
  ];

  for (const p of pages) {
    it(`${p.file} uses shared workbench header and search`, () => {
      const src = read(p.file);
      expect(src).toContain("MasterListHeader");
      expect(src).toContain(`title="${p.title}"`);
      expect(src).toContain("MasterSearchInput");
      expect(src).toContain(p.search);
      expect(src).toContain("useMasterListSelection");
      expect(src).toContain("MasterSelectAllCheckbox");
      expect(src).toContain("MasterBulkActionBar");
      expect(src).toContain("postMasterBulkMutation");
      expect(src).toContain("MasterListPagination");
      // Back to Masters via MasterListHeader → ERPBackNavigation → MASTERS_LANDING_PATH
      expect(src).toMatch(/MasterListHeader/);
    });
  }

  it("MasterListHeader navigates explicitly to /masters", () => {
    const wb = read("src/components/masters/MasterListWorkbench.tsx");
    expect(wb).toContain('label="Back to Masters"');
    expect(wb).toContain("MASTERS_LANDING_PATH");
    expect(wb).toContain('data-testid="master-back-to-masters"');
    const q = read("src/lib/masterListQuery.ts");
    expect(q).toContain('export const MASTERS_LANDING_PATH = "/masters"');
  });

  it("Masters landing page exists and lists core masters", () => {
    const src = read("src/pages/MastersLandingPage.tsx");
    expect(src).toContain('data-testid="masters-landing-title"');
    expect(src).toContain('to: "/customers"');
    expect(src).toContain('to: "/suppliers"');
    expect(src).toContain('to: "/items"');
  });

  it("App registers /masters route", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/masters"');
    expect(app).toContain("MastersLandingPage");
  });

  it("selection is page-scoped and clears on query context change", () => {
    const hook = read("src/hooks/useMasterListWorkbench.ts");
    expect(hook).toContain("useMasterListSelection");
    expect(hook).toContain("queryContextKey");
    expect(hook).toContain("bulk.clear()");
    expect(hook).toMatch(/SEARCH_DEBOUNCE_MS\s*=\s*300/);
    const wb = read("src/components/masters/MasterListWorkbench.tsx");
    expect(wb).toContain("(current page)");
    expect(wb).toContain('aria-label="Select all rows on this page"');
  });

  it("workbench pages bind selection to pageIds and queryContextKey", () => {
    for (const file of ["src/pages/CustomersPage.tsx", "src/pages/SuppliersPage.tsx", "src/pages/ItemsPage.tsx"]) {
      const src = read(file);
      expect(src).toMatch(/useMasterListSelection\(\s*pageIds\s*,\s*queryContextKey\s*\)/);
    }
  });

  it("bulk delete confirmation states protected-record consequence", () => {
    const modal = read("src/components/masters/BulkDeleteConfirmModal.tsx");
    expect(modal).toMatch(/Permanently delete/i);
    expect(modal).toMatch(/blocked/i);
  });

  it("Customers and Suppliers share equivalent column labels", () => {
    const c = read("src/pages/CustomersPage.tsx");
    const s = read("src/pages/SuppliersPage.tsx");
    for (const label of ["Name", "Contact", "State", "GSTIN", "Status", "Actions"]) {
      expect(c).toContain(label);
      expect(s).toContain(label);
    }
    expect(c).toContain("Delivery locations");
    expect(s).toContain("Supply locations");
  });

  it("search Escape and clear affordances exist", () => {
    const wb = read("src/components/masters/MasterListWorkbench.tsx");
    expect(wb).toContain('e.key === "Escape"');
    expect(wb).toContain('aria-label="Clear search"');
    expect(wb).toContain("data-testid=\"master-search-clear\"");
  });

  it("bulk actions use double-submit guard pattern on customers/suppliers/items", () => {
    for (const file of ["src/pages/CustomersPage.tsx", "src/pages/SuppliersPage.tsx", "src/pages/ItemsPage.tsx"]) {
      const src = read(file);
      expect(src).toContain("bulkInFlight");
      expect(src).toMatch(/if \(bulkInFlight\.current\) return/);
    }
  });
});
