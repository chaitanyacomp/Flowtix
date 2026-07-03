import { describe, expect, it } from "vitest";
import {
  buildErpApiCacheKey,
  buildErpPageCacheKey,
  clearErpDataCache,
  invalidateErpCacheForScopes,
  readErpCachedData,
  runErpDedupedFetch,
  writeErpCache,
} from "../../src/lib/erpDataCache";

describe("erpDataCache", () => {
  it("builds role-scoped page and api keys", () => {
    expect(buildErpPageCacheKey({ role: "store", route: "/dashboard", queryKey: "backlog" })).toBe(
      "STORE::/dashboard::backlog",
    );
    expect(buildErpApiCacheKey("STORE", "/api/pending-actions")).toBe("STORE::GET::/api/pending-actions");
  });

  it("hydrates page cache from api cache fallback", () => {
    clearErpDataCache("test");
    const pageKey = buildErpPageCacheKey({ role: "STORE", route: "/pending-actions", queryKey: "list" });
    const apiKey = buildErpApiCacheKey("STORE", "/api/pending-actions");
    writeErpCache(pageKey, apiKey, { data: { count: 2, actions: [] }, error: null, updatedAt: Date.now() });
    expect(readErpCachedData(pageKey, apiKey)?.data).toEqual({ count: 2, actions: [] });
  });

  it("dedupes concurrent fetches for the same api key", async () => {
    clearErpDataCache("test");
    const apiKey = buildErpApiCacheKey("STORE", "/api/pending-actions");
    let runs = 0;
    const task = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 5));
      return "ok";
    };
    const [a, b] = await Promise.all([runErpDedupedFetch(apiKey, task), runErpDedupedFetch(apiKey, task)]);
    expect(runs).toBe(1);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
  });

  it("invalidates dashboard and pending-actions scopes for the active role", () => {
    clearErpDataCache("test");
    const dashKey = buildErpPageCacheKey({ role: "STORE", route: "/dashboard", queryKey: "backlog" });
    const paKey = buildErpPageCacheKey({ role: "STORE", route: "/pending-actions", queryKey: "list" });
    const dashApiKey = buildErpApiCacheKey("STORE", "/api/dashboard/dispatch-backlog");
    const paApiKey = buildErpApiCacheKey("STORE", "/api/pending-actions");
    writeErpCache(dashKey, dashApiKey, { data: [], error: null, updatedAt: Date.now() });
    writeErpCache(paKey, paApiKey, { data: { count: 0, actions: [] }, error: null, updatedAt: Date.now() });

    invalidateErpCacheForScopes(["dashboard"], "STORE");
    expect(readErpCachedData(dashKey, dashApiKey)).toBeUndefined();
    expect(readErpCachedData(paKey, paApiKey)).toBeDefined();

    invalidateErpCacheForScopes(["pending-actions"], "STORE");
    expect(readErpCachedData(paKey, paApiKey)).toBeUndefined();
  });

  it("clears all entries on logout reset", () => {
    const pageKey = buildErpPageCacheKey({ role: "ADMIN", route: "/dashboard", queryKey: "summary" });
    const apiKey = buildErpApiCacheKey("ADMIN", "/api/dashboard");
    writeErpCache(pageKey, apiKey, { data: {}, error: null, updatedAt: Date.now() });
    clearErpDataCache("logout");
    expect(readErpCachedData(pageKey, apiKey)).toBeUndefined();
  });
});

describe("usePendingActionsPageData SWR wiring", () => {
  it("uses cached query hook with route-scoped key", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const file = readFileSync(resolve(__dirname, "../../src/hooks/usePendingActionsPageData.ts"), "utf8");
    expect(file).toContain("useErpCachedQuery");
    expect(file).toContain("PENDING_ACTIONS_ROUTE");
    expect(file).toContain('apiPath: "/api/pending-actions"');
  });
});
