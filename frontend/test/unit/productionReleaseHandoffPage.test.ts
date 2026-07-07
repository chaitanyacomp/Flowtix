import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pagePath = resolve(__dirname, "../../src/pages/ProductionReleaseHandoffPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

describe("ProductionReleaseHandoffPage release UX", () => {
  it("exports page component", async () => {
    const mod = await import("../../src/pages/ProductionReleaseHandoffPage");
    expect(typeof mod.ProductionReleaseHandoffPage).toBe("function");
  });

  it("does not navigate away after release", () => {
    expect(pageSource).not.toContain("buildPostReleaseProductionHref");
    expect(pageSource).not.toContain('navigate("/production');
    expect(pageSource).not.toContain('navigate(`/production');
    expect(pageSource).toContain("void loadQueue({ silent: true })");
    expect(pageSource).toContain("onBackToList()");
  });

  it("shows release queue empty state copy", () => {
    expect(pageSource).toContain("No work orders awaiting release.");
    expect(pageSource).toContain('data-testid="production-release-empty"');
  });

  it("still refreshes pending actions and dashboard counters after release", () => {
    expect(pageSource).toContain('bumpErpRefresh(["pending-actions", "dashboard", "production"])');
  });
});
