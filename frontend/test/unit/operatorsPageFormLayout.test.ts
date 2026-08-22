import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("OperatorsPage form header action layout", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/OperatorsPage.tsx"), "utf8");

  it("keeps Create/Update visually in the header while fields scroll independently", () => {
    expect(source).toContain('data-testid="operators-workspace"');
    expect(source).toContain('data-testid="operator-form-card"');
    expect(source).toContain('data-testid="operator-form-header"');
    expect(source).toContain('data-testid="operator-form-actions"');
    expect(source).toContain('data-testid="operator-form-fields"');
    expect(source).toContain('data-testid="operator-form-submit"');
    expect(source).toContain("lg:h-[calc(100dvh-13.5rem)]");
    expect(source).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(source).toMatch(/operator-form-actions[\s\S]*?row-start-1/);
    expect(source).toMatch(/operator-form-fields[\s\S]*?row-start-2/);
    expect(source).toMatch(/operator-form-fields[\s\S]*?overflow-y-auto/);
    expect(source).not.toContain("sticky bottom-0");
  });

  it("keeps list scroll and pagination independent", () => {
    expect(source).toContain('data-testid="operators-list-panel"');
    expect(source).toContain('data-testid="operators-list-scroll"');
    expect(source).toContain('data-testid="operators-list-pagination"');
    expect(source).toContain("MasterListPagination");
  });
});
