import * as React from "react";

/**
 * FT-PERF-001 — lightweight client-side performance marks.
 * Logs in dev (or when localStorage `erp:perfLog` = "1").
 */

export type PerfMarkKind =
  | "page-load"
  | "login-submit"
  | "login-dashboard-ready"
  | "api";

export type PerfMark = {
  kind: PerfMarkKind;
  label: string;
  durationMs: number;
  at: string;
  meta?: Record<string, unknown>;
};

const marks: PerfMark[] = [];
const pageStartByLabel = new Map<string, number>();

function perfLoggingEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem("erp:perfLog") === "1";
  } catch {
    return false;
  }
}

export function startPerfMark(label: string): void {
  pageStartByLabel.set(label, performance.now());
}

export function endPerfMark(
  label: string,
  kind: PerfMarkKind,
  meta?: Record<string, unknown>,
): number | null {
  const started = pageStartByLabel.get(label);
  if (started == null) return null;
  pageStartByLabel.delete(label);
  const durationMs = Math.round((performance.now() - started) * 10) / 10;
  recordPerfMark({ kind, label, durationMs, at: new Date().toISOString(), meta });
  return durationMs;
}

export function recordPerfMark(mark: PerfMark): void {
  marks.push(mark);
  if (marks.length > 200) marks.shift();
  if (!perfLoggingEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`[perf:fe] ${mark.label} ${mark.durationMs}ms`, mark);
}

export function recordApiPerf(path: string, durationMs: number, meta?: Record<string, unknown>): void {
  recordPerfMark({
    kind: "api",
    label: path.split("?")[0],
    durationMs: Math.round(durationMs * 10) / 10,
    at: new Date().toISOString(),
    meta,
  });
}

export function getPerfMarks(): readonly PerfMark[] {
  return marks;
}

/** Mark page mount → first meaningful render (call when primary data load completes). */
export function usePagePerf(label: string, ready: boolean, meta?: Record<string, unknown>): void {
  const startedRef = React.useRef(false);
  const loggedRef = React.useRef(false);

  React.useEffect(() => {
    if (!startedRef.current) {
      startPerfMark(label);
      startedRef.current = true;
    }
  }, [label]);

  React.useEffect(() => {
    if (!ready || loggedRef.current) return;
    endPerfMark(label, "page-load", meta);
    loggedRef.current = true;
  }, [ready, label, meta]);
}
