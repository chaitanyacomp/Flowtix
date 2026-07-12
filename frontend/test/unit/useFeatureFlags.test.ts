import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

import { apiFetch } from "../../src/services/api";
import {
  __resetFeatureFlagsForTests,
  getFeatureFlagsSnapshot,
  loadFeatureFlags,
} from "../../src/hooks/useFeatureFlags";

describe("useFeatureFlags / loadFeatureFlags recovery", () => {
  beforeEach(() => {
    __resetFeatureFlagsForTests();
    vi.mocked(apiFetch).mockReset();
  });

  afterEach(() => {
    __resetFeatureFlagsForTests();
  });

  it("does not permanently cache OFF after a failed feature-flags request", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Network down"));
    await expect(loadFeatureFlags()).rejects.toThrow(/Network down/);
    expect(getFeatureFlagsSnapshot()).toEqual({
      flags: null,
      error: "Network down",
      hasResolved: false,
    });

    vi.mocked(apiFetch).mockResolvedValueOnce({
      monthlyPlanning: true,
      planningDrivenProcurement: false,
    });
    const flags = await loadFeatureFlags();
    expect(flags.monthlyPlanning).toBe(true);
    expect(getFeatureFlagsSnapshot()).toEqual({
      flags: { monthlyPlanning: true, planningDrivenProcurement: false },
      error: null,
      hasResolved: true,
    });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("successful retry restores Monthly Planning availability without sticky OFF", async () => {
    vi.mocked(apiFetch)
      .mockRejectedValueOnce(new Error("backend unavailable"))
      .mockResolvedValueOnce({ monthlyPlanning: true, planningDrivenProcurement: true });

    await expect(loadFeatureFlags()).rejects.toThrow(/backend unavailable/);
    expect(getFeatureFlagsSnapshot().hasResolved).toBe(false);

    const recovered = await loadFeatureFlags();
    expect(recovered).toEqual({
      monthlyPlanning: true,
      planningDrivenProcurement: true,
    });
  });

  it("caches a successful response for subsequent loads", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ monthlyPlanning: true });
    await loadFeatureFlags();
    await loadFeatureFlags();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
