/**
 * Tally master-import busy/progress helpers (pure — unit-testable).
 */

export type TallyImportBusyKind = "idle" | "preview" | "apply";

export type TallyImportProgressPhase =
  | "idle"
  | "uploading"
  | "analysing"
  | "preparing_preview"
  | "preview_ready"
  | "importing"
  | "failed";

export type TallyImportProgressView = {
  phase: TallyImportProgressPhase;
  /** Measurable percent 0–100, or null when indeterminate. Never 100 until preview_ready. */
  percent: number | null;
  indeterminate: boolean;
  filename: string;
  stageLabel: string;
  detail: string;
  elapsedMs: number;
  etaLabel?: string | null;
  stalled?: boolean;
  /** Apply batch progress when known */
  batchIndex?: number | null;
  batchTotal?: number | null;
  itemsProcessed?: number | null;
  itemsTotal?: number | null;
};

/** Minimum processed items before ETA is shown. */
export const ETA_MIN_PROCESSED = 40;
/** Stall warning after no progress change. */
export const STALL_WARNING_MS = 30_000;

/** Upload phase maps real XHR progress into 0–40. */
export function mapUploadPercent(loaded: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 5;
  const raw = Math.max(0, Math.min(1, loaded / total));
  return Math.round(raw * 40);
}

/**
 * Cap analysis display percent at 99 until preview is ready.
 * Prefer explicit processed/total when available.
 */
export function mapAnalysisDisplayPercent(opts: {
  serverPercent?: number | null;
  processed?: number | null;
  total?: number | null;
}): number | null {
  const processed = opts.processed;
  const total = opts.total;
  if (
    processed != null &&
    total != null &&
    Number.isFinite(processed) &&
    Number.isFinite(total) &&
    total > 0
  ) {
    const ratio = Math.max(0, Math.min(1, processed / total));
    // Keep analysis in 40–85 band of overall preview journey
    return Math.min(85, Math.round(40 + ratio * 45));
  }
  if (opts.serverPercent == null || !Number.isFinite(opts.serverPercent)) return null;
  return Math.min(99, Math.max(0, Math.round(opts.serverPercent)));
}

/** @deprecated Prefer mapAnalysisDisplayPercent — kept for older tests. */
export function mapAnalysisPercent(serverPercent: number | null | undefined): number {
  return mapAnalysisDisplayPercent({ serverPercent }) ?? 40;
}

export function mapPreparingPreviewPercent(): number {
  return 90;
}

export function previewReadyPercent(): number {
  return 100;
}

/**
 * Apply batch progress into a soft 5–95 band (never 100 until apply response lands).
 */
export function mapImportBatchPercent(batchIndex: number, batchTotal: number): number {
  if (!Number.isFinite(batchTotal) || batchTotal <= 0) return 10;
  const idx = Math.max(0, Math.min(batchTotal, batchIndex));
  return Math.round(5 + (idx / batchTotal) * 90);
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m <= 0) return `${rem}s`;
  return `${m}m ${String(rem).padStart(2, "0")}s`;
}

export type EtaRateSample = { processed: number; atMs: number };

/**
 * Smoothed ETA from processing rate. Returns null until enough measurable progress.
 */
export function estimateRemainingMs(opts: {
  processed: number;
  total: number;
  elapsedMs: number;
  previous?: EtaRateSample | null;
}): { etaMs: number | null; label: string; ratePerSec: number | null } {
  const { processed, total, elapsedMs } = opts;
  if (
    !Number.isFinite(processed) ||
    !Number.isFinite(total) ||
    total <= 0 ||
    processed < ETA_MIN_PROCESSED ||
    elapsedMs < 1000
  ) {
    return { etaMs: null, label: "Estimating remaining time…", ratePerSec: null };
  }
  const remaining = Math.max(0, total - processed);
  if (remaining <= 0) {
    return { etaMs: 0, label: "Finishing…", ratePerSec: null };
  }

  // Prefer instantaneous smoothed rate vs previous sample when available.
  let ratePerSec = processed / (elapsedMs / 1000);
  const prev = opts.previous;
  if (prev && prev.atMs < elapsedMs && processed > prev.processed) {
    const dProc = processed - prev.processed;
    const dSec = (elapsedMs - prev.atMs) / 1000;
    if (dSec > 0.2) {
      const instant = dProc / dSec;
      ratePerSec = ratePerSec * 0.4 + instant * 0.6;
    }
  }
  if (!Number.isFinite(ratePerSec) || ratePerSec <= 0.01) {
    return { etaMs: null, label: "Estimating remaining time…", ratePerSec: null };
  }
  const etaMs = Math.round((remaining / ratePerSec) * 1000);
  return { etaMs, label: `Estimated remaining: ${formatElapsed(etaMs)}`, ratePerSec };
}

export function isProgressStalled(opts: {
  lastProgressAtMs: number;
  nowMs: number;
  stallMs?: number;
}): boolean {
  const stallMs = opts.stallMs ?? STALL_WARNING_MS;
  return opts.nowMs - opts.lastProgressAtMs >= stallMs;
}

