import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ShiftsPage form header action layout", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/ShiftsPage.tsx"), "utf8");

  it("keeps Create/Update visually in the header while fields scroll independently", () => {
    expect(source).toContain('data-testid="shifts-workspace"');
    expect(source).toContain('data-testid="shift-form-card"');
    expect(source).toContain('data-testid="shift-form-header"');
    expect(source).toContain('data-testid="shift-form-actions"');
    expect(source).toContain('data-testid="shift-form-fields"');
    expect(source).toContain('data-testid="shift-form-submit"');
    expect(source).toContain("lg:h-[calc(100dvh-13.5rem)]");
    expect(source).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(source).toMatch(/shift-form-actions[\s\S]*?row-start-1/);
    expect(source).toMatch(/shift-form-fields[\s\S]*?row-start-2/);
    expect(source).toMatch(/shift-form-fields[\s\S]*?overflow-y-auto/);
    expect(source).not.toContain("sticky bottom-0");
  });

  it("keeps list scroll and pagination independent", () => {
    expect(source).toContain('data-testid="shifts-list-panel"');
    expect(source).toContain('data-testid="shifts-list-scroll"');
    expect(source).toContain('data-testid="shifts-list-pagination"');
    expect(source).toContain("MasterListPagination");
  });
});
