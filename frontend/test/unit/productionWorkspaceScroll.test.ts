import { describe, expect, it, vi } from "vitest";
import { scrollProductionWorkspaceToActiveEntry } from "../../src/lib/productionWorkspaceScroll";

describe("productionWorkspaceScroll", () => {
  it("resets scroll to the active production entry area after auto-advance", () => {
    const scrollIntoView = vi.fn();
    const win = {
      setTimeout: (fn: () => void) => {
        fn();
        return 1 as never;
      },
      scrollTo: vi.fn(),
    };

    scrollProductionWorkspaceToActiveEntry({ scrollIntoView } as never, null, win as never);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(win.scrollTo).not.toHaveBeenCalled();
  });

  it("falls back to page top when no active entry element is mounted", () => {
    const win = {
      setTimeout: (fn: () => void) => {
        fn();
        return 1 as never;
      },
      scrollTo: vi.fn(),
    };

    scrollProductionWorkspaceToActiveEntry(null, null, win as never);

    expect(win.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
