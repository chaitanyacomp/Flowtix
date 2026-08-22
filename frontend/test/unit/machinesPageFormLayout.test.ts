import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("MachinesPage form header action layout", () => {
  const source = readFileSync(resolve(__dirname, "../../src/pages/MachinesPage.tsx"), "utf8");

  it("keeps Create/Update visually in the header while fields scroll independently", () => {
    expect(source).toContain('data-testid="machines-workspace"');
    expect(source).toContain('data-testid="machine-form-card"');
    expect(source).toContain('data-testid="machine-form-header"');
    expect(source).toContain('data-testid="machine-form-actions"');
    expect(source).toContain('data-testid="machine-form-fields"');
    expect(source).toContain('data-testid="machine-form-submit"');

    expect(source).toContain("lg:h-[calc(100dvh-13.5rem)]");
    expect(source).toContain("max-h-[min(70dvh,40rem)]");
    expect(source).toContain("lg:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)]");
    expect(source).toContain("grid-rows-[auto_minmax(0,1fr)]");

    expect(source).toContain('data-testid="machine-form-header"');
    expect(source).toMatch(/machine-form-header[\s\S]*?row-start-1/);
    expect(source).toMatch(/machine-form-actions[\s\S]*?row-start-1/);
    expect(source).toMatch(/machine-form-fields[\s\S]*?row-start-2/);
    expect(source).toMatch(/machine-form-fields[\s\S]*?overflow-y-auto/);

    expect(source).not.toContain("sticky bottom-0");
    expect(source).not.toContain("shadow-[0_-8px_16px_-16px_rgba(0,0,0,0.55)]");
  });

  it("keeps list scroll and pagination independent of the form card", () => {
    expect(source).toContain('data-testid="machines-list-panel"');
    expect(source).toContain('data-testid="machines-list-scroll"');
    expect(source).toContain('data-testid="machines-list-pagination"');
    expect(source).toContain("MasterListPagination");

    const listBlock = source.slice(
      source.indexOf('data-testid="machines-list-panel"'),
      source.indexOf('data-testid="machine-form-card"'),
    );
    expect(listBlock).toContain("overflow-auto");
    expect(listBlock).toContain("shrink-0");
    expect(listBlock).toContain("MasterListPagination");
  });
});
