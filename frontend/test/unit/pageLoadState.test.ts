import { describe, expect, it } from "vitest";
import {
  createInFlightFetchDeduper,
  isDispatchSalesOrdersBootPending,
  isPageRefreshing,
  resolveReportTableLoadUi,
  shouldCommitAsyncFetchResult,
  shouldReplacePageWithInitialLoader,
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

  it("ignores obsolete async fetch generations", () => {
    expect(shouldCommitAsyncFetchResult(1, 1)).toBe(true);
    expect(shouldCommitAsyncFetchResult(1, 2)).toBe(false);
  });

  it("keeps dispatch completion messaging blocked until sales-order boot completes", () => {
    expect(isDispatchSalesOrdersBootPending(false)).toBe(true);
    expect(isDispatchSalesOrdersBootPending(true)).toBe(false);
  });

  it("does not replace the page during background refresh when data is already visible", () => {
    const snapshot = { firstLoadDone: true, loading: true, hasDisplayData: true };
    expect(shouldReplacePageWithInitialLoader(snapshot)).toBe(false);
    expect(isPageRefreshing(snapshot)).toBe(true);
  });

  it("report table gate keeps rows during refresh and delays empty until boot", () => {
    const boot = resolveReportTableLoadUi({
      firstLoadDone: false,
      loading: true,
      hasDisplayData: false,
      isEmpty: true,
    });
    expect(boot.showInitialLoader).toBe(true);
    expect(boot.showEmpty).toBe(false);
    expect(boot.showTable).toBe(false);

    const refresh = resolveReportTableLoadUi({
      firstLoadDone: true,
      loading: true,
      hasDisplayData: true,
      isEmpty: false,
    });
    expect(refresh.showInitialLoader).toBe(false);
    expect(refresh.showRefreshing).toBe(true);
    expect(refresh.showTable).toBe(true);
    expect(refresh.showEmpty).toBe(false);

    const empty = resolveReportTableLoadUi({
      firstLoadDone: true,
      loading: false,
      hasDisplayData: true,
      isEmpty: true,
    });
    expect(empty.showEmpty).toBe(true);
    expect(empty.showTable).toBe(false);
  });
});

describe("ErpPageContentGate semantics", () => {
  it("initial loading does not qualify as empty-ready", () => {
    const firstLoadDone = false;
    const isEmpty = true;
    expect(shouldShowEmptyState({ firstLoadDone, isEmpty })).toBe(false);
    expect(shouldShowInitialPageSkeleton({ firstLoadDone, loading: true, hasDisplayData: false })).toBe(true);
  });

  it("mutation pending does not replace initial page loading", () => {
    expect(shouldShowInitialPageSkeleton({ firstLoadDone: true, loading: true, hasDisplayData: true })).toBe(false);
    expect(isPageRefreshing({ firstLoadDone: true, loading: true, hasDisplayData: true })).toBe(true);
  });
});
