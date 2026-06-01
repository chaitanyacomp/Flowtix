import * as React from "react";
import { apiFetch } from "../services/api";

export type FeatureFlags = {
  monthlyPlanning: boolean;
  planningDrivenProcurement: boolean;
};

const DEFAULT_FLAGS: FeatureFlags = { monthlyPlanning: false, planningDrivenProcurement: false };

// Module-level cache so the flags are fetched once per session and shared across components.
let cachedFlags: FeatureFlags | null = null;
let inFlight: Promise<FeatureFlags> | null = null;

async function fetchFlags(): Promise<FeatureFlags> {
  if (cachedFlags) return cachedFlags;
  if (!inFlight) {
    inFlight = apiFetch<Partial<FeatureFlags>>("/api/config/feature-flags")
      .then((res) => {
        cachedFlags = { ...DEFAULT_FLAGS, ...(res ?? {}) };
        return cachedFlags;
      })
      .catch(() => {
        // On failure, treat all flags as OFF (safe default).
        cachedFlags = { ...DEFAULT_FLAGS };
        return cachedFlags;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Read runtime feature flags (fetched once, cached). Defaults to all-OFF until loaded. */
export function useFeatureFlags(): { flags: FeatureFlags; loading: boolean } {
  const [flags, setFlags] = React.useState<FeatureFlags>(cachedFlags ?? DEFAULT_FLAGS);
  const [loading, setLoading] = React.useState<boolean>(cachedFlags == null);

  React.useEffect(() => {
    let active = true;
    if (cachedFlags) {
      setFlags(cachedFlags);
      setLoading(false);
      return;
    }
    void fetchFlags().then((f) => {
      if (!active) return;
      setFlags(f);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { flags, loading };
}
