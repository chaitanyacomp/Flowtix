import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ProductionOperatorIdentityBar", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/erp/production/ProductionOperatorIdentityBar.tsx"),
    "utf8",
  );

  it("exposes FT-PD-066 identity bar and KPI strip test ids", () => {
    expect(source).toContain('data-testid="production-operator-identity-bar"');
    expect(source).toContain('data-testid="production-operator-kpi-strip"');
    expect(source).toContain("Planned");
    expect(source).toContain("Produced");
    expect(source).toContain("Remaining");
    expect(source).toContain("flowContextLabel");
    expect(source).toContain("text-[20px]");
  });
});