export function buildUploadingView(filename: string, uploadPercent: number, elapsedMs: number): TallyImportProgressView {
  return {
    phase: "uploading",
    percent: Math.max(0, Math.min(40, uploadPercent)),
    indeterminate: false,
    filename,
    stageLabel: "Uploading file",
    detail: `Uploading and analysing “${filename}”…`,
    elapsedMs,
    etaLabel: null,
  };
}

export function buildAnalysingView(
  filename: string,
  opts: {
    recordsHint?: number | null;
    processed?: number | null;
    total?: number | null;
    serverPercent?: number | null;
    elapsedMs: number;
    etaLabel?: string | null;
    stalled?: boolean;
  },
): TallyImportProgressView {
  const total = opts.total ?? opts.recordsHint ?? null;
  const processed = opts.processed ?? null;
  const percent = mapAnalysisDisplayPercent({
    serverPercent: opts.serverPercent,
    processed,
    total,
  });
  const hasCounts =
    processed != null && total != null && Number.isFinite(processed) && Number.isFinite(total) && total > 0;
  const pctPart = percent != null ? ` · ${percent}%` : "";
  let detail: string;
  if (hasCounts) {
    detail = `Processed ${processed!.toLocaleString("en-IN")} of ${total!.toLocaleString("en-IN")} stock items${pctPart}`;
  } else if (total && total > 0) {
    detail = `File uploaded. Analysing ${total.toLocaleString("en-IN")} stock-item records…`;
  } else {
    detail = `File uploaded. Analysing Tally XML — large files may take a few minutes.`;
  }
  if (opts.stalled) {
    // Stall copy is rendered separately in the overlay; keep detail focused on counts.
  }
  return {
    phase: "analysing",
    percent,
    indeterminate: percent == null,
    filename,
    stageLabel: "Server analysing XML",
    detail,
    elapsedMs: opts.elapsedMs,
    etaLabel: opts.etaLabel ?? (hasCounts ? "Estimating remaining time…" : null),
    stalled: Boolean(opts.stalled),
    itemsProcessed: processed,
    itemsTotal: total,
  };
}

export function buildPreparingPreviewView(filename: string, elapsedMs: number): TallyImportProgressView {
  return {
    phase: "preparing_preview",
    percent: mapPreparingPreviewPercent(),
    indeterminate: false,
    filename,
    stageLabel: "Preparing preview",
    detail: "Building preview rows and mapping tables…",
    elapsedMs,
    etaLabel: null,
  };
}

export function buildPreviewReadyView(filename: string, elapsedMs: number): TallyImportProgressView {
  return {
    phase: "preview_ready",
    percent: previewReadyPercent(),
    indeterminate: false,
    filename,
    stageLabel: "Preview ready",
    detail: "Preview is ready for review.",
    elapsedMs,
    etaLabel: null,
  };
}

export function buildImportingView(
  filename: string,
  opts: {
    elapsedMs: number;
    batchIndex?: number | null;
    batchTotal?: number | null;
    itemsProcessed?: number | null;
    itemsTotal?: number | null;
  },
): TallyImportProgressView {
  const bi = opts.batchIndex ?? null;
  const bt = opts.batchTotal ?? null;
  const ip = opts.itemsProcessed ?? null;
  const it = opts.itemsTotal ?? null;
  let detail = "Importing records in batches of 100…";
  if (bi != null && bt != null && it != null) {
    detail = `Importing batch ${bi} of ${bt} — ${(ip ?? 0).toLocaleString("en-IN")} of ${it.toLocaleString("en-IN")} items processed`;
  } else if (bi != null && bt != null) {
    detail = `Importing batch ${bi} of ${bt}…`;
  }
  return {
    phase: "importing",
    percent: bi != null && bt != null ? mapImportBatchPercent(bi, bt) : null,
    indeterminate: bi == null || bt == null,
    filename,
    stageLabel: "Importing",
    detail,
    elapsedMs: opts.elapsedMs,
    batchIndex: bi,
    batchTotal: bt,
    itemsProcessed: ip,
    itemsTotal: it,
  };
}

export function buildFailedView(filename: string, stageLabel: string, detail: string, elapsedMs: number): TallyImportProgressView {
  return {
    phase: "failed",
    percent: null,
    indeterminate: false,
    filename,
    stageLabel,
    detail,
    elapsedMs,
    etaLabel: null,
  };
}

/**
 * Synchronous submission guard: returns true if this caller acquired the lock.
 */
export function tryAcquireBusy(busyRef: { current: boolean }): boolean {
  if (busyRef.current) return false;
  busyRef.current = true;
  return true;
}

export function releaseBusy(busyRef: { current: boolean }): void {
  busyRef.current = false;
}

export function newClientOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stage-1 options locked while previewing/applying or after successful preview until Start over. */
export function stage1InputsLocked(busy: boolean, previewLocked: boolean): boolean {
  return busy || previewLocked;
}

/** Stage-2 mapping editable only when preview is ready and not applying. */
export function stage2MappingEditable(hasPreview: boolean, busy: boolean): boolean {
  return hasPreview && !busy;
}

export function startOverAllowed(busy: boolean): boolean {
  return !busy;
}

/** Ignore stale async results when a newer request superseded this one. */
export function isCurrentRequest(requestId: number, currentId: number): boolean {
  return requestId === currentId;
}
