import * as React from "react";
import { apiFetch } from "../services/api";

export type FeatureFlags = {
  monthlyPlanning: boolean;
  planningDrivenProcurement: boolean;
};

export type FeatureFlagsStatus = "loading" | "ready" | "error";

const DEFAULT_FLAGS: FeatureFlags = { monthlyPlanning: false, planningDrivenProcurement: false };

// Module-level cache: only successful responses are sticky for the SPA session.
let cachedFlags: FeatureFlags | null = null;
let lastFetchError: string | null = null;
let inFlight: Promise<FeatureFlags> | null = null;
const listeners = new Set<() => void>();

function notifyFeatureFlagsListeners() {
  for (const listener of listeners) listener();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return "Failed to load feature flags";
}

/**
 * Load runtime feature flags. Successful results are cached for the session.
 * Failures do **not** permanently cache all-OFF — a later call retries.
 */
export async function loadFeatureFlags(): Promise<FeatureFlags> {
  if (cachedFlags) return cachedFlags;
  if (!inFlight) {
    inFlight = apiFetch<Partial<FeatureFlags>>("/api/config/feature-flags")
      .then((res) => {
        cachedFlags = { ...DEFAULT_FLAGS, ...(res ?? {}) };
        lastFetchError = null;
        notifyFeatureFlagsListeners();
        return cachedFlags;
      })
      .catch((err) => {
        // Keep last known good cache if present; otherwise leave uncached so callers can retry.
        lastFetchError = errorMessage(err);
        notifyFeatureFlagsListeners();
        if (cachedFlags) return cachedFlags;
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Snapshot for tests / diagnostics. */
export function getFeatureFlagsSnapshot(): {
  flags: FeatureFlags | null;
  error: string | null;
  hasResolved: boolean;
} {
  return {
    flags: cachedFlags,
    error: lastFetchError,
    hasResolved: cachedFlags != null,
  };
}

/** Test-only: clear session cache so the next load retries the network. */
export function __resetFeatureFlagsForTests(): void {
  cachedFlags = null;
  lastFetchError = null;
  inFlight = null;
}

/**
 * Read runtime feature flags (fetched once on success, shared across components).
 * Network failure is distinguishable from a permanently disabled feature.
 */
export function useFeatureFlags(): {
  flags: FeatureFlags;
  loading: boolean;
  error: string | null;
  status: FeatureFlagsStatus;
  retry: () => void;
} {
  const [, setTick] = React.useState(0);
  const [loading, setLoading] = React.useState<boolean>(cachedFlags == null);
  const [localError, setLocalError] = React.useState<string | null>(
    cachedFlags == null ? lastFetchError : null,
  );

  React.useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const runLoad = React.useCallback(() => {
    if (cachedFlags) {
      setLoading(false);
      setLocalError(null);
      return;
    }
    setLoading(true);
    void loadFeatureFlags()
      .then(() => {
        setLocalError(null);
        setLoading(false);
      })
      .catch((err) => {
        setLocalError(errorMessage(err));
        setLoading(false);
      });
  }, []);

  React.useEffect(() => {
    runLoad();
  }, [runLoad]);

  const retry = React.useCallback(() => {
    if (cachedFlags) {
      setLocalError(null);
      setLoading(false);
      notifyFeatureFlagsListeners();
      return;
    }
    lastFetchError = null;
    setLocalError(null);
    setLoading(true);
    void loadFeatureFlags()
      .then(() => {
        setLocalError(null);
        setLoading(false);
      })
      .catch((err) => {
        setLocalError(errorMessage(err));
        setLoading(false);
      });
  }, []);

  const flags = cachedFlags ?? DEFAULT_FLAGS;
  const error = cachedFlags ? null : localError ?? lastFetchError;
  const status: FeatureFlagsStatus = cachedFlags
    ? "ready"
    : loading
      ? "loading"
      : error
        ? "error"
        : "loading";

  return { flags, loading, error, status, retry };
}
