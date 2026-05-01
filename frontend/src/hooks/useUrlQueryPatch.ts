import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { applySearchParamsPatch } from "../lib/urlSearchParamsPatch";

/**
 * Merge query updates with replace navigation (back-friendly list/report state).
 */
export function useUrlQueryPatch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const patch = React.useCallback(
    (
      updates: Record<string, string | number | boolean | null | undefined>,
      opts?: { omitWhenEquals?: Record<string, string> },
    ) => {
      setSearchParams((prev) => applySearchParamsPatch(prev, updates, opts), { replace: true });
    },
    [setSearchParams],
  );
  return { searchParams, setSearchParams, patch };
}
