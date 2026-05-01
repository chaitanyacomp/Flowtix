/**
 * Merge updates into URLSearchParams, omitting empty values and optional defaults.
 * Use with setSearchParams((prev) => applySearchParamsPatch(prev, patch, opts), { replace: true }).
 */
export function applySearchParamsPatch(
  prev: URLSearchParams,
  patch: Record<string, string | number | boolean | null | undefined>,
  options?: { omitWhenEquals?: Record<string, string> },
): URLSearchParams {
  const next = new URLSearchParams(prev);
  const omit = options?.omitWhenEquals ?? {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      next.delete(key);
      continue;
    }
    const str = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    if (str === "") {
      next.delete(key);
      continue;
    }
    if (omit[key] !== undefined && omit[key] === str) {
      next.delete(key);
    } else {
      next.set(key, str);
    }
  }
  return next;
}

export function readUrlString(sp: URLSearchParams, key: string, defaultVal = ""): string {
  return sp.get(key) ?? defaultVal;
}

export function readUrlEnum<T extends string>(
  sp: URLSearchParams,
  key: string,
  allowed: readonly T[],
  defaultVal: T,
): T {
  const v = sp.get(key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : defaultVal;
}

export function readUrlInt(sp: URLSearchParams, key: string, defaultVal = 0): number {
  const v = sp.get(key);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : defaultVal;
}

export function readUrlBool(sp: URLSearchParams, key: string): boolean {
  const v = sp.get(key);
  return v === "1" || v === "true";
}

/** Remove the given query keys (replace navigation preserves unrelated params). */
export function deleteUrlParamKeys(prev: URLSearchParams, keys: readonly string[]): URLSearchParams {
  const patch: Record<string, null> = {};
  for (const k of keys) patch[k] = null;
  return applySearchParamsPatch(prev, patch);
}
