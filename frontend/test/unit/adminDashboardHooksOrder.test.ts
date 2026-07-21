import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  countAuthoritativeRmShortageCases,
  pickLiveFactoryHighlights,
  summarizeLiveFactoryCounters,
} from "../../src/lib/liveFactoryStatus";

/**
 * Guard: AdminOperationalDashboardPage must not call hooks after early returns
 * (loading / error / empty). Regression for "Rendered more hooks than during
 * the previous render" after Live Factory Status.
 */
describe("AdminOperationalDashboardPage hooks order", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/pages/DashboardPage.tsx"),
    "utf8",
  );

  const fnStart = source.indexOf("export function AdminOperationalDashboardPage");
  expect(fnStart).toBeGreaterThan(-1);
  const body = source.slice(fnStart);
  const loadingReturn = body.search(/if\s*\(\s*loading\s*\)\s*\{/);
  expect(loadingReturn).toBeGreaterThan(-1);

  const beforeLoading = body.slice(0, loadingReturn);
  const afterLoading = body.slice(loadingReturn);

  it("1–2. All React hooks in AdminOperationalDashboardPage run before loading early return", () => {
    const hookRe = /\bReact\.(use(?:State|Memo|Effect|LayoutEffect|Callback|Ref))\b/g;
    const afterHooks = [...afterLoading.matchAll(hookRe)].map((m) => m[1]);
    expect(afterHooks).toEqual([]);
    expect(beforeLoading).toMatch(/authoritativeRmShortage/);
    expect(beforeLoading).toMatch(/React\.useMemo/);
  });

  it("3. Empty Live Factory dataset classifies safely", () => {
    expect(summarizeLiveFactoryCounters([])).toEqual({
      readyToStart: 0,
      running: 0,
      paused: 0,
      blocked: 0,
      awaitingReport: 0,
      pendingQc: 0,
    });
    expect(pickLiveFactoryHighlights([], 5)).toEqual([]);
    expect(countAuthoritativeRmShortageCases([])).toEqual({ caseCount: 0, firstDoc: null });
  });

  it("4. Populated Live Factory / null rmRisk defaults safely", () => {
    const counters = summarizeLiveFactoryCounters([
      {
        workOrderId: 1,
        workOrderNo: "WO-1",
        itemName: "A",
        requiredQty: 10,
        producedQty: 0,
        balanceQty: 10,
        nextAction: "PRODUCTION_PENDING",
        productionWorkState: "READY_TO_START",
        rmReadyForProduction: true,
        canAcceptProductionEntry: true,
      },
    ]);
    expect(counters.readyToStart).toBe(1);
    expect(countAuthoritativeRmShortageCases(null)).toEqual({ caseCount: 0, firstDoc: null });
  });

  it("5. authoritativeRmShortage useMemo is declared before loading return", () => {
    const memoIdx = beforeLoading.lastIndexOf("authoritativeRmShortage");
    expect(memoIdx).toBeGreaterThan(-1);
    expect(memoIdx).toBeLessThan(loadingReturn);
  });
});
