import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ProductionOperatorWorkbench", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionOperatorWorkbench.tsx"),
    "utf8",
  );

  it("implements FT-PD-066 MES grid layout", () => {
    expect(source).toContain('data-testid="production-operator-workbench"');
    expect(source).toContain("PRODUCTION_OPERATOR_WORKBENCH_GRID");
    expect(source).toContain("Production entry");
    expect(source).toContain("Recent entries");
    expect(source).toContain('data-testid="production-operator-recent-panel"');
  });
});
