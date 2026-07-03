import { describe, expect, it } from "vitest";
import { matchRoutePrefix } from "../../src/hooks/useRouteActive";

describe("matchRoutePrefix", () => {
  it("matches exact path", () => {
    expect(matchRoutePrefix("/pending-actions", "/pending-actions")).toBe(true);
  });

  it("matches nested path prefix", () => {
    expect(matchRoutePrefix("/dashboard/extra", "/dashboard")).toBe(true);
  });

  it("returns false for unrelated routes", () => {
    expect(matchRoutePrefix("/pending-actions", "/dashboard")).toBe(false);
  });

  it("treats root as exact match only", () => {
    expect(matchRoutePrefix("/", "/")).toBe(true);
    expect(matchRoutePrefix("/dashboard", "/")).toBe(false);
  });
});
