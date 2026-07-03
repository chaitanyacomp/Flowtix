import { describe, expect, it } from "vitest";
import {
  createInFlightFetchDeduper,
  isPageRefreshing,
  shouldShowEmptyState,
  shouldShowInitialPageSkeleton,
} from "../../src/lib/pageLoadState";

describe("pageLoadState", () => {
  it("shows skeleton on initial load before display data exists", () => {
    expect(shouldShowInitialPageSkeleton({ firstLoadDone: false, loading: true, hasDisplayData: false })).toBe(true);
    expect(shouldShowInitialPageSkeleton({ firstLoadDone: false, loading: false, hasDisplayData: false })).toBe(true);
    expect(shouldShowInitialPageSkeleton({ firstLoadDone: true, loading: true, hasDisplayData: true })).toBe(false);
  });

  it("does not render false empty state before first load completes", () => {
    expect(shouldShowEmptyState({ firstLoadDone: false, isEmpty: true })).toBe(false);
    expect(shouldShowEmptyState({ firstLoadDone: true, isEmpty: true })).toBe(true);
    expect(shouldShowEmptyState({ firstLoadDone: true, isEmpty: false })).toBe(false);
  });

  it("keeps stale data visible while refreshing", () => {
    expect(isPageRefreshing({ firstLoadDone: true, loading: true, hasDisplayData: true })).toBe(true);
    expect(isPageRefreshing({ firstLoadDone: false, loading: true, hasDisplayData: false })).toBe(false);
    expect(isPageRefreshing({ firstLoadDone: true, loading: true, hasDisplayData: false })).toBe(false);
  });

  it("dedupes concurrent fetch calls for the same mount", async () => {
    const deduper = createInFlightFetchDeduper();
    let runs = 0;
    const task = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 5));
      return "ok";
    };
    const [a, b] = await Promise.all([deduper.run(task), deduper.run(task)]);
    expect(runs).toBe(1);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
  });
});

describe("ErpPageContentGate semantics", () => {
  it("initial loading does not qualify as empty-ready", () => {
    const firstLoadDone = false;
    const isEmpty = true;
    expect(shouldShowEmptyState({ firstLoadDone, isEmpty })).toBe(false);
    expect(shouldShowInitialPageSkeleton({ firstLoadDone, loading: true, hasDisplayData: false })).toBe(true);
  });
});
