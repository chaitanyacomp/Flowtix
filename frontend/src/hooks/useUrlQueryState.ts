import * as React from "react";
import { useUrlQueryPatch } from "./useUrlQueryPatch";
import {
  readUrlBool,
  readUrlEnum,
  readUrlInt,
  readUrlString,
} from "../lib/urlSearchParamsPatch";

export type UrlQueryRead = {
  string: (key: string, defaultVal?: string) => string;
  int: (key: string, defaultVal?: number) => number;
  bool: (key: string) => boolean;
  enum: <T extends string>(key: string, allowed: readonly T[], defaultVal: T) => T;
};

/**
 * URL query sync with typed readers and a patch that merges default omit rules (clean URLs).
 * Use with setSearchParams replace navigation via underlying useUrlQueryPatch.
 */
export function useUrlQueryState(defaultOmitWhenEquals?: Record<string, string>) {
  const { searchParams, patch: rawPatch, setSearchParams } = useUrlQueryPatch();

  const patch = React.useCallback(
    (
      updates: Record<string, string | number | boolean | null | undefined>,
      opts?: { omitWhenEquals?: Record<string, string> },
    ) => {
      rawPatch(updates, {
        omitWhenEquals: { ...defaultOmitWhenEquals, ...opts?.omitWhenEquals },
      });
    },
    [rawPatch, defaultOmitWhenEquals],
  );

  const read = React.useMemo<UrlQueryRead>(
    () => ({
      string: (key, defaultVal = "") => readUrlString(searchParams, key, defaultVal),
      int: (key, defaultVal = 0) => readUrlInt(searchParams, key, defaultVal),
      bool: (key) => readUrlBool(searchParams, key),
      enum: (key, allowed, defaultVal) => readUrlEnum(searchParams, key, allowed, defaultVal),
    }),
    [searchParams],
  );

  return { searchParams, setSearchParams, patch, read };
}

/**
 * Local draft for search text debounced into the URL. Syncs draft from URL on external
 * navigation (back/forward). Skips patch when trimmed value equals URL (avoids loops).
 */
export function useDebouncedUrlStringParam(options: {
  /** Current value from URL (e.g. read.string("search")) */
  urlValue: string;
  patch: (
    updates: Record<string, string | number | boolean | null | undefined>,
    opts?: { omitWhenEquals?: Record<string, string> },
  ) => void;
  paramKey: string;
  debounceMs?: number;
  omitWhenEquals?: Record<string, string>;
}): readonly [string, React.Dispatch<React.SetStateAction<string>>] {
  const { urlValue, patch, paramKey, debounceMs = 320, omitWhenEquals } = options;
  const [draft, setDraft] = React.useState(urlValue);

  React.useEffect(() => {
    setDraft(urlValue);
  }, [urlValue]);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = draft.trim();
      if (trimmed === urlValue.trim()) return;
      patch({ [paramKey]: trimmed || null }, { omitWhenEquals });
    }, debounceMs);
    return () => window.clearTimeout(t);
  }, [draft, urlValue, paramKey, debounceMs, patch, omitWhenEquals]);

  return [draft, setDraft] as const;
}
